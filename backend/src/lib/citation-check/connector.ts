// Polaczenie "Sprawdz powolania" (ADR-0157) z konektorem MCP.
//
// Repertorium jest serwisem ZDALNYM (HTTP), wiec NIE ma go na liscie zaufanych
// konektorow Patrona (APPROVED_PATRON_CONNECTORS = konektory bundlowane w
// instalatorze). Operator dopisuje go w nakladce ~/.patron/mcp-servers.operator.json
// (ADR-0166 - plik instalatora ginie przy aktualizacji) jako Ring 2 z
// `operatorApproved: true` - ta sama sciezka co kazdy konektor 3rd-party:
// brama bezpieczenstwa przy starcie (ADR-0028) i ring-policy przy kazdym
// wywolaniu (ADR-0027, zdarzenie `ring_policy.decision` w lancuchu audytu).
// Brama daje Repertorium `human_review` (falszywe alarmy o polach wyniku), wiec
// Operator po przegladzie wpisuje tez `gatewayApproval.hash` (ADR-0158).
// Adres konektora z kluczem dostepu zyje wylacznie w lokalnej nakladce Operatora.

import { getMcpTools, isMcpTool, runMcpTool } from "../mcp";
import type { VerifyToolCall } from "./index";

export const VERIFY_TOOL = "verify_citations";

/** Nazwa serwera MCP z narzedziem `verify_citations` (domyslnie "repertorium"). */
export function verifierServerName(): string {
    const v = process.env.PATRON_CITATION_VERIFIER_SERVER?.trim();
    // "__" jest separatorem serwer__narzedzie w nazwach narzedzi MCP - nazwa
    // serwera z nim wskazywalaby cudze narzedzie ("saos__search").
    return v && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(v) && !v.includes("__")
        ? v
        : "repertorium";
}

/**
 * Zwraca funkcje wywolania `verify_citations` albo null, gdy konektor nie jest
 * skonfigurowany, nie wstal albo zostal zablokowany przez brame bezpieczenstwa.
 */
export async function resolveVerifyToolCall(): Promise<VerifyToolCall | null> {
    const name = `${verifierServerName()}__${VERIFY_TOOL}`;
    try {
        await getMcpTools();
    } catch {
        return null;
    }
    if (!isMcpTool(name)) return null;
    return async (args) => {
        const r = await runMcpTool(name, args);
        return { text: r.text, structured: r.structured, isError: r.isError };
    };
}
