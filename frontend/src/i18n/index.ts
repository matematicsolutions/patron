// Patron i18n - minimalistyczny dictionary lookup z fallbackiem.
//
// API:
//   t("chat.send")              -> "Wyslij" (PL) / "Send" (EN)
//   setLocale("en")             -> przelacza aktywny jezyk (jeden per instalacja)
//   formatDate(new Date())      -> "20.05.2026" (PL) / "20/05/2026" (EN)
//   formatDateTime(...)         -> "20.05.2026, 15:30"
//
// Architektura locale: ADR-0132 (jeden jezyk per instalacja, bez next-intl,
// bez locale w URL). Domyslnie PL; EN opt-in z configu instalacji, ustawiany
// raz przy bootstrapie (przed pierwszym renderem).
//
// Brak klucza w aktywnym slowniku -> fallback do PL (zrodlo kluczy). Brak w PL
// -> zwraca klucz (np. "chat.unknownKey") + console.warn. To deterministyczna
// pomylka widoczna w UI i w DevTools - latwo zauwazyc.

import { pl } from "./pl";
import { en } from "./en";
import { it } from "./it";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { pt } from "./pt";

// 7 rynkow docelowych (ADR-0139): PL (macierzysty), EN (miedzynarodowy),
// IT / DE / ES / FR (najwieksze rynki LegalTech UE), BR (pt-BR, kolejnosc
// wdrozenia wg wielkosci rynku). Slownik moze byc uzupelniany przyrostowo -
// brak klucza w slowniku rynkowym pokrywa fallback EN -> PL.
// GB (United Kingdom) is a JURISDICTION edition, not a language edition: it
// reuses the "en" dictionary verbatim (same UI language) and only carries a
// distinct PROFILES entry (backend) + home connector (gb-eli) - see ADR-0139
// follow-up. No new dictionary file, no new translation keys.
//
// "us" (jurysdykcja USA) NIE jest jezykiem UI - jest angielski, identyczny z
// "en". Zamiast nowego 614-kluczowego slownika, "us" wskazuje na TEN SAM
// obiekt slownika `en` (patrz DICTS nizej); rozni sie tylko LOCALE_TAGS
// (en-US zamiast en-GB dla formatDate/formatNumber) i profilem jurysdykcji w
// backend/src/lib/chat/prompts.ts (substancja USA zamiast PL+UE).
export type Locale = "pl" | "en" | "it" | "de" | "es" | "fr" | "pt" | "gb" | "us";

const SUPPORTED_LOCALES: ReadonlyArray<Locale> = [
    "pl",
    "en",
    "it",
    "de",
    "es",
    "fr",
    "pt",
    "gb",
    "us",
];

// Aktywne locale - jeden jezyk per instalacja (ADR-0132). Domyslnie PL.
// Zrodlo: zmienna build-time NEXT_PUBLIC_PATRON_LOCALE, czytana raz przy
// inicjalizacji modulu. Poniewaz NEXT_PUBLIC_* jest stala build-time, serwer i
// klient czytaja te sama wartosc -> brak flashu PL->EN i mismatchu przy
// hydratacji. `setLocale` pozostaje dla testow / ewentualnego override.
function initialLocale(): Locale {
    const raw = process.env.NEXT_PUBLIC_PATRON_LOCALE;
    return (SUPPORTED_LOCALES as ReadonlyArray<string>).includes(raw ?? "")
        ? (raw as Locale)
        : "pl";
}

let activeLocale: Locale = initialLocale();

// Slowniki indeksowane po locale. Walked strukturalnie w `lookup`
// (klucze pochodza z `pl` przez TranslationKey).
const DICTS: Record<Locale, Record<string, unknown>> = {
    pl,
    en,
    it,
    de,
    es,
    fr,
    pt,
    gb: en,
    // "us" reuzywa DOKLADNIE ten sam obiekt slownika co "en" (UI jezyk = EN;
    // "us" to jurysdykcja, nie jezyk). Zero duplikacji 614 kluczy.
    us: en,
};

/** Ustaw aktywny jezyk UI. Wolaj raz przy bootstrapie aplikacji. */
export function setLocale(locale: Locale): void {
    activeLocale = locale;
}

/** Pobierz aktywny jezyk UI. */
export function getLocale(): Locale {
    return activeLocale;
}

type Dict = typeof pl;
type Leaves<T, P extends string = ""> = {
    [K in keyof T & string]: T[K] extends object
        ? Leaves<T[K], `${P}${K}.`>
        : `${P}${K}`;
}[keyof T & string];

export type TranslationKey = Leaves<Dict>;

function lookupIn(
    dict: Record<string, unknown>,
    parts: string[],
): string | undefined {
    let cur: unknown = dict;
    for (const p of parts) {
        if (
            cur &&
            typeof cur === "object" &&
            p in (cur as Record<string, unknown>)
        ) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return undefined;
        }
    }
    return typeof cur === "string" ? cur : undefined;
}

function lookup(key: string): string | undefined {
    const parts = key.split(".");
    const primary = lookupIn(DICTS[activeLocale], parts);
    if (primary !== undefined) return primary;
    // Fallback lancuchowy: aktywne -> EN -> PL (zrodlo kluczy). Dla locale
    // nie-PL brak tlumaczenia lepiej pokryc angielskim niz polskim (rynki UE),
    // PL zostaje ostatnia deska ratunku jako slownik kompletny z definicji.
    // "us" jest juz aliasem "en" (DICTS.us === en), wiec ten fallback jest dla
    // niego no-op w praktyce (primary lookup w DICTS.us juz znajdzie to co
    // znalazlby enHit), ale wykluczamy go tu jawnie dla spojnosci z resztą.
    if (activeLocale !== "en" && activeLocale !== "gb" && activeLocale !== "us" && activeLocale !== "pl") {
        const enHit = lookupIn(en as Record<string, unknown>, parts);
        if (enHit !== undefined) return enHit;
    }
    if (activeLocale !== "pl") return lookupIn(pl, parts);
    return undefined;
}

/**
 * Pobierz tlumaczenie dla klucza w aktywnym locale (fallback PL).
 * Brak klucza wszedzie -> zwraca klucz + log w konsoli (lokalne dev only).
 */
export function t(key: TranslationKey): string {
    const v = lookup(key);
    if (v !== undefined) return v;
    if (typeof window !== "undefined") {
        console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
}

// ---------------------------------------------------------------------------
// Format helpers - locale-aware (ADR-0132). PL: DD.MM.RRRR, przecinek dziesietny.
// EN: en-GB (DD/MM/YYYY, kropka dziesietna).
// ---------------------------------------------------------------------------

const LOCALE_TAGS: Record<Locale, string> = {
    pl: "pl-PL",
    en: "en-GB",
    it: "it-IT",
    de: "de-DE",
    es: "es-ES",
    fr: "fr-FR",
    pt: "pt-BR",
    gb: "en-GB",
    // "us" jurysdykcja USA: en-US formatowanie dat/liczb (MM/DD/YYYY), a nie
    // en-GB dziedziczone po "en" (UE-first).
    us: "en-US",
};

function localeTag(): string {
    return LOCALE_TAGS[activeLocale];
}

// Slowa wzgledne per-locale (formatRelative).
const RELATIVE: Record<
    Locale,
    {
        now: string;
        minAgo: (n: number) => string;
        hoursAgo: (n: number) => string;
        yesterday: string;
        daysAgo: (n: number) => string;
    }
> = {
    pl: {
        now: "teraz",
        minAgo: (n) => `${n} min temu`,
        hoursAgo: (n) => `${n} godz. temu`,
        yesterday: "wczoraj",
        daysAgo: (n) => `${n} dni temu`,
    },
    en: {
        now: "now",
        minAgo: (n) => `${n} min ago`,
        hoursAgo: (n) => `${n} h ago`,
        yesterday: "yesterday",
        daysAgo: (n) => `${n} days ago`,
    },
    it: {
        now: "adesso",
        minAgo: (n) => `${n} min fa`,
        hoursAgo: (n) => `${n} h fa`,
        yesterday: "ieri",
        daysAgo: (n) => `${n} giorni fa`,
    },
    de: {
        now: "jetzt",
        minAgo: (n) => `vor ${n} Min.`,
        hoursAgo: (n) => `vor ${n} Std.`,
        yesterday: "gestern",
        daysAgo: (n) => `vor ${n} Tagen`,
    },
    es: {
        now: "ahora",
        minAgo: (n) => `hace ${n} min`,
        hoursAgo: (n) => `hace ${n} h`,
        yesterday: "ayer",
        daysAgo: (n) => `hace ${n} días`,
    },
    fr: {
        now: "maintenant",
        minAgo: (n) => `il y a ${n} min`,
        hoursAgo: (n) => `il y a ${n} h`,
        yesterday: "hier",
        daysAgo: (n) => `il y a ${n} jours`,
    },
    pt: {
        now: "agora",
        minAgo: (n) => `ha ${n} min`,
        hoursAgo: (n) => `ha ${n} h`,
        yesterday: "ontem",
        daysAgo: (n) => `ha ${n} dias`,
    },
    gb: {
        now: "now",
        minAgo: (n) => `${n} min ago`,
        hoursAgo: (n) => `${n} h ago`,
        yesterday: "yesterday",
        daysAgo: (n) => `${n} days ago`,
    },
    // "us" = same words as "en" (UI language is English either way).
    us: {
        now: "now",
        minAgo: (n) => `${n} min ago`,
        hoursAgo: (n) => `${n} h ago`,
        yesterday: "yesterday",
        daysAgo: (n) => `${n} days ago`,
    },
};

/**
 * Format daty wedlug aktywnego locale (PL: DD.MM.RRRR, EN: DD/MM/YYYY).
 * Akceptuje Date, string ISO, lub number (epoch ms).
 */
export function formatDate(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(localeTag(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(d);
}

/**
 * Format daty + godziny.
 */
export function formatDateTime(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(localeTag(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(d);
}

/**
 * Format wzgledny ("teraz", "5 min temu", "wczoraj" / "now", "5 min ago",
 * "yesterday"). Dla starszych dat wraca do formatDate.
 */
export function formatRelative(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    const r = RELATIVE[activeLocale];
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return r.now;
    if (min < 60) return r.minAgo(min);
    const hours = Math.floor(min / 60);
    if (hours < 24) return r.hoursAgo(hours);
    const days = Math.floor(hours / 24);
    if (days === 1) return r.yesterday;
    if (days < 7) return r.daysAgo(days);
    return formatDate(d);
}

/**
 * Format liczby wedlug aktywnego locale (PL: spacja tysiace, przecinek dziesietny).
 */
export function formatNumber(n: number, fractionDigits = 0): string {
    return new Intl.NumberFormat(localeTag(), {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(n);
}

/**
 * Format kwoty (PL: "12 345,67 zl"; domyslna waluta PLN).
 * UWAGA: waluta opisuje DENOMINACJE kwoty, nie preferencje locale - kwota
 * policzona w PLN ma byc podpisana PLN takze w UI EN/IT. Zmiana waluty to
 * decyzja miejsca wywolania (przekaz jawnie "EUR"), nie slownika.
 */
export function formatCurrency(amount: number, currency = "PLN"): string {
    return new Intl.NumberFormat(localeTag(), {
        style: "currency",
        currency,
    }).format(amount);
}

// Re-export slownikow dla testow / debug.
export { pl, en, it, de, es, fr, pt };
