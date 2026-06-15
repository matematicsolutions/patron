// Copy-mechanism generative NER dla wartosci liczbowych i dat - warstwa
// gwarancji anty-halucynacji (ADR-0084).
//
// Wzorzec: PMC11622873 (OSS) - generatywny NER z dekoderem ograniczonym
// do spanow tekstu zrodlowego (copy/pointer mechanism). Dekoder moze tylko
// kopiowac fragmenty zrodla, nigdy generowac nowych znakow. Patron bierze
// wzorzec gwarancji, nie kod ani model - reimplementacja deterministyczna,
// zero sieci neuronowej, zero-LLM, offline (Konstytucja Art. 1/3/7).
//
// Modul ma dwie czesci:
//   (1) constrainToSource(value, sourceText) - guard: zwraca offsety tylko
//       gdy value wystepuje doslownie w zrodle, inaczej null. Brama dla
//       wartosci niepewnego pochodzenia (output LLM, luzna heurystyka).
//   (2) extractCopySpans(sourceText) - ekstraktor copy-span dla polskich
//       kwot i dat, emitujacy wylacznie doslowne spany jako ExtractedEntity.
//
// Inwariant calego modulu (testowalny): dla kazdego zwroconego spanu
//   sourceText.slice(start, end) === value
// To jest istota copy-mechanism - brak fabrykacji wartosci.
//
// Zobacz governance/adr/0084-copy-mechanism-ner-anty-halucynacja.md
// Synergia z ADR-0005 (grounding cytatow) i ADR-0080 (grounding tabular).

import type { ExtractedEntity } from "./types";

/**
 * Pozycja doslownego spanu w tekscie zrodlowym. Offsety w jednostkach
 * kodu UTF-16 (spojnie z reszta biblioteki i String.prototype.slice),
 * `end` exclusive - spojnie z ExtractedEntity.
 */
export interface SourceSpan {
    /** Offset poczatkowy w tekscie zrodlowym. */
    start: number;
    /** Offset koncowy w tekscie zrodlowym (exclusive). */
    end: number;
}

/**
 * Opcje kotwiczenia dla constrainToSource.
 */
export interface ConstrainOptions {
    /**
     * Szukaj wystapienia od tego offsetu (wlacznie). Pozwala kotwiczyc
     * kolejne wystapienia tej samej wartosci po kolei. Domyslnie 0.
     */
    from?: number;
    /**
     * Ktore wystapienie kotwiczyc: pierwsze (domyslne) czy ostatnie.
     * Dla "last" opcja `from` jest ignorowana.
     */
    occurrence?: "first" | "last";
}

/**
 * Guard copy-mechanism: zwraca offsety tylko gdy `value` wystepuje
 * doslownie w `sourceText`, inaczej `null` (odrzucenie).
 *
 * To jest brama dla kazdej wartosci niepewnego pochodzenia. Jezeli model
 * LLM albo luzna heurystyka poda wartosc, ktorej nie ma w zrodle verbatim,
 * funkcja ja odrzuca zamiast poprawiac. Inwariant gwarantowany przez
 * konstrukcje: zwracamy offsety realnego wystapienia (indexOf/lastIndexOf),
 * wiec sourceText.slice(start, end) === value zawsze zachodzi dla wyniku
 * niebedacego null.
 *
 * @returns SourceSpan z doslownym wystapieniem albo null.
 */
export function constrainToSource(
    value: string,
    sourceText: string,
    options: ConstrainOptions = {},
): SourceSpan | null {
    // Pusta wartosc albo puste zrodlo - nie ma czego kotwiczyc. Milczenie
    // jest uczciwsze niz falszywy span (zgodnie z duchem ADR-0080 sekcja C).
    if (value.length === 0 || sourceText.length === 0) {
        return null;
    }

    let start: number;
    if (options.occurrence === "last") {
        start = sourceText.lastIndexOf(value);
    } else {
        const from = options.from ?? 0;
        // Ujemny `from` traktujemy jak 0 (String.indexOf i tak by to zrobil,
        // ale jawnie - audytowalnosc Art. 3).
        start = sourceText.indexOf(value, from < 0 ? 0 : from);
    }

    if (start < 0) {
        return null;
    }

    return { start, end: start + value.length };
}

/**
 * Wszystkie nienakladajace sie doslowne wystapienia `value` w `sourceText`.
 * Gdy ta sama wartosc (np. kwota "1 000,00 zl") pada w dokumencie
 * wielokrotnie, kotwiczymy kazde z osobna. Skanujemy od lewej, po kazdym
 * trafieniu przeskakujemy za jego koniec (zero nakladania).
 */
export function constrainAllToSource(
    value: string,
    sourceText: string,
): SourceSpan[] {
    const spans: SourceSpan[] = [];
    if (value.length === 0 || sourceText.length === 0) {
        return spans;
    }
    let cursor = 0;
    for (;;) {
        const start = sourceText.indexOf(value, cursor);
        if (start < 0) break;
        const end = start + value.length;
        spans.push({ start, end });
        cursor = end;
    }
    return spans;
}

/**
 * Polskie nazwy miesiecy w dopelniaczu (forma uzywana w datach slownych:
 * "12 marca 2024"). Lista zamknieta - 12 miesiecy, kazdy w dwoch wariantach
 * pisowni (z diakrytykiem i bez, bo korpus PL po OCR bywa zdiakrytyzowany
 * niespojnie). Mapowanie na numer miesiaca (1-12) do normalizacji ISO.
 */
const MIESIACE_DOPELNIACZ: ReadonlyMap<string, number> = new Map([
    ["stycznia", 1],
    ["lutego", 2],
    ["marca", 3],
    ["kwietnia", 4],
    ["maja", 5],
    ["czerwca", 6],
    ["lipca", 7],
    ["sierpnia", 8],
    ["wrzesnia", 9],
    ["września", 9],
    ["pazdziernika", 10],
    ["października", 10],
    ["listopada", 11],
    ["grudnia", 12],
]);

/**
 * Alternatywa regexowa nazw miesiecy (oba warianty - z diakrytykiem i bez,
 * bo korpus PL bywa zdiakrytyzowany niespojnie po OCR).
 */
const MIESIAC_ALT =
    "stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|" +
    "września|wrzesnia|października|pazdziernika|listopada|grudnia";

/**
 * Jednostki waluty - wymagane przy kwocie. Bez jednostki goly ciag cyfr
 * jest nieodroznialny od numeru / fragmentu PESEL / numeru strony, wiec
 * celowo nie lapiemy golych liczb (precyzja przed recall - patrz ADR-0084
 * Konsekwencje). Symbole walut + skroty literowe + slowo "zlotych" w obu
 * wariantach pisowni (z diakrytykiem "złotych" i ASCII "zlotych", bo OCR
 * korpusu PL produkuje obie formy). Warianty dluzsze ("złotych"/"zlotych")
 * sa przed krotszymi ("zł"/"zl"), zeby alternacja wybrala pelne slowo.
 */
const WALUTA_ALT =
    "złotych|zlotych|zł|zl|PLN|EUR|USD|GBP|CHF|€|\\$|£";

/**
 * Kwota polska: opcjonalny separator tysiecy (spacja zwykla albo niełamliwa
 *  ), przecinek dziesietny opcjonalny, jednostka waluty wymagana po
 * pojedynczej spacji (zwyklej albo niełamliwej).
 *
 * Przyklady:
 *   "1 234,56 zl"
 *   "12.000,00 PLN"   (kropka jako separator tysiecy - polski wariant)
 *   "500 zl"
 *   "1 000 000,00 zlotych"
 *   "99,99 EUR"
 *
 * Grupa cyfr: pierwszy blok 1-3 cyfry, kolejne bloki dokladnie 3 cyfry
 * oddzielone separatorem tysiecy (spacja / spacja niełamliwa / kropka),
 * opcjonalna czesc dziesietna po przecinku.
 */
const KWOTA_RE = new RegExp(
    "\\d{1,3}(?:[\\u00a0 .]\\d{3})*(?:,\\d{1,2})?[\\u00a0 ](?:" +
        WALUTA_ALT +
        ")(?=\\s|$|[.,;:!?)\\]])",
    "g",
);

/**
 * Data ISO: RRRR-MM-DD z zakresem miesiaca 01-12 i dnia 01-31 (bez
 * walidacji dni w miesiacu - rezerwacja ADR-0084 E.2).
 */
const DATA_ISO_RE = /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;

/**
 * Data kropkowa: DD.MM.RRRR (dzien 01-31, miesiac 01-12, rok 4 cyfry).
 * Dzien i miesiac moga byc jedno- lub dwucyfrowe.
 */
const DATA_KROPKA_RE =
    /\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.\d{4}\b/g;

/**
 * Data slowna: "12 marca 2024 r." - dzien (1-31), nazwa miesiaca w
 * dopelniaczu z zamknietej listy, rok 4 cyfry, opcjonalny sufiks "r." albo
 * "roku".
 *
 * Przyklady:
 *   "12 marca 2024 r."
 *   "5 września 2023 r."
 *   "1 stycznia 2020"
 *   "31 grudnia 1999 roku"
 */
const DATA_SLOWNA_RE = new RegExp(
    "\\b(?:0?[1-9]|[12]\\d|3[01])\\s+(?:" +
        MIESIAC_ALT +
        ")\\s+\\d{4}(?:\\s+r\\.|\\s+roku)?",
    "g",
);

/**
 * Wewnetrzna definicja reguly copy-span. Kazda regula produkuje doslowne
 * spany jednego typu encji.
 */
interface CopySpanRule {
    id: string;
    type: ExtractedEntity["type"];
    pattern: RegExp;
    baseConfidence: number;
    /** Normalizacja do formy kanonicznej (dedup w grafie). */
    normalize: (raw: string) => string;
    /** Metadane domeny dla wykrytego spanu (waluta, format daty). */
    metadata?: (raw: string) => Record<string, string | number | undefined>;
}

/**
 * Normalizacja kwoty do formy kanonicznej: usuwa separatory tysiecy
 * (spacja / spacja niełamliwa / kropka miedzy grupami cyfr) i przykleja
 * jednostke waluty bez spacji. Przecinek dziesietny zostaje. Sluzy
 * deduplikacji ("1 000,00 zl" == "1000,00zl"), nie jest wartoscia
 * emitowana (ta pozostaje doslowna).
 */
function normalizeKwota(raw: string): string {
    return raw
        .replace(/ /g, " ") // spacja niełamliwa -> zwykla
        .replace(/(\d)[ .](?=\d{3}\b)/g, "$1") // separator tysiecy miedzy grupami
        .replace(/\s+/g, " ")
        .replace(/\s+(?=\D)/g, "") // spacja przed jednostka waluty
        .trim();
}

/**
 * Wyciaga jednostke waluty z surowej kwoty (do metadanych).
 */
function walutaZKwoty(raw: string): string {
    const m = raw.match(
        /(złotych|zlotych|zł|zl|PLN|EUR|USD|GBP|CHF|€|\$|£)\s*$/,
    );
    return m ? m[1]! : "";
}

/**
 * Normalizacja daty ISO - juz kanoniczna, zwracamy bez zmian.
 */
function normalizeDataIso(raw: string): string {
    return raw;
}

/**
 * Normalizacja daty kropkowej DD.MM.RRRR -> RRRR-MM-DD (forma ISO,
 * dedup z innymi formatami tej samej daty).
 */
function normalizeDataKropka(raw: string): string {
    const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return raw;
    const dd = m[1]!.padStart(2, "0");
    const mm = m[2]!.padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
}

/**
 * Normalizacja daty slownej "12 marca 2024 r." -> RRRR-MM-DD.
 *
 * Nazwe miesiaca dopasowujemy klasa \p{L} z flaga `u` (Unicode property
 * escape), zeby objac polskie diakrytyki. Klasa [A-Za-z...] nie obejmuje
 * 'ś'/'ź', wiec "września"/"października" nie zostalyby znormalizowane do
 * ISO i nigdy nie deduplikowalyby sie ze swoim ISO-bliznakiem.
 */
function normalizeDataSlowna(raw: string): string {
    const m = raw.match(/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u);
    if (!m) return raw;
    const miesiac = MIESIACE_DOPELNIACZ.get(m[2]!.toLowerCase());
    if (miesiac === undefined) return raw;
    const dd = m[1]!.padStart(2, "0");
    const mm = String(miesiac).padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
}

const COPY_SPAN_RULES: readonly CopySpanRule[] = [
    {
        id: "copy-kwota-pl",
        type: "KWOTA",
        pattern: KWOTA_RE,
        baseConfidence: 0.95,
        normalize: normalizeKwota,
        metadata: (raw) => ({ waluta: walutaZKwoty(raw) }),
    },
    {
        id: "copy-data-iso",
        type: "DATA",
        pattern: DATA_ISO_RE,
        baseConfidence: 1.0,
        normalize: normalizeDataIso,
        metadata: () => ({ format: "iso" }),
    },
    {
        id: "copy-data-kropka",
        type: "DATA",
        pattern: DATA_KROPKA_RE,
        baseConfidence: 0.95,
        normalize: normalizeDataKropka,
        metadata: () => ({ format: "kropka" }),
    },
    {
        id: "copy-data-slowna",
        type: "DATA",
        pattern: DATA_SLOWNA_RE,
        baseConfidence: 0.95,
        normalize: normalizeDataSlowna,
        metadata: () => ({ format: "slowna" }),
    },
];

/** Surowe trafienie przed rozstrzygnieciem nakladania. */
interface RawHit {
    rule: CopySpanRule;
    raw: string;
    start: number;
    end: number;
}

/**
 * Ekstraktor copy-span: emituje wylacznie doslowne spany polskich kwot i
 * dat jako ExtractedEntity, z dokladnymi offsetami.
 *
 * Inwariant gwarantowany konstrukcyjnie: value pobierany przez
 * sourceText.slice(start, end), wiec sourceText.slice(start, end) === value
 * dla kazdego zwroconego bytu. Zadna wartosc nie jest fabrykowana ani
 * przepisywana - kopiujemy fragment zrodla (mechanizm copy/pointer).
 *
 * Przy nakladaniu dwoch regul na ten sam fragment wybieramy dluzsze
 * dopasowanie (wieksza specyficznosc). Wynik posortowany po pozycji.
 */
export function extractCopySpans(sourceText: string): ExtractedEntity[] {
    if (sourceText.length === 0) {
        return [];
    }

    const hits: RawHit[] = [];
    for (const rule of COPY_SPAN_RULES) {
        // Re-tworzymy regex per wywolanie - flaga `g` ma stan (lastIndex),
        // recykling gubilby dopasowania (jak detectAll w regex.ts).
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(sourceText)) !== null) {
            const raw = m[0];
            if (raw.length === 0) {
                // Ochrona przed nieskonczona petla na zero-length match.
                re.lastIndex += 1;
                continue;
            }
            hits.push({
                rule,
                raw,
                start: m.index,
                end: m.index + raw.length,
            });
        }
    }

    const resolved = resolveOverlaps(hits);

    return resolved.map((hit) => {
        const value = sourceText.slice(hit.start, hit.end);
        // Inwariant copy-mechanism: emitowana wartosc to doslowny span zrodla.
        // (value === hit.raw === sourceText.slice(start, end))
        const metadata = hit.rule.metadata
            ? hit.rule.metadata(value)
            : undefined;
        const entity: ExtractedEntity = {
            type: hit.rule.type,
            value,
            valueNormalized: hit.rule.normalize(value),
            sourceOffsetStart: hit.start,
            sourceOffsetEnd: hit.end,
            confidence: hit.rule.baseConfidence,
            ruleId: hit.rule.id,
        };
        if (metadata !== undefined) {
            entity.metadata = metadata;
        }
        return entity;
    });
}

/**
 * Rozstrzyga nakladajace sie trafienia: sortuje po pozycji startu, przy
 * konflikcie wybiera dluzszy span (wieksza specyficznosc), a przy rownej
 * dlugosci pierwsza regule. Deterministyczne.
 */
function resolveOverlaps(hits: RawHit[]): RawHit[] {
    const sorted = [...hits].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        // Dluzszy span pierwszy przy tym samym starcie.
        return b.end - a.end;
    });

    const kept: RawHit[] = [];
    for (const hit of sorted) {
        const last = kept[kept.length - 1];
        if (last && hit.start < last.end) {
            // Nakladanie. Zostaw dluzszy (wiekszy zasieg konca).
            if (hit.end > last.end) {
                kept[kept.length - 1] = hit;
            }
            continue;
        }
        kept.push(hit);
    }
    return kept;
}
