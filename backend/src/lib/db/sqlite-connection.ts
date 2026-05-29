// Polaczenie SQLite (single-user, zero-cloud desktop) + bootstrap schematu
// + seed jednego lokalnego usera. Singleton - jedno polaczenie na proces.
//
// Sciezka bazy:
//   PATRON_DB_PATH (env, pelna sciezka do pliku) ma pierwszenstwo.
//   W przeciwnym razie: %APPDATA%/PATRON/patron.db (Windows)
//   lub ~/.patron/patron.db (Linux/macOS).
//
// Lokalny user zastepuje GoTrue. Stale (env override):
//   PATRON_LOCAL_USER_ID    (default ponizej, UUID v4)
//   PATRON_LOCAL_USER_EMAIL (default 'local@patron')
//   PATRON_LOCAL_USER_NAME  (default 'Mecenas')

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { SQLITE_SCHEMA } from "./schema.sqlite";
import { applyEncryptionKey } from "./atrest";

/**
 * Wymiar embeddingu wektorowego (ADR-0054). Musi byc zgodny z modelem
 * embeddera (lib/retrieval/embeddings.ts). Default 384 = multilingual-e5-small.
 * Zmiana modelu na inny wymiar wymaga re-index korpusu (DROP vec_chunks).
 */
export const EMBED_DIM = Number(process.env.PATRON_EMBED_DIM) || 384;

export const LOCAL_USER_ID =
  process.env.PATRON_LOCAL_USER_ID ||
  "00000000-0000-0000-0000-000000000001";
export const LOCAL_USER_EMAIL = (
  process.env.PATRON_LOCAL_USER_EMAIL || "local@patron"
).toLowerCase();
export const LOCAL_USER_NAME =
  process.env.PATRON_LOCAL_USER_NAME || "Mecenas";

function defaultDataDir(): string {
  if (process.platform === "win32") {
    const base =
      process.env.APPDATA ||
      path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "PATRON");
  }
  return path.join(os.homedir(), ".patron");
}

export function dbFilePath(): string {
  if (process.env.PATRON_DB_PATH) return process.env.PATRON_DB_PATH;
  return path.join(defaultDataDir(), "patron.db");
}

function nowIso(): string {
  return new Date().toISOString();
}

let db: Database.Database | undefined;
let vecEnabled = false;

/** Czy warstwa wektorowa (sqlite-vec vec0) jest dostepna w tej instancji. */
export function isVecEnabled(): boolean {
  return vecEnabled;
}

/**
 * Zwraca singleton polaczenia SQLite. Pierwsze wywolanie tworzy katalog danych,
 * otwiera baze, ustawia PRAGMA, aplikuje schemat (idempotentnie), laduje
 * sqlite-vec + tworzy virtual tables retrievalu (vec0 + FTS5) i seeduje
 * lokalnego usera.
 */
export function getDb(): Database.Database {
  if (db) return db;
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  // ADR-0072: szyfrowanie at-rest. MUSI byc pierwsza operacja po otwarciu
  // (PRAGMA key przed odczytem naglowka). No-op gdy klucz nieustawiony;
  // fail-loud gdy klucz ustawiony, a sterownik nie szyfruje.
  applyEncryptionKey(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_SCHEMA);
  ensureSchemaUpgrades(db);
  setupRetrievalTables(db);
  seedLocalUser(db);
  return db;
}

/**
 * Idempotentne upgrade'y schematu dla ISTNIEJACYCH baz SQLite. `create table
 * if not exists` (SQLITE_SCHEMA) nie dodaje kolumn do tabel ktore juz istnieja,
 * a desktop nie ma runnera migracji (migrations/*.sql ida tylko na Postgres).
 * Tu dokladamy brakujace kolumny przez ALTER TABLE ADD COLUMN, sprawdzajac
 * najpierw PRAGMA table_info. Bezpieczne do wielokrotnego uruchomienia.
 *
 * UWAGA: ALTER dodaje kolumne z samym DEFAULT (bez CHECK) - CHECK constraint
 * istnieje tylko w swiezo tworzonej tabeli (SQLITE_SCHEMA). Walidacje wartosci
 * egzekwuje warstwa aplikacji (provider.schema.ts DataClassification).
 */
function ensureSchemaUpgrades(conn: Database.Database): void {
  const hasColumn = (table: string, column: string): boolean => {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    return cols.some((c) => c.name === column);
  };

  // ADR-0067: projects.classification (straznik data-residency). Backfill
  // istniejacych spraw na fail-closed 'attorney_client_privileged' (DEFAULT).
  if (!hasColumn("projects", "classification")) {
    conn.exec(
      "alter table projects add column classification text not null default 'attorney_client_privileged'",
    );
  }
}

/**
 * Laduje rozszerzenie sqlite-vec i tworzy virtual tables retrievalu (ADR-0054):
 *   vec_chunks(embedding float[EMBED_DIM]) - wektor (sqlite-vec)
 *   doc_chunks_fts(content) - BM25 (FTS5, wbudowane w better-sqlite3)
 * rowid obu = doc_chunks.id (1:1). Jezeli sqlite-vec niedostepny, retrieval
 * wektorowy jest wylaczony (isVecEnabled() === false), ale aplikacja dziala
 * (BM25 + graf nadal aktywne).
 */
function setupRetrievalTables(conn: Database.Database): void {
  // PATRON_DISABLE_VEC: wylacza warstwe wektorowa (sqlite-vec + embeddingi).
  // Uzywane gdy sqlite-vec/model niedostepny oraz w testach offline -
  // BM25 + graf nadal dzialaja (Faza 1 wg ADR-0007).
  if (process.env.PATRON_DISABLE_VEC) {
    vecEnabled = false;
    conn.exec(
      `create virtual table if not exists doc_chunks_fts using fts5(content, tokenize='unicode61 remove_diacritics 2')`,
    );
    return;
  }
  try {
    sqliteVec.load(conn);
    conn.exec(
      `create virtual table if not exists vec_chunks using vec0(embedding float[${EMBED_DIM}])`,
    );
    vecEnabled = true;
  } catch (e) {
    console.warn(
      "[sqlite] sqlite-vec niedostepny - retrieval wektorowy wylaczony:",
      e instanceof Error ? e.message : String(e),
    );
    vecEnabled = false;
  }
  // FTS5 jest wbudowane w better-sqlite3 (BM25 nie zalezy od sqlite-vec).
  conn.exec(
    `create virtual table if not exists doc_chunks_fts using fts5(content, tokenize='unicode61 remove_diacritics 2')`,
  );
}

function seedLocalUser(conn: Database.Database): void {
  const existing = conn
    .prepare("select id from app_users where id = ?")
    .get(LOCAL_USER_ID);
  const ts = nowIso();
  if (!existing) {
    conn
      .prepare(
        "insert into app_users (id, email, display_name, created_at) values (?, ?, ?, ?)",
      )
      .run(LOCAL_USER_ID, LOCAL_USER_EMAIL, LOCAL_USER_NAME, ts);
  }
  const profile = conn
    .prepare("select id from user_profiles where user_id = ?")
    .get(LOCAL_USER_ID);
  if (!profile) {
    conn
      .prepare(
        `insert into user_profiles
          (id, user_id, display_name, tier, message_credits_used,
           credits_reset_date, tabular_model, created_at, updated_at)
         values (?, ?, ?, 'Free', 0, ?, 'gemini-3-flash-preview', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        LOCAL_USER_ID,
        LOCAL_USER_NAME,
        new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        ts,
        ts,
      );
  }
}

/** Zamyka polaczenie (testy / shutdown). Kolejny getDb() otworzy na nowo. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
