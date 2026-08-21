// Bramka pokrycia motywu.
//
// Tryb ciemny dziala dzieki temu, ze cala skala neutralna jest przekierowana na
// zmienne --n-* w globals.css (@theme inline), wiec kazde `bg-white` czy
// `text-gray-900` w komponentach przelacza sie razem z motywem BEZ migracji
// setek klas.
//
// Slabosc tego rozwiazania: odcien, ktorego NIE ma w mapowaniu, po cichu spada
// na domyslna palete Tailwinda - ktora jest zaprojektowana pod jasne tlo.
// Zmierzone 2026-08-21: `text-stone-800` uzyty w karcie zrodla MCP dal w trybie
// ciemnym kontrast **1.57** (ciemny tekst na ciemnej karcie, praktycznie
// nieczytelny). Nie bylo o tym zadnego bledu - komponent renderowal sie
// poprawnie, tylko nie dalo sie go przeczytac.
//
// Dlatego bramka: kazdy odcien neutralny UZYTY w komponentach musi miec
// mapowanie. Test czyta ZRODLA, bo tam powstaje blad.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const CSS = join(SRC, "app", "globals.css");

const NEUTRAL_FAMILIES = ["gray", "slate", "zinc", "neutral", "stone"];
const USE = new RegExp(
    `\\b(?:text|bg|border|ring|divide|from|via|to)-(${NEUTRAL_FAMILIES.join("|")})-(\\d{2,3})\\b`,
    "g",
);

function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, acc);
        else if (entry.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

describe("pokrycie motywu dla skali neutralnej", () => {
    const css = readFileSync(CSS, "utf8");

    const used = new Set<string>();
    for (const file of tsxFiles(SRC)) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(USE)) used.add(`${m[1]}-${m[2]}`);
    }

    it("znajduje uzycia (kontrola pozytywna - inaczej test przechodzi pusty)", () => {
        expect(used.size).toBeGreaterThan(5);
    });

    it("kazdy uzyty odcien neutralny jest przekierowany na zmienna --n-*", () => {
        const missing = [...used]
            .filter((shade) => !css.includes(`--color-${shade}: var(--n-`))
            .sort();

        expect(
            missing,
            "Te odcienie spadna na domyslna palete Tailwinda i beda nieczytelne " +
                "w trybie ciemnym. Dopisz mapowanie w globals.css (@theme inline).",
        ).toEqual([]);
    });

    it("rampa --n-* jest zdefiniowana w OBU motywach", () => {
        const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
        const dark = css.slice(css.indexOf(".dark {"));
        for (const step of ["0", "50", "200", "500", "900", "950"]) {
            expect(light, `jasny motyw nie ma --n-${step}`).toContain(`--n-${step}:`);
            expect(dark, `ciemny motyw nie ma --n-${step}`).toContain(`--n-${step}:`);
        }
    });
});
