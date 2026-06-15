// Patron i18n - minimalistyczny dictionary lookup z fallbackiem.
//
// API:
//   t("chat.send")              -> "Wyslij"
//   t("nav.assistant")          -> "Asystent"
//   formatDate(new Date())      -> "20.05.2026"
//   formatDateTime(...)         -> "20.05.2026, 15:30"
//
// Brak klucza w slowniku -> zwraca klucz (np. "chat.unknownKey") + console.warn.
// To deterministyczna pomylka widoczna w UI i w DevTools - latwo zauwazyc.

import { pl } from "./pl";

type Dict = typeof pl;
type Leaves<T, P extends string = ""> = {
    [K in keyof T & string]: T[K] extends object
        ? Leaves<T[K], `${P}${K}.`>
        : `${P}${K}`;
}[keyof T & string];

export type TranslationKey = Leaves<Dict>;

function lookup(key: string): string | undefined {
    const parts = key.split(".");
    let cur: unknown = pl;
    for (const p of parts) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return undefined;
        }
    }
    return typeof cur === "string" ? cur : undefined;
}

/**
 * Pobierz polskie tlumaczenie dla klucza.
 * Brak klucza -> zwraca klucz + log w konsoli (lokalne dev only).
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
// Format helpers - polskie konwencje (DD.MM.RRRR, separator dziesietny przecinek)
// ---------------------------------------------------------------------------

const DATE_LOCALE = "pl-PL";

/**
 * Format daty wedlug konwencji polskiej: DD.MM.RRRR.
 * Akceptuje Date, string ISO, lub number (epoch ms).
 */
export function formatDate(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(DATE_LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(d);
}

/**
 * Format daty + godziny: DD.MM.RRRR, HH:MM.
 */
export function formatDateTime(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(DATE_LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(d);
}

/**
 * Format wzgledny ("teraz", "5 min temu", "wczoraj").
 * Dla starszych dat wraca do formatDate.
 */
export function formatRelative(input: Date | string | number): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "teraz";
    if (min < 60) return `${min} min temu`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} godz. temu`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "wczoraj";
    if (days < 7) return `${days} dni temu`;
    return formatDate(d);
}

/**
 * Format liczby - polskie separatory (spacja jako tysiace, przecinek dziesietny).
 */
export function formatNumber(n: number, fractionDigits = 0): string {
    return new Intl.NumberFormat(DATE_LOCALE, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(n);
}

/**
 * Format kwoty w PLN: "12 345,67 zł".
 */
export function formatCurrency(amount: number, currency = "PLN"): string {
    return new Intl.NumberFormat(DATE_LOCALE, {
        style: "currency",
        currency,
    }).format(amount);
}

// Re-export slownika dla testow / debug.
export { pl };
