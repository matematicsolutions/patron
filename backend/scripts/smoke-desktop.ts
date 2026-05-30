#!/usr/bin/env tsx
// Smoke end-to-end stacku desktop (tryb sqlite, zero-cloud). Pre-launch checklist:
// bootuje backend na efemerycznym porcie + temp dane, uderza realne endpointy
// przez HTTP (Express wiring + middleware + auth bypass + multipart) i sprawdza
// efekty w bazie. Pomija endpointy LLM-zalezne (chat, /draft/refine) - wymagaja
// klucza; pokrywaja je testy jednostkowe z fake-LLM.
//
//   npm run smoke:desktop
//
// PATRON_DISABLE_VEC=1 -> bez modelu embeddera (warstwa wektorowa ma wlasny smoke).
// Sprawdzamy sciezke BM25+graf indexu (doc_chunks + extracted_entities).

import { spawn, spawnSync } from "child_process";
import net from "net";
import { Document, Packer, Paragraph } from "docx";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { applyTrackedEdits } from "../src/lib/docxTrackedChanges";

const PORT = 3094;
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patron-smoke-"));
const dbPath = path.join(tmp, "patron.db");
const storeDir = path.join(tmp, "sprawy");
const folderDir = path.join(tmp, "folder-sprawy");
fs.mkdirSync(folderDir, { recursive: true });

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`, extra ?? "");
  }
}

async function makeDocx(text: string): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph(text)] }] }),
  );
}

/** TCP-connect probe: czy ktos juz nasluchuje na porcie (zombie z poprzedniego runu). */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(800, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/**
 * Ubija CALE drzewo procesu serwera. Na win32 spawn z shell:true tworzy wrapper
 * cmd -> node tsx; child.kill() ubija tylko wrapper, node zostaje osierocony i
 * trzyma port (powod falszywego FAIL "index w tle" przy kolejnym runie).
 */
function killTree(pid: number | undefined, kill: () => void): void {
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    kill();
  }
}

async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

async function main() {
  // Pre-check: jezeli 3094 jest zajety (zombie z przerwanego runu), spawnowany
  // serwer nie zbinduje (EADDRINUSE) i requesty cicho trafia w zombie z inna baza
  // -> falszywy FAIL "index w tle". Failuj GLOSNO z instrukcja zamiast diagnozowac.
  if (await portInUse(PORT)) {
    console.error(
      `FAIL: port ${PORT} juz zajety (zombie serwer z poprzedniego runu?). ` +
        `Zabij proces (netstat -ano | findstr :${PORT} -> Stop-Process -Id <pid> -Force) i ponow.`,
    );
    process.exit(1);
  }

  const server = spawn("npx", ["tsx", "src/index.ts"], {
    env: {
      ...process.env,
      PATRON_DB_BACKEND: "sqlite",
      PATRON_STORAGE: "fs",
      PATRON_DISABLE_VEC: "1",
      PATRON_DB_PATH: dbPath,
      PATRON_STORAGE_DIR: storeDir,
      PORT: String(PORT),
      DOWNLOAD_SIGNING_SECRET: "smoke",
      USER_API_KEYS_ENCRYPTION_SECRET: "smoke",
    },
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  try {
    check("backend wstal (/health)", await waitForHealth());

    // 1. Upload pojedynczego dokumentu -> skan + utrwalenie + index w tle.
    const docx = await makeDocx(
      "Pozew o zachowek. Sad powolal uchwale Sygn. akt III CZP 11/13 dotyczaca darowizn.",
    );
    const form = new FormData();
    form.append("file", new Blob([docx]), "pozew.docx");
    const up = await fetch(`${BASE}/single-documents`, {
      method: "POST",
      body: form,
    });
    const upBody = (await up.json()) as { id?: string; status?: string };
    check("upload docx -> 201", up.status === 201, up.status);
    check("dokument ready", upBody.status === "ready", upBody.status);
    const docId = upBody.id;

    // 2. Index w tle (BM25+graf) - poll bazy readonly.
    let indexed = false;
    for (let i = 0; i < 20 && docId; i++) {
      try {
        const db = new Database(dbPath, { readonly: true });
        const chunks = (
          db
            .prepare("select count(*) c from doc_chunks where document_id = ?")
            .get(docId) as { c: number }
        ).c;
        const ents = (
          db
            .prepare(
              "select count(*) c from extracted_entities where document_id = ?",
            )
            .get(docId) as { c: number }
        ).c;
        db.close();
        if (chunks > 0 && ents > 0) {
          indexed = true;
          break;
        }
      } catch {
        /* db busy / not ready */
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    check("index w tle: doc_chunks + extracted_entities", indexed);

    // 3. Folder Sprawy: import katalogu.
    fs.writeFileSync(
      path.join(folderDir, "umowa.docx"),
      await makeDocx("Umowa najmu lokalu. Czynsz 2000 zl miesiecznie."),
    );
    const fi = await fetch(`${BASE}/folders/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderDir }),
    });
    const fiBody = (await fi.json()) as { indexed?: number; total?: number };
    check(
      "folders/ingest zaimportowal plik",
      fi.status === 200 && (fiBody.indexed ?? 0) >= 1,
      fiBody,
    );

    // 4. Word import roundtrip: edytowany docx z tracked change.
    const base = await makeDocx("Powodka zada kwoty 5000 zl tytulem zachowku.");
    const edited = await applyTrackedEdits(
      base,
      [
        {
          find: "5000",
          replace: "8000",
          context_before: "kwoty ",
          context_after: " zl",
        },
      ],
      { author: "Beata" },
    );
    const rtForm = new FormData();
    rtForm.append("file", new Blob([edited.bytes]), "edited.docx");
    const rt = await fetch(`${BASE}/draft/roundtrip`, {
      method: "POST",
      body: rtForm,
    });
    const rtBody = (await rt.json()) as {
      trackedChanges?: { kind: string }[];
    };
    check(
      "draft/roundtrip parsuje tracked changes",
      rt.status === 200 && (rtBody.trackedChanges?.length ?? 0) >= 1,
      rtBody.trackedChanges?.length,
    );

    console.log(
      failures === 0
        ? "\nDESKTOP SMOKE PASS (all green)"
        : `\nDESKTOP SMOKE FAIL: ${failures}`,
    );
  } finally {
    killTree(server.pid, () => server.kill());
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("DESKTOP SMOKE THREW:", e);
  process.exit(1);
});
