// Connector picker - domena (ADR-0133).
//
// Mecenas wybiera konektory MCP = wybor jurysdykcji. Picker zmienia TYLKO
// konektory zaufanego zestawu (Ring 1, APPROVED_PATRON_CONNECTORS). Konektory
// poza zestawem (Ring 2 / 3rd-party) sa read-only dla pickera - ich wlaczenie
// to rola Operatora (operatorApproved w mcp-servers.json), nie mecenasa.
//
// Ta warstwa NIE dotyka MCP Security Gateway ani ring-policy - czyta decyzje
// `decideRing` i autoryzuje toggle. I/O pliku konfiguracji jest w ./index.

import { decideRing } from "./ring-policy";
import {
    listConnectorConfigs,
    setConnectorEnabledInConfig,
    type McpServerConfig,
} from "./index";

export type Jurisdiction =
    | "PL"
    | "EU"
    | "DE"
    | "AT"
    | "ES"
    | "FI"
    | "IE"
    | "NL"
    | "SE"
    | "FR"
    | "LU"
    | "OTHER";

// Mapowanie nazwa konektora -> jurysdykcja (do grupowania w pickerze).
const JURISDICTION_BY_CONNECTOR: Readonly<Record<string, Jurisdiction>> = {
    saos: "PL",
    nsa: "PL",
    isap: "PL",
    krs: "PL",
    "sejm-eli": "PL",
    "eu-sparql": "EU",
    "eu-compliance": "EU",
    "de-eli": "DE",
    "at-eli": "AT",
    "es-eli": "ES",
    "fi-eli": "FI",
    "ie-eli": "IE",
    "nl-eli": "NL",
    "se-eli": "SE",
    "fr-eli": "FR",
    "lu-eli": "LU",
};

export interface ConnectorInfo {
    name: string;
    /** Brak pola w configu = wlaczony (zgodnie z semantyka loadConfig). */
    enabled: boolean;
    ring: 1 | 2;
    /** Tylko Ring 1 jest przelaczalny przez picker (mecenas). */
    toggleable: boolean;
    jurisdiction: Jurisdiction;
    trustLevel?: "trusted" | "untrusted";
    operatorApproved?: boolean;
}

function toInfo(cfg: McpServerConfig): ConnectorInfo {
    const decision = decideRing(cfg.name, {
        trustLevel: cfg.trustLevel,
        operatorApproved: cfg.operatorApproved,
    });
    const ring: 1 | 2 = decision.ring === 1 ? 1 : 2;
    return {
        name: cfg.name,
        enabled: cfg.enabled !== false,
        ring,
        toggleable: ring === 1,
        jurisdiction: JURISDICTION_BY_CONNECTOR[cfg.name] ?? "OTHER",
        ...(cfg.trustLevel !== undefined && { trustLevel: cfg.trustLevel }),
        ...(cfg.operatorApproved !== undefined && {
            operatorApproved: cfg.operatorApproved,
        }),
    };
}

/** Lista konektorow ze stanem (do GET /connectors). */
export function getConnectorList(): ConnectorInfo[] {
    return listConnectorConfigs().map(toInfo);
}

export type ToggleResult =
    | { ok: true; connector: ConnectorInfo }
    | { ok: false; status: 403 | 404 | 500; error: string };

/**
 * Przelacza `enabled` konektora. Tylko Ring 1 (zaufany zestaw). Ring 2 = 403
 * (3rd-party zostaje za bramka Operatora - ADR-0133). Konektor nieznany = 404.
 */
export function toggleConnector(name: string, enabled: boolean): ToggleResult {
    const cfg = listConnectorConfigs().find((c) => c.name === name);
    if (!cfg) {
        return { ok: false, status: 404, error: `Konektor "${name}" nie znaleziony.` };
    }
    const info = toInfo(cfg);
    if (!info.toggleable) {
        return {
            ok: false,
            status: 403,
            error: `Konektor "${name}" jest poza zaufanym zestawem - zmiana wymaga Operatora.`,
        };
    }
    const w = setConnectorEnabledInConfig(name, enabled);
    if (!w.ok) {
        return { ok: false, status: 500, error: w.error ?? "write failed" };
    }
    return { ok: true, connector: { ...info, enabled } };
}
