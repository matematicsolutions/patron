// Eval rankingowy event-centric KG (ADR-0089, Faza C / US1).
//
// Cel (AC1.4): pokazac, ze dopasowanie subgrafowe ZDARZEN bije analogie ENCJOWA
// z ADR-0087 (plaski Jaccard worka encji) na korpusie, gdzie ta sama konfiguracja
// rol - a nie sam worek wspolnych encji - odroznia sprawy trafne od pozornie
// podobnych.
//
// To nie jest test jednostkowy - to pomiar jakosci. Liczby laduja w ADR-0089.
// Korpus syntetyczny, deterministyczny (zero losowosci, zero zegara).
//
// Konstrukcja pulapki: dystraktor "dist-trap" ma IDENTYCZNY worek wartosci co
// sprawa-kotwica, ale rozsiany po dokumencie (duze odstepy pozycji) - przez co
// NIE tworzy zadnej ramki zdarzenia. Plaski Jaccard (ADR-0087) stawia go na #1;
// dopasowanie zdarzeniowe spycha go na dol, bo nie ma wspolwystepujacej ramki.
//
// Metryka: nDCG@5. Porownanie: ranking po analogii encjowej (ADR-0087) vs ranking
// po analogii zdarzeniowej (ten modul). Oczekiwanie: zdarzeniowa bije encjowa.

import { describe, it, expect } from "vitest";
import {
  buildEventFrames,
  eventSetSimilarity,
  jaccard,
  type RoleHit,
  type EventFrame,
} from "./events";

const WINDOW = 120;

interface EvalDoc {
  id: string;
  hits: RoleHit[]; // pozycjonowane trafienia rol -> ramki przez buildEventFrames
  content: number; // symulacja wyniku tresci (tie-break)
  relevant: boolean; // ground truth
}

// Sprawa-kotwica (zapytanie): powod zada zachowku, podstawa art. 991 kc, kwota.
// Wszystkie role wspolwystepuja (jedna ramka).
const ANCHOR: EvalDoc = {
  id: "anchor",
  hits: [
    { role: "strona", value: "powod", position: 0 },
    { role: "czyn", value: "zachowek", position: 10 },
    { role: "podstawa", value: "art.991 kc", position: 20 },
    { role: "kwota", value: "50000", position: 30 },
  ],
  content: 1.0,
  relevant: true,
};

// Kandydaci do uszeregowania (anchor jest referencja, nie kandydatem).
const CANDIDATES: EvalDoc[] = [
  // Trafne analogie: ta sama konfiguracja rol, ramka wspolwystepujaca.
  {
    id: "rel-1",
    hits: [
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 12 },
      { role: "podstawa", value: "art.991 kc", position: 24 },
      { role: "kwota", value: "30000", position: 36 },
    ],
    content: 0.7,
    relevant: true,
  },
  {
    id: "rel-2",
    hits: [
      { role: "strona", value: "pozwany", position: 0 },
      { role: "czyn", value: "zachowek", position: 10 },
      { role: "podstawa", value: "art.991 kc", position: 20 },
    ],
    content: 0.55,
    relevant: true,
  },
  {
    id: "rel-3",
    hits: [
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 10 },
      { role: "podstawa", value: "art.991 kc", position: 20 },
    ],
    content: 0.5,
    relevant: true,
  },
  // PULAPKA ENCJOWA: identyczny worek wartosci co kotwica, ale rozsiany ->
  // brak jakiejkolwiek ramki zdarzenia. Plaski Jaccard = 1.0 (myli sie).
  {
    id: "dist-trap",
    hits: [
      { role: "strona", value: "powod", position: 0 },
      { role: "czyn", value: "zachowek", position: 500 },
      { role: "podstawa", value: "art.991 kc", position: 1000 },
      { role: "kwota", value: "50000", position: 1500 },
    ],
    content: 0.68,
    relevant: false,
  },
  // Dystraktory tematyczne: inna konfiguracja, ramka obca.
  {
    id: "dist-darowizna",
    hits: [
      { role: "strona", value: "obdarowany", position: 0 },
      { role: "czyn", value: "darowizna", position: 10 },
      { role: "podstawa", value: "art.898 kc", position: 20 },
    ],
    content: 0.66,
    relevant: false,
  },
  {
    id: "dist-dzial",
    hits: [
      { role: "strona", value: "spadkobierca", position: 0 },
      { role: "czyn", value: "dzial spadku", position: 10 },
      { role: "podstawa", value: "art.1035 kc", position: 25 },
    ],
    content: 0.6,
    relevant: false,
  },
];

/** Plaski worek wartosci (analogia encjowa ADR-0087): wszystkie wartosci hitow. */
function entityBag(doc: EvalDoc): Set<string> {
  return new Set(doc.hits.map((h) => h.value));
}

function dcg(relevances: number[]): number {
  return relevances.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
}

function ndcg(rankedRelevances: number[], k: number): number {
  const dcgVal = dcg(rankedRelevances.slice(0, k));
  const ideal = [...rankedRelevances].sort((a, b) => b - a);
  const idealDcg = dcg(ideal.slice(0, k));
  return idealDcg === 0 ? 0 : dcgVal / idealDcg;
}

/**
 * Uszereguj kandydatow malejaco wg score; tie-break: tresc malejaco, potem id.
 * Zwraca sekwencje trafnosci (1/0) w kolejnosci rankingu.
 */
function rankRelevances(
  scored: { doc: EvalDoc; score: number }[],
): number[] {
  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.doc.content !== a.doc.content) return b.doc.content - a.doc.content;
    return a.doc.id < b.doc.id ? -1 : a.doc.id > b.doc.id ? 1 : 0;
  });
  return sorted.map((s) => (s.doc.relevant ? 1 : 0));
}

describe("event-centric KG eval (ADR-0089)", () => {
  it("analogia zdarzeniowa bije encjowa (ADR-0087) na nDCG@5", () => {
    const anchorBag = entityBag(ANCHOR);
    const anchorFrames = buildEventFrames(ANCHOR.hits, { windowChars: WINDOW });

    // Baseline: analogia encjowa = plaski Jaccard worka encji (mechanizm ADR-0087).
    const entityScored = CANDIDATES.map((doc) => ({
      doc,
      score: jaccard(entityBag(doc), anchorBag),
    }));
    const entityNdcg = ndcg(rankRelevances(entityScored), 5);

    // Sygnal zdarzeniowy: dopasowanie subgrafowe ramek.
    const eventScored = CANDIDATES.map((doc) => ({
      doc,
      score: eventSetSimilarity(
        buildEventFrames(doc.hits, { windowChars: WINDOW }),
        anchorFrames,
      ),
    }));
    const eventNdcg = ndcg(rankRelevances(eventScored), 5);

    // Pulapka encjowa: dist-trap ma IDENTYCZNY worek co kotwica (plaski Jaccard 1.0)
    // ale zero ramek (eventScore 0). To jest mechanizm przewagi.
    const trapEntity = entityScored.find((s) => s.doc.id === "dist-trap")!;
    const trapEvent = eventScored.find((s) => s.doc.id === "dist-trap")!;
    expect(trapEntity.score).toBeCloseTo(1.0, 6);
    expect(trapEvent.score).toBe(0);

    // Headline: zdarzeniowa bije encjowa.
    expect(eventNdcg).toBeGreaterThan(entityNdcg);

    // Snapshot liczb do ADR-0089 (deterministyczne).
    expect(entityNdcg).toBeCloseTo(0.7328, 3);
    expect(eventNdcg).toBeCloseTo(1.0, 3);
  });
});
