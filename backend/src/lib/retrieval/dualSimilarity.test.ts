import { describe, it, expect } from "vitest";
import {
  jaccard,
  structuralSimilarity,
  dualSimilarityRank,
  type DualSimilarityCandidate,
} from "./dualSimilarity";

const S = (...xs: string[]): Set<string> => new Set(xs);

describe("jaccard", () => {
  it("rozlaczne zbiory daja 0", () => {
    expect(jaccard(S("a"), S("b"))).toBe(0);
  });
  it("identyczne daja 1", () => {
    expect(jaccard(S("a", "b"), S("a", "b"))).toBe(1);
  });
  it("czesciowe pokrycie", () => {
    expect(jaccard(S("a", "b", "c"), S("b", "c", "d"))).toBeCloseTo(2 / 4);
  });
  it("oba puste daja 0", () => {
    expect(jaccard(S(), S())).toBe(0);
  });
  it("jeden pusty daje 0", () => {
    expect(jaccard(S("a"), S())).toBe(0);
  });
  it("symetryczny", () => {
    expect(jaccard(S("a", "b", "c"), S("b"))).toBe(
      jaccard(S("b"), S("a", "b", "c")),
    );
  });
});

describe("structuralSimilarity", () => {
  it("jest jaccardem sasiedztw", () => {
    expect(structuralSimilarity(S("art1", "art2"), S("art2", "art3"))).toBeCloseTo(
      1 / 3,
    );
  });
});

describe("dualSimilarityRank", () => {
  const ref = S("art415kc", "sygn_iii_czp", "precedensX");

  it("wynosi sprawe strukturalnie analogiczna nad tylko tematycznie podobna", () => {
    const candidates: DualSimilarityCandidate[] = [
      // wysoki content, zerowe pokrycie strukturalne z referencja
      { id: "topical", contentScore: 0.8, profile: S("inny1", "inny2") },
      // nieco nizszy content, ale identyczna struktura z referencja
      { id: "analog", contentScore: 0.75, profile: S("art415kc", "sygn_iii_czp", "precedensX") },
      // filler ustawia dol skali normalizacji tresci
      { id: "filler", contentScore: 0.0, profile: S("zzz") },
    ];
    const ranked = dualSimilarityRank(candidates, ref, { alpha: 0.5 });
    expect(ranked[0].id).toBe("analog");
  });

  it("alpha=1 daje czysty porzadek tresci (brak regresji)", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "a", contentScore: 0.9, profile: S() },
      { id: "b", contentScore: 0.5, profile: S("art415kc") },
      { id: "c", contentScore: 0.1, profile: new Set(ref) },
    ];
    const ranked = dualSimilarityRank(candidates, ref, { alpha: 1 });
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("alpha=0 daje czysty porzadek strukturalny", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "topical", contentScore: 1.0, profile: S("x") },
      { id: "analog", contentScore: 0.0, profile: S("art415kc", "sygn_iii_czp", "precedensX") },
    ];
    const ranked = dualSimilarityRank(candidates, ref, { alpha: 0 });
    expect(ranked[0].id).toBe("analog");
  });

  it("pusty profil referencyjny sprowadza ranking do tresci (brak regresji)", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "a", contentScore: 0.2, profile: S("art415kc") },
      { id: "b", contentScore: 0.9, profile: S("art5kc") },
    ];
    const ranked = dualSimilarityRank(candidates, new Set<string>(), { alpha: 0.6 });
    expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("determinizm: dwa wywolania daja identyczny wynik", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "a", contentScore: 0.5, profile: S("art415kc") },
      { id: "b", contentScore: 0.5, profile: S("art415kc") },
    ];
    expect(dualSimilarityRank(candidates, ref, { alpha: 0.5 })).toEqual(
      dualSimilarityRank(candidates, ref, { alpha: 0.5 }),
    );
  });

  it("remis score daje stabilny tie-break po kolejnosci wejscia", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "first", contentScore: 0.5, profile: S("art415kc") },
      { id: "second", contentScore: 0.5, profile: S("art415kc") },
    ];
    const ranked = dualSimilarityRank(candidates, ref, { alpha: 0.5 });
    expect(ranked.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("alpha spoza [0,1] jest przycinany", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "a", contentScore: 1.0, profile: S("x") },
      { id: "b", contentScore: 0.0, profile: new Set(ref) },
    ];
    // alpha=5 -> przyciety do 1 -> czysta tresc -> "a" pierwszy
    expect(dualSimilarityRank(candidates, ref, { alpha: 5 })[0].id).toBe("a");
    // alpha=-5 -> przyciety do 0 -> czysta struktura -> "b" pierwszy
    expect(dualSimilarityRank(candidates, ref, { alpha: -5 })[0].id).toBe("b");
  });

  it("pusta lista i pojedynczy kandydat", () => {
    expect(dualSimilarityRank([], ref)).toEqual([]);
    const one = dualSimilarityRank(
      [{ id: "x", contentScore: 0.3, profile: S("art415kc") }],
      ref,
      { alpha: 0.6 },
    );
    expect(one).toHaveLength(1);
    expect(one[0].id).toBe("x");
  });

  it("score laczony jest w [0,1]", () => {
    const candidates: DualSimilarityCandidate[] = [
      { id: "a", contentScore: 0.9, profile: S("art415kc") },
      { id: "b", contentScore: 0.1, profile: S("inny") },
    ];
    for (const r of dualSimilarityRank(candidates, ref, { alpha: 0.6 })) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
