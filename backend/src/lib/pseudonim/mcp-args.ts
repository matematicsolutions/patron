// Argumenty wywolan ZEWNETRZNYCH konektorow MCP (audyt 2026-09 A-09 / B-11).
//
// Decyzja wlasciciela produktu (2026-10-06): w argumentach narzedzi MCP
// (`serwer__narzedzie`) NIE przywracamy tokenow pseudonimow dla osob i danych
// osobowych. Model widzi token i konektor dostaje token. Odtwarzamy tylko
// kategorie identyfikujace podmioty publicznych rejestrow (ORG, NIP, REGON, KRS),
// bo szukanie spolki po nazwie, NIP albo KRS jest celowym uzyciem konektora KRS.
//
// Niezaleznie od mapy (model lokalny nie ma mapy, a tresc akt moze przyjsc
// doslownie, np. przez wstrzykniecie w dokumencie, B-11) w argumentach po
// odtworzeniu wycinamy PESEL z poprawna suma kontrolna i adresy e-mail. Do
// audytu idzie tylko licznik per kategoria, nigdy wartosc.
//
// Narzedzia LOKALNE (edit_document, find_in_document, generate_docx...) dalej
// dostaja pelne odtworzenie (`unwrap`) - pracuja na danych, ktore nigdy nie
// opuszczaja maszyny, a token w ich argumencie bylby bledem (edycja DOCX nie
// trafilaby w tekst).

import { POLISH_PII_RULES, detectRegex } from "./detect";
import type { PiiCategory, PseudonimMap } from "./types";

/**
 * Kategorie, ktorych tokeny wolno odtworzyc w argumencie zewnetrznego
 * konektora MCP. Wszystko inne (PERSON, PESEL, ADDRESS, EMAIL, PHONE i kazda
 * przyszla kategoria osobowa) zostaje tokenem - lista dozwolonych, nie
 * zabronionych, wiec nowa kategoria jest domyslnie chroniona.
 */
export const MCP_REHYDRATABLE_CATEGORIES: ReadonlySet<PiiCategory> = new Set<PiiCategory>([
    "ORG",
    "NIP",
    "REGON",
    "KRS",
]);

/** Kategorie wycinane z argumentow MCP niezaleznie od mapy pseudonimow. */
const MCP_ARGS_DLP_RULES = POLISH_PII_RULES.filter(
    (r) => r.category === "PESEL" || r.category === "EMAIL",
);

export interface PreparedMcpArgs {
    /** Argumenty do wyslania konektorowi. */
    args: unknown;
    /**
     * Liczba wartosci wycietych przez DLP (PESEL z poprawna suma, e-mail),
     * per kategoria. Bez wartosci.
     */
    redacted: Record<string, number>;
    /** Liczba tokenow pseudonimow NIE odtworzonych (kategorie osobowe), per kategoria. */
    tokensWithheld: Record<string, number>;
}

function bump(counter: Record<string, number>, key: string, by = 1): void {
    counter[key] = (counter[key] ?? 0) + by;
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let n = 0;
    let i = haystack.indexOf(needle);
    while (i >= 0) {
        n++;
        i = haystack.indexOf(needle, i + needle.length);
    }
    return n;
}

/**
 * `unwrap` ograniczony do wskazanych kategorii. Tokeny pozostalych kategorii
 * zostaja w tekscie i sa liczone w `withheld`.
 */
export function unwrapCategories(
    text: string,
    map: PseudonimMap,
    allowed: ReadonlySet<PiiCategory>,
    withheld: Record<string, number> = {},
): string {
    // Od najdluzszego tokenu - jak `unwrap` (bez aliasingu [ORG_1] / [ORG_10]).
    const tokens = [...map.byToken.values()].sort(
        (a, b) => b.token.length - a.token.length,
    );
    let out = text;
    for (const t of tokens) {
        if (!out.includes(t.token)) continue;
        if (allowed.has(t.category)) {
            out = out.split(t.token).join(t.original);
        } else {
            bump(withheld, t.category, countOccurrences(out, t.token));
        }
    }
    return out;
}

/** Zastepuje PESEL (poprawna suma) i e-mail tokenem z mapy albo znacznikiem. */
function redactDlp(
    text: string,
    map: PseudonimMap | null,
    redacted: Record<string, number>,
): string {
    const all = detectRegex(text, MCP_ARGS_DLP_RULES);
    if (all.length === 0) return text;
    // Trafienia nakladajace sie (np. "85071202931@x.pl" = PESEL i e-mail):
    // zostaje najdluzsze od danej pozycji, kolejne nakladki odpadaja.
    all.sort((a, b) => a.start - b.start || b.end - a.end);
    const hits: typeof all = [];
    let lastEnd = -1;
    for (const h of all) {
        if (h.start < lastEnd) continue;
        hits.push(h);
        lastEnd = h.end;
    }
    let out = text;
    // Od konca - offsety wczesniejszych trafien sie nie zmieniaja.
    for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i]!;
        const replacement =
            map?.byOriginal.get(h.span) ?? `[${h.category}_REDACTED]`;
        out = out.slice(0, h.start) + replacement + out.slice(h.end);
        bump(redacted, h.category);
    }
    return out;
}

function prepareValue(
    value: unknown,
    map: PseudonimMap | null,
    redacted: Record<string, number>,
    withheld: Record<string, number>,
): unknown {
    if (typeof value === "string") {
        const restored = map
            ? unwrapCategories(value, map, MCP_REHYDRATABLE_CATEGORIES, withheld)
            : value;
        return redactDlp(restored, map, redacted);
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        // PESEL podany jako liczba JSON (11 cyfr miesci sie w double).
        const s = String(value);
        const cleaned = redactDlp(s, map, redacted);
        return cleaned === s ? value : cleaned;
    }
    if (Array.isArray(value))
        return value.map((v) => prepareValue(v, map, redacted, withheld));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>))
            out[k] = prepareValue(v, map, redacted, withheld);
        return out;
    }
    return value;
}

/**
 * Przygotowuje argumenty wywolania zewnetrznego konektora MCP: odtwarza tylko
 * kategorie z `MCP_REHYDRATABLE_CATEGORIES`, potem wycina PESEL i e-mail
 * (takze wpisane doslownie, spoza mapy). `map` = null dla modelu lokalnego
 * albo danych publicznych - wtedy dziala sam DLP.
 */
export function prepareMcpToolArgs(
    input: unknown,
    map: PseudonimMap | null,
): PreparedMcpArgs {
    const redacted: Record<string, number> = {};
    const tokensWithheld: Record<string, number> = {};
    const args = prepareValue(input, map, redacted, tokensWithheld);
    return { args, redacted, tokensWithheld };
}
