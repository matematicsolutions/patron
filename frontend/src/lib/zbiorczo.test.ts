// Zbiorcza operacja mowi, co sie udalo, a co nie - nigdy nie udaje sukcesu.
//
// 2026-10-10 (przeglad komunikatow bledow, wzorzec REA): zbiorcze usuwanie dokumentow
// w ProjectPage robilo `deleteDocument(id).catch(() => {})`, a potem czyscilo liste
// bez wzgledu na wynik. Mecenas widzial "usuniete", pliki zostawaly na dysku.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Z from "./zbiorczo";

describe("zbiorczo()", () => {
    it("dzieli identyfikatory na udane i nieudane, zachowujac kolejnosc", async () => {
        expect(typeof Z.zbiorczo).toBe("function");
        const w = await Z.zbiorczo(["a", "b", "c", "d"], async (id) => {
            if (id === "b" || id === "d") throw new Error("odmowa");
        });
        expect(w.udane).toEqual(["a", "c"]);
        expect(w.nieudane).toEqual(["b", "d"]);
    });

    it("pusta lista = pusty wynik, bez wywolan", async () => {
        let wolan = 0;
        const w = await Z.zbiorczo([], async () => { wolan++; });
        expect(w).toEqual({ udane: [], nieudane: [] });
        expect(wolan).toBe(0);
    });

    it("wyjatek synchroniczny tez liczy sie jako nieudany, nie przerywa reszty", async () => {
        const w = await Z.zbiorczo(["x", "y"], (id) => {
            if (id === "x") throw new Error("od razu");
            return Promise.resolve();
        });
        expect(w).toEqual({ udane: ["y"], nieudane: ["x"] });
    });
});

describe("ProjectPage: zbiorcze akcje nie polykaja bledow", () => {
    const src = readFileSync(join(__dirname, "..", "app", "components", "projects", "ProjectPage.tsx"), "utf8");

    it("zadne wywolanie usuniecia ani przeniesienia nie konczy sie pustym catch", () => {
        const polkniete = src.match(
            /(deleteDocument|deleteChat|deleteTabularReview|moveDocumentToFolder)\([^)]*\)\s*\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/g,
        ) ?? [];
        expect(polkniete).toEqual([]);
    });

    it("widok usuwa tylko to, co sie udalo (filtr po udane, nigdy po calym wyborze)", () => {
        expect(src).not.toMatch(/filter\(\(\w+\)\s*=>\s*!owned\.includes\(/);
        expect((src.match(/!udane\.includes\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });

    it("cztery zbiorcze akcje ida przez zbiorczo() i mowia o porazce", () => {
        expect((src.match(/zbiorczo\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
        expect(src).toMatch(/projects\.bulkFailedTitle/);
        expect(src).toMatch(/projects\.bulkDeleteFailed/);
        expect(src).toMatch(/projects\.bulkMoveFailed/);
    });
});
