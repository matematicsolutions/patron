// Wbudowane workflow oparte na POLSKIEJ procedurze widzi tylko edycja PL.
//
// 2026-10-10: "Analiza akt (6-punktowa, karne)" (k.p.k., ADR-0130) weszla do listy
// UI w 1.4.0 (audyt D-13) i pokazywala sie mecenasowi w Monachium i w Nowym Jorku -
// z polskim tytulem i promptem o art. 201 k.p.k. Lista pelna (BUILT_IN_WORKFLOWS)
// zostaje dla parytetu z backendem; widoki biora liste EDYCJI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as W from "./builtinWorkflows";
import { SUPPORTED_LOCALES } from "@/i18n";

const KARNY = "builtin-analiza-akt-karne";
const KORZEN = join(__dirname, "..", "..", "..");

describe("wbudowane workflow wg edycji", () => {
    it("mianownik: zbior tylko-PL niepusty i kazdy jego wpis istnieje w liscie pelnej", () => {
        const tylkoPl = [...(W.TYLKO_EDYCJA_PL ?? [])];
        expect(tylkoPl).toContain(KARNY);
        const wszystkie = new Set(W.BUILT_IN_WORKFLOWS.map((w) => w.id));
        expect(tylkoPl.filter((id) => !wszystkie.has(id))).toEqual([]);
    });

    it("edycja PL widzi workflow karny, kazda inna edycja nie", () => {
        expect(typeof W.wbudowaneDlaEdycji).toBe("function");
        expect(W.wbudowaneDlaEdycji("pl").map((w) => w.id)).toContain(KARNY);
        const inne = SUPPORTED_LOCALES.filter((l) => l !== "pl");
        expect(inne.length).toBeGreaterThan(0);
        for (const l of inne) {
            expect(W.wbudowaneDlaEdycji(l).map((w) => w.id), `edycja ${l}`).not.toContain(KARNY);
        }
    });

    it("inne edycje traca TYLKO workflow z zbioru PL", () => {
        const pelna = W.BUILT_IN_WORKFLOWS.length;
        expect(W.wbudowaneDlaEdycji("en").length).toBe(pelna - W.TYLKO_EDYCJA_PL.size);
    });

    it("widoki biora liste edycji, nie liste pelna", () => {
        const widoki = [
            "app/components/assistant/AssistantWorkflowModal.tsx",
            "app/components/workflows/WorkflowList.tsx",
            "app/(pages)/workflows/[id]/page.tsx",
        ];
        const bledy: string[] = [];
        for (const rel of widoki) {
            const src = readFileSync(join(KORZEN, rel), "utf8");
            if (!src.includes("wbudowaneDlaEdycji(")) bledy.push(`${rel}: brak wbudowaneDlaEdycji()`);
            if (/BUILT_IN_WORKFLOWS\s*\.\s*(filter|find|map)/.test(src)) bledy.push(`${rel}: siega po liste pelna`);
        }
        expect(bledy).toEqual([]);
    });
});
