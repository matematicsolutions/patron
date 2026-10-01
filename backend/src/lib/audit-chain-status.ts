// Stan lancucha audytu i potwierdzanie rozwidlen z poziomu aplikacji (ADR-0165).
//
// Do ADR-0161 sprawdzenie lancucha i potwierdzenie rozwidlen sprzed straznika byly
// tylko komendami `npm run` - zainstalowany desktop ich nie ma, wiec kancelaria nie
// mogla sprawdzic wlasnego dziennika, a rozwidlenia z 1.x zostawaly bez ochrony.
// Ten modul daje to samo co skrypty, przez klienta bazy backendu (SQLite przez
// shim albo Supabase), dla endpointow /api/audit/chain.
//
// Rdzen oceny jest JEDEN: `verifyAuditChain` i `buildForkAcknowledgement`
// (audit-chain-verify.ts). Tu tylko zrodlo wierszy, prog straznika i bramka zapisu.
//
// Potwierdzenie to akt czlowieka (wzorzec karty zatwierdzenia z ADR-0137):
// podglad zwraca `digest` = SHA-256 kanonicznego payloadu, ktory zostalby zapisany.
// Zapis przechodzi TYLKO z tym samym digestem, liczonym od nowa w chwili zapisu -
// jesli miedzy podgladem a kliknieciem stan sie zmienil, zapisu nie ma (409).

import crypto from "crypto";
import { appendAuditEvent, canonicalJsonStringify } from "./audit";
import {
    buildForkAcknowledgement,
    FORK_ACK_EVENT,
    verifyAuditChain,
    type ChainReport,
    type ChainRow,
    type ForkAckPayload,
} from "./audit-chain-verify";
import { isSqliteBackend, type createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

const PAGE = 1000;

/** Wszystkie wiersze audit_log w kolejnosci id (stronicowanie po id, nie offsecie). */
export async function loadChainRows(db: Db): Promise<ChainRow[]> {
    const out: ChainRow[] = [];
    let lastId = 0;
    for (;;) {
        const { data, error } = await db
            .from("audit_log")
            .select("id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash")
            .gt("id", lastId)
            .order("id", { ascending: true })
            .limit(PAGE);
        if (error) throw new Error(`audit_log read failed: ${error.message}`);
        const rows = (data ?? []) as ChainRow[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
        lastId = rows[rows.length - 1].id;
    }
}

/**
 * Prog straznika (ADR-0161): SQLite - z definicji indeksu w pliku (zrodlo, ktore
 * egzekwuje). Postgres przez PostgREST nie siega pg_indexes, wiec zwracamy null:
 * w trybie serwerowym stan pokazuje sie bez progu, a potwierdzenie robi sie
 * skryptem z `--guard-after-id`.
 */
export async function readGuardThreshold(): Promise<number | null> {
    if (!isSqliteBackend()) return null;
    const { getDb } = await import("./db/sqlite-connection");
    const { readAuditChainGuardThreshold } = await import("./db/migrate.sqlite");
    return readAuditChainGuardThreshold(getDb());
}

/** SHA-256 kanonicznego payloadu potwierdzenia - to, co widzi czlowiek, i nic wiecej. */
export function ackDigest(ack: ForkAckPayload): string {
    return crypto.createHash("sha256").update(canonicalJsonStringify(ack), "utf8").digest("hex");
}

export interface ChainStatus {
    report: ChainReport;
    /** Prog znany (SQLite) - bez niego potwierdzenie jest niedozwolone. */
    guardKnown: boolean;
    /** Co mozna potwierdzic teraz; null gdy nic albo gdy potwierdzenie niedozwolone. */
    pending: { digest: string; forks: Array<{ parentId: number; siblingIds: number[] }> } | null;
    checkedAt: string;
}

async function evaluate(
    db: Db,
): Promise<{ status: ChainStatus; ack: ForkAckPayload | null }> {
    const [rows, guardAfterId] = await Promise.all([loadChainRows(db), readGuardThreshold()]);
    const report = verifyAuditChain(rows, { guardAfterId });
    const ack = buildForkAcknowledgement(rows, report);
    return {
        ack,
        status: {
            report,
            guardKnown: guardAfterId !== null,
            pending: ack
                ? {
                      digest: ackDigest(ack),
                      forks: ack.forks.map((f) => ({
                          parentId: f.parent_id,
                          siblingIds: f.siblings.map((s) => s.id),
                      })),
                  }
                : null,
            checkedAt: new Date().toISOString(),
        },
    };
}

export async function getChainStatus(db: Db): Promise<ChainStatus> {
    return (await evaluate(db)).status;
}

export type AcknowledgeResult =
    | { ok: true; status: ChainStatus }
    | {
          ok: false;
          reason: "blocked" | "no_guard" | "nothing_to_acknowledge" | "stale" | "write_failed";
          status?: ChainStatus;
          detail?: string;
      };

/**
 * Zapisuje potwierdzenie przez appendAuditEvent (jedyny pisarz audytu), ale tylko
 * gdy `digest` od czlowieka zgadza sie z tym, co wychodzi z oceny TERAZ.
 * Odmowy jak w skrypcie: BLOKADA (potwierdzenie nie wybiela manipulacji) i brak
 * progu straznika (zbior rozwidlen nie jest zamkniety).
 */
export async function acknowledgeForks(
    db: Db,
    input: { actorUserId: string | null; digest: string },
): Promise<AcknowledgeResult> {
    const { status, ack } = await evaluate(db);
    if (status.report.verdict === "blokada") return { ok: false, reason: "blocked", status };
    if (!status.guardKnown) return { ok: false, reason: "no_guard", status };
    if (!ack || !status.pending) return { ok: false, reason: "nothing_to_acknowledge", status };
    if (input.digest !== status.pending.digest) return { ok: false, reason: "stale", status };

    const written = await appendAuditEvent(db, {
        event_type: FORK_ACK_EVENT,
        actor_user_id: input.actorUserId,
        payload: { ...ack, tool: "ui:audit-chain" },
    });
    if (!written.ok) return { ok: false, reason: "write_failed", status, detail: written.error };
    return { ok: true, status: await getChainStatus(db) };
}

/** Walidacja wejscia POST: digest to 64 znaki hex (SHA-256). */
export function isAckDigest(x: unknown): x is string {
    return typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
}

/** Kod HTTP dla wyniku potwierdzenia: odmowa = 409, awaria zapisu = 500. */
export function ackHttpStatus(result: AcknowledgeResult): number {
    if (result.ok) return 200;
    return result.reason === "write_failed" ? 500 : 409;
}
