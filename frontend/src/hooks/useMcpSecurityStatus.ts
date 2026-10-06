// Hook frontend dla bannera MCP Security Gateway (ADR-0042).
//
// Polling endpointu GET /api/security/mcp-status co 60s. Zero zewnetrznych
// zaleznosci (TanStack Query nie w stosie, useEffect + setInterval + fetch
// wystarcza dla read-only widgetu, Konstytucja Art. 4 neutralnosc).
//
// Strategia error handling:
//   403 (non-admin) -> visible: false, banner sie nie renderuje
//   5xx / network -> visible: false + error, banner sie nie renderuje (fail-closed)
//   200 -> visible: true; baner i perymetr pokazuja BLOKADY (blockedGatewayDecisions).
//   Tryb bramy jest zawsze "enforce" (ADR-0160) - backend nie zglasza innego.

"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiBase";

export type GatewayMode = "enforce" | "audit" | "off";

export interface McpStatus {
    gateway: {
        mode: GatewayMode;
        active: boolean;
        last_startup_scan: {
            timestamp: string;
            overall_action: string;
            servers_scanned: number;
            findings_count: number;
        } | null;
    };
    audit_summary_24h: {
        decisions_total: number;
        by_action: { audit: number; human_review: number; denied: number };
        /**
         * B-08: ile z `human_review` to nowy konektor spoza zaufanego zestawu,
         * ktory czeka na zatwierdzenie Operatora (bez podejrzanego sygnalu).
         * Brak pola = starszy backend (0).
         */
        awaiting_operator_approval?: number;
    };
}

/**
 * Decyzje bramy z ostatnich 24h, ktore BLOKUJA konektor: `denied` oraz
 * `human_review` bez zatwierdzenia Operatora (zatwierdzony ma w audycie akcje
 * `audit`, ADR-0158). Liczenie samego `denied` przemilczalo blokade dryfu i
 * podmiany plikow konektora (ADR-0159/0162), ktore koncza sie `human_review`.
 */
export function blockedGatewayDecisions(status: McpStatus | null): number {
    if (!status) return 0;
    const { denied, human_review } = status.audit_summary_24h.by_action;
    return denied + human_review;
}

/**
 * B-08: blokady, ktore sa zwyklym oczekiwaniem na zatwierdzenie nowego
 * konektora 3rd-party (podzbior blockedGatewayDecisions). Baner pokazuje je
 * jako oczekiwanie, nie alarm; perymetr dalej liczy je jako blokade (narzedzia
 * konektora NIE sa zaladowane).
 */
export function awaitingApprovalDecisions(status: McpStatus | null): number {
    if (!status) return 0;
    const n = status.audit_summary_24h.awaiting_operator_approval ?? 0;
    return Math.max(0, Math.min(n, status.audit_summary_24h.by_action.human_review));
}

export interface UseMcpSecurityStatusResult {
    visible: boolean;
    status: McpStatus | null;
    error: string | null;
}

const POLL_INTERVAL_MS = 60_000;
const ENDPOINT = apiUrl("/api/security/mcp-status");

export function useMcpSecurityStatus(): UseMcpSecurityStatusResult {
    const [status, setStatus] = useState<McpStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function fetchStatus(): Promise<void> {
            try {
                const res = await fetch(ENDPOINT, {
                    credentials: "include",
                });

                if (cancelled) return;

                if (res.status === 403) {
                    setVisible(false);
                    setStatus(null);
                    setError(null);
                    return;
                }

                if (!res.ok) {
                    setVisible(false);
                    setError(`HTTP ${res.status}`);
                    return;
                }

                const data = (await res.json()) as McpStatus;
                if (cancelled) return;

                setStatus(data);
                setVisible(true);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                setVisible(false);
                setError(err instanceof Error ? err.message : "unknown");
            }
        }

        void fetchStatus();
        const intervalId = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, []);

    return { visible, status, error };
}
