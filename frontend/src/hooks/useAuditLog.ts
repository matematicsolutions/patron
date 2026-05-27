// Hook fetch dla viewera audytora (ADR-0046 faza 2 z ADR-0040).
//
// Wywoluje GET /api/audit/log z parametrami filter. Zero polling (audytor
// chce stabilny widok do analizy, refetch explicit przez button). Zero
// zewnetrznych zaleznosci (useEffect + fetch).

"use client";

import { useCallback, useEffect, useState } from "react";

export type AuditEventType =
    | "all"
    | "chat.message.user"
    | "chat.message.assistant"
    | "input_security_scan"
    | "mcp_security.gateway"
    | "ring_policy.decision"
    | "rodo.delete"
    | "rodo.export"
    | "admin.access.audit_viewer"
    | "admin.access.security_banner"
    | "admin.access.metrics"
    | "migrate.rollback";

export interface AuditLogFilter {
    event_type: AuditEventType;
    actor_user_id: string;
    since: string;
    until: string;
    limit: number;
    cursor: number | null;
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

export interface UseAuditLogResult {
    events: AuditLogResponseEvent[];
    nextCursor: number | null;
    loading: boolean;
    error: string | null;
    refetch: () => void;
    loadMore: (cursor: number) => void;
}

export function useAuditLog(filter: AuditLogFilter): UseAuditLogResult {
    const [events, setEvents] = useState<AuditLogResponseEvent[]>([]);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refetchCount, setRefetchCount] = useState(0);

    const fetchPage = useCallback(
        async (cursorOverride: number | null, append: boolean): Promise<void> => {
            setLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams();
                if (filter.event_type !== "all") {
                    params.set("event_type", filter.event_type);
                }
                if (filter.actor_user_id) {
                    params.set("actor_user_id", filter.actor_user_id);
                }
                if (filter.since) params.set("since", filter.since);
                if (filter.until) params.set("until", filter.until);
                if (filter.limit) params.set("limit", String(filter.limit));
                if (cursorOverride !== null) {
                    params.set("cursor", String(cursorOverride));
                }

                const res = await fetch(`/api/audit/log?${params.toString()}`, {
                    credentials: "include",
                });

                if (res.status === 403) {
                    setError("Wymagana rola admin (whitelist email env).");
                    setEvents([]);
                    setNextCursor(null);
                    return;
                }

                if (!res.ok) {
                    setError(`HTTP ${res.status}`);
                    return;
                }

                const data = (await res.json()) as {
                    events: AuditLogResponseEvent[];
                    next_cursor: number | null;
                };
                setEvents((prev) => (append ? [...prev, ...data.events] : data.events));
                setNextCursor(data.next_cursor);
            } catch (err) {
                setError(err instanceof Error ? err.message : "unknown");
            } finally {
                setLoading(false);
            }
        },
        [filter],
    );

    useEffect(() => {
        void fetchPage(null, false);
    }, [refetchCount, fetchPage]);

    const refetch = useCallback(() => {
        setRefetchCount((n) => n + 1);
    }, []);

    const loadMore = useCallback(
        (cursor: number) => {
            void fetchPage(cursor, true);
        },
        [fetchPage],
    );

    return { events, nextCursor, loading, error, refetch, loadMore };
}
