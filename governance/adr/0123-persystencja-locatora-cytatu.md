# ADR-0123: Persystencja lokatora cytatu (occurrence-highlight po reload)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. `extractAnnotations` (persistence.ts) persystuje `locator` z werdyktu groundingu do `citation_data`. Domyka ADR-0122 (occurrence-aware highlight dzialal dotad tylko na zywym evencie SSE). Stacked na ADR-0116/0120/0121/0122 (branch feat/oc-locator-loose-match).

**Data**: 2026-06-14

**Powiazane zasady**: Art. 2 (tajemnica/RODO: `rawText` laduje obok `quote` w `chat_messages.annotations` - ta sama kategoria danych, juz persystowana; NIE do `audit_log`), Art. 7 (fail-closed: brak lokatora w werdykcie => brak pola, backward-compat).

**Powiazane ADR**: ADR-0116 (`CitationLocator`), ADR-0120 (lokator do SSE + persystencji - "gdzie cytaty juz sa"), ADR-0122 (occurrence-aware highlight konsumujacy lokator), ADR-0005 (grounding, persystencja `grounding`/`grounding_status`).

---

## Kontekst

ADR-0122 wprowadzil occurrence-aware highlight: frontend uzywa `locator.occurrenceHint`, by podswietlic wlasciwe wystapienie powtarzajacej sie frazy. Ale lokator plynal TYLKO w zywym evencie SSE `{type:"citations"}`. Po reload czatu `extractAnnotations` (persistence.ts) odtwarzal `citation_data` z `grounding`/`grounding_status`, lecz BEZ `locator` -> occurrence-highlight degradowal do pierwszego dopasowania.

Lokator jest dostepny w miejscu zapisu: `chat.ts:602` / `projectChat.ts` przekazuja do `extractAnnotations` mape z `groundCitationsByRef` = `Record<number, GroundedCitation>` (`GroundingResult` + `locator`). Brakowalo tylko persystencji pola.

## Decyzja

W `extractAnnotations`:
- poszerzyc typ parametru `grounding` o opcjonalny `locator` (`GroundingResult & { locator?: CitationLocator | null }`) - zgodny z faktycznie przekazywana mapa,
- gdy `verdict.locator` obecny, doleczyc `locator` do `citation_data` obok `grounding`/`grounding_status`.

Frontend BEZ zmian: loader `patronApi.ts` rzutuje zapisane annotations pass-through `as PATRONCitationAnnotation[]` (brak whitelisty pol) -> `locator` przechodzi sam; `expandCitationToEntries` (ADR-0122) czyta `a.locator?.occurrenceHint` identycznie jak na zywym evencie.

**Bez migracji**: `chat_messages.annotations` to blob JSON - nowe pole nie wymaga zmiany schematu (omija Route B, swiadomie odlozony).

### Granica governance (KLUCZOWA)

`locator.rawText` (= tresc cytatu) laduje w `chat_messages.annotations` OBOK `quote`, ktore jest tam persystowane od poczatku - zero NOWEJ kategorii danych. To wprost dozwolone w ADR-0120 ("locator -> persystencji wiadomosci, gdzie cytaty juz sa"). Audyt (`appendLlmRouteEvent`) niezmieniony - dostaje `groundingSummary` (liczby), NIE lokator/rawText.

### Zarezerwowane
1. Sound PDF per-strona occurrence (Route B - page-local offsety).
2. Migracja/normalizacja istniejacych zapisanych annotations (brak - stare czaty po prostu nie maja lokatora, graceful fallback do pierwszego dopasowania).

---

## Konsekwencje

**Pozytywne**: occurrence-aware highlight przezywa reload czatu - lokator trwaly tak jak werdykt groundingu. Zmiana minimalna (kilka linii w jednym module), w pelni testowalna (vitest), zero zmian frontendu, zero migracji. Symetria z zywa sciezka SSE.

**Negatywne / koszt**: nieznaczny wzrost rozmiaru zapisanych annotations (lokator zawiera `rawText` ~ powiela `quote`); akceptowalne (offline SQLite, ta sama kategoria danych). Stare czaty bez lokatora - fallback do pierwszego dopasowania (bez regresji).

**Bramki PRZED merge**: TSC `--noEmit` exit 0 (SPELNIONE); vitest `src/lib/chat` + `src/lib/citation` 123/123 (SPELNIONE, +2 testy: persystuje locator gdy obecny, brak pola gdy werdykt bez lokatora / brak mapy grounding); patron-pr-review (ponizej); CHANGELOG przy merge; private-remote przed push.
