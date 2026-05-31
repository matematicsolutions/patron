// Mikrobenchmark sqlite-vec (ADR-0088, Faza D evaluation).
//
// Mierzy latencje exact brute-force KNN warstwy wektorowej (sqlite-vec vec0,
// ADR-0054) w skali realistycznej dla jednej kancelarii, by uzasadnic decyzje
// "utrzymac sqlite-vec vs adoptowac ANN-index (Zvec/Proxima)". Losowe wektory
// L2-znormalizowane (jak e5) - nie wymaga embeddera, dziala offline.
//
// Uruchom z katalogu backend (potrzebuje better-sqlite3 + sqlite-vec z deps):
//   cd backend && node scripts/vec-bench.cjs
//
// Wynik to dolna granica (sam KNN, bez RRF/BM25/grafu). Reprodukcja liczb z
// ADR-0088: prog flip ~100k chunkow (p95 KNN przekracza ~100ms, rosnie liniowo).

const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const os = require("os");
const path = require("path");
const fs = require("fs");

const DIM = Number(process.env.VEC_BENCH_DIM) || 384; // multilingual-e5-small
const TOPK = 24;
const QUERIES = 50;
const SCALES = (process.env.VEC_BENCH_SCALES || "10000,50000,100000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);

const file = path.join(os.tmpdir(), `vec-bench-${process.pid}.db`);
const db = new Database(file);
sqliteVec.load(db);
db.exec(`create virtual table vec_chunks using vec0(embedding float[${DIM}])`);

function randVec() {
  const a = new Float32Array(DIM);
  let n = 0;
  for (let i = 0; i < DIM; i++) {
    a[i] = Math.random() * 2 - 1;
    n += a[i] * a[i];
  }
  n = Math.sqrt(n);
  for (let i = 0; i < DIM; i++) a[i] /= n;
  return a;
}
function buf(v) {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

const ins = db.prepare("insert into vec_chunks (rowid, embedding) values (?, ?)");
const knn = db.prepare(
  `select rowid from vec_chunks where embedding match ? order by distance limit ${TOPK}`,
);

let inserted = 0;
for (const target of SCALES) {
  const tx = db.transaction((from, to) => {
    for (let i = from; i < to; i++) ins.run(BigInt(i + 1), buf(randVec()));
  });
  const t0 = Date.now();
  tx(inserted, target);
  const tIns = ((Date.now() - t0) / 1000).toFixed(1);
  inserted = target;

  for (let w = 0; w < 5; w++) knn.all(buf(randVec())); // warmup
  const lat = [];
  for (let q = 0; q < QUERIES; q++) {
    const s = process.hrtime.bigint();
    knn.all(buf(randVec()));
    lat.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  lat.sort((a, b) => a - b);
  const avg = (lat.reduce((a, b) => a + b, 0) / QUERIES).toFixed(2);
  const p95 = lat[Math.floor(QUERIES * 0.95)].toFixed(2);
  const sizeMB = (fs.statSync(file).size / 1048576).toFixed(1);
  console.log(
    `N=${String(target).padStart(7)}  insert=${tIns}s  KNN avg=${avg}ms  p95=${p95}ms  dbFile=${sizeMB}MB`,
  );
}

db.close();
fs.unlinkSync(file);
