// Pure functions parsowania query params dla GET /api/audit/log (ADR-0040 faza 1).
//
// Parser cursor-based paginacji + filtrow dla audytora. Wszystkie funkcje
// pure, testowalne bez mockow Supabase.

export const VALID_EVENT_TYPES = [
    "chat.message.user",
    "chat.message.assistant",
    "input_security_scan",
    "mcp_security.gateway",
    "ring_policy.decision",
    "rodo.delete",
    "rodo.export",
] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];

export interface AuditLogFilter {
    event_type: EventType | null;       // null = all
    actor_user_id: string | null;
    since: string;                       // ISO timestamp
    until: string;                       // ISO timestamp
    limit: number;                       // 1-200
    cursor: number | null;               // event_id offset
}

export interface ParseResult {
    ok: boolean;
    filter?: AuditLogFilter;
    error?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_WINDOW_DAYS = 30;

function isValidIso(s: string): boolean {
    const d = new Date(s);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10);
}

function isValidUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Parsuje query params Express req.query do strongly-typed AuditLogFilter.
 * Default since = teraz - 30 dni, until = teraz, limit = 50, cursor = null.
 * Zwraca {ok: false, error: ...} dla nieprawidlowych wartosci.
 */
export function parseAuditLogQuery(
    query: Record<string, unknown>,
    now: Date = new Date(),
): ParseResult {
    const eventTypeRaw = query.event_type;
    let event_type: EventType | null = null;
    if (typeof eventTypeRaw === "string" && eventTypeRaw !== "all") {
        if (!(VALID_EVENT_TYPES as ReadonlyArray<string>).includes(eventTypeRaw)) {
            return {
                ok: false,
                error: `invalid event_type: ${eventTypeRaw}`,
            };
        }
        event_type = eventTypeRaw as EventType;
    }

    const actorRaw = query.actor_user_id;
    let actor_user_id: string | null = null;
    if (typeof actorRaw === "string" && actorRaw.length > 0) {
        if (!isValidUuid(actorRaw)) {
            return { ok: false, error: "invalid actor_user_id (not UUID)" };
        }
        actor_user_id = actorRaw;
    }

    let since: string;
    if (typeof query.since === "string") {
        if (!isValidIso(query.since)) {
            return { ok: false, error: "invalid since (ISO 8601 required)" };
        }
        since = query.since;
    } else {
        since = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
            .toISOString();
    }

    let until: string;
    if (typeof query.until === "string") {
        if (!isValidIso(query.until)) {
            return { ok: false, error: "invalid until (ISO 8601 required)" };
        }
        until = query.until;
    } else {
        until = now.toISOString();
    }

    let limit = DEFAULT_LIMIT;
    if (typeof query.limit === "string") {
        const parsed = Number.parseInt(query.limit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_LIMIT) {
            return {
                ok: false,
                error: `invalid limit (1-${MAX_LIMIT})`,
            };
        }
        limit = parsed;
    }

    let cursor: number | null = null;
    if (typeof query.cursor === "string") {
        const parsed = Number.parseInt(query.cursor, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return { ok: false, error: "invalid cursor (positive integer)" };
        }
        cursor = parsed;
    }

    return {
        ok: true,
        filter: {
            event_type,
            actor_user_id,
            since,
            until,
            limit,
            cursor,
        },
    };
}

export interface AuditLogRow {
    id: number;
    event_type: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    ts: string;
    hash: string;
    prev_hash: string;
    payload: unknown;
}

export interface AuditLogResponseEvent {
    id: number;
    event_type: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    ts: string;
    hash: string;
    prev_hash: string;
    payload_masked: unknown;
}

/**
 * Sklada response z surowych wierszy DB + funkcji maskowania payload.
 * Pure - injected mask function dla testowalnosci.
 */
export function buildResponseEvents(
    rows: ReadonlyArray<AuditLogRow>,
    maskFn: (payload: unknown) => unknown,
): AuditLogResponseEvent[] {
    return rows.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        actor_user_id: row.actor_user_id,
        chat_id: row.chat_id,
        document_id: row.document_id,
        ts: row.ts,
        hash: row.hash,
        prev_hash: row.prev_hash,
        payload_masked: maskFn(row.payload),
    }));
}

/**
 * Cursor next = id ostatniego eventu w obecnej stronie (paginacja DESC by id).
 * Zwraca null jezeli rows.length < limit (ostatnia strona).
 */
export function computeNextCursor(
    rows: ReadonlyArray<AuditLogRow>,
    limit: number,
): number | null {
    if (rows.length < limit) return null;
    const last = rows[rows.length - 1];
    return last?.id ?? null;
}
