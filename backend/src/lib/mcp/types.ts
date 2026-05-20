// Typy wspolne dla warstwy MCP w Patronie.
//
// McpCitation - ustrukturyzowane zrodlo zwrocone przez serwer MCP (np. SAOS).
// W odroznieniu od cytatow z dokumentow uzytkownika (parsowanych z bloku
// <CITATIONS> w odpowiedzi LLM), MCP citation NIE jest kotwiczona znacznikiem
// [N] w prozie. To jest "powiazane zrodlo" pokazywane w panelu obok odpowiedzi.
//
// Kontrakt: serwer MCP moze wystawic citations w polu structuredContent
// (https://modelcontextprotocol.io/specification - capabilities.tools.outputSchema).
// Patron czyta to pole opcjonalnie - serwery ktore go nie maja po prostu
// zwracaja pusta liste cytatow, a tekst i tak idzie do LLM.

export interface McpCitation {
    /** Stale pole rozrozniajace zrodlo cytatu w warstwie UI. */
    source: "mcp";
    /** Nazwa serwera MCP, np. "saos". Wypelniana po stronie klienta. */
    server: string;
    /** Nazwa narzedzia w obrebie serwera, np. "search" lub "get_judgment". */
    tool: string;
    /** Etykieta wyswietlana w panelu, np. "I ACa 772/13 - SA w Krakowie". */
    title?: string;
    /** URL do oryginalu, np. SAOS judgment URL. */
    url?: string;
    /** Krotki fragment tekstu zrodla. */
    snippet?: string;
    /** Dowolne dodatkowe pola charakterystyczne dla domeny (sygnatura, data, sklad). */
    metadata?: Record<string, unknown>;
}

/**
 * Wynik wywolania narzedzia MCP po stronie Patrona.
 * Tekst trafia do tool_result (widziany przez LLM), citations - do panelu UI.
 */
export interface McpToolResult {
    /** Czlowiekoczytelny tekst skladany z blokow content[].text. */
    text: string;
    /** Cytaty wyluskane ze structuredContent (jesli serwer je wystawia). */
    citations: McpCitation[];
    /** true jesli serwer oznaczyl wynik jako blad (result.isError). */
    isError?: boolean;
}
