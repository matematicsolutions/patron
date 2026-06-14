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
//   PATRON_LOCAL_USER_NAME  (default 'Mecenasie' - wolacz, greeting "Witaj, Mecenasie")

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { SQLITE_SCHEMA } from "./schema.sqlite";
import { applyEncryptionKey } from "./atrest";
import { runSqliteMigrations } from "./migrate.sqlite";

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
  process.env.PATRON_LOCAL_USER_NAME || "Mecenasie";

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
  // Audyt P3 #12: pod WAL przy rownoczesnym zapisie indeksera/Merkle w tle
  // ryzyko SQLITE_BUSY. busy_timeout daje retry zamiast natychmiastowego bledu;
  // synchronous=NORMAL jest bezpieczne i zalecane pod WAL (mniej fsync, bez
  // ryzyka korupcji przy WAL).
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.exec(SQLITE_SCHEMA);
  ensureSchemaUpgrades(db);
  // Audyt P2 #7: wersjonowany runner migracji (PRAGMA user_version) dla zmian
  // ktorych ALTER nie obsluguje (rebuild tabeli pod zmiane CHECK/FK). Po
  // ensureSchemaUpgrades (proste ADD COLUMN), przed warstwa retrievalu.
  runSqliteMigrations(db);
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

  // Audyt P2 #10: proweniencja strony w chunku RAG (nullable, bez CHECK ->
  // ADD COLUMN wystarczy). Istniejace chunki zostaja z page_no = null do
  // czasu re-indeksu; nowy ingest wypelnia z markerow [Page N].
  if (!hasColumn("doc_chunks", "page_no")) {
    conn.exec("alter table doc_chunks add column page_no integer");
  }

  // ADR-0117 (audyt P2 #6): zgoda na chmure per-sprawa (nullable->default 0,
  // bez CHECK -> ADD COLUMN wystarczy). Istniejace sprawy: 0 (fail-closed).
  if (!hasColumn("projects", "cloud_consent")) {
    conn.exec(
      "alter table projects add column cloud_consent integer not null default 0",
    );
  }

  // ADR-0124 (Route B): surowe offsety chunka w zrodle (exact lokator
  // search-time). Nullable, bez DEFAULT - stare chunki maja NULL do re-indeksu
  // (feed/grounding robi fallback best-effort). Backfill = re-index dokumentu.
  if (!hasColumn("doc_chunks", "source_offset_start")) {
    conn.exec("alter table doc_chunks add column source_offset_start integer");
  }
  if (!hasColumn("doc_chunks", "source_offset_end")) {
    conn.exec("alter table doc_chunks add column source_offset_end integer");
  }

  // ADR-0125 (T2.1 KGLF): governance krawedzi grafu. Istniejace auto-krawedzie
  // dostaja DEFAULT 'proposed'/'analysis' (run_id null = widoczne globalnie, bez
  // regresji retrievalu); ratyfikacja (akt ludzki) ustawi 'ratified' pozniej.
  if (!hasColumn("citation_graph", "status")) {
    conn.exec(
      "alter table citation_graph add column status text not null default 'proposed'",
    );
  }
  if (!hasColumn("citation_graph", "origin")) {
    conn.exec(
      "alter table citation_graph add column origin text not null default 'analysis'",
    );
  }
  if (!hasColumn("citation_graph", "run_id")) {
    conn.exec("alter table citation_graph add column run_id text");
  }
  if (!hasColumn("citation_graph", "ratified_by")) {
    conn.exec("alter table citation_graph add column ratified_by text");
  }
  if (!hasColumn("citation_graph", "ratified_at")) {
    conn.exec("alter table citation_graph add column ratified_at text");
  }
}

/** Model embeddera z env (lustro embeddings.ts; tu bez importu - unik cyklu). */
function currentEmbedModel(): string {
  return process.env.PATRON_EMBED_MODEL || "Xenova/multilingual-e5-small";
}

export type EmbedderMetaAction =
  | "fresh"
  | "unchanged"
  | "dim-mismatch"
  | "model-changed";

/**
 * Wersjonowanie embeddera (audyt P2 #8). Porownuje zapisany (model, wymiar)
 * uzyty do zbudowania vec_chunks z biezacym. Niezgodnosc WYMIARU = drop
 * vec_chunks (inaczej cicha korupcja - vec0 ma staly wymiar, a inserty innego
 * wymiaru leca bledem/sa odrzucane) + wyzerowanie embedding_model w doc_chunks
 * (sygnal do re-indeksu). Zmiana MODELU przy tym samym wymiarze = ostrzezenie
 * (wektory z innego modelu sa nieporownywalne, zalecany re-index), bez dropu.
 * Na koniec zapisuje biezace (model, wymiar). Zwraca rodzaj akcji.
 *
 * Eksport dla testow; produkcyjnie wolane z setupRetrievalTables PRZED utworzeniem
 * vec_chunks. Wymaga tabel retrieval_meta i doc_chunks (SQLITE_SCHEMA).
 */
export function reconcileEmbedderMeta(
  conn: Database.Database,
  dim: number = EMBED_DIM,
  model: string = currentEmbedModel(),
): EmbedderMetaAction {
  const get = (k: string): string | undefined =>
    (
      conn
        .prepare("select value from retrieval_meta where key = ?")
        .get(k) as { value: string } | undefined
    )?.value;
  const prevDim = get("embed_dim");
  const prevModel = get("embed_model");

  let action: EmbedderMetaAction = "fresh";
  if (prevDim || prevModel) {
    if (prevDim && Number(prevDim) !== dim) {
      action = "dim-mismatch";
      console.warn(
        `[sqlite] EMBED_DIM zmieniony ${prevDim} -> ${dim}: usuwam vec_chunks ` +
          `(niezgodny wymiar) i zeruje znaczniki embeddingow. BM25/graf dzialaja ` +
          `dalej; uruchom re-index korpusu, by odbudowac warstwe wektorowa.`,
      );
      conn.exec("drop table if exists vec_chunks");
      conn.prepare("update doc_chunks set embedding_model = null").run();
    } else if (prevModel && prevModel !== model) {
      action = "model-changed";
      console.warn(
        `[sqlite] PATRON_EMBED_MODEL zmieniony ${prevModel} -> ${model} (ten sam ` +
          `wymiar). Wektory pochodza z poprzedniego modelu - zalecany re-index ` +
          `korpusu dla spojnosci wyszukiwania.`,
      );
    } else {
      action = "unchanged";
    }
  }

  const up = conn.prepare(
    "insert into retrieval_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
  );
  up.run("embed_dim", String(dim));
  up.run("embed_model", model);
  return action;
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
    // Audyt P2 #8: wykryj niezgodnosc wymiaru/modelu embeddera ZANIM utworzysz
    // vec_chunks (create-if-not-exists nie zmieni wymiaru istniejacej tabeli ->
    // cicha korupcja przy innym EMBED_DIM). Mismatch wymiaru => drop vec_chunks.
    reconcileEmbedderMeta(conn);
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
  // Korekta jednorazowa starego domyslnego imienia. Seed wstawia display_name
  // TYLKO przy tworzeniu wiersza, wiec baza zalozona starszym buildem trzyma
  // poprzedni default (mianownik 'Mecenas'). Jezeli nazwa nadal rowna sie temu
  // staremu defaultowi, aktualizuj do biezacego (wolacz 'Mecenasie', greeting
  // "Witaj, Mecenasie"). Zawezone do lokalnego usera i do dokladnie starej
  // wartosci - nie rusza imienia ustawionego swiadomie przez uzytkownika.
  const PREV_DEFAULT_NAME = "Mecenas";
  if (LOCAL_USER_NAME !== PREV_DEFAULT_NAME) {
    conn
      .prepare(
        "update app_users set display_name = ? where id = ? and display_name = ?",
      )
      .run(LOCAL_USER_NAME, LOCAL_USER_ID, PREV_DEFAULT_NAME);
    conn
      .prepare(
        "update user_profiles set display_name = ? where user_id = ? and display_name = ?",
      )
      .run(LOCAL_USER_NAME, LOCAL_USER_ID, PREV_DEFAULT_NAME);
  }
}

/** Zamyka polaczenie (testy / shutdown). Kolejny getDb() otworzy na nowo. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
