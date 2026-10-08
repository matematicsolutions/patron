// Granice argumentow narzedzi czatu, ktore podaje MODEL (przeglad 2026-10-08,
// wzorzec "limit wierszy != limit danych"). Liczba wynikow bez sufitu i kontekst
// bez sufitu daja jednym wywolaniem cale akta sprawy w wyniku narzedzia - a przy
// modelu chmurowym wynik narzedzia wychodzi z komputera (zamaskowany, ale caly).
// Argument spoza zakresu jest PRZYCINANY, nie odrzucany: model dostaje wynik i
// informacje o przycieciu, zamiast bledu, ktory kusi do ponawiania.

export const MAX_SEARCH_CORPUS_RESULTS = 20;
export const MAX_FIND_RESULTS = 50;
export const MAX_FIND_CONTEXT_CHARS = 500;

/** Liczba calkowita z zakresu [min, max]; nie-liczba = wartosc domyslna. */
export function ogranicz(v: unknown, min: number, max: number, domyslna: number): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return domyslna;
    return Math.min(max, Math.max(min, Math.floor(v)));
}
