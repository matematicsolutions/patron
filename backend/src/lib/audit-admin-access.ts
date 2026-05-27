// Helper logowania dostepu admin do chronionych endpointow (ADR-0043).
//
// Wpiecie w endpoint per ADR-0040 (audit viewer), ADR-0042 (banner status),
// ADR-0037 (metrics scrape). Graceful: catch + stderr, NIGDY nie rzuca -
// audit_log fail nie blokuje endpointu (Konstytucja Art. 8 stalosc
// kontraktow).
//
// Payload zawiera: method, path, query (jezeli != puste). NIE zawiera body
// (admin endpointy sa read-only GET, body brak).

import { appendAuditEvent } from "./audit";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminAccessEventType =
    | "admin.access.audit_viewer"
    | "admin.access.security_banner"
    | "admin.access.metrics";

export interface RecordAdminAccessArgs {
    db: SupabaseClient;
    event_type: AdminAccessEventType;
    actor_user_id: string | null;
    actor_email: string | null;
    method: string;
    path: string;
    query?: Record<string, unknown>;
    remote_ip?: string;
}

/**
 * Buduje payload dla admin.access event. Pure function - testowalna bez
 * mockow Supabase. Pomija query gdy puste (zwartosc payload).
 */
export function buildAdminAccessPayload(args: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    remote_ip?: string;
    actor_email?: string | null;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        method: args.method,
        path: args.path,
    };
    if (args.query && Object.keys(args.query).length > 0) {
        payload.query = args.query;
    }
    if (args.remote_ip) {
        payload.remote_ip = args.remote_ip;
    }
    if (args.actor_email) {
        payload.actor_email = args.actor_email;
    }
    return payload;
}

/**
 * Zapisuje admin.access event do audit_log. Graceful - bledy logowane do
 * stderr, NIGDY nie rzuca. Calle should NOT await dla speed albo `.catch(
 * () => {})` dla ergonomii TS.
 */
export async function recordAdminAccess(
    args: RecordAdminAccessArgs,
): Promise<void> {
    try {
        const payload = buildAdminAccessPayload({
            method: args.method,
            path: args.path,
            query: args.query,
            remote_ip: args.remote_ip,
            actor_email: args.actor_email,
        });
        await appendAuditEvent(args.db, {
            event_type: args.event_type,
            actor_user_id: args.actor_user_id,
            payload,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[ADMIN-ACCESS-LOG-FAIL] ${args.event_type}: ${msg}`);
    }
}
