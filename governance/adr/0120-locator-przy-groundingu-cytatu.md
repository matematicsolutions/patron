# ADR-0120: Trwaly lokator przy groundingu cytatu (read->cite)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Wpiete w `ground-citations.ts`; emisja lokatora do SSE `{type:"citations"}` jest automatyczna (rideuje w mapie grounding); render highlightu po stronie frontendu + persystencja lokatora w schemacie = rezerwacja.

**Data**: 2026-06-14

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc**: lokator liczony z surowego tekstu JUZ prefetchowanego przez grounding. Zero nowego I/O, zero egress, zero LLM.
- **Art. 3 - Audytowalnosc**: deterministyczny. Lokator to dowod pozycyjny cytatu (gdzie w aktach), wzmacnia record-keeping (AI Act art. 12).
- **Art. 7 - Minimalnosc / rzetelnosc**: lokator powstaje TYLKO gdy cytat jest verbatim w zrodle (`locatorFromQuote` = exact-or-null); inaczej null. Brak fabrykowania pozycji.

**Powiazane ADR**: ADR-0116 (lokator + `locatorFromQuote`), ADR-0005 (grounding - ten ADR wzbogaca jego wynik), ADR-0001/0033 (audit hash-chain - granica: lokator NIE wchodzi do audit_log).

---

## Kontekst

`groundCitationsByRef` (ADR-0005) prefetchuje surowy tekst kazdego cytowanego dokumentu i weryfikuje cytat string-matchem, zwracajac werdykt per `ref` (`GroundingResult{status, decision, offset...}`). `offset` jest w tekscie ZNORMALIZOWANYM - nie nadaje sie do highlightu w surowym dokumencie ani do persystencji. Brakuje trwalej, re-kotwiczalnej pozycji cytatu (ADR-0116), mimo ze surowe zrodlo jest w tym momencie JUZ w pamieci.

## Decyzja

Wzbogacic wynik groundingu o trwaly lokator:
- Nowy typ `GroundedCitation extends GroundingResult { locator: CitationLocator | null }` w `ground-citations.ts`.
- `groundCitationsByRef` zwraca `Record<number, GroundedCitation>`; dla kazdego werdyktu buduje `locator = locatorFromQuote(quote, rawSource)` z prefetchowanej mapy (zero dodatkowego I/O). Verbatim -> lokator; inaczej null.

### Granica governance (KLUCZOWA)

Lokator zawiera `rawText` (= tresc cytatu). Plynie do **SSE `{type:"citations"}`** (gdzie cytaty z `quote` juz sa) i do **persystencji wiadomosci** (gdzie cytaty juz sa). **NIE** trafia do `audit_log`: oba routes (`chat.ts`, `projectChat.ts`) zapisuja do audytu `groundingSummary(grounding)` - same liczby decyzji, bez tresci. Ta granica jest niezmienna (tajemnica zawodowa + RODO minimalizacja, AGENTS.md sek. 13).

### Co pozostaje zarezerwowane

1. Render highlightu z lokatora po stronie frontendu (UI czyta `grounding[ref].locator` z SSE).
2. Persystencja lokatora w schemacie jako osobne pole (dzis rideuje w mapie grounding wiadomosci) - jezeli potrzebny indeks po pozycji.
3. Most do warstwy ZMODYFIKOWANY (cytat rozni sie od zrodla) - 0120 kotwiczy tylko verbatim; rozmyte = domena 0005.

---

## Konsekwencje

**Pozytywne**:
- Kazdy ZWERYFIKOWANY cytat dostaje persystowalna, re-kotwiczalna pozycje w aktach - fundament pod highlight i pod audit bundle (dowod "gdzie w dokumencie").
- Zero dodatkowego I/O i zero kosztu - lokator liczony z juz wczytanego zrodla; to czyni grounding (a nie wyszukiwanie korpusu) wlasciwym miejscem na lokatory (tam zrodlo jest w reku, w przeciwienstwie do search_corpus, gdzie wymagalby N odczytow).
- Granica audit_log zachowana - lokator do SSE/persistence, summary (liczby) do audytu.

**Negatywne / koszt**:
- Lokator powstaje tylko dla cytatow verbatim w surowym zrodle; gdy LLM podal cytat ze zmieniona interpunkcja/bialymi znakami (ZMODYFIKOWANY) - null. Swiadome (fail-closed); pelne pokrycie czeka na most do warstwy rozmytej.

**Bramki PRZED merge**: TSC `--noEmit` exit 0 (spelnione); `src/lib/citation` + `src/lib/chat` zielone 115/115 (spelnione); test lokatora dla verbatim/null w ground-citations.test.ts (spelnione); Marko 2x na ADR; CHANGELOG przy merge; private-remote przed push.
