// Testy wezlow PERSON w grafie (audyt P2 #11 follow-up, ADR-0127). Regula OSOBA
// w pl-entities + mapowanie OSOBA -> wspomina_osobe w extractorze.

import { describe, expect, it } from "vitest";
import { detectAll } from "../pl-entities";
import { extractEntitiesAndEdges } from "./extractor";

describe("regula OSOBA (detectAll)", () => {
    it("lapie nazwisko po markerze, grupa = sama nazwa (bez markera)", () => {
        const osoby = detectAll("Zeznania złożył świadek Piotr Zięba wczoraj.").filter(
            (m) => m.type === "OSOBA",
        );
        expect(osoby).toHaveLength(1);
        expect(osoby[0].raw).toBe("Piotr Zięba");
        expect(osoby[0].normalized).toBe("Piotr Zięba");
    });

    it("offset wskazuje nazwe, nie marker", () => {
        const text = "Pismo sporządził adw. Anna Nowak.";
        const o = detectAll(text).find((m) => m.type === "OSOBA")!;
        expect(text.slice(o.start, o.end)).toBe("Anna Nowak");
    });

    it("NIE lapie terminow prawnych bez markera osobowego", () => {
        const osoby = detectAll(
            "Sąd Najwyższy powołał Kodeks Karny w wyroku.",
        ).filter((m) => m.type === "OSOBA");
        expect(osoby).toHaveLength(0);
    });
});

describe("extractEntitiesAndEdges - wezel + krawedz osoby", () => {
    it("OSOBA tworzy encje i krawedz wspomina_osobe", () => {
        const r = extractEntitiesAndEdges(
            "doc-x",
            "W sprawie zeznawał świadek Jan Kowalski, a Pani Maria Wiśniewska wniosła apelację.",
        );
        const osoby = r.entities.filter((e) => e.type === "OSOBA");
        expect(osoby.map((e) => e.valueNormalized).sort()).toEqual([
            "Jan Kowalski",
            "Maria Wiśniewska",
        ]);
        const osobaEdges = r.edges.filter((e) => e.relation === "wspomina_osobe");
        expect(osobaEdges.length).toBe(2);
        // krawedz osoby NIE jest dokument->dokument (cel to encja, nie inny dok)
        expect(osobaEdges.every((e) => e.toDocId === null)).toBe(true);
    });

    it("dwa dokumenty wspominajace te sama osobe dziela value_normalized (baza nawigacji 'kto wspomina X')", () => {
        const a = extractEntitiesAndEdges("doc-a", "Świadek Jan Kowalski zeznał.");
        const b = extractEntitiesAndEdges("doc-b", "Pan Jan Kowalski podpisał pismo.");
        const vnA = a.entities.find((e) => e.type === "OSOBA")?.valueNormalized;
        const vnB = b.entities.find((e) => e.type === "OSOBA")?.valueNormalized;
        expect(vnA).toBe("Jan Kowalski");
        expect(vnB).toBe("Jan Kowalski"); // wspolny klucz -> zapytanie po value_normalized laczy oba dokumenty
    });
});
