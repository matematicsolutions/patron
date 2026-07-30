// Testy klienta kanalu dystrybucji paczek (ADR-0140). Kanal budujemy w tmp
// jako katalog (transport pendrive) - identyczny uklad co `lpf publish`:
// chunks/xx/<sha256>.gz + manifests/<name>.json + <pack>-<edition>.state.json.
// HTTP rozni sie wylacznie prefiksem sciezki, wiec katalog cwiczy cala logike
// delty, weryfikacji i podmiany pliku.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import Database from "better-sqlite3";
import {
  checkUpdate,
  fetchPack,
  listPackFiles,
  readChannelStamp,
  stampChannel,
  updatePack,
} from "./pack-channel";

const CHUNK = 1024; // maly chunk, zeby test operowal na kilku KB

let tmp: string;
let channel: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pack-channel-"));
  channel = path.join(tmp, "kanal");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** Odpowiednik `lpf publish` - wystarczajacy do cwiczenia klienta. */
function publish(packFile: string, version: string, packName = "pl-demo", edition = "full") {
  const data = fs.readFileSync(packFile);
  const digests: string[] = [];
  for (let off = 0; off < data.length; off += CHUNK) {
    const block = data.subarray(off, off + CHUNK);
    const digest = sha256(block);
    digests.push(digest);
    const dir = path.join(channel, "chunks", digest.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${digest}.gz`), zlib.gzipSync(block));
  }
  const manifestName = `${packName}-${edition}-${version}.json`;
  fs.mkdirSync(path.join(channel, "manifests"), { recursive: true });
  fs.writeFileSync(
    path.join(channel, "manifests", manifestName),
    JSON.stringify({
      pack_name: packName,
      edition,
      version,
      chunk_size: CHUNK,
      pack_size: data.length,
      pack_sha256: sha256(data),
      chunks: digests,
    }),
  );
  fs.writeFileSync(
    path.join(channel, `${packName}-${edition}.state.json`),
    JSON.stringify({
      pack_name: packName,
      edition,
      current_version: version,
      manifest: `manifests/${manifestName}`,
    }),
  );
  return path.join(channel, "manifests", manifestName);
}

/** Paczka = SQLite z pack_meta (jak w fabryce), wypelniona balastem do >4 chunkow. */
function makePack(file: string, packName = "pl-demo", filler = "A"): void {
  const db = new Database(file);
  db.exec("CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO pack_meta (key, value) VALUES ('pack_name', ?)").run(packName);
  db.exec("CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT)");
  const ins = db.prepare("INSERT INTO docs (body) VALUES (?)");
  for (let i = 0; i < 40; i++) ins.run(filler.repeat(200) + i);
  db.close();
}

describe("pack-channel", () => {
  it("fetchPack odtwarza paczke bit w bit i weryfikuje sha256 calosci", async () => {
    const pack = path.join(tmp, "pack.sqlite");
    makePack(pack);
    const manifest = publish(pack, "2026Q2");

    const out = path.join(tmp, "out.sqlite");
    const result = await fetchPack(manifest, out);

    expect(fs.readFileSync(out).equals(fs.readFileSync(pack))).toBe(true);
    expect(result.fromSeed).toBe(0);
    expect(result.downloaded).toBe(result.chunksTotal);
  });

  it("fetchPack z seedem pobiera wylacznie brakujace chunki", async () => {
    const v1 = path.join(tmp, "v1.sqlite");
    makePack(v1);
    // v2 = v1 + dopisane rekordy (bez VACUUM - strony nie przesuwaja sie)
    const v2 = path.join(tmp, "v2.sqlite");
    fs.copyFileSync(v1, v2);
    const db = new Database(v2);
    const ins = db.prepare("INSERT INTO docs (body) VALUES (?)");
    for (let i = 0; i < 8; i++) ins.run("NOWE".repeat(100) + i);
    db.close();
    const manifest = publish(v2, "2026Q3");

    const out = path.join(tmp, "out.sqlite");
    const result = await fetchPack(manifest, out, { seed: v1 });

    expect(fs.readFileSync(out).equals(fs.readFileSync(v2))).toBe(true);
    expect(result.fromSeed).toBeGreaterThan(0);
    expect(result.downloaded).toBeLessThan(result.chunksTotal);
  });

  it("uszkodzony chunk = twardy blad, wyjscie posprzatane", async () => {
    const pack = path.join(tmp, "pack.sqlite");
    makePack(pack);
    const manifest = publish(pack, "2026Q2");
    const digest = (
      JSON.parse(fs.readFileSync(manifest, "utf-8")) as { chunks: string[] }
    ).chunks[1];
    fs.writeFileSync(
      path.join(channel, "chunks", digest.slice(0, 2), `${digest}.gz`),
      zlib.gzipSync(Buffer.from("zle dane")),
    );

    await expect(fetchPack(manifest, path.join(tmp, "out.sqlite"))).rejects.toThrow(
      /nie zgadza sie ze skrotem/,
    );
  });

  it("checkUpdate: aktualna vs dostepna z realnym rozmiarem delty", async () => {
    const pack = path.join(tmp, "pack.sqlite");
    makePack(pack);
    publish(pack, "2026Q2");
    stampChannel(pack, channel, "2026Q2");

    expect((await checkUpdate(pack)).status).toBe("aktualna");

    const v2 = path.join(tmp, "v2.sqlite");
    fs.copyFileSync(pack, v2);
    const db = new Database(v2);
    db.prepare("INSERT INTO docs (body) VALUES (?)").run("ORZECZENIE".repeat(300));
    db.close();
    publish(v2, "2026Q3");

    const check = await checkUpdate(pack);
    expect(check.status).toBe("dostepna");
    expect(check.have).toBe("2026Q2");
    expect(check.available).toBe("2026Q3");
    expect(check.downloadBytes).toBeGreaterThan(0);
    expect(check.downloadBytes).toBeLessThan(check.packSize);
  });

  it("updatePack podmienia paczke w miejscu i przestemplowuje wersje", async () => {
    const pack = path.join(tmp, "pack.sqlite");
    makePack(pack);
    publish(pack, "2026Q2");
    stampChannel(pack, channel, "2026Q2");

    const v2 = path.join(tmp, "v2.sqlite");
    fs.copyFileSync(pack, v2);
    const db = new Database(v2);
    db.prepare("INSERT INTO docs (body) VALUES (?)").run("NOWELIZACJA".repeat(200));
    db.close();
    publish(v2, "2026Q3");

    const result = await updatePack(pack);
    expect(result.status).toBe("zaktualizowana");
    expect(result.from).toBe("2026Q2");
    expect(result.to).toBe("2026Q3");
    expect(result.savedPct).toBeGreaterThan(0);

    // Paczka po aktualizacji: nowa tresc + swiezy stempel; smieci sprzatniete.
    const stamp = readChannelStamp(pack);
    expect(stamp.channelVersion).toBe("2026Q3");
    expect(fs.existsSync(`${pack}.new`)).toBe(false);
    expect(fs.existsSync(`${pack}.prev`)).toBe(false);
    const db2 = new Database(pack, { readonly: true });
    const n = db2.prepare("SELECT COUNT(*) AS n FROM docs").get() as { n: number };
    db2.close();
    expect(n.n).toBe(41);
  });

  it("paczka bez stempla kanalu = czytelny blad", async () => {
    const pack = path.join(tmp, "pack.sqlite");
    makePack(pack);
    await expect(checkUpdate(pack)).rejects.toThrow(/nie wie, z jakiego kanalu/);
  });

  it("listPackFiles pomija stany przejsciowe .new/.prev", () => {
    const dir = path.join(tmp, "packs");
    fs.mkdirSync(dir);
    for (const f of ["a.sqlite", "b.db", "a.sqlite.new", "a.sqlite.prev", "notatka.txt"]) {
      fs.writeFileSync(path.join(dir, f), "x");
    }
    expect(listPackFiles(dir).map((f) => path.basename(f))).toEqual(["a.sqlite", "b.db"]);
  });
});
