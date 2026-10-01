// Wspolne zrodlo wierszy audit_log dla `audit:verify` i `audit:acknowledge-forks`
// (ADR-0161). Jedno miejsce wyboru bazy, odczytu progu straznika i druku raportu -
// oba skrypty widza dziennik dokladnie tak samo.
//
// Zrodlo bez flagi: ta sama regula co backend (lib/supabase.ts) - SQLite, chyba ze
// PATRON_DB_BACKEND=supabase. SQLite otwierany TYLKO DO ODCZYTU (readonly,
// fileMustExist). Zapis (potwierdzenie) idzie osobno, przez appendAuditEvent.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import type { ChainReport, ChainRow } from "../src/lib/audit-chain-verify";
import { readAuditChainGuardThreshold } from "../src/lib/db/migrate.sqlite";
import { dbFilePath } from "../src/lib/db/sqlite-connection";
import { applyEncryptionKey } from "../src/lib/db/atrest";

/** Trojstan + blad. 1 = BLOKADA jak dotychczasowe "lancuch zerwany". */
export const EXIT = { ok: 0, uwagi: 3, blokada: 1, error: 2 } as const;

export interface SourceArgs {
    source: "sqlite" | "supabase";
    sqlitePath: string | null;
    guardAfterId: number | null;
    /** Flagi bez wartosci, ktore wolajacy skrypt dopuscil (np. --tak). */
    flags: Set<string>;
    /** Flagi z wartoscia, ktore wolajacy skrypt dopuscil (np. --actor). */
    values: Map<string, string>;
}

export function parseSourceArgs(
    argv: string[],
    allowedFlags: string[] = [],
    allowedValues: string[] = [],
): SourceArgs {
    const backendIsSqlite =
        (process.env.PATRON_DB_BACKEND ?? "sqlite").toLowerCase() !== "supabase";
    const args: SourceArgs = {
        source: backendIsSqlite ? "sqlite" : "supabase",
        sqlitePath: null,
        guardAfterId: null,
        flags: new Set(),
        values: new Map(),
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--sqlite") {
            args.source = "sqlite";
            const next = argv[i + 1];
            if (next && !next.startsWith("--")) {
                args.sqlitePath = next;
                i++;
            }
        } else if (a === "--supabase") {
            args.source = "supabase";
        } else if (a === "--guard-after-id") {
            const n = Number(argv[++i]);
            if (!Number.isSafeInteger(n) || n < 0) {
                console.error("[audit-chain] --guard-after-id wymaga liczby calkowitej >= 0");
                process.exit(EXIT.error);
            }
            args.guardAfterId = n;
        } else if (allowedFlags.includes(a)) {
            args.flags.add(a);
        } else if (allowedValues.includes(a) && argv[i + 1]) {
            args.values.set(a, argv[++i]);
        } else {
            console.error(`[audit-chain] nieznany argument: ${a}`);
            process.exit(EXIT.error);
        }
    }
    return args;
}

export function sqliteFile(args: SourceArgs): string {
    return args.sqlitePath ?? dbFilePath();
}

function loadSqlite(file: string): { rows: ChainRow[]; guardAfterId: number | null } {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
        applyEncryptionKey(db);
        const raw = db
            .prepare(
                "select id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash from audit_log order by id",
            )
            .all() as Array<Omit<ChainRow, "payload"> & { payload: string }>;
        // Nieczytelny JSON to slad ingerencji w wiersz, nie blad odczytu zrodla:
        // zostawiamy surowy tekst, hash sie nie zgodzi i wiersz dostanie BLOKADE.
        const rows = raw.map((r) => {
            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(r.payload) as Record<string, unknown>;
            } catch {
                payload = { nieczytelny_payload: r.payload };
            }
            return { ...r, payload };
        });
        return { rows, guardAfterId: readAuditChainGuardThreshold(db) };
    } finally {
        db.close();
    }
}

async function loadSupabase(): Promise<ChainRow[]> {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        console.error("[audit-chain] Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w .env");
        process.exit(EXIT.error);
    }
    const db = createClient(url, key, { auth: { persistSession: false } });
    const PAGE = 1000;
    const out: ChainRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await db
            .from("audit_log")
            .select("id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash")
            .order("id", { ascending: true })
            .range(offset, offset + PAGE - 1);
        if (error) {
            console.error("[audit-chain] read failed:", error.message);
            process.exit(EXIT.error);
        }
        const rows = (data ?? []) as ChainRow[];
        out.push(...rows);
        if (rows.length < PAGE) break;
    }
    return out;
}

/**
 * Wczytuje caly dziennik. Prog straznika: z flagi, a dla SQLite z definicji
 * indeksu w pliku (zrodlo, ktore realnie egzekwuje). Dla Supabase PostgREST nie
 * siega pg_indexes - prog podaje sie flaga `--guard-after-id` (odczyt:
 * `select indexdef from pg_indexes where indexname = 'audit_log_prev_hash_unique'`).
 */
export async function loadChain(
    args: SourceArgs,
): Promise<{ rows: ChainRow[]; guardAfterId: number | null }> {
    if (args.source === "sqlite") {
        const file = sqliteFile(args);
        console.log(`[audit-chain] zrodlo: SQLite ${file} (tylko odczyt)`);
        try {
            const loaded = loadSqlite(file);
            return { rows: loaded.rows, guardAfterId: args.guardAfterId ?? loaded.guardAfterId };
        } catch (e) {
            console.error(`[audit-chain] nie moge odczytac ${file}: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(EXIT.error);
        }
    }
    console.log("[audit-chain] zrodlo: Supabase (PostgREST)");
    return { rows: await loadSupabase(), guardAfterId: args.guardAfterId };
}

const KINDS = [
    "hash_mismatch",
    "hash_mismatch_fk_cascade",
    "duplicate_hash",
    "missing_parent",
    "parent_not_earlier",
    "genesis_count",
    "fork_after_guard",
    "fork_unexplained",
    "ack_invalid",
    "ack_missing",
    "fork_concurrent",
    "hash_mismatch_legal_break",
    "fork_acknowledged",
    "legal_break_truncated",
] as const;

/** Druk raportu: pelny mianownik (kontrole zdane tez) i same id wierszy, nigdy payload. */
export function printReport(report: ChainReport, elapsedS: string): void {
    const label = { ok: "OK", uwagi: "UWAGI", blokada: "BLOKADA" }[report.verdict];
    const guard =
        report.guardAfterId === null ? "brak / nieznany" : `unikalny prev_hash dla id > ${report.guardAfterId}`;
    console.log(`[audit-chain] ${label} - ${report.rows} wpisow w ${elapsedS}s`);
    console.log(
        `[audit-chain] sciezka glowna: ${report.mainChain}, ogniwa boczne: ${report.sideRows}, punkty rozwidlenia: ${report.forkPoints}`,
    );
    console.log(`[audit-chain] straznik: ${guard}`);
    for (const k of KINDS) {
        const n = report.findings.filter((f) => f.kind === k).length;
        const mark = n === 0 ? "zdane " : k === "fork_acknowledged" || k === "legal_break_truncated" ? "INFO  " : "ZNALEZ";
        console.log(`[audit-chain]   ${mark} ${k}: ${n}`);
    }
    for (const f of report.findings) {
        console.log(`[audit-chain] ${f.severity.toUpperCase()} ${f.kind} id=[${f.ids.join(",")}]: ${f.detail}`);
    }
    if (report.headHash) console.log(`[audit-chain] head: id=${report.headId} hash=${report.headHash}`);
}
