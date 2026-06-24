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

export type Locale = "pl" | "en";

// Aktywne locale - jeden jezyk per instalacja (ADR-0132). Domyslnie PL.
// Zrodlo: zmienna build-time NEXT_PUBLIC_PATRON_LOCALE, czytana raz przy
// inicjalizacji modulu. Poniewaz NEXT_PUBLIC_* jest stala build-time, serwer i
// klient czytaja te sama wartosc -> brak flashu PL->EN i mismatchu przy
// hydratacji. `setLocale` pozostaje dla testow / ewentualnego override.
function initialLocale(): Locale {
    return process.env.NEXT_PUBLIC_PATRON_LOCALE === "en" ? "en" : "pl";
}

let activeLocale: Locale = initialLocale();

// Slowniki indeksowane po locale. Walked strukturalnie w `lookup`
// (klucze pochodza z `pl` przez TranslationKey).
const DICTS: Record<Locale, Record<string, unknown>> = { pl, en };

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
    // Fallback do PL (zrodlo kluczy), gdy brak tlumaczenia w aktywnym locale.
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

const LOCALE_TAGS: Record<Locale, string> = { pl: "pl-PL", en: "en-GB" };

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
 */
export function formatCurrency(amount: number, currency = "PLN"): string {
    return new Intl.NumberFormat(localeTag(), {
        style: "currency",
        currency,
    }).format(amount);
}

// Re-export slownikow dla testow / debug.
export { pl, en };
