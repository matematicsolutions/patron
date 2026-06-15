// Weak-supervision bootstrap anotacji korpusu gazetteerem (ADR-0085).
//
// Wzorzec: CN115221265A (CN-only) - auto-anotacja korpusu slownikiem przez
// WuManber do bootstrapu NER bez recznej anotacji. Reimplementacja od zera,
// czysty TypeScript + Node 20 stdlib, zero zaleznosci npm. Patrz ADR-0085
// i THIRD_PARTY_INSPIRATIONS.md.
//
// GRANICA: to narzedzie OFFLINE pipeline'u danych treningowych. Bierze
// dokument plus slownik termow z etykietami i emituje slabe etykiety (weak
// labels) jako spany {start, end, term, label} do dalszego fine-tune PL NER
// (np. LoRA, FAZA2). NIE wpina sie w indexDocument ani w czat - nie jest
// sciezka requestu produkcyjnego. Patrz ADR-0085 (Co pozostaje zarezerwowane).
//
// OFFSETY: indeksy punktow kodowych (Array.from(text)), spojne z wuManber.ts.
// Emitowany `term` jest re-derywowany z offsetow dokumentu, wiec zachowuje
// wielkosc liter zrodla (a nie slownika) i zawsze spelnia inwariant
// term === Array.from(text).slice(start, end).join("").

import { buildWuManber, searchWuManber } from "./wuManber";
import { COURTS, SIGNATURE_PREFIXES } from "./gazetteers";

/** Wpis slownika: term do dopasowania plus etykieta slabej anotacji. */
export interface DictionaryEntry {
    /** Doslowny ciag do wyszukania w dokumencie. */
    term: string;
    /** Etykieta slabej anotacji (np. SAD, SYGNATURA_PREFIX, FORMA_PRAWNA). */
    label: string;
    /**
     * Gdy true, dopasowanie respektuje wielkosc liter (np. prefiks "CZP" nie
     * lapie "czp"). Gdy false/undefined, wpis jest case-insensitive z
     * zastrzezeniem `caseInsensitiveDefault` w opcjach (domyslnie true).
     */
    caseSensitive?: boolean;
}

/** Pojedyncza slaba etykieta (offsety = indeksy punktow kodowych). */
export interface WeakLabelSpan {
    /** Indeks poczatkowy w punktach kodowych (inclusive). */
    start: number;
    /** Indeks koncowy w punktach kodowych (exclusive). */
    end: number;
    /** Doslowny fragment dokumentu: Array.from(text).slice(start, end).join(""). */
    term: string;
    /** Etykieta z dopasowanego wpisu slownika. */
    label: string;
}

/** Opcje anotacji. */
export interface BootstrapOptions {
    /**
     * Domyslna wielkosc-liter dla wpisow BEZ jawnego `caseSensitive`. Default
     * true (case-insensitive). Wpis z `caseSensitive: true` ignoruje ta opcje.
     */
    caseInsensitiveDefault?: boolean;
}

/**
 * Formy prawne spolek - lista stala, spojna z FIRMA_Z_FORMA_RE w regex.ts.
 * Trzymana tutaj jawnie (a nie wyciagana z regexu), bo regex koduje je w
 * alternacji z escapowanymi spacjami, niewygodnej do reuzycia jako lista.
 */
export const LEGAL_FORMS: readonly string[] = [
    "Sp. z o.o.",
    "S.A.",
    "Sp. k.",
    "S.K.A.",
    "Sp. j.",
    "Sp. p.",
    "P.S.A.",
];

/**
 * Zbuduj slownik termow do anotacji z gazetteerow PL plus opcjonalny slownik
 * dostarczony przez wywolujacego (np. nazwiska stron sprawy Koziatek).
 *
 * Splaszczenie COURTS: pelna nazwa sadu ORAZ kazdy niepusty alias trafiaja
 * jako osobne wpisy z etykieta SAD (krotki alias "SN" jest wlasnym termem,
 * nie tylko pelna nazwa). Prefiksy sygnatur sa case-sensitive ("CZP" != "czp").
 * Wpisy dostarczone (`extra`) dolaczane sa doslownie, bez modyfikacji ksztaltu.
 */
export function buildDictionary(extra: DictionaryEntry[] = []): DictionaryEntry[] {
    const dict: DictionaryEntry[] = [];

    for (const court of COURTS) {
        if (court.name.trim().length > 0) {
            dict.push({ term: court.name, label: "SAD" });
        }
        for (const alias of court.aliases) {
            if (alias.trim().length > 0) {
                dict.push({ term: alias, label: "SAD" });
            }
        }
    }

    for (const p of SIGNATURE_PREFIXES) {
        if (p.prefix.trim().length > 0) {
            dict.push({ term: p.prefix, label: "SYGNATURA_PREFIX", caseSensitive: true });
        }
    }

    for (const forma of LEGAL_FORMS) {
        dict.push({ term: forma, label: "FORMA_PRAWNA" });
    }

    for (const e of extra) {
        dict.push(e);
    }

    return dict;
}

/**
 * Anotuj dokument slownikiem. Zwraca slabe etykiety dla KAZDEGO wystapienia
 * KAZDEGO termu (bez deduplikacji, nakladania zachowane), posortowane rosnaco
 * po `start` (przy remisie dluzszy span pierwszy, dalej alfabetycznie po
 * etykiecie - stabilny, deterministyczny porzadek).
 *
 * Wpisy partycjonowane sa na case-insensitive i case-sensitive, bo maszyna
 * WuManber ma tryb wielkosci-liter globalny dla calego slownika. Budujemy
 * wiec maksymalnie dwie maszyny i scalamy wyniki.
 */
export function bootstrapAnnotate(
    text: string,
    dict: DictionaryEntry[],
    options: BootstrapOptions = {},
): WeakLabelSpan[] {
    const caseInsensitiveDefault = options.caseInsensitiveDefault !== false;
    const codePoints = Array.from(text);

    const ciEntries: DictionaryEntry[] = [];
    const csEntries: DictionaryEntry[] = [];
    for (const e of dict) {
        if (e.term.length === 0) continue;
        const caseInsensitive = e.caseSensitive === true ? false : caseInsensitiveDefault;
        (caseInsensitive ? ciEntries : csEntries).push(e);
    }

    const spans: WeakLabelSpan[] = [];

    const annotate = (entries: DictionaryEntry[], caseInsensitive: boolean): void => {
        if (entries.length === 0) return;
        const machine = buildWuManber(
            entries.map((e) => e.term),
            { caseInsensitive },
        );
        for (const hit of searchWuManber(machine, text)) {
            const entry = entries[hit.patternIndex]!;
            spans.push({
                start: hit.start,
                end: hit.end,
                term: codePoints.slice(hit.start, hit.end).join(""),
                label: entry.label,
            });
        }
    };

    annotate(ciEntries, true);
    annotate(csEntries, false);

    spans.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        if (a.end !== b.end) return b.end - a.end;
        return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });

    return spans;
}
