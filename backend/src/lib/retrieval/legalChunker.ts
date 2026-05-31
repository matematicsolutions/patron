// Clause-boundary chunking + parser sekcji wyroku (ADR-0083).
//
// Tnie tekst prawniczy po naturalnych granicach przed chunkowaniem RAG zamiast
// slepym oknem okolo 900 znakow:
//   1. sekcje kanoniczne polskiego wyroku/uzasadnienia (naglowek+sygnatura,
//      oznaczenie stron, zadanie/wnioski, ustalenia faktyczne, ocena prawna/
//      rozwazania, sentencja/rozstrzygniecie),
//   2. jednostki redakcyjne (art. / par. / ust. / pkt / lit.).
//
// Brama trybu prawniczego (ADR-0083 sekcja A): granice licza sie tylko gdy
// dokument zawiera co najmniej jeden marker mocny (Sygn. akt, WYROK,
// POSTANOWIENIE, UZASADNIENIE, "Sad ustalil", "Sad zwazyl co nastepuje") albo
// jednostke redakcyjna. Pospolite slowa-naglowki (Wniosek, przeciwko,
// Rozwazania, Ocena prawna, orzeka) sa SLABE i same z siebie nie wlaczaja
// trybu prawniczego - zwykla notatka/mail z taka linia idzie fallbackiem i ma
// wynik identyczny z chunkText (zero regresji dla dokumentow nieprawniczych).
//
// Kazdy blok jest przepuszczany przez chunkText (jednolita normalizacja i
// podzial do maxChars). Brak aktywacji trybu prawniczego => caly tekst idzie
// przez chunkText.
//
// Deterministyczne, offline, zero LLM (Konstytucja Art. 1, 3, 7). Zrodlo
// determinizmu: fabryki zwracaja swiezy RegExp przy kazdym wywolaniu i zaden
// wzorzec nie ma flagi g. Reuzywa chunkText jako fallback - nie duplikuje
// logiki akapitowej.

import { chunkText, type ChunkPiece } from "./indexer";

const DEFAULT_MAX_CHARS = 900;
const DEFAULT_MIN_CHARS = 200;

export interface LegalChunkOptions {
  maxChars?: number;
  minChars?: number;
}

// Klasy znakow tolerancyjne na polskie diakrytyki w obu wariantach (z ogonkiem
// i ASCII), bo tekst po OCR/konwersji bywa niespojny. Uzywane konsekwentnie we
// wszystkich naglowkach (takze "z powodztwa", "Stan faktyczny", "Sentencja"),
// zeby OCR ASCII tez byl rozpoznawany.
const A = "[aAąĄ]"; // a / A / a-ogonek
const E = "[eEęĘ]"; // e / E / e-ogonek
const O = "[oOóÓ]"; // o / O / o-kreska
const Z = "[zZżŻźŹ]"; // z / Z / z-kropka / z-kreska
const L = "[lLłŁ]"; // l / L / l-przekreslone

/**
 * Markery MOCNE: wzorce o niskim ryzyku false-positive w zwyklym tekscie.
 * Aktywuja tryb prawniczy (ADR-0083 sekcja A). Dopasowywane na poczatku linii,
 * bez wielkosci liter. Swiezy RegExp przy kazdym wywolaniu (determinizm,
 * brak wspoldzielonego stanu); zaden wzorzec nie ma flagi g.
 */
function strongHeadingPatterns(): RegExp[] {
  return [
    // Naglowek wyroku z sygnatura: "Sygn. akt I C 100/26"
    new RegExp(`^\\s*Sygn${O}?\\.?\\s*akt\\b`, "im"),
    // "W Y R O K" (rozstrzelone) / "WYROK" / "POSTANOWIENIE" / "UZASADNIENIE"
    new RegExp(`^\\s*W\\s*Y\\s*R\\s*O\\s*K\\b`, "im"),
    new RegExp(`^\\s*WYROK\\b`, "im"),
    new RegExp(`^\\s*POSTANOWIENIE\\b`, "im"),
    new RegExp(`^\\s*UZASADNIENIE\\b`, "im"),
    // Ustalenia faktyczne - formy z podmiotem "Sad" (specyficzne, malo prozowe).
    // Pokrywa "Sad ustalil ..." oraz wariant "Sad ustalil nastepujacy stan ...".
    new RegExp(`^\\s*S${A}d\\s+ustali${L}\\b`, "im"),
    new RegExp(`^\\s*S${A}d\\s+ustali${L}\\s+nast${E}puj${A}cy\\b`, "im"),
    // Ocena prawna - forma z podmiotem "Sad" (specyficzna).
    new RegExp(`^\\s*S${A}d\\s+zwa${Z}y${L}[,]?\\s+co\\s+nast${E}puje\\b`, "im"),
  ];
}

/**
 * Naglowki SLABE: pospolite polskie slowa, ktore licza sie jako granica tylko
 * gdy (a) tryb prawniczy jest aktywny oraz (b) linia ma ksztalt naglowka -
 * cala fraza, opcjonalnie zakonczona dwukropkiem (wymog konca linii albo ":").
 * Dzieki temu linia prozy "Ocena prawna sytuacji jest trudna" nie jest
 * naglowkiem, a "Ocena prawna:" jest. Swiezy RegExp, brak flagi g.
 */
function weakHeadingPatterns(): RegExp[] {
  const phrases: string[] = [
    `${Z}${A}danie`, // Zadanie
    `Wnioski`,
    `Wniosek`,
    `Stan\\s+faktyczny`,
    `Ustalenia\\s+faktyczne`,
    `Ocena\\s+prawna`,
    `Rozwa${Z}ania\\s+prawne`,
    `Rozwa${Z}ania`,
    `Sentencja`,
    `Rozstrzygni${E}cie`,
    `orzeka`,
    // Oznaczenie stron / komparycja. ".*" pozwala na "przeciwko Spolce X",
    // ale wymog "(?::|$)" na koncu linii odsiewa zdania prozy ze srodka
    // (te i tak nie wlaczaja trybu prawniczego, bo sa slabe).
    `przeciwko\\b.*`,
    `(?:w\\s+sprawie\\s+)?z\\s+pow${O}d${Z}twa\\b.*`,
  ];
  return phrases.map(
    (p) => new RegExp(`^\\s*(?:${p})\\s*(?::|$)`, "im"),
  );
}

/**
 * Jednostki redakcyjne na poczatku linii (numerowane). Aktywuja tryb prawniczy
 * i sa naturalna granica chunku. Swiezy RegExp, brak flagi g.
 */
function editorialUnitPatterns(): RegExp[] {
  return [
    new RegExp(`^\\s*Art${O}?(?:${O}|ku${L})?\\.?\\s*\\d`, "im"), // Art. N / Artykul N
    new RegExp(`^\\s*Artyku${L}\\s*\\d`, "im"),
    new RegExp(`^\\s*(?:Par\\.|\\u00a7)\\s*\\d`, "im"), // Par. N / znak paragrafu
    new RegExp(`^\\s*ust\\.?\\s*\\d`, "im"), // ust. N
    new RegExp(`^\\s*pkt\\.?\\s*\\d`, "im"), // pkt N
    new RegExp(`^\\s*lit\\.?\\s*[a-z]\\b`, "im"), // lit. x
  ];
}

/** Czy linia pasuje do ktoregokolwiek z podanych wzorcow. */
function lineMatchesAny(line: string, patterns: RegExp[]): boolean {
  for (const pat of patterns) {
    if (pat.test(line)) return true;
  }
  return false;
}

/**
 * Znajduje offsety poczatkow linii bedacych granicami chunku. Dwa przejscia:
 *   1. tryb prawniczy aktywny tylko gdy wystepuje marker mocny albo jednostka
 *      redakcyjna (ADR-0083 sekcja A). W przeciwnym razie zwraca [] (pelny
 *      fallback do chunkText - zero regresji dla dokumentow nieprawniczych).
 *   2. zbiera offsety: markery mocne, jednostki redakcyjne, slabe naglowki.
 * Deterministyczne: skanuje linie po liniach, swieze wzorce, brak flagi g.
 */
function findBoundaryOffsets(normalized: string): number[] {
  const strong = strongHeadingPatterns();
  const weak = weakHeadingPatterns();
  const units = editorialUnitPatterns();
  const lines = normalized.split("\n");

  // Przejscie 1: czy dokument jest prawniczy?
  let legalMode = false;
  for (const line of lines) {
    if (lineMatchesAny(line, strong) || lineMatchesAny(line, units)) {
      legalMode = true;
      break;
    }
  }
  if (!legalMode) return [];

  // Przejscie 2: zbierz granice (mocne + jednostki + slabe naglowki-linie).
  const offsets: number[] = [];
  let lineStart = 0;
  for (const line of lines) {
    if (
      lineMatchesAny(line, strong) ||
      lineMatchesAny(line, units) ||
      lineMatchesAny(line, weak)
    ) {
      offsets.push(lineStart);
    }
    lineStart += line.length + 1; // +1 za znak "\n"
  }
  return offsets;
}

/**
 * Tnie tekst na bloki wedlug posortowanych offsetow granic. Tekst przed
 * pierwsza granica (preambula) jest osobnym blokiem, jezeli niepusty.
 */
function sliceByOffsets(text: string, offsets: number[]): string[] {
  if (offsets.length === 0) return [];
  const sorted = Array.from(new Set(offsets)).sort((a, b) => a - b);
  const blocks: string[] = [];
  // Preambula przed pierwsza granica.
  if (sorted[0] > 0) {
    const pre = text.slice(0, sorted[0]).trim();
    if (pre) blocks.push(pre);
  }
  for (let i = 0; i < sorted.length; i++) {
    const end = i + 1 < sorted.length ? sorted[i + 1] : text.length;
    const block = text.slice(sorted[i], end).trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Chunkuje tekst prawniczy po granicach sekcji wyroku i jednostek redakcyjnych.
 * Bez aktywacji trybu prawniczego deleguje w calosci do chunkText (akapitowego).
 * Kazdy blok jest przepuszczany przez chunkText (jednolita normalizacja i
 * podzial do maxChars - bez asymetrii miedzy blokiem krotkim a dlugim). Zwraca
 * chunki z indeksem porzadkowym, deterministycznie (Konstytucja Art. 3).
 */
export function chunkLegalText(
  text: string,
  opts: LegalChunkOptions = {},
): ChunkPiece[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const minChars = opts.minChars ?? DEFAULT_MIN_CHARS;

  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  const offsets = findBoundaryOffsets(normalized);

  // Brak aktywacji trybu prawniczego => pelny fallback do chunkText (identyczny
  // wynik jak dotychczas, takze dla notatek ze slabymi slowami-naglowkami).
  if (offsets.length === 0) {
    return chunkText(text, maxChars, minChars);
  }

  const blocks = sliceByOffsets(normalized, offsets);
  if (blocks.length === 0) {
    return chunkText(text, maxChars, minChars);
  }

  // Kazdy blok przez chunkText - jednolita normalizacja bialych znakow i
  // podzial do maxChars (ADR-0083 sekcja D). Brok krotszy niz maxChars wyjdzie
  // jako jeden chunk, dluzszy zostanie podzielony - ta sama sciezka dla obu.
  const contents: string[] = [];
  for (const block of blocks) {
    for (const piece of chunkText(block, maxChars, minChars)) {
      contents.push(piece.content);
    }
  }

  // Bezpiecznik: gdyby z jakiegos powodu nic nie powstalo, oddaj fallback.
  if (contents.length === 0) {
    return chunkText(text, maxChars, minChars);
  }

  return contents.map((content, index) => ({ index, content }));
}