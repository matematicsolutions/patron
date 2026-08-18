// ADR-0146: grounding cytatow z konektorow MCP (SAOS / NSA / EUREKA / ISAP / EU...).
//
// PROBLEM (zmierzony 2026-08-17): cytaty MCP (`mcp_citations`) NIE przechodzily przez
// kaskade groundingu - `groundCitationsByRef` liczy tylko cytaty `<CITATIONS>` z
// dokumentow kancelarii. Model podal blockquote jako "doslowny cytat" interpretacji
// KIS (sygnatura i data PRAWDZIWE), a tekst NIE wystepowal w zrodle (0/4 zdan) - UI
// pokazal karty zrodel i milczal. To jest dokladnie przypadek, ktory produkt obiecuje
// lapac ("AI, ktora wie, czego nie wie").
//
// ROZWIAZANIE (deterministyczne, offline, zero LLM, zero egressu):
//   1. Z odpowiedzi modelu wyciagamy SPANY CYTOWANE - blockquote'y markdown (`> ...`)
//      i fragmenty w cudzyslowach („...” / "..." / «...») o sensownej dlugosci. To sa
//      miejsca, gdzie model TWIERDZI, ze cytuje doslownie.
//   2. Kazdy span sprawdzamy string-matchem (ten sam algorytm co ADR-0005: exact ->
//      tolerant) wzgledem TEKSTOW ZWROCONYCH PRZEZ NARZEDZIA MCP w tej turze
//      (tool_result, ktory model faktycznie widzial). Zrodlo = to, co przyszlo z
//      konektora, nie to, co model pamieta.
//   3. Werdykt per span (green/yellow/red) + werdykt per KARTA zrodla MCP:
//        green  - co najmniej jeden cytat z odpowiedzi znaleziony w tym zrodle,
//        yellow - "nie zweryfikowano": brak doslownego cytatu do sprawdzenia albo brak
//                 tekstu zrodla albo tylko dopasowanie przyblizone,
//        red    - cytat podany jako doslowny NIE wystepuje w zrodle (przypisanie
//                 jednoznaczne: zrodlo z jednym dokumentem albo jedyna karta w turze).
//      Cytaty red bez jednoznacznego przypisania ida na poziom ODPOWIEDZI (baner) -
//      nigdy cicho. Brak tekstu zrodla = yellow, nigdy green.
//
// GRANICE:
//   - To jest warstwa DORADCZA (jak verdict w ADR-0097): nie blokuje odpowiedzi.
//     Prawnik dostaje sygnal, gdzie model twierdzi "cytuje", a zrodlo tego nie mowi.
//   - Sprawdzamy ISTNIENIE tekstu, nie WSPARCIE tezy (gradient citation-grounding-pl:
//     ISTNIENIE / TRESC / FRAGMENT). Etap semantyczny (sedzia) = rezerwacja.
//   - Spany, ktore wystepuja w tekstach WYKLUCZONYCH (cytaty <CITATIONS> juz
//     ugruntowane w ADR-0005, tresc wiadomosci uzytkownika) sa pomijane - model
//     cytuje wtedy dokument kancelarii lub uzytkownika, nie zrodlo MCP.
//   - Wydajnosc: teksty MCP bywaja dlugie (pelne orzeczenie = 100k+ znakow). Etap
//     tolerant NIE przesuwa okna edit-distance po calym zrodle (O(n*L^2)); najpierw
//     szuka KOTWIC (krotkich shingli cytatu) w zrodle i liczy odleglosc tylko w
//     oknach wokol trafien. Brak kotwic = NIEZWERYFIKOWANY (kierunek bezpieczny: red).
//
// Modul czysty (bez I/O) - wpiecie w stream.ts (SSE `mcp_grounding`), persystencja
// (annotations) i UI to osobne szwy.

import type { McpCitation } from "../mcp/types";
import { normalize, MODIFIED_RATIO_THRESHOLD, type GroundingStatus } from "./grounding";

/** Tekst zwrocony przez JEDNO wywolanie narzedzia MCP + klucze kart, ktore z niego powstaly. */
export interface McpSourceText {
    server: string;
    tool: string;
    /** Pelny tekst tool_result (to, co widzial model). */
    text: string;
    /** Klucze kart (mcpCitationKey) wyluskanych z tego samego wywolania. */
    citationKeys: string[];
}

export type McpVerdict = "green" | "yellow" | "red";

export type McpCardReason =
    | "quote_found" // >=1 cytat doslowny znaleziony w zrodle
    | "quote_modified" // tylko dopasowanie przyblizone (interpunkcja / uciecie)
    | "quote_not_found" // cytat podany jako doslowny NIE wystepuje w tym zrodle
    | "no_quote" // odpowiedz nie zawiera doslownego cytatu do sprawdzenia dla tej karty
    | "no_source"; // brak tekstu zrodla (konektor nie zwrocil tresci)

export interface McpQuoteResult {
    /** Cytowany span (tak jak w odpowiedzi, po strippingu markdown; max 600 znakow). */
    quote: string;
    /** Skad wyciety: blockquote markdown albo cudzyslow w prozie. */
    kind: "blockquote" | "inline";
    verdict: McpVerdict;
    status: GroundingStatus;
    /** Najgorszy stosunek edit-distance / dlugosc (0 = doslownie). */
    ratio: number;
    /** Zrodlo, w ktorym znaleziono (green/yellow) - albo NAJBLIZSZE (red, informacyjnie). */
    source?: { server: string; tool: string };
    /** Klucz karty MCP, jesli przypisanie jednoznaczne. */
    citationKey?: string;
}

export interface McpCardVerdict {
    verdict: McpVerdict;
    reason: McpCardReason;
    /** Ile cytatow z odpowiedzi trafilo w to zrodlo (green + yellow). */
    matched: number;
}

export interface McpGroundingReport {
    quotes: McpQuoteResult[];
    perCitation: Record<string, McpCardVerdict>;
    summary: {
        quotes: number;
        green: number;
        yellow: number;
        red: number;
        sources: number;
        cards: number;
    };
}

/** Klucz karty MCP - JEDNA definicja (stream.ts deduplikuje po tym samym kluczu). */
export function mcpCitationKey(c: Pick<McpCitation, "server" | "tool" | "url" | "title">): string {
    return `${c.server}|${c.tool}|${c.url ?? c.title ?? ""}`;
}

// ---------------------------------------------------------------------------
// 1. Ekstrakcja spanow cytowanych z odpowiedzi
// ---------------------------------------------------------------------------

const MIN_INLINE_WORDS = 5;
const MIN_INLINE_CHARS = 25;
const MIN_BLOCKQUOTE_WORDS = 3;
const MAX_QUOTES = 40;
const MAX_QUOTE_CHARS = 600;
const CITATIONS_TAG_RE = /<CITATIONS>[\s\S]*?(?:<\/CITATIONS>|$)/g;

function stripMarkdownInline(s: string): string {
    return s
        .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "") // znaczniki [1], [2, 3]
        .replace(/[*_`]+/g, "")
        .replace(/^\s*[-*]\s+/, "")
        .trim();
}

/** Zdejmuje zewnetrzne cudzyslowy z blockquote'a, jesli sa. */
function stripOuterQuotes(s: string): string {
    return s.replace(/^[„"“«‚']+/, "").replace(/[”"“»‘']+$/, "").trim();
}

function wordCount(s: string): number {
    return s.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Wyciaga z prozy odpowiedzi spany, ktore model prezentuje jako cytaty doslowne:
 * blockquote'y markdown (linie `> ...`, kolejne linie sklejane) i fragmenty w
 * cudzyslowach o dlugosci >= MIN_INLINE_WORDS slow. Blok <CITATIONS> pomijany
 * (to protokol cytatow dokumentowych - ADR-0005). Deduplikacja po znormalizowanym
 * tekscie, limit MAX_QUOTES.
 */
export function extractQuotedSpans(
    answerText: string,
): Array<{ quote: string; kind: "blockquote" | "inline" }> {
    const prose = (answerText ?? "").replace(CITATIONS_TAG_RE, "");
    const out: Array<{ quote: string; kind: "blockquote" | "inline" }> = [];
    const seen = new Set<string>();
    const push = (raw: string, kind: "blockquote" | "inline") => {
        const q = raw.trim().slice(0, MAX_QUOTE_CHARS);
        const key = normalize(q);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push({ quote: q, kind });
    };

    // Blockquote'y: kolejne linie zaczynajace sie od ">" = jeden span.
    const lines = prose.split(/\r?\n/);
    let buf: string[] = [];
    const flush = () => {
        if (buf.length === 0) return;
        const joined = stripOuterQuotes(stripMarkdownInline(buf.join(" ")));
        if (wordCount(joined) >= MIN_BLOCKQUOTE_WORDS) push(joined, "blockquote");
        buf = [];
    };
    for (const line of lines) {
        const m = /^\s*>\s?(.*)$/.exec(line);
        if (m) {
            const inner = m[1].trim();
            // pusta linia ">" = akapit w obrebie tego samego blockquote'a
            if (inner.length > 0) buf.push(inner);
            continue;
        }
        flush();
    }
    flush();

    // Cudzyslowy w prozie (poza liniami blockquote - te juz policzone).
    const proseNoBq = lines.filter((l) => !/^\s*>/.test(l)).join("\n");
    const inlineRe = /[„"«]([^„"”«»\n]{10,}?)[”"»]/g;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(proseNoBq)) !== null) {
        const q = stripMarkdownInline(m[1]);
        if (q.length >= MIN_INLINE_CHARS && wordCount(q) >= MIN_INLINE_WORDS) {
            push(q, "inline");
        }
        if (out.length >= MAX_QUOTES) break;
    }
    return out.slice(0, MAX_QUOTES);
}

// ---------------------------------------------------------------------------
// 2. Dopasowanie spanu do tekstu zrodla (exact -> tolerant z kotwicami)
// ---------------------------------------------------------------------------

function splitGaps(normQuote: string): string[] {
    return normQuote
        .split(/\s*(?:\[\s*\.\.\.\s*\]|\.\.\.)\s*/)
        .map((seg) => seg.trim())
        .filter((seg) => seg.length > 0);
}

function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > 40) return Math.max(m, n);
    const dp: number[] = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
        let prev = dp[0];
        dp[0] = j;
        for (let i = 1; i <= m; i++) {
            const tmp = dp[i];
            dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[m];
}

const ANCHOR_LEN = 12;
const ANCHOR_COUNT = 6;
const MAX_ANCHOR_HITS = 30;

/**
 * Przyblizone dopasowanie segmentu w (potencjalnie bardzo dlugim) zrodle.
 * Zamiast przesuwac okno po calym zrodle, bierze do ANCHOR_COUNT kotwic (shingli
 * ANCHOR_LEN znakow rownomiernie z segmentu), szuka ich indexOf w zrodle i liczy
 * edit-distance tylko w oknach +/- kilka znakow wokol przewidywanego poczatku.
 * Brak kotwic w zrodle = brak dopasowania (ratio 1). Kierunek bledu: red, nie green.
 */
function approxLocate(segment: string, src: string): { ratio: number; at: number } {
    const L = segment.length;
    if (L === 0 || src.length === 0) return { ratio: 1, at: -1 };
    if (L <= ANCHOR_LEN) {
        const at = src.indexOf(segment);
        return at >= 0 ? { ratio: 0, at } : { ratio: 1, at: -1 };
    }
    const anchors: Array<{ text: string; offsetInSeg: number }> = [];
    const n = Math.min(ANCHOR_COUNT, Math.floor(L / ANCHOR_LEN));
    for (let i = 0; i < n; i++) {
        const off = Math.floor((i * (L - ANCHOR_LEN)) / Math.max(1, n - 1));
        anchors.push({ text: segment.slice(off, off + ANCHOR_LEN), offsetInSeg: off });
    }
    const candidates = new Set<number>();
    for (const a of anchors) {
        let from = 0;
        let hits = 0;
        while (hits < MAX_ANCHOR_HITS) {
            const idx = src.indexOf(a.text, from);
            if (idx < 0) break;
            candidates.add(Math.max(0, idx - a.offsetInSeg));
            from = idx + 1;
            hits++;
        }
    }
    if (candidates.size === 0) return { ratio: 1, at: -1 };
    let best = { ratio: 1, at: -1 };
    const slack = Math.min(20, Math.ceil(L * 0.1));
    for (const start of candidates) {
        for (let s = Math.max(0, start - slack); s <= start + slack && s + 1 <= src.length; s++) {
            const window = src.slice(s, s + L);
            const d = editDistance(segment, window);
            const ratio = d / L;
            if (ratio < best.ratio) best = { ratio, at: s };
            if (d === 0) return best;
        }
    }
    return best;
}

/** Werdykt tekstowy jednego cytatu wzgledem jednego zrodla. */
export function matchQuoteInSource(
    quote: string,
    sourceText: string,
): { status: GroundingStatus; ratio: number; at: number } {
    const src = normalize(sourceText);
    if (src.length === 0) return { status: "BRAK_ZRODLA", ratio: 1, at: -1 };
    // Zewnetrzne cudzyslowy (po normalizacji ujednolicone do ") nie sa czescia cytatu.
    const segments = splitGaps(normalize(quote).replace(/^"+|"+$/g, "").trim());
    if (segments.length === 0) return { status: "BRAK_ZRODLA", ratio: 1, at: -1 };

    let cursor = 0;
    let first = -1;
    let exact = true;
    for (const seg of segments) {
        const idx = src.indexOf(seg, cursor);
        if (idx === -1) {
            exact = false;
            break;
        }
        if (first === -1) first = idx;
        cursor = idx + seg.length;
    }
    if (exact) return { status: "ZWERYFIKOWANY", ratio: 0, at: first };

    let worst = 0;
    let firstAt = -1;
    for (const seg of segments) {
        const { ratio, at } = approxLocate(seg, src);
        worst = Math.max(worst, ratio);
        if (firstAt === -1) firstAt = at;
    }
    return {
        status: worst <= MODIFIED_RATIO_THRESHOLD ? "ZMODYFIKOWANY" : "NIEZWERYFIKOWANY",
        ratio: worst,
        at: firstAt,
    };
}

// ---------------------------------------------------------------------------
// 3. Raport: spany x zrodla -> werdykty per cytat i per karta
// ---------------------------------------------------------------------------

export interface GroundMcpInput {
    answerText: string;
    sources: McpSourceText[];
    citations: McpCitation[];
    /** Teksty, w ktorych trafienie WYKLUCZA span z oceny (cytaty <CITATIONS>, wiadomosci usera). */
    excludeTexts?: string[];
}

function verdictOf(status: GroundingStatus): McpVerdict {
    if (status === "ZWERYFIKOWANY") return "green";
    if (status === "ZMODYFIKOWANY") return "yellow";
    return "red";
}

/**
 * Przypisuje trafienie w zrodle do konkretnej karty: (a) jedyna karta z tego
 * wywolania; (b) karta, ktorej tytul/URL/snippet wystepuje w zrodle NAJBLIZEJ PRZED
 * offsetem trafienia (listing wynikow: naglowek pozycji poprzedza jej tresc).
 */
function attributeCard(
    src: string,
    at: number,
    keys: string[],
    byKey: Map<string, McpCitation>,
): string | undefined {
    if (keys.length === 1) return keys[0];
    if (keys.length === 0 || at < 0) return undefined;
    let bestKey: string | undefined;
    let bestPos = -1;
    for (const k of keys) {
        const c = byKey.get(k);
        if (!c) continue;
        const probes = [c.title, c.url, c.snippet]
            .map((p) => normalize(p ?? ""))
            .filter((p) => p.length >= 6);
        for (const p of probes) {
            const pos = src.lastIndexOf(p, at);
            if (pos > bestPos) {
                bestPos = pos;
                bestKey = k;
            }
        }
    }
    return bestKey;
}

/**
 * Glowna funkcja: dla kazdego spanu z odpowiedzi szuka najlepszego zrodla MCP,
 * buduje werdykt per cytat i per karta. Czysta, deterministyczna, synchroniczna.
 */
export function groundMcpCitations(input: GroundMcpInput): McpGroundingReport {
    const { answerText, sources, citations } = input;
    const byKey = new Map<string, McpCitation>();
    for (const c of citations) byKey.set(mcpCitationKey(c), c);
    const cardKeys = [...byKey.keys()];

    const excludeNorm = (input.excludeTexts ?? [])
        .map((t) => normalize(t))
        .filter((t) => t.length > 0);
    const spans = extractQuotedSpans(answerText).filter((s) => {
        const nq = normalize(s.quote);
        return !excludeNorm.some((ex) => ex.includes(nq));
    });

    // Zrodla z tekstem (normalizacja raz).
    const usable = sources
        .map((s) => ({ ...s, norm: normalize(s.text) }))
        .filter((s) => s.norm.length > 0);
    // Karty, ktorych zrodlo nie ma tekstu (konektor zwrocil pusty tool_result).
    const keysWithText = new Set(usable.flatMap((s) => s.citationKeys));

    const quotes: McpQuoteResult[] = [];
    const matchedByKey = new Map<string, { green: number; yellow: number; red: number }>();
    const bump = (key: string, v: McpVerdict) => {
        const e = matchedByKey.get(key) ?? { green: 0, yellow: 0, red: 0 };
        e[v]++;
        matchedByKey.set(key, e);
    };

    for (const span of spans) {
        let best: {
            status: GroundingStatus;
            ratio: number;
            at: number;
            src?: (typeof usable)[number];
        } = { status: "BRAK_ZRODLA", ratio: 1, at: -1 };
        for (const s of usable) {
            const r = matchQuoteInSource(span.quote, s.norm);
            if (r.status === "BRAK_ZRODLA") continue;
            if (r.ratio < best.ratio || best.src === undefined) {
                best = { ...r, src: s };
            }
            if (r.status === "ZWERYFIKOWANY") break;
        }
        // Zadne zrodlo nie ma tekstu -> BRAK_ZRODLA = "nie zweryfikowano" (yellow),
        // nie "nie wystepuje" (red): nie mamy z czym porownac i mowimy to wprost.
        const status: GroundingStatus = best.src === undefined ? "BRAK_ZRODLA" : best.status;
        const verdict: McpVerdict = status === "BRAK_ZRODLA" ? "yellow" : verdictOf(status);
        const q: McpQuoteResult = {
            quote: span.quote,
            kind: span.kind,
            verdict,
            status,
            ratio: best.ratio,
        };
        if (best.src && verdict !== "red") {
            q.source = { server: best.src.server, tool: best.src.tool };
            const key = attributeCard(best.src.norm, best.at, best.src.citationKeys, byKey);
            if (key) {
                q.citationKey = key;
                bump(key, verdict);
            }
        } else if (verdict === "red") {
            // Red: przypisanie do karty tylko JEDNOZNACZNE - (a) jedyna karta w turze,
            // (b) jedyne zrodlo z tekstem i ma jedna karte, (c) sa kotwice (ratio < 1)
            // w zrodle o jednej karcie (model czytal ten dokument i "cytuje" go).
            // Inaczej cytat zostaje na poziomie odpowiedzi (baner) - nigdy cicho,
            // ale tez bez oskarzania przypadkowej karty.
            const near = best.src && best.ratio < 1 ? best.src : undefined;
            if (near) q.source = { server: near.server, tool: near.tool };
            const only =
                cardKeys.length === 1
                    ? cardKeys[0]
                    : usable.length === 1 && usable[0].citationKeys.length === 1
                      ? usable[0].citationKeys[0]
                      : near && near.citationKeys.length === 1
                        ? near.citationKeys[0]
                        : undefined;
            if (only) {
                q.citationKey = only;
                bump(only, "red");
            }
        }
        quotes.push(q);
    }

    const perCitation: Record<string, McpCardVerdict> = {};
    for (const key of cardKeys) {
        const m = matchedByKey.get(key);
        if (!keysWithText.has(key)) {
            perCitation[key] = { verdict: "yellow", reason: "no_source", matched: 0 };
        } else if (m && m.red > 0 && m.green === 0) {
            perCitation[key] = { verdict: "red", reason: "quote_not_found", matched: m.yellow };
        } else if (m && m.green > 0) {
            perCitation[key] = { verdict: "green", reason: "quote_found", matched: m.green + m.yellow };
        } else if (m && m.yellow > 0) {
            perCitation[key] = { verdict: "yellow", reason: "quote_modified", matched: m.yellow };
        } else {
            perCitation[key] = { verdict: "yellow", reason: "no_quote", matched: 0 };
        }
    }

    const summary = {
        quotes: quotes.length,
        green: quotes.filter((q) => q.verdict === "green").length,
        yellow: quotes.filter((q) => q.verdict === "yellow").length,
        red: quotes.filter((q) => q.verdict === "red").length,
        sources: usable.length,
        cards: cardKeys.length,
    };
    return { quotes, perCitation, summary };
}

/** Podsumowanie do audit_log - TYLKO liczby i enumy, zero tresci cytatow. */
export function mcpGroundingSummary(report: McpGroundingReport | null | undefined): {
    quotes: number;
    green: number;
    yellow: number;
    red: number;
    sources: number;
    cards: number;
    cards_red: number;
} | null {
    if (!report) return null;
    return {
        ...report.summary,
        cards_red: Object.values(report.perCitation).filter((c) => c.verdict === "red").length,
    };
}
