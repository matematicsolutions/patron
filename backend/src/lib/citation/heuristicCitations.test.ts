// Testy heurystycznego ekstraktora odwolan prawnych PL (Faza 3 audytu Fable5).

import { describe, expect, it } from "vitest";

import { extractHeuristicCitations } from "./heuristicCitations";

describe("extractHeuristicCitations", () => {
  it("lapie przepis: art. N", () => {
    const r = extractHeuristicCitations("Zgodnie z art. 415 k.c. sprawca ponosi odpowiedzialnosc.");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "przepis", match: "art. 415" });
  });

  it("lapie przepis z ustepem: art. N ust. M", () => {
    const r = extractHeuristicCitations("Por. art. 5 ust. 1 ustawy.");
    expect(r[0]).toMatchObject({ kind: "przepis", match: "art. 5 ust. 1" });
  });

  it("lapie paragraf: § N (z ustepem)", () => {
    const r = extractHeuristicCitations("Reguluje to § 12 ust. 2 regulaminu.");
    expect(r[0]).toMatchObject({ kind: "paragraf", match: "§ 12 ust. 2" });
  });

  it("lapie sygnature akt", () => {
    const r = extractHeuristicCitations("Sad powolal uchwale sygn. akt III CZP 11/13 w tej sprawie.");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "sygnatura", match: "sygn. akt III CZP 11/13" });
  });

  it("lapie wiele odwolan i zwraca je w kolejnosci wystapienia", () => {
    const r = extractHeuristicCitations(
      "Na podstawie art. 415 k.c. oraz § 5, sad (sygn. I OSK 1234/20) orzekl.",
    );
    expect(r.map((c) => c.kind)).toEqual(["przepis", "paragraf", "sygnatura"]);
    expect(r.map((c) => c.index)).toEqual([...r.map((c) => c.index)].sort((a, b) => a - b));
  });

  it("NIE lapuje slow bez kropki/znaku (artysta, sztuka)", () => {
    expect(extractHeuristicCitations("artysta i sztuka ludowa")).toHaveLength(0);
  });

  it("pusty tekst = brak wynikow", () => {
    expect(extractHeuristicCitations("")).toHaveLength(0);
  });

  it("normalizuje biale znaki w dopasowaniu", () => {
    const r = extractHeuristicCitations("art.   12a w przepisie");
    expect(r[0].match).toBe("art. 12a");
  });

  it("nie zwraca nakladajacych sie spanow", () => {
    const r = extractHeuristicCitations("art. 5 ust. 1 oraz art. 5 ust. 1");
    // dwa odrebne, nie nakladajace sie wystapienia
    expect(r).toHaveLength(2);
    expect(r[0].index).toBeLessThan(r[1].index);
  });
});
