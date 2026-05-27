// Hook frontend dla bannera MCP Security Gateway (ADR-0042).
//
// Polling endpointu GET /api/security/mcp-status co 60s. Zero zewnetrznych
// zaleznosci (TanStack Query nie w stosie, useEffect + setInterval + fetch
// wystarcza dla read-only widgetu, Konstytucja Art. 4 neutralnosc).
//
// Strategia error handling:
//   403 (non-admin) -> visible: false, banner sie nie renderuje
//   5xx / network -> visible: false + error, banner sie nie renderuje (fail-closed)
//   200 + mode "off" -> visible: true, banner pokazuje wylaczony (kolor szary)
//   200 + mode "enforce"/"audit" -> visible: true, banner pokazuje aktywny

"use client";

import { useEffect, useState } from "react";

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
    };
}

export interface UseMcpSecurityStatusResult {
    visible: boolean;
    status: McpStatus | null;
    error: string | null;
}

const POLL_INTERVAL_MS = 60_000;
const ENDPOINT = "/api/security/mcp-status";

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
