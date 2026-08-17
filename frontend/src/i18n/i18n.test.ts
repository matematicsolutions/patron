// Parytet slownikow i18n (spec 012 US2). pl.ts jest zrodlem kluczy (ADR-0132):
// slowniki rynkowe moga byc CZESCIOWE (fallback EN -> PL), ale nie moga miec
// kluczy-sierot (literowka w slowniku rynkowym = martwe tlumaczenie, ktorego
// fallback nigdy nie pokryje). Dodatkowo: obietnica spec 007 - klucze
// tabular.review* istnieja we WSZYSTKICH 6 locale.
import { describe, expect, it } from "vitest";
import { de, en, es, fr, it as itDict, pl } from "./index";

function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") {
            out.push(...leafKeys(v as Record<string, unknown>, `${prefix}${k}.`));
        } else {
            out.push(`${prefix}${k}`);
        }
    }
    return out;
}

const MARKET_DICTS: Record<string, Record<string, unknown>> = {
    en,
    it: itDict,
    de,
    es,
    fr,
};

describe("i18n - parytet slownikow", () => {
    const plKeys = new Set(leafKeys(pl));

    it("slowniki rynkowe nie maja kluczy-sierot spoza pl.ts", () => {
        for (const [name, dict] of Object.entries(MARKET_DICTS)) {
            const orphans = leafKeys(dict).filter((k) => !plKeys.has(k));
            expect(orphans, `slownik ${name} ma klucze spoza pl.ts`).toEqual([]);
        }
    });

    it("klucze tabular.review* sa we wszystkich 6 locale (spec 007)", () => {
        const reviewKeys = [...plKeys].filter((k) =>
            k.startsWith("tabular.review"),
        );
        expect(reviewKeys.length).toBeGreaterThanOrEqual(11);
        for (const [name, dict] of Object.entries(MARKET_DICTS)) {
            const keys = new Set(leafKeys(dict));
            const missing = reviewKeys.filter((k) => !keys.has(k));
            expect(missing, `slownik ${name} nie pokrywa tabular.review*`).toEqual(
                [],
            );
        }
    });
});
