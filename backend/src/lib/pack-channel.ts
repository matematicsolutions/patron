// Klient kanalu dystrybucji paczek wiedzy (ADR-0140) - port fetch/update z
// legal-pack-factory (src/legal_pack_factory/channel.py) na TypeScript.
// Wylacznie wbudowane moduly Node (https, crypto, zlib, fs) + better-sqlite3
// (juz w zaleznosciach backendu) do odczytu pack_meta z samej paczki.
//
// Wzorzec Steam/SteamPipe: paczka = chunki stalego rozmiaru (256 KB,
// wielokrotnosc strony SQLite 4096 B), kazdy gzipowany OSOBNO i adresowany
// wlasnym sha256. Manifest = lista skrotow w kolejnosci + skrot calosci.
// Klient pobiera wylacznie chunki, ktorych nie ma w lokalnej poprzedniej
// paczce (seed) - kwartalna aktualizacja to ~20% pliku zamiast 100%
// (pomiar na paczce US w legal-pack-factory/docs/kanal-dystrybucji.md).
//
// Transport jest nieistotny: `base` to URL http(s) ALBO katalog (pendrive).
// Ten sam manifest, ten sam klient, ta sama weryfikacja.
//
// Paczka zna swoj kanal: pack_meta.channel_url + channel_version (wzorzec
// naglowka OSM PBF) - aktualizacja nie potrzebuje konfiguracji obok pliku.
// Stara paczka jest ruszana dopiero, gdy nowa zlozy sie poprawnie i zgodzi
// ze skrotem; plik zajety przez inny proces = czytelny blad, stara paczka
// nietknieta.

import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import os from "os";
import path from "path";
import zlib from "zlib";
import Database from "better-sqlite3";

export const CHUNK_SIZE = 256 * 1024;
const HTTP_TIMEOUT_MS = 60_000;

export interface ChannelStamp {
  channelUrl: string | null;
  channelVersion: string | null;
  packName: string | null;
  edition: string;
}

interface ChannelState {
  pack_name: string;
  edition: string;
  current_version: string;
  manifest: string;
}

interface PackManifest {
  pack_name: string;
  version: string;
  chunk_size?: number;
  pack_size: number;
  pack_sha256: string;
  chunks: string[];
}

export interface FetchResult {
  chunksTotal: number;
  fromSeed: number;
  downloaded: number;
  downloadedBytes: number;
  savedPct: number;
  packSha256: string;
}

export interface UpdateCheck {
  status: "aktualna" | "dostepna";
  have: string | null;
  available: string;
  packSize: number;
  downloadBytes: number;
}

/** Plik zajety (baza otwarta przez inny proces) - do zmapowania na HTTP 409. */
export class PackBusyError extends Error {}

const sha256 = (data: Buffer): string =>
  crypto.createHash("sha256").update(data).digest("hex");

const isHttpBase = (base: string): boolean => /^https?:\/\//.test(base);

function httpGet(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https://") ? https : http;
    const req = mod.get(url, { timeout: HTTP_TIMEOUT_MS }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`Kanal odpowiedzial ${code} dla ${url}`));
        return;
      }
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => resolve(Buffer.concat(parts)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout pobierania ${url}`)));
    req.on("error", reject);
  });
}

/** Jedno zrodlo dla pendrive'a i sieci - rozni je tylko prefiks (jak w channel.py). */
async function readSource(base: string, rel: string): Promise<Buffer> {
  if (isHttpBase(base)) return httpGet(`${base.replace(/\/+$/, "")}/${rel}`);
  return fs.promises.readFile(path.join(base, rel));
}

/** Skad pochodzi paczka i jaka ma wersje (pack_meta; brak tabeli = brak stempla). */
export function readChannelStamp(packPath: string): ChannelStamp {
  const db = new Database(packPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare("SELECT key, value FROM pack_meta")
      .all() as Array<{ key: string; value: string }>;
    const meta = new Map(rows.map((r) => [r.key, r.value]));
    return {
      channelUrl: meta.get("channel_url") ?? null,
      channelVersion: meta.get("channel_version") ?? null,
      packName: meta.get("pack_name") ?? null,
      edition: meta.get("edition") ?? "full",
    };
  } finally {
    db.close();
  }
}

/** Wpisuje pochodzenie do samej paczki (patrz stamp_channel w channel.py). */
export function stampChannel(packPath: string, channelUrl: string, version: string): void {
  const db = new Database(packPath);
  try {
    const stmt = db.prepare("INSERT OR REPLACE INTO pack_meta (key, value) VALUES (?, ?)");
    db.transaction(() => {
      stmt.run("channel_url", channelUrl);
      stmt.run("channel_version", version);
    })();
  } finally {
    db.close();
  }
}

/**
 * Chunki poprzedniej wersji paczki - to one czynia aktualizacje tania.
 * W odroznieniu od wersji Python trzymamy digest -> offset (nie tresc):
 * paczka wazy do 1,6 GB i nie miesci sie w pamieci.
 */
async function indexSeed(seedPath: string, chunkSize: number): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!fs.existsSync(seedPath)) return index;
  const fd = await fs.promises.open(seedPath, "r");
  try {
    const buf = Buffer.alloc(chunkSize);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, chunkSize, offset);
      if (bytesRead === 0) break;
      const digest = sha256(buf.subarray(0, bytesRead));
      if (!index.has(digest)) index.set(digest, offset);
      offset += bytesRead;
    }
  } finally {
    await fd.close();
  }
  return index;
}

async function loadManifest(
  manifestSrc: string,
  baseOverride?: string,
): Promise<{ manifest: PackManifest; base: string }> {
  let raw: Buffer;
  let defaultBase: string;
  if (isHttpBase(manifestSrc)) {
    raw = await httpGet(manifestSrc);
    defaultBase = manifestSrc.split("/manifests/")[0];
  } else {
    raw = await fs.promises.readFile(manifestSrc);
    defaultBase = path.dirname(path.dirname(manifestSrc));
  }
  return { manifest: JSON.parse(raw.toString("utf-8")) as PackManifest, base: baseOverride ?? defaultBase };
}

/** Odtwarza paczke z kanalu, pobierajac wylacznie brakujace chunki. */
export async function fetchPack(
  manifestSrc: string,
  outPath: string,
  opts: { base?: string; seed?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<FetchResult> {
  const { manifest, base } = await loadManifest(manifestSrc, opts.base);
  const chunkSize = manifest.chunk_size ?? CHUNK_SIZE;
  const seedIndex = opts.seed ? await indexSeed(opts.seed, chunkSize) : new Map<string, number>();
  const seedFd = opts.seed && seedIndex.size > 0 ? await fs.promises.open(opts.seed, "r") : null;

  let fromSeed = 0;
  let downloaded = 0;
  let downloadedBytes = 0;
  const whole = crypto.createHash("sha256");

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const out = await fs.promises.open(outPath, "w");
  try {
    const seedBuf = Buffer.alloc(chunkSize);
    for (let i = 0; i < manifest.chunks.length; i++) {
      const digest = manifest.chunks[i];
      let block: Buffer;
      const seedOffset = seedIndex.get(digest);
      if (seedFd && seedOffset !== undefined) {
        const { bytesRead } = await seedFd.read(seedBuf, 0, chunkSize, seedOffset);
        block = seedBuf.subarray(0, bytesRead);
        fromSeed++;
      } else {
        const rawGz = await readSource(base, `chunks/${digest.slice(0, 2)}/${digest}.gz`);
        downloadedBytes += rawGz.length;
        block = zlib.gunzipSync(rawGz);
        if (sha256(block) !== digest) {
          throw new Error(`Chunk ${digest} nie zgadza sie ze skrotem - kanal uszkodzony.`);
        }
        downloaded++;
      }
      await out.write(block);
      whole.update(block);
      opts.onProgress?.(i + 1, manifest.chunks.length);
    }
  } finally {
    await out.close();
    await seedFd?.close();
  }

  if (whole.digest("hex") !== manifest.pack_sha256) {
    await fs.promises.unlink(outPath).catch(() => undefined);
    throw new Error("Zlozona paczka nie zgadza sie ze skrotem z manifestu.");
  }

  const total = manifest.chunks.length;
  return {
    chunksTotal: total,
    fromSeed,
    downloaded,
    downloadedBytes,
    savedPct: total ? Math.round((1000 * fromSeed) / total) / 10 : 0,
    packSha256: manifest.pack_sha256,
  };
}

async function readChannelState(base: string, stamp: ChannelStamp): Promise<ChannelState> {
  const rel = `${stamp.packName}-${stamp.edition}.state.json`;
  return JSON.parse((await readSource(base, rel)).toString("utf-8")) as ChannelState;
}

function requireBase(stamp: ChannelStamp, channel?: string): string {
  const base = channel ?? stamp.channelUrl;
  if (!base) {
    throw new Error(
      "Paczka nie wie, z jakiego kanalu pochodzi (brak channel_url w pack_meta). " +
        "Podaj adres kanalu albo uzyj paczki opieczetowanej przy publikacji.",
    );
  }
  return base;
}

/**
 * Dry-run: czy w kanale jest nowsza wersja i ile trzeba pobrac.
 * downloadBytes = suma nieskompresowanych bajtow chunkow, ktorych nie ma
 * w lokalnej paczce (gorna granica - gzip per chunk jeszcze je zmniejszy).
 * To zrodlo komunikatu UI "dostepna aktualizacja X->Y, N MB z M MB".
 */
export async function checkUpdate(packPath: string, channel?: string): Promise<UpdateCheck> {
  const stamp = readChannelStamp(packPath);
  const base = requireBase(stamp, channel);
  const state = await readChannelState(base, stamp);
  if (state.current_version === stamp.channelVersion) {
    return {
      status: "aktualna",
      have: stamp.channelVersion,
      available: state.current_version,
      packSize: fs.statSync(packPath).size,
      downloadBytes: 0,
    };
  }
  const manifestSrc = isHttpBase(base)
    ? `${base.replace(/\/+$/, "")}/${state.manifest}`
    : path.join(base, state.manifest);
  const { manifest } = await loadManifest(manifestSrc, base);
  const chunkSize = manifest.chunk_size ?? CHUNK_SIZE;
  const seedIndex = await indexSeed(packPath, chunkSize);
  let downloadBytes = 0;
  const lastIndex = manifest.chunks.length - 1;
  manifest.chunks.forEach((digest, i) => {
    if (seedIndex.has(digest)) return;
    downloadBytes += i === lastIndex ? manifest.pack_size - lastIndex * chunkSize : chunkSize;
  });
  return {
    status: "dostepna",
    have: stamp.channelVersion,
    available: state.current_version,
    packSize: manifest.pack_size,
    downloadBytes,
  };
}

export interface UpdateResult {
  status: "aktualna" | "zaktualizowana";
  from: string | null;
  to: string;
  downloadedBytes: number;
  savedPct: number;
}

/**
 * Aktualizuje paczke w miejscu, pobierajac wylacznie roznice. Awaria w polowie
 * pobierania zostawia klienta z dzialajaca baza (staging .new, backup .prev).
 */
export async function updatePack(
  packPath: string,
  opts: { channel?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<UpdateResult> {
  const stamp = readChannelStamp(packPath);
  const base = requireBase(stamp, opts.channel);
  const state = await readChannelState(base, stamp);
  if (state.current_version === stamp.channelVersion) {
    return {
      status: "aktualna",
      from: stamp.channelVersion,
      to: state.current_version,
      downloadedBytes: 0,
      savedPct: 100,
    };
  }

  const staging = `${packPath}.new`;
  const manifestSrc = isHttpBase(base)
    ? `${base.replace(/\/+$/, "")}/${state.manifest}`
    : path.join(base, state.manifest);
  const result = await fetchPack(manifestSrc, staging, {
    base,
    seed: packPath,
    onProgress: opts.onProgress,
  });

  const backup = `${packPath}.prev`;
  try {
    await fs.promises.rename(packPath, backup);
  } catch (err) {
    await fs.promises.unlink(staging).catch(() => undefined);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new PackBusyError(
        `Nie mozna podmienic ${path.basename(packPath)}: plik jest otwarty przez inny proces. ` +
          "Zamknij narzedzia korzystajace z tej paczki i powtorz. Stara paczka jest nietknieta.",
      );
    }
    throw err;
  }
  await fs.promises.rename(staging, packPath);
  stampChannel(packPath, base, state.current_version);
  await fs.promises.unlink(backup);

  return {
    status: "zaktualizowana",
    from: stamp.channelVersion,
    to: state.current_version,
    downloadedBytes: result.downloadedBytes,
    savedPct: result.savedPct,
  };
}

/** Katalog paczek wiedzy: PATRON_PACKS_DIR albo <dane PATRONa>/packs. */
export function packsDir(): string {
  if (process.env.PATRON_PACKS_DIR) return process.env.PATRON_PACKS_DIR;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
      : os.homedir();
  return process.platform === "win32"
    ? path.join(base, "PATRON", "packs")
    : path.join(base, ".patron", "packs");
}

/** Pliki paczek w katalogu (paczka = SQLite; .new/.prev to stany przejsciowe). */
export function listPackFiles(dir: string = packsDir()): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(sqlite|db)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}
