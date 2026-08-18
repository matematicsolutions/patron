// Heurystyczny ekstraktor odwolan prawnych PL z prozy odpowiedzi (Faza 3 audytu).
//
// Problem (audyt Fable5, oS 3 ryzyko #3 - "bypass markera"): grounding obejmuje
// WYLACZNIE cytaty oznaczone przez model w bloku <CITATIONS>/[ref]. Twierdzenie,
// ktorego model NIE oznaczy (np. "zgodnie z art. 415 k.c."), przechodzi bez
// weryfikacji, bez sygnalu, bez sladu.
//
// Ten modul lapie KANDYDATOW na odwolania prawne w prozie (poza blokiem CITATIONS),
// po to, by nieoznaczone odwolanie dostalo tag "[model - zweryfikuj]" zamiast
// przejsc po cichu. NIE weryfikuje tresci (to robi grounding/cascade) - jego rola
// to wylacznie WYKRYCIE, ze cos wyglada jak odwolanie prawne, a nie zostalo
// zacytowane formalnie. Deterministyczny, offline, zero LLM/PII/egress.
//
// WAZNE: caller podaje PROZE (tekst PRZED <CITATIONS>), tak jak ground-citations.ts
// (slice do search(/<CITATIONS/i)). Samo WPIECIE w sciezke groundingu (stream.ts) to
// zmiana zachowania moatu i zostaje ZA FLAGA + decyzja governance D1 (sygnal vs blok
// vs tag) - patrz ADR-0144. Domyslnie nieaktywne.

export interface HeuristicCitation {
  /** Znormalizowany dopasowany tekst (np. "art. 415", "sygn. akt III CZP 11/13"). */
  match: string;
  /** Rodzaj wykrytego odwolania. */
  kind: "przepis" | "paragraf" | "sygnatura";
  /** Offset poczatku dopasowania w tekscie zrodlowym (do ewentualnego anchorowania). */
  index: number;
}

// Kolejnosc ma znaczenie: sygnatura najpierw (najdluzszy, najbardziej specyficzny
// wzorzec), potem przepis, potem paragraf. Dedup nizej preferuje wczesniejszy/dluzszy
// span, wiec specyficzne wzorce nie sa zjadane przez ogolne.
const PATTERNS: ReadonlyArray<{
  kind: HeuristicCitation["kind"];
  src: string;
  flags: string;
}> = [
  // "sygn. akt III CZP 11/13", "sygn. I OSK 1234/20" (rzymska + kod izby + nr/rok)
  {
    kind: "sygnatura",
    src: "sygn\\.\\s*(?:akt\\s*)?[IVXLCDM]+\\s+[A-Z]{1,4}\\s+\\d+\\/\\d{2,4}",
    flags: "gi",
  },
  // "art. 415", "art. 5 ust. 1", "art. 12a"
  { kind: "przepis", src: "art\\.\\s*\\d+[a-z]?(?:\\s*ust\\.\\s*\\d+)?", flags: "gi" },
  // "§ 5", "§ 12 ust. 2"
  { kind: "paragraf", src: "§\\s*\\d+(?:\\s*ust\\.\\s*\\d+)?", flags: "g" },
];

/**
 * Wyciaga kandydatow na odwolania prawne z prozy. Pure function - bez IO, bez
 * stanu wspoldzielonego (RegExp budowany per wywolanie). Zwraca liste bez
 * nakladajacych sie spanow, posortowana po pozycji w tekscie.
 */
export function extractHeuristicCitations(text: string): HeuristicCitation[] {
  const found: HeuristicCitation[] = [];
  for (const { kind, src, flags } of PATTERNS) {
    for (const m of text.matchAll(new RegExp(src, flags))) {
      if (m.index === undefined) continue;
      found.push({
        match: m[0].replace(/\s+/g, " ").trim(),
        kind,
        index: m.index,
      });
    }
  }
  // Dedup nakladajacych sie spanow: sortuj po pozycji (przy remisie dluzszy
  // pierwszy), zachowaj najwczesniejszy, pomin span zaczynajacy sie w obrebie
  // juz zachowanego.
  found.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  const kept: HeuristicCitation[] = [];
  let lastEnd = -1;
  for (const c of found) {
    if (c.index >= lastEnd) {
      kept.push(c);
      lastEnd = c.index + c.match.length;
    }
  }
  return kept;
}
