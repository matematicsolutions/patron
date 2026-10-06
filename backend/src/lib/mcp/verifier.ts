// Serwer weryfikatora powolan (ADR-0157) w warstwie MCP - poprawka R-CC-07.
//
// ADR-0157 kaze Operatorowi zarejestrowac Repertorium jako zwykly serwer MCP w
// nakladce. Bez tego modulu jego narzedzia trafialy tez do modelu czatu
// (getMcpTools -> lib/chat/stream.ts), w tym `verify_citations` z trybem `text`
// (cale pismo). Model, ktory przeczytal pismo, mial wiec sciezke wyslania CALEJ
// tresci obok przycisku "Sprawdz powolania", ktory pilnuje, zeby wychodzila
// tylko lista powolan.
//
// Zasada: narzedzia serwera weryfikatora NIE sa narzedziami czatu. Sa dostepne
// wylacznie przez `runCitationVerifier` (lib/mcp/index.ts), ktory przepuszcza
// tylko tryb listy - argumenty skladane od zera z bialej listy pol ponizej.

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

/** Czy serwer jest weryfikatorem powolan - jego narzedzia nie ida do czatu. */
export function isVerifierServer(serverName: string): boolean {
    return serverName === verifierServerName();
}

/** Limit pozycji na wywolanie (kontrakt `verify_citations`). */
const MAKS_POZYCJI = 25;

function krotkiNapis(v: unknown, maks: number, wzor?: RegExp): string | null {
    if (typeof v !== "string") return null;
    if (v.length === 0 || v.length > maks) return null;
    return wzor && !wzor.test(v) ? null : v;
}

/**
 * Argumenty `verify_citations` w trybie listy, budowane OD ZERA z bialej listy
 * pol. Wszystko inne - w szczegolnosci `text` (cale pismo) - nie wychodzi.
 * Pola sa krotkie i maja ksztalt identyfikatora, zeby lista nie stala sie
 * kanalem na dowolny tekst. Pozycja o zlym ksztalcie jest pomijana.
 */
export function sanitizeVerifyArgs(input: Record<string, unknown>): Record<string, unknown> {
    const surowe = Array.isArray(input.citations) ? input.citations : [];
    const citations: Record<string, string>[] = [];
    for (const raw of surowe.slice(0, MAKS_POZYCJI)) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
        const r = raw as Record<string, unknown>;
        const ref = krotkiNapis(r.ref, 12, /^c\d{1,6}$/);
        if (!ref) continue;
        if (r.type === "signature") {
            const signature = krotkiNapis(r.signature, 40, /^[0-9A-ZĄĆĘŁŃÓŚŹŻ /]+$/);
            if (!signature) continue;
            const data = krotkiNapis(r.date_in_text, 10, /^\d{4}-\d{2}-\d{2}$/);
            citations.push({
                type: "signature",
                signature,
                ...(data ? { date_in_text: data } : {}),
                ref,
            });
        } else if (r.type === "provision") {
            const actId = krotkiNapis(r.act_id, 40, /^eli:[A-Z]{2}\/\d{4}\/\d{1,5}$/);
            const article = krotkiNapis(r.article, 16, /^[0-9a-z^]+$/);
            if (!actId || !article) continue;
            citations.push({ type: "provision", act_id: actId, article, ref });
        }
    }
    const out: Record<string, unknown> = { citations };
    const asOf = krotkiNapis(input.as_of, 10, /^\d{4}-\d{2}-\d{2}$/);
    if (asOf) out.as_of = asOf;
    return out;
}
