// Connector picker - domena (ADR-0133).
//
// Mecenas wybiera konektory MCP = wybor jurysdykcji. Picker zmienia TYLKO
// konektory zaufanego zestawu (Ring 1, APPROVED_PATRON_CONNECTORS). Konektory
// poza zestawem (Ring 2 / 3rd-party) sa read-only dla pickera - ich wlaczenie
// to rola Operatora (`gatewayApproval` w nakladce, ADR-0158 / B-08), nie mecenasa.
// Picker pokazuje, ze taki konektor czeka na zatwierdzenie (pole `gateway`).
//
// Ta warstwa NIE dotyka MCP Security Gateway ani ring-policy - czyta decyzje
// `decideRing` i autoryzuje toggle. I/O pliku konfiguracji jest w ./index.

import { decideRing } from "./ring-policy";
import {
    getGatewayState,
    isAwaitingOperatorApproval,
    listConnectorConfigs,
    setConnectorEnabledInConfig,
    type McpServerConfig,
} from "./index";
import {
    APPROVED_PATRON_CONNECTORS,
    buildScanContext,
    typosquatDetector,
} from "../mcp-security";

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
    | "IT"
    | "BR"
    | "GB"
    | "US"
    | "OTHER";

// Mapowanie nazwa konektora -> jurysdykcja (do grupowania w pickerze).
// Klucze MUSZA byc rowne APPROVED_PATRON_CONNECTORS (pipeline.ts) - parytet
// pilnowany przez connector-name-parity.test.ts. Nie dopisuj tu konektora,
// ktory nie przeszedl gateway-scanu i nie jest zsynchronizowany we wszystkich
// lustrach (AGENTS.md Mirrors #2); sejm-eli siedzial tu osierocony od
// ADR-0133 (2026-06-24) bez wpisu gdziekolwiek indziej - usuniety 2026-08-31
// (repo ~/Projects/sejm-eli-mcp zyje we flocie; wejscie do PATRONa = scan +
// ADR + wszystkie lustra naraz; uwaga: Levenshtein("sejm-eli","se-eli")=2,
// wiec bez wpisu w APPROVED bramka typosquat go zablokuje).
export const JURISDICTION_BY_CONNECTOR: Readonly<Record<string, Jurisdiction>> = {
    saos: "PL",
    nsa: "PL",
    isap: "PL",
    krs: "PL",
    eureka: "PL",
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
    "it-eli": "IT",
    "br-eli": "BR",
    "gb-eli": "GB",
    "us-eli": "US",
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
    /**
     * Stan bramy bezpieczenstwa MCP (B-08 / ADR-0158). Brak pola = nic do
     * zgloszenia (zarejestrowany albo stan nieznany do pierwszego skanu).
     * - awaiting_operator_approval: `human_review` bez zgodnego `gatewayApproval`;
     * - blocked: brama odrzucila konektor (`denied`, np. nazwa myli sie z zaufana).
     */
    gateway?: ConnectorGatewayStatus;
}

export type ConnectorGatewayStatus = "awaiting_operator_approval" | "blocked";

/**
 * Stan bramy dla pickera. Po skanie w tym procesie - stan faktyczny. Przed nim
 * (picker otwarty przed pierwszym czatem) - tylko to, co wiadomo bez laczenia
 * sie z konektorem: nieznany konektor bez `gatewayApproval` na pewno czeka na
 * Operatora (B-08), a nazwa mylaca sie z zaufana (typosquat critical) bedzie
 * odrzucona. Konektor z wpisanym zatwierdzeniem - nieznany do skanu (hash).
 */
function gatewayStatusOf(cfg: McpServerConfig): ConnectorGatewayStatus | undefined {
    const live = getGatewayState(cfg.name);
    if (live) {
        if (isAwaitingOperatorApproval(live)) return "awaiting_operator_approval";
        return live.registered ? undefined : "blocked";
    }
    if (cfg.enabled === false) return undefined;
    if (APPROVED_PATRON_CONNECTORS.includes(cfg.name)) return undefined;
    if (cfg.gatewayApproval !== undefined) return undefined;
    const typo = typosquatDetector.run(
        { name: cfg.name, transport: cfg.transport, tools: [] },
        buildScanContext(),
    );
    return typo.some((f) => f.severity === "critical") ? "blocked" : "awaiting_operator_approval";
}

function toInfo(cfg: McpServerConfig): ConnectorInfo {
    const decision = decideRing(cfg.name, {
        trustLevel: cfg.trustLevel,
        operatorApproved: cfg.operatorApproved,
        configSource: cfg.configSource,
    });
    const ring: 1 | 2 = decision.ring === 1 ? 1 : 2;
    const gateway = ring === 1 ? undefined : gatewayStatusOf(cfg);
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
        ...(gateway !== undefined && { gateway }),
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
