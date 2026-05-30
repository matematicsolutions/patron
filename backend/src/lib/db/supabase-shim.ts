// Adapter mimikujacy API @supabase/supabase-js na better-sqlite3 (single-user).
//
// Cel: zero zmian w ~30 plikach call-site. createServerSupabase() w trybie
// sqlite zwraca ten obiekt (rzutowany na SupabaseClient w lib/supabase.ts).
// Obslugiwany jest dokladnie ten podzbior PostgREST/GoTrue, ktorego uzywa
// kod backendu (zweryfikowany greplem):
//   .from(t).select|insert|update|upsert|delete
//   filtry: eq neq in gt gte lt lte is not like ilike or
//   modyfikatory: order limit range single maybeSingle
//   select opts: { count: "exact", head: true }
//   .auth.getUser / .auth.admin.getUserById / listUsers / deleteUser
//
// Kontrakt zwrotny: { data, error, count? } - thenable (await dziala).
// Bledy unikalnosci mapowane na PostgreSQL code "23505" (retry hash-chain
// w appendAuditEvent zalezy od tego kodu).

import type DatabaseType from "better-sqlite3";
import crypto from "crypto";
import {
  getDb,
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
} from "./sqlite-connection";

type Db = DatabaseType.Database;
type Row = Record<string, unknown>;
type SqlBind = number | string | bigint | Buffer | null;

interface PgError {
  message: string;
  code?: string;
  details?: string;
}

interface Result {
  data: unknown;
  error: PgError | null;
  count?: number;
}

// Kolumny jsonb (z schema.sql) - serializowane przy zapisie, parsowane przy
// odczycie. Reszta kolumn przechodzi bez zmian.
const JSON_COLUMNS: Record<string, Set<string>> = {
  projects: new Set(["shared_with"]),
  documents: new Set(["structure_tree"]),
  workflows: new Set(["columns_config"]),
  chat_messages: new Set(["content", "files", "annotations"]),
  tabular_reviews: new Set(["columns_config", "document_ids", "shared_with"]),
  tabular_cells: new Set(["citations"]),
  tabular_review_chat_messages: new Set(["content", "annotations"]),
  audit_log: new Set(["payload"]),
};

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

function sanitizeIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`[sqlite-shim] niedozwolony identyfikator: ${name}`);
  }
  return name;
}

function sanitizeColumnList(cols: string): string {
  const trimmed = cols.trim();
  if (trimmed === "" || trimmed === "*") return "*";
  // Lista kolumn z kodu (literaly). Dopuszczamy litery/cyfry/_/przecinki/spacje.
  if (!/^[\w\s,*]+$/.test(trimmed)) return "*";
  return trimmed;
}

interface TableMeta {
  columns: Set<string>;
  pk: string | null;
  pkIsText: boolean;
}

const metaCache = new Map<string, TableMeta>();

function tableMeta(db: Db, table: string): TableMeta {
  const cached = metaCache.get(table);
  if (cached) return cached;
  const info = db
    .prepare(`PRAGMA table_info(${sanitizeIdent(table)})`)
    .all() as { name: string; type: string; pk: number }[];
  let pk: string | null = null;
  let pkIsText = false;
  for (const c of info) {
    if (c.pk > 0) {
      pk = c.name;
      pkIsText = /text/i.test(c.type);
    }
  }
  const meta: TableMeta = {
    columns: new Set(info.map((c) => c.name)),
    pk,
    pkIsText,
  };
  metaCache.set(table, meta);
  return meta;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isJsonColumn(table: string, col: string): boolean {
  return JSON_COLUMNS[table]?.has(col) ?? false;
}

/** Wartosc -> bind SQLite. Boolean->0/1, obiekt/tablica->JSON, undefined->null. */
function toBind(value: unknown): SqlBind {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") {
    if (Buffer.isBuffer(value)) return value;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") return value;
  return String(value);
}

/** Wartosc do zapisu kolumny (jsonb -> stringify nie-string). */
function writeVal(table: string, col: string, value: unknown): SqlBind {
  if (isJsonColumn(table, col) && value != null && typeof value === "string") {
    return value; // juz JSON tekst - nie podwajaj kodowania
  }
  return toBind(value);
}

/** Wiersz z bazy -> deserializacja kolumn jsonb. */
function fromRow(table: string, row: Row | undefined): Row | undefined {
  if (!row) return row;
  const json = JSON_COLUMNS[table];
  if (!json) return row;
  const out: Row = { ...row };
  for (const k of json) {
    if (k in out && typeof out[k] === "string") {
      try {
        out[k] = JSON.parse(out[k] as string);
      } catch {
        /* zostaw surowy string */
      }
    }
  }
  return out;
}

function toPgError(e: unknown): PgError {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  // better-sqlite3: SQLITE_CONSTRAINT_UNIQUE / _PRIMARYKEY -> PostgreSQL 23505
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return { code: "23505", message: err.message ?? "unique violation" };
  }
  return { code, message: err?.message ?? String(e) };
}

// ---------------------------------------------------------------------------
// .or() parser - format PostgREST: "col.op.val,col2.in.(a,b,c)"
// ---------------------------------------------------------------------------

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function parseOr(expr: string): { sql: string; params: SqlBind[] } {
  const clauses: string[] = [];
  const params: SqlBind[] = [];
  for (const token of splitTopLevel(expr)) {
    const firstDot = token.indexOf(".");
    if (firstDot < 0) continue;
    const col = sanitizeIdent(token.slice(0, firstDot));
    const rest = token.slice(firstDot + 1);
    const secondDot = rest.indexOf(".");
    if (secondDot < 0) continue;
    const op = rest.slice(0, secondDot);
    const valRaw = rest.slice(secondDot + 1);
    if (op === "in") {
      const inner = valRaw.replace(/^\(/, "").replace(/\)$/, "");
      const arr = inner.length ? inner.split(",") : [];
      if (arr.length === 0) {
        clauses.push("0 = 1");
      } else {
        clauses.push(`${col} in (${arr.map(() => "?").join(",")})`);
        params.push(...arr.map((v) => v as SqlBind));
      }
    } else if (op === "eq") {
      clauses.push(`${col} = ?`);
      params.push(valRaw);
    } else if (op === "neq") {
      clauses.push(`${col} != ?`);
      params.push(valRaw);
    } else if (op === "is") {
      clauses.push(valRaw === "null" ? `${col} is null` : `${col} = ?`);
      if (valRaw !== "null") params.push(valRaw);
    }
  }
  return { sql: clauses.join(" or "), params };
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

interface Filter {
  kind: "simple" | "or";
  col?: string;
  op?: string;
  val?: unknown;
  sql?: string;
  params?: SqlBind[];
}

type Operation = "select" | "insert" | "update" | "delete" | "upsert";

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orderings: { col: string; asc: boolean }[] = [];
  private _limit?: number;
  private _offset?: number;
  private _rangeEnd?: number;
  private operation: Operation = "select";
  private selectCols = "*";
  private wantReturning = false;
  private singleMode: false | "single" | "maybe" = false;
  private payload: Row | Row[] = {};
  private onConflict?: string;
  private countMode = false;
  private headOnly = false;

  constructor(
    private db: Db,
    private table: string,
  ) {
    sanitizeIdent(table);
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.operation === "select") {
      this.selectCols = sanitizeColumnList(cols ?? "*");
      if (opts?.count) this.countMode = true;
      if (opts?.head) this.headOnly = true;
    } else {
      this.wantReturning = true;
      if (cols && cols.trim()) this.selectCols = sanitizeColumnList(cols);
    }
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.operation = "insert";
    this.payload = rows;
    return this;
  }

  update(values: Row): this {
    this.operation = "update";
    this.payload = values;
    return this;
  }

  upsert(values: Row, opts?: { onConflict?: string }): this {
    this.operation = "upsert";
    this.payload = values;
    this.onConflict = opts?.onConflict;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  private addFilter(col: string, op: string, val: unknown): this {
    this.filters.push({ kind: "simple", col: sanitizeIdent(col), op, val });
    return this;
  }

  eq(col: string, val: unknown): this {
    return this.addFilter(col, "eq", val);
  }
  neq(col: string, val: unknown): this {
    return this.addFilter(col, "neq", val);
  }
  gt(col: string, val: unknown): this {
    return this.addFilter(col, "gt", val);
  }
  gte(col: string, val: unknown): this {
    return this.addFilter(col, "gte", val);
  }
  lt(col: string, val: unknown): this {
    return this.addFilter(col, "lt", val);
  }
  lte(col: string, val: unknown): this {
    return this.addFilter(col, "lte", val);
  }
  in(col: string, vals: unknown[]): this {
    return this.addFilter(col, "in", vals);
  }
  is(col: string, val: unknown): this {
    return this.addFilter(col, "is", val);
  }
  like(col: string, val: string): this {
    return this.addFilter(col, "like", val);
  }
  ilike(col: string, val: string): this {
    return this.addFilter(col, "ilike", val);
  }
  not(col: string, op: string, val: unknown): this {
    return this.addFilter(col, `not_${op}`, val);
  }
  or(expr: string): this {
    const { sql, params } = parseOr(expr);
    this.filters.push({ kind: "or", sql, params });
    return this;
  }
  // PostgREST .filter(col, op, val) - generyczny filtr. Operator przekazany
  // wprost do buildWhere (eq/neq/gt/.../cs). "cs" = contains dla kolumny
  // JSON-tablica tekst (np. projects.shared_with).
  filter(col: string, op: string, val: unknown): this {
    return this.addFilter(col, op, val);
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderings.push({
      col: sanitizeIdent(col),
      asc: opts?.ascending !== false,
    });
    return this;
  }
  limit(n: number): this {
    this._limit = n;
    return this;
  }
  range(from: number, to: number): this {
    this._offset = from;
    this._rangeEnd = to;
    return this;
  }
  single(): this {
    this.singleMode = "single";
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  // PromiseLike: await wykonuje zapytanie (better-sqlite3 jest synchroniczne).
  then<TR = Result, TE = never>(
    onfulfilled?: ((value: Result) => TR | PromiseLike<TR>) | null,
    onrejected?: ((reason: unknown) => TE | PromiseLike<TE>) | null,
  ): Promise<TR | TE> {
    let result: Result;
    try {
      result = this.exec();
    } catch (e) {
      result = { data: null, error: toPgError(e) };
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }

  private buildWhere(): { sql: string; params: SqlBind[] } {
    const clauses: string[] = [];
    const params: SqlBind[] = [];
    for (const f of this.filters) {
      if (f.kind === "or") {
        if (f.sql) {
          clauses.push(`(${f.sql})`);
          params.push(...(f.params ?? []));
        }
        continue;
      }
      const col = f.col as string;
      switch (f.op) {
        case "eq":
          clauses.push(`${col} = ?`);
          params.push(toBind(f.val));
          break;
        case "neq":
          clauses.push(`${col} != ?`);
          params.push(toBind(f.val));
          break;
        case "gt":
          clauses.push(`${col} > ?`);
          params.push(toBind(f.val));
          break;
        case "gte":
          clauses.push(`${col} >= ?`);
          params.push(toBind(f.val));
          break;
        case "lt":
          clauses.push(`${col} < ?`);
          params.push(toBind(f.val));
          break;
        case "lte":
          clauses.push(`${col} <= ?`);
          params.push(toBind(f.val));
          break;
        case "in": {
          const arr = (f.val as unknown[]) ?? [];
          if (arr.length === 0) {
            clauses.push("0 = 1");
          } else {
            clauses.push(`${col} in (${arr.map(() => "?").join(",")})`);
            params.push(...arr.map(toBind));
          }
          break;
        }
        case "is":
          if (f.val === null) clauses.push(`${col} is null`);
          else {
            clauses.push(`${col} is ?`);
            params.push(toBind(f.val));
          }
          break;
        case "not_is":
          if (f.val === null) clauses.push(`${col} is not null`);
          else {
            clauses.push(`${col} is not ?`);
            params.push(toBind(f.val));
          }
          break;
        case "like":
        case "ilike":
          // SQLite LIKE jest case-insensitive dla ASCII - pokrywa ilike.
          clauses.push(`${col} like ?`);
          params.push(String(f.val));
          break;
        case "cs": {
          // PostgREST contains dla kolumny JSON-tablica tekst. Val to JSON
          // string (np. '["email"]') lub tablica. Kazdy element musi byc
          // obecny w tablicy kolumny. coalesce -> NULL traktowany jak [].
          let arr: unknown[];
          if (Array.isArray(f.val)) arr = f.val;
          else {
            try {
              const parsed = JSON.parse(String(f.val));
              arr = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              arr = [f.val];
            }
          }
          if (arr.length === 0) {
            clauses.push("1 = 1");
          } else {
            for (const el of arr) {
              clauses.push(
                `exists (select 1 from json_each(coalesce(${col}, '[]')) where json_each.value = ?)`,
              );
              params.push(toBind(el));
            }
          }
          break;
        }
        default:
          throw new Error(`[sqlite-shim] nieobslugiwany operator: ${f.op}`);
      }
    }
    return {
      sql: clauses.length ? ` where ${clauses.join(" and ")}` : "",
      params,
    };
  }

  private applySingle(rows: Row[]): Result {
    if (!this.singleMode) return { data: rows, error: null };
    if (rows.length === 1) return { data: rows[0], error: null };
    if (rows.length === 0) {
      return {
        data: null,
        error:
          this.singleMode === "single"
            ? { code: "PGRST116", message: "no rows returned" }
            : null,
      };
    }
    return {
      data: null,
      error: { code: "PGRST116", message: "multiple rows returned" },
    };
  }

  private exec(): Result {
    switch (this.operation) {
      case "select":
        return this.execSelect();
      case "insert":
        return this.execInsert();
      case "update":
        return this.execUpdate();
      case "upsert":
        return this.execUpsert();
      case "delete":
        return this.execDelete();
    }
  }

  private execSelect(): Result {
    const { sql: where, params } = this.buildWhere();
    if (this.countMode) {
      const r = this.db
        .prepare(`select count(*) as c from ${this.table}${where}`)
        .get(...params) as { c: number };
      const count = Number(r.c);
      if (this.headOnly) return { data: [], count, error: null };
      // fallthrough: zwroc tez wiersze ponizej z polem count
      const rows = this.runSelectRows(where, params);
      return { data: rows, count, error: null };
    }
    const rows = this.runSelectRows(where, params);
    return this.applySingle(rows);
  }

  private runSelectRows(where: string, params: SqlBind[]): Row[] {
    let q = `select ${this.selectCols} from ${this.table}${where}`;
    if (this.orderings.length) {
      q +=
        " order by " +
        this.orderings.map((o) => `${o.col} ${o.asc ? "asc" : "desc"}`).join(", ");
    }
    if (this._offset != null) {
      const lim =
        this._rangeEnd != null ? this._rangeEnd - this._offset + 1 : -1;
      q += ` limit ${Number(lim)} offset ${Number(this._offset)}`;
    } else if (this._limit != null) {
      q += ` limit ${Number(this._limit)}`;
    }
    const raw = this.db.prepare(q).all(...params) as Row[];
    return raw.map((r) => fromRow(this.table, r) as Row);
  }

  private execInsert(): Result {
    const meta = tableMeta(this.db, this.table);
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const keys: { id?: SqlBind; rowid?: number | bigint }[] = [];
    try {
      const tx = this.db.transaction((rws: Row[]) => {
        for (const raw of rws) {
          const row: Row = { ...raw };
          this.autofill(meta, row);
          const cols = Object.keys(row).filter((c) => meta.columns.has(c));
          const vals = cols.map((c) => writeVal(this.table, c, row[c]));
          const info = this.db
            .prepare(
              `insert into ${this.table} (${cols.join(",")}) values (${cols
                .map(() => "?")
                .join(",")})`,
            )
            .run(...vals);
          keys.push({
            id: meta.pkIsText && meta.pk ? (row[meta.pk] as SqlBind) : undefined,
            rowid: info.lastInsertRowid,
          });
        }
      });
      tx(rows);
    } catch (e) {
      return { data: null, error: toPgError(e) };
    }
    if (!this.wantReturning) return { data: null, error: null };
    const fetched: Row[] = [];
    for (const k of keys) {
      const r =
        k.id != null
          ? this.db
              .prepare(
                `select ${this.selectCols} from ${this.table} where ${meta.pk} = ?`,
              )
              .get(k.id)
          : this.db
              .prepare(
                `select ${this.selectCols} from ${this.table} where rowid = ?`,
              )
              .get(k.rowid as number | bigint);
      const row = fromRow(this.table, r as Row | undefined);
      if (row) fetched.push(row);
    }
    return this.applySingle(fetched);
  }

  private execUpdate(): Result {
    const meta = tableMeta(this.db, this.table);
    const values = this.payload as Row;
    const cols = Object.keys(values).filter((c) => meta.columns.has(c));
    const setParams = cols.map((c) => writeVal(this.table, c, values[c]));
    const { sql: where, params } = this.buildWhere();
    if (cols.length === 0) return { data: this.wantReturning ? [] : null, error: null };
    const setSql = cols.map((c) => `${c} = ?`).join(", ");
    try {
      this.db
        .prepare(`update ${this.table} set ${setSql}${where}`)
        .run(...setParams, ...params);
    } catch (e) {
      return { data: null, error: toPgError(e) };
    }
    if (!this.wantReturning) return { data: null, error: null };
    const rows = this.db
      .prepare(`select ${this.selectCols} from ${this.table}${where}`)
      .all(...params) as Row[];
    return this.applySingle(rows.map((r) => fromRow(this.table, r) as Row));
  }

  private execUpsert(): Result {
    const meta = tableMeta(this.db, this.table);
    const row: Row = { ...(this.payload as Row) };
    this.autofill(meta, row);
    const cols = Object.keys(row).filter((c) => meta.columns.has(c));
    const vals = cols.map((c) => writeVal(this.table, c, row[c]));
    const conflictCols = (this.onConflict ?? meta.pk ?? "")
      .split(",")
      .map((s) => sanitizeIdent(s.trim()))
      .filter(Boolean);
    const updateCols = cols.filter((c) => !conflictCols.includes(c));
    const doUpdate =
      updateCols.length > 0
        ? `do update set ${updateCols.map((c) => `${c} = excluded.${c}`).join(", ")}`
        : "do nothing";
    const sql = `insert into ${this.table} (${cols.join(",")}) values (${cols
      .map(() => "?")
      .join(",")}) on conflict(${conflictCols.join(",")}) ${doUpdate}`;
    try {
      this.db.prepare(sql).run(...vals);
    } catch (e) {
      return { data: null, error: toPgError(e) };
    }
    if (!this.wantReturning) return { data: null, error: null };
    const where = conflictCols.map((c) => `${c} = ?`).join(" and ");
    const wparams = conflictCols.map((c) => writeVal(this.table, c, row[c]));
    const rows = this.db
      .prepare(`select ${this.selectCols} from ${this.table} where ${where}`)
      .all(...wparams) as Row[];
    return this.applySingle(rows.map((r) => fromRow(this.table, r) as Row));
  }

  private execDelete(): Result {
    const { sql: where, params } = this.buildWhere();
    try {
      this.db.prepare(`delete from ${this.table}${where}`).run(...params);
    } catch (e) {
      return { data: null, error: toPgError(e) };
    }
    return { data: this.wantReturning ? [] : null, error: null };
  }

  private autofill(meta: TableMeta, row: Row): void {
    if (meta.pk && meta.pkIsText && row[meta.pk] == null) {
      row[meta.pk] = crypto.randomUUID();
    }
    if (meta.columns.has("created_at") && row.created_at == null) {
      row.created_at = nowIso();
    }
    if (meta.columns.has("updated_at") && row.updated_at == null) {
      row.updated_at = nowIso();
    }
  }
}

// ---------------------------------------------------------------------------
// Auth (single-user, zastepuje GoTrue) - ksztalt zwrotny jak supabase-js v2.
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

function readUser(db: Db, id: string): AuthUser | null {
  const u = db
    .prepare("select id, email, display_name from app_users where id = ?")
    .get(id) as { id: string; email: string; display_name?: string } | undefined;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    user_metadata: { display_name: u.display_name ?? null },
  };
}

function makeAuth(db: Db) {
  return {
    async getUser(_token?: string) {
      const user = readUser(db, LOCAL_USER_ID);
      if (!user) {
        return { data: { user: null }, error: { message: "no local user" } };
      }
      return { data: { user }, error: null };
    },
    admin: {
      async getUserById(id: string) {
        const user = readUser(db, id);
        if (!user) {
          return { data: { user: null }, error: { message: "user not found" } };
        }
        return { data: { user }, error: null };
      },
      async listUsers(_opts?: { perPage?: number; page?: number }) {
        const rows = db
          .prepare("select id, email, display_name from app_users")
          .all() as { id: string; email: string; display_name?: string }[];
        const users: AuthUser[] = rows.map((u) => ({
          id: u.id,
          email: u.email,
          user_metadata: { display_name: u.display_name ?? null },
        }));
        return { data: { users }, error: null };
      },
      async deleteUser(id: string) {
        try {
          db.prepare("delete from app_users where id = ?").run(id);
          return { data: { user: null }, error: null };
        } catch (e) {
          return { data: { user: null }, error: toPgError(e) };
        }
      },
    },
  };
}

export interface SqliteClient {
  from(table: string): Query;
  auth: ReturnType<typeof makeAuth>;
}

/** Identyfikator lokalnego usera - re-export dla auth bypass (middleware). */
export { LOCAL_USER_ID, LOCAL_USER_EMAIL };

export function createSqliteClient(): SqliteClient {
  const db = getDb();
  return {
    from(table: string) {
      return new Query(db, table);
    },
    auth: makeAuth(db),
  };
}
