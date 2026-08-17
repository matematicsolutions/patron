// Hook frontend dla bannera posture egress / data-residency (Faza 2 audytu Fable5).
//
// Czyta GET /api/config/egress (read-only, requireAuth). Cel: pracujacy prawnik
// widzi, gdy model chmurowy jest dozwolony dla spraw objetych tajemnica - zgoda
// Operatora staje sie WIDOCZNA, nie tylko zaszyta w env i ADR (ryzyko #2 audytu).
//
// Bez zewnetrznych zaleznosci (useEffect + fetch, jak useMcpSecurityStatus,
// Konstytucja Art. 4). Network / 5xx -> config null (fail-closed, banner sie nie
// renderuje).

"use client";

import { useEffect, useState } from "react";

export interface EgressConfig {
    us_providers: { allowed: boolean };
    privileged_cloud: { allowed: boolean };
    local_model_configured: boolean;
}

export interface UseEgressConfigResult {
    config: EgressConfig | null;
}

const ENDPOINT = "/api/config/egress";

export function useEgressConfig(): UseEgressConfigResult {
    const [config, setConfig] = useState<EgressConfig | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchConfig(): Promise<void> {
            try {
                const res = await fetch(ENDPOINT, { credentials: "include" });
                if (cancelled) return;
                if (!res.ok) {
                    setConfig(null);
                    return;
                }
                const data = (await res.json()) as EgressConfig;
                if (cancelled) return;
                setConfig(data);
            } catch {
                if (cancelled) return;
                setConfig(null);
            }
        }

        void fetchConfig();
        return () => {
            cancelled = true;
        };
    }, []);

    return { config };
}
