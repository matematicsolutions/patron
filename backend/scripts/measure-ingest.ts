// Pomiar rozbicia czasu ingestu jednego dokumentu (aparatura do ADR-0156).
// Uruchomienie:  npx tsx scripts/measure-ingest.ts <plik> [powtorzenia]
// Izolowany: wlasny PATRON_DB_PATH + storage w temp, baza Operatora nietknieta.
// NIE jest testem CI - to przyrzad pomiarowy, czas w bramce jest flaky (ADR-0153).

import fs from "fs";
import os from "os";
import path from "path";

const file = process.argv[2];
const repeats = Number(process.argv[3] ?? 1);
if (!file) {
  console.error("uzycie: tsx scripts/measure-ingest.ts <plik.pdf> [powtorzenia]");
  process.exit(2);
}

const stamp = Date.now();
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_DB_PATH = path.join(os.tmpdir(), `patron-measure-${stamp}.db`);
process.env.PATRON_STORAGE_DIR = path.join(os.tmpdir(), `patron-measure-store-${stamp}`);

async function main() {
  const conn = await import("../src/lib/db/sqlite-connection");
  conn.getDb();
  const { ingestDocument } = await import("../src/lib/documentIngest");
  const { createServerSupabase } = await import("../src/lib/supabase");
  const db = createServerSupabase();

  const content = fs.readFileSync(file);
  console.log(
    `plik: ${path.basename(file)} (${(content.byteLength / 1024).toFixed(0)} KB)`,
  );

  for (let i = 0; i < repeats; i++) {
    const t0 = process.hrtime.bigint();
    const r = await ingestDocument({
      content,
      filename: path.basename(file),
      userId: "measure",
      projectId: null,
      db,
    });
    const total = Number(process.hrtime.bigint() - t0) / 1e9;
    console.log(
      `przebieg ${i + 1}: status=${r.httpStatus} CALOSC=${total.toFixed(1)} s`,
    );
  }
  conn.closeDb();
}

void main();
