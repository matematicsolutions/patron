// Polski prompt detekcji PII dla LLM-fallback.
//
// Wykorzystywany przez `LlmDetector` w `detect.ts` (na razie no-op,
// docelowo Ollama qwen3.5:4b albo mistral-pl) do wykrywania imion,
// nazwisk, nazw spolek, adresow i innych encji, ktorych regex nie
// wylapie z powodu fleksji albo nietypowej formy.
//
// Przyklad fleksji ktorej regex nie obsluzy:
//   "umowa z Janowi Kowalskiemu" -> imie w celowniku
//   "spolka z ograniczona odpowiedzialnoscia" -> forma prawna pisana w pelni
//   "ulica Marszalkowska 1, 00-001 Warszawa" -> adres
//
// Format wyjsciowy: JSON tablica `[{"span": "...", "category": "PERSON"}]`.

import type { PiiCategory } from "./types";

/**
 * Lista kategorii do prompta - synchronizujemy z `PiiCategory`,
 * ale ograniczonych do tych, ktore LLM ma wykrywac. PESEL/NIP/REGON/KRS
 * lapie regex - tutaj zostaje PERSON/ORG/ADDRESS, czyli to czego
 * regex sam nie zlapie.
 */
export const LLM_CATEGORIES: PiiCategory[] = ["PERSON", "ORG", "ADDRESS"];

/**
 * Polski prompt detekcji - przekazywany jako `system` do lokalnego LLM
 * (Ollama qwen3.5:4b / mistral-pl). Tekst do analizy idzie jako `user`.
 *
 * Polskie przyklady i polska terminologia formy prawnej - to jest
 * powod dla ktorego nie uzywamy hey-jude oryginalnego prompta EN.
 */
export const POLISH_DETECTION_PROMPT = `
Jestes detektorem polskich danych osobowych (PII) w dokumentach prawniczych.
Analizujesz fragment tekstu i wypisujesz wszystkie wystapienia:

- PERSON - imiona i nazwiska osob fizycznych. Lapiesz wszystkie formy
  fleksyjne (mianownik, dopelniacz, celownik, biernik, narzednik,
  miejscownik, wolacz). Przyklady: "Jan Kowalski", "Janowi Kowalskiemu",
  "Jana Kowalskiego", "Anna Nowak", "Annie Nowak". NIE LAPIESZ imienia
  bez nazwiska (np. samego "Jan") - to za szerokie.

- ORG - nazwy organizacji, w tym spolek z forma prawna polska:
  "sp. z o.o.", "S.A.", "sp. j.", "sp. k.", "sp. p.", "Sp. z o.o. Sp. k.",
  "spolka cywilna", "fundacja", "stowarzyszenie". Razem z forma prawna.
  Przyklady: "ABC sp. z o.o.", "Megabank S.A.", "Kowalski i Wspolnicy
  sp. k.".

- ADDRESS - adresy pocztowe: ulica + numer + kod pocztowy + miasto.
  Przyklad: "ulica Marszalkowska 1, 00-001 Warszawa". NIE LAPIESZ
  samej nazwy miasta ani samego kodu - tylko pelny adres.

WYNIK: JSON tablica obiektow w formacie:
[
  {"span": "<dokladny tekst z dokumentu>", "category": "PERSON|ORG|ADDRESS"}
]

WAZNE:
- Zwracasz dokladny tekst z dokumentu (bez modyfikacji fleksji).
- Jezeli encja powtarza sie - zwracasz kazde wystapienie osobno
  (deduplikacja po stronie wywolujacego).
- Jezeli niczego nie znajdziesz - zwracasz pusta tablice [].
- ZADNYCH komentarzy, ZADNEGO tekstu poza JSON-em.
`.trim();

/**
 * Wzor parsera odpowiedzi LLM. Tolerancyjny na bialy znak i otoczenie
 * markdownowymi backticks (`json ... `). Zwraca [] przy bledzie parsowania.
 */
export function parseDetectionResponse(raw: string): Array<{ span: string; category: PiiCategory }> {
    const stripped = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
    try {
        const parsed = JSON.parse(stripped);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (x): x is { span: string; category: PiiCategory } =>
                typeof x?.span === "string" &&
                typeof x?.category === "string" &&
                LLM_CATEGORIES.includes(x.category as PiiCategory),
        );
    } catch {
        return [];
    }
}
