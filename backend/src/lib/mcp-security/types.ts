// Typy warstwy MCP Security Gateway - skan definicji konektorow MCP przed
// zaladowaniem do kontraktu Patrona. Skan dzieje sie LOKALNIE, deterministycznie,
// zero-LLM, ZANIM definicja narzedzia trafi do orchestratora.
//
// Zobacz governance/adr/0025-mcp-security-gateway-wdrazenie.md:
// skeleton dziedziczy AGPL-3.0 po patron; pattern (4 detektory, scan przed
// zaladowaniem) cherry-picked z microsoft/agent-governance-toolkit (MIT,
// snapshot 2026-05-24, audyt RODO 🟢 ZIELONY). Skeleton 5-fazowy i 4 stany
// akcji wziete z naszego wlasnego input-security (ADR-0019). Kod TS napisany
// od zera. NIE wpiety w startup backendu (osobny ADR-0028).

/**
 * Kategoria zagrozenia wykrytego w definicji konektora MCP.
 * - typosquat: nazwa konektora myli sie z nazwa zatwierdzonego (atak phishing namespace)
 * - drift: hash opisu konektora/narzedzi rozni sie od poprzedniego ladowania
 * - hidden_instructions: wzorce w description skierowane do LLM (jailbreak via tool description)
 * - tool_poisoning: opis prosi o uprawnienia poza inputSchema lub modyfikuje zachowanie systemu
 */
export type McpThreatCategory =
    | "typosquat"
    | "drift"
    | "hidden_instructions"
    | "tool_poisoning";

/**
 * Waga pojedynczego znaleziska. `critical` zarezerwowane dla sygnalow jednoznacznych
 * (typosquat dist<=2, hidden-instruction o twardym znaczeniu). Reszta kieruje
 * do `human_review` (Art. 6 Konstytucji - human in the loop).
 */
export type McpSeverity = "low" | "medium" | "high" | "critical";

/**
 * Pojedyncze znalezisko w skanie.
 */
export interface McpFinding {
    detector: string;
    category: McpThreatCategory;
    severity: McpSeverity;
    /** Identyfikator skanowanego konektora (jego deklarowana nazwa). */
    serverName: string;
    /** Opcjonalna nazwa narzedzia wewnatrz konektora, ktore wywolalo znalezisko. */
    toolName?: string;
    /** Krotki opis dla audytora (po polsku, bez diakrytyki - konwencja repo). */
    message: string;
    /** Surowy fragment wzbudzajacy podejrzenie - przyciety do 200 znakow. */
    sample?: string;
}

/**
 * Definicja pojedynczego konektora MCP do skanu.
 * Lekka kopia struktury `mcp-servers.json` + lista narzedzi z `tools/list`.
 */
export interface McpServerDefinition {
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    tools: McpToolDefinition[];
}

/**
 * Definicja pojedynczego narzedzia eksportowanego przez konektor MCP.
 * Spojne z tools/list odpowiedzi po stronie JSON-RPC.
 */
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
}

/**
 * Interfejs detektora. Pojedynczy detektor analizuje definicje konektora
 * (i wszystkich jego narzedzi) i zwraca liste znalezisk.
 */
export interface McpDetector {
    name: string;
    run(server: McpServerDefinition, context: McpScanContext): McpFinding[];
}

/**
 * Kontekst skanu wspolny dla wszystkich detektorow.
 */
export interface McpScanContext {
    /** Lista zatwierdzonych nazw konektorow Patrona (canonical) - referencja dla typosquat. */
    approvedNames: ReadonlySet<string>;
    /** Mapa: serverName -> baseline hash (do detektora drift). Brak = pierwszy load. */
    driftBaseline: ReadonlyMap<string, string>;
}

/**
 * Wynik skanu pojedynczego konektora.
 */
export interface McpServerScanResult {
    serverName: string;
    findings: McpFinding[];
    riskScore: number;
    threatLevel: McpSeverity;
    /** Decyzja PATRON dla tego konektora. */
    action: McpAction;
    /** Hash aktualny opisow (do zapisu jako nowy baseline, jezeli action!=denied). */
    currentHash: string;
}

/**
 * Decyzja PATRON dla konektora po skanie.
 * - allowed: konektor moze byc wpiety
 * - audit: konektor moze byc wpiety, finding zapisany do audit log
 * - human_review: konektor wymaga zatwierdzenia Operatora
 * - denied: konektor odrzucony, blokada wpiecia
 */
export type McpAction = "allowed" | "audit" | "human_review" | "denied";

/**
 * Wynik skanu calego rejestru konektorow MCP (raport).
 */
export interface McpScanReport {
    timestamp: string;
    totalServers: number;
    allowed: number;
    audit: number;
    humanReview: number;
    denied: number;
    perServer: McpServerScanResult[];
    /** Ogolny werdykt - najgorsza decyzja wsrod konektorow. */
    overallAction: McpAction;
}
