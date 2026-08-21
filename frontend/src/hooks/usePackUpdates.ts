// Hook frontend dla bannera aktualizacji paczek wiedzy (ADR-0140).
//
// Czyta GET /api/packs/updates (requireAuth+requireAdmin; desktop single-user:
// operator = admin). Zwraca wylacznie paczki ze statusem "dostepna" - banner
// to lagodny nacisk ("prawo sie zmienia"), nie blokada: paczka bez kanalu albo
// z kanalem offline po prostu nie generuje wpisu.
//
// Bez zewnetrznych zaleznosci (useEffect + fetch, jak useEgressConfig).
// Network / 5xx -> pusta lista (fail-closed, banner sie nie renderuje).

"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiBase";

export interface PackUpdate {
    file: string;
    packName: string | null;
    edition: string;
    status: string;
    have: string | null;
    available: string;
    downloadMb: number;
    packMb: number;
}

const ENDPOINT = apiUrl("/api/packs/updates");

export function usePackUpdates(): { updates: PackUpdate[] } {
    const [updates, setUpdates] = useState<PackUpdate[]>([]);

    useEffect(() => {
        let cancelled = false;

        async function fetchUpdates(): Promise<void> {
            try {
                const res = await fetch(ENDPOINT, { credentials: "include" });
                if (cancelled || !res.ok) return;
                const data = (await res.json()) as { updates?: PackUpdate[] };
                if (cancelled) return;
                setUpdates(
                    (data.updates ?? []).filter((u) => u.status === "dostepna"),
                );
            } catch {
                // offline / backend jeszcze wstaje - brak bannera, zero halasu
            }
        }

        void fetchUpdates();
        return () => {
            cancelled = true;
        };
    }, []);

    return { updates };
}
