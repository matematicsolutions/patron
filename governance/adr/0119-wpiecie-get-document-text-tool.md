# ADR-0119: Wpiecie narzedzia agenta `get_document_text` (stronicowany odczyt)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Realizuje rezerwacje D.1 z ADR-0117 (wpiecie bounded read jako narzedzie). Pierwszy NIE-pure krok adopcji OC->PATRON - dotyka zywej powierzchni narzedzi agenta.

**Data**: 2026-06-14

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc**: narzedzie czyta lokalny dokument przez istniejaca sciezke `readDocumentContent`. Zero nowego egressu.
- **Art. 3 - Audytowalnosc**: deterministyczne okno; brak nowej operacji decyzyjnej (read, nie decyzja) - spojnie z `read_document`, ktory tez nie pisze audit_log.
- **Art. 7 - Minimalnosc**: agent czyta duze akta oknami zamiast zrzutu calosci.

**Powiazane ADR**: ADR-0117 (rdzen `boundedDocumentText`), ADR-0116 (offsety okna = zywnosc dla lokatora), ADR-0019/0020 (input-security guard - REUZYWANY przez `readDocumentContent`, nie omijany).

---

## Kontekst

ADR-0117 dostarczyl czysty rdzen stronicowania i zarezerwowal wpiecie jako narzedzie. `read_document` zrzuca caly tekst - dla akt na setki stron to zalanie kontekstu i koszt.

## Decyzja

Dodac narzedzie agenta `get_document_text(doc_id, char_offset?, max_chars?)` jako **additive** rozszerzenie powierzchni:
- **`tools.ts`**: schema obok `read_document`/`find_in_document` (ta sama tablica `TOOLS`, wiec dostepne wszedzie tam gdzie `read_document`).
- **`tool-dispatch.ts`**: nowy branch w `runToolCalls`, ktory:
  1. rozwiazuje `doc_id` przez `resolveDocLabel` (jak `read_document`),
  2. czyta pelny tekst przez `readDocumentContent` - **ta sama sciezka**: wersja tracked-changes, ekstrakcja PDF/DOCX, **guard input-security `analyzeInput`/`isHardThreat`**,
  3. przy sentinelu bledu (`isReadFailureSentinel`) zwraca komunikat bez okienkowania (nie udaje okna),
  4. inaczej tnie `boundedDocumentText` i zwraca JSON `{doc_id, filename, char_offset, max_chars, total_chars, next_offset, truncated, note: citationReminder, text}`.

Scoping: dostep wylacznie przez `docStore.get(docId)` - ta sama lista dozwolonych dokumentow sesji co `read_document` (desktop single-user, ADR-0053; brak org scoping w retrieval). Brak nowej powierzchni cross-tenant. `citationReminder` zachowany - dyscyplina cytatu jak w `read_document`.

### Co pozostaje zarezerwowane

1. Upgrade `search_corpus` do typed feed (ADR-0118) - osobny slice (zmienia istniejacy output, wyzsze ryzyko).
2. Wpiecie lokatora (0116) do SSE `{type:"citations"}`/grounding - osobny ADR.

---

## Konsekwencje

**Pozytywne**:
- Agent czyta duze akta oknami (mniejszy koszt/kontekst) bez nowej powierzchni bezpieczenstwa - pelny reuse sciezki `read_document` (guard, wersjonowanie, scoping przez docStore).
- `next_offset`/`truncated` w odpowiedzi - jawna kontynuacja, zero ciche uciecie.
- Offsety okna spojne z lokatorem 0116 (read->cite).

**Negatywne / koszt**:
- Branche `runToolCalls` nie maja w repo testow jednostkowych (jak `read_document`/`find_in_document`); pokrycie = czysty rdzen 0117 (13/13) + brak regresji w `src/lib/chat` (70/70) + tsc clean. Integracyjny test dispatcha = rezerwacja (brak harnessu).
- Domyslne limity (50k/200k) z 0117 do strojenia na korpusie PL.

**Bramki PRZED merge**: TSC `--noEmit` exit 0 (spelnione); `src/lib/chat` zielone 70/70 (spelnione); Marko 2x na ADR; CHANGELOG przy merge; bramka private-remote przed push (push=zgoda Operatora).
