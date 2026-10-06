// Pomiar samej indeksacji RAG (indexDocument) i tego, ile z niej wykonuje sie
// SYNCHRONICZNIE, zanim `void indexDocument(...)` odda sterowanie wolajacemu.
// uzycie: npx tsx scripts/measure-index.ts <plik.pdf>
// Warstwa wektorowa wylaczona (PATRON_DISABLE_VEC=1) - mierzy czesc CPU-bound
// bez modelu, ktorego wagi nie sa na tej maszynie.

import fs from "fs";
import os from "os";
import path from "path";

const file = process.argv[2];
if (!file) {
  console.error("uzycie: tsx scripts/measure-index.ts <plik.pdf>");
  process.exit(2);
}

const stamp = Date.now();
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_DB_PATH = path.join(os.tmpdir(), `patron-idx-${stamp}.db`);
process.env.PATRON_STORAGE_DIR = path.join(os.tmpdir(), `patron-idx-store-${stamp}`);

async function main() {
  const conn = await import("../src/lib/db/sqlite-connection");
  conn.getDb();
  const { extractPdfText } = await import("../src/lib/chat/pdf");
  const { indexDocument } = await import("../src/lib/retrieval/indexer");
  const { createServerSupabase } = await import("../src/lib/supabase");
  const db = createServerSupabase();

  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  const text = await extractPdfText(ab);

  const { data: doc } = await db
    .from("documents")
    .insert({
      project_id: null,
      user_id: "measure",
      filename: path.basename(file),
      file_type: "pdf",
      size_bytes: buf.byteLength,
      status: "ready",
    })
    .select("*")
    .single();
  const docId = (doc as { id: string }).id;

  // Ile z indexDocument leci PRZED pierwszym oddaniem sterowania (to jest to,
  // co `void` mial rzekomo odsunac w tlo).
  const t0 = process.hrtime.bigint();
  const p = indexDocument(docId, text);
  const sync = Number(process.hrtime.bigint() - t0) / 1e9;
  const res = await p;
  const total = Number(process.hrtime.bigint() - t0) / 1e9;

  console.log(
    `${path.basename(file)} | tekst ${(text.length / 1024).toFixed(0)} KB | chunkow ${res.chunks} | ` +
      `indexDocument CALOSC=${total.toFixed(2)} s | SYNCHRONICZNIE przed oddaniem sterowania=${sync.toFixed(2)} s ` +
      `(${((sync / total) * 100).toFixed(0)}%)`,
  );
  conn.closeDb();
}

void main();
