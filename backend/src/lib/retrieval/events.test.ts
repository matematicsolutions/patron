// Testy jednostkowe event-centric KG baseline (ADR-0089, Faza C / US1).
//
// Pokrywaja: mapowanie rol, leksykon czynow, klastrowanie ramek (bliskosc +
// minRoles), determinizm, podobienstwo per-rola (sedno przewagi nad ADR-0087),
// symetria, brzegi (puste, degradacja bez regresji), ranking.

import { describe, it, expect } from "vitest";
import {
  roleOfEntityType,
  extractActHits,
  buildRoleHits,
  buildEventFrames,
  frameSimilarity,
  eventSetSimilarity,
  eventSimilarityRank,
  jaccard,
  type RoleHit,
  type EventFrame,
  type EventCandidate,
} from "./events";
import type { ExtractedEntity } from "../pl-entities/types";

function frame(
  roles: Record<string, string[]>,
  span: [number, number] = [0, 0],
): EventFrame {
  const m = new Map<any, Set<string>>();
  for (const [k, vs] of Object.entries(roles)) m.set(k as any, new Set(vs));
  return { roles: m, span };
}

describe("roleOfEntityType", () => {
  it("mapuje encje ADR-0008 (ontologia legal PL) na role v1", () => {
    expect(roleOfEntityType("OSOBA")).toBe("strona");
    expect(roleOfEntityType("FIRMA")).toBe("strona");
    expect(roleOfEntityType("DATA")).toBe("data");
    expect(roleOfEntityType("DATA_PUBLIKACJI")).toBe("data");
    expect(roleOfEntityType("KWOTA")).toBe("kwota");
    expect(roleOfEntityType("SYGNATURA_AKTU")).toBe("podstawa");
  });

  it("sygnatura orzeczenia, sad i PII nie sa rolami v1 (zwraca null)", () => {
    expect(roleOfEntityType("SYGNATURA_ORZECZENIA")).toBeNull();
    expect(roleOfEntityType("SAD")).toBeNull();
    expect(roleOfEntityType("PESEL")).toBeNull();
  });
});

describe("extractActHits", () => {
  it("wykrywa czyny z leksykonu z pozycja", () => {
    const text = "Powod wnosi o zachowek oraz zaplata kwoty glownej.";
    const hits = extractActHits(text);
    const values = hits.map((h) => h.value).sort();
    expect(values).toContain("zachowek");
    expect(values).toContain("zaplata");
    expect(hits.every((h) => h.role === "czyn")).toBe(true);
  });

  it("respektuje granice slowa (nie lapie podciagu wewnatrz slowa)", () => {
    // "ustalenie" jest w leksykonie; "doustalenie" nie powinno trafic jako slowo.
    const text = "przedustalenieo";
    expect(extractActHits(text)).toHaveLength(0);
  });

  it("jest deterministyczny (dwa wywolania = ten sam wynik)", () => {
    const text = "zachowek darowizna zachowek";
    expect(extractActHits(text)).toEqual(extractActHits(text));
  });
});

describe("buildRoleHits", () => {
  it("laczy encje (strona/data/kwota/podstawa) z czynami z tekstu", () => {
    const e = (
      type: ExtractedEntity["type"],
      valueNormalized: string,
      pos: number,
    ): ExtractedEntity => ({
      type,
      value: valueNormalized,
      valueNormalized,
      sourceOffsetStart: pos,
      sourceOffsetEnd: pos + valueNormalized.length,
      confidence: 0.9,
      ruleId: "test",
    });
    const entities: ExtractedEntity[] = [
      e("OSOBA", "jan kowalski", 0),
      e("SYGNATURA_AKTU", "art.991 kc", 20),
      e("SYGNATURA_ORZECZENIA", "I C 1/20", 40), // null -> pominiete
    ];
    const hits = buildRoleHits(entities, "sprawa o zachowek");
    const roles = hits.map((h) => h.role).sort();
    expect(roles).toContain("strona");
    expect(roles).toContain("podstawa");
    expect(roles).toContain("czyn");
    // SYGNATURA_ORZECZENIA nie jest rola v1 -> brak hitu dla tej wartosci
    expect(hits.find((h) => h.value === "I C 1/20")).toBeUndefined();
  });
});

describe("buildEventFrames", () => {
  it("klastruje wspolwystepujace role w jedna ramke", () => {
    const hits: RoleHit[] = [
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 10 },
      { role: "podstawa", value: "art.991 kc", position: 20 },
    ];
    const frames = buildEventFrames(hits, { windowChars: 100, minRoles: 2 });
    expect(frames).toHaveLength(1);
    expect(frames[0].roles.get("strona")).toEqual(new Set(["powod"]));
    expect(frames[0].roles.get("czyn")).toEqual(new Set(["zachowek"]));
    expect(frames[0].span).toEqual([0, 20]);
  });

  it("rozdziela trafienia odlegle (gap > windowChars) na osobne klastry", () => {
    const hits: RoleHit[] = [
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 10 },
      { role: "podstawa", value: "art.991 kc", position: 500 },
      { role: "kwota", value: "50000", position: 510 },
    ];
    const frames = buildEventFrames(hits, { windowChars: 100, minRoles: 2 });
    expect(frames).toHaveLength(2);
  });

  it("odrzuca klaster z mniej niz minRoles roznymi rolami", () => {
    // Dwie strony obok siebie = 1 rola -> nie zdarzenie przy minRoles=2.
    const hits: RoleHit[] = [
      { role: "strona", value: "powod", position: 0 },
      { role: "strona", value: "pozwany", position: 5 },
    ];
    expect(buildEventFrames(hits, { minRoles: 2 })).toHaveLength(0);
  });

  it("pusta lista trafien daje brak ramek", () => {
    expect(buildEventFrames([])).toEqual([]);
  });

  it("jest deterministyczny niezaleznie od kolejnosci wejscia", () => {
    const a: RoleHit[] = [
      { role: "podstawa", value: "art.991 kc", position: 20 },
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 10 },
    ];
    const b: RoleHit[] = [a[1], a[2], a[0]];
    expect(buildEventFrames(a)).toEqual(buildEventFrames(b));
  });
});

describe("frameSimilarity", () => {
  it("identyczne ramki -> 1", () => {
    const f = frame({ strona: ["powod"], czyn: ["zachowek"], podstawa: ["art.991 kc"] });
    expect(frameSimilarity(f, f)).toBe(1);
  });

  it("porownuje wartosci TYLKO w obrebie tej samej roli (sedno vs ADR-0087)", () => {
    // Ta sama wartosc "50000" raz jako kwota, raz jako strona -> brak dopasowania.
    const a = frame({ kwota: ["50000"], czyn: ["zachowek"] });
    const b = frame({ strona: ["50000"], czyn: ["zachowek"] });
    // Wspolne role: kwota, czyn, strona. czyn matchuje (1), kwota 0, strona 0.
    expect(frameSimilarity(a, b)).toBeCloseTo(1 / 3);
  });

  it("brak wspolnych rol -> 0", () => {
    const a = frame({ strona: ["powod"], czyn: ["zachowek"] });
    const b = frame({ kwota: ["50000"], data: ["2020-01-01"] });
    expect(frameSimilarity(a, b)).toBe(0);
  });

  it("jest symetryczne", () => {
    const a = frame({ strona: ["powod"], czyn: ["zachowek"], podstawa: ["art.991 kc"] });
    const b = frame({ strona: ["powod"], czyn: ["zachowek"], kwota: ["50000"] });
    expect(frameSimilarity(a, b)).toBeCloseTo(frameSimilarity(b, a));
  });
});

describe("eventSetSimilarity", () => {
  it("pusta lista po ktorejkolwiek stronie -> 0 (degradacja bez regresji)", () => {
    const f = [frame({ strona: ["powod"], czyn: ["zachowek"] })];
    expect(eventSetSimilarity([], f)).toBe(0);
    expect(eventSetSimilarity(f, [])).toBe(0);
    expect(eventSetSimilarity([], [])).toBe(0);
  });

  it("identyczne zbiory ramek -> 1", () => {
    const f = [frame({ strona: ["powod"], czyn: ["zachowek"], podstawa: ["art.991 kc"] })];
    expect(eventSetSimilarity(f, f)).toBe(1);
  });

  it("jest symetryczne", () => {
    const a = [frame({ strona: ["powod"], czyn: ["zachowek"] })];
    const b = [
      frame({ strona: ["powod"], czyn: ["zachowek"] }),
      frame({ kwota: ["50000"], data: ["2020-01-01"] }),
    ];
    expect(eventSetSimilarity(a, b)).toBeCloseTo(eventSetSimilarity(b, a));
  });
});

describe("jaccard", () => {
  it("dwa puste -> 0, identyczne -> 1, czesciowe -> proporcja", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("eventSimilarityRank", () => {
  it("alpha=1 zachowuje kolejnosc tresci (brak regresji)", () => {
    const ref = [frame({ strona: ["powod"], czyn: ["zachowek"] })];
    const candidates: EventCandidate[] = [
      { id: "a", contentScore: 0.3, frames: [] },
      { id: "b", contentScore: 0.9, frames: ref },
      { id: "c", contentScore: 0.6, frames: [] },
    ];
    const ranked = eventSimilarityRank(candidates, ref, { alpha: 1 });
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("pusta referencja -> eventScore 0 dla wszystkich (degradacja do tresci)", () => {
    const candidates: EventCandidate[] = [
      { id: "a", contentScore: 0.3, frames: [frame({ strona: ["x"], czyn: ["zachowek"] })] },
      { id: "b", contentScore: 0.9, frames: [] },
    ];
    const ranked = eventSimilarityRank(candidates, [], { alpha: 0.6 });
    expect(ranked.every((r) => r.eventScore === 0)).toBe(true);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sygnal zdarzeniowy wynosi kandydata o tej samej konfiguracji rol", () => {
    const ref = [frame({ strona: ["powod"], czyn: ["zachowek"], podstawa: ["art.991 kc"] })];
    const candidates: EventCandidate[] = [
      // nizsza tresc, ale ramka identyczna z referencja
      { id: "match", contentScore: 0.5, frames: ref },
      // wyzsza tresc, ale brak ramek zdarzeniowych
      { id: "nomatch", contentScore: 0.6, frames: [] },
    ];
    const ranked = eventSimilarityRank(candidates, ref, { alpha: 0.4 });
    expect(ranked[0].id).toBe("match");
  });
});
