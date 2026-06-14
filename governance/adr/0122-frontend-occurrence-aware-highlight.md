# ADR-0122: Occurrence-aware highlight cytatu we frontendzie (locator -> UI)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Przewleczenie `grounding[ref].locator` (ADR-0116/0120) z SSE `{type:"citations"}` do anotacji cytatu + wybor ktore wystapienie powtarzajacej sie frazy podswietlic. Stacked logicznie na ADR-0116/0120/0121 (branch feat/oc-locator-loose-match).

**Data**: 2026-06-14

**Powiazane zasady**: Art. 2 (tajemnica/RODO: lokator z `rawText` plynie do SSE/UI gdzie cytat juz jest, NIE do `audit_log` - granica niezmieniona), Art. 7 (fail-closed: brak/poza zakresem occurrence => pierwsze dopasowanie, highlight nigdy nie pogarsza sie wzgledem stanu sprzed ADR-0122).

**Powiazane ADR**: ADR-0116 (`CitationLocator{rawText,startHint,occurrenceHint}`), ADR-0120 (lokator przy groundingu -> emisja do SSE), ADR-0121 (whitespace-loose, podnosi trafialnosc lokatora), ADR-0005 (grounding cytatow, werdykt+badge w UI).

---

## Kontekst

Backend od ADR-0120 emituje w SSE `{type:"citations", citations, grounding}` mape `grounding[ref] -> GroundedCitation{decision, locator}`. Frontend (`useAssistantChat.ts`) konsumowal te mape, ale czytal WYLACZNIE `decision` (badge groundingu) - pole `locator` bylo **gubione**.

Istniejacy highlight cytatu w viewerze (`DocView` PDF / `DocxView` DOCX) dziala przez dopasowanie tekstu `quote` (string letters-only, `indexOf` PIERWSZEGO trafienia, segmenty dzielone wielokropkiem). Gdy cytowana fraza wystepuje w dokumencie **wielokrotnie** (termin zdefiniowany, powtarzana klauzula), zawsze podswietlane jest pierwsze wystapienie - czesto nie to, ktore agent zacytowal.

Ustalenie z mapowania: dla cytatu ZWERYFIKOWANEGO (jedyny przypadek gdy `locator != null`) `rawText` i `quote` po stripie letters-only daja IDENTYCZNY string -> sama podmiana stringu jest kosmetyczna. Realny roznicownik to `occurrenceHint` (ktore wystapienie). Stad zakres tego ADR = occurrence-aware highlight, nie podmiana tekstu zapytania.

## Decyzja

1. **Typy** (`types.ts`): nowy `PATRONCitationLocator{rawText, startHint?, occurrenceHint?}` (lustro backendowego `CitationLocator`); pole `locator?` w `PATRONCitationAnnotation`; pole `occurrence?` w `CitationQuote`. `expandCitationToEntries` na sciezce jednosegmentowej (bez page-break) dolacza `occurrence = locator.occurrenceHint`; sciezka page-break BEZ occurrence (niejednoznaczna semantyka per-segment).
2. **Wiring** (`useAssistantChat.ts`): handler `citations` przestaje gubic `locator` - dokleja go do anotacji obok `decision`.
3. **Czysta funkcja** (`quoteOccurrence.ts`): `nthOccurrenceIndex(haystack, needle, occurrence?)` - indeks n-tego NIENAKLADAJACEGO sie wystapienia; zero DOM; bezpieczny fallback (brak/poza zakresem => pierwsze; brak wystapien => -1). Dzielona przez oba highlightery.
4. **Highlightery** (`highlightQuote.ts` PDF, `highlightDocxQuote.ts` DOCX): opcjonalny `occurrence` stosowany TYLKO dla cytatu jednosegmentowego; `indexOf` zastapione `nthOccurrenceIndex`. Z `occurrence===undefined` zachowanie identyczne jak przed ADR-0122.
5. **Viewery** (`DocView`, `DocxView`): przewlekaja `occurrence` z `CitationQuote` do highlighterow; `occurrence` wlaczone do quote-key (re-highlight reaguje na zmiane).

### Granica soundness (KLUCZOWA)

`occurrenceHint` liczony jest w **surowym tekscie zrodlowym backendu**. Frontend matchuje w INNEJ ekstrakcji (pdf.js / docx-preview, letters-only). Dlatego:
- **DOCX**: jeden DOM, brak stronicowania -> wystapienie globalne w dokumencie ~ globalny occurrenceHint. Sound.
- **PDF**: highlight per-strona (`textDivs` jednej strony), a occurrenceHint globalny -> **BEST-EFFORT**. Gdy strona ma mniej wystapien niz indeks, `nthOccurrenceIndex` spada do pierwszego (bez regresji). Sound per-strona occurrence wymaga page-local offsetow (**Route B**) = rezerwacja.

Granica tajemnicy/RODO bez zmian: `locator.rawText` (= tresc cytatu) plynie do SSE i UI (gdzie cytat juz jest), NIGDY do `audit_log` (audyt dostaje `groundingSummary` - same liczby, ADR-0120).

### Zarezerwowane
1. **Persystencja lokatora** przy zapisie wiadomosci -> occurrence-aware highlight po RELOAD (dzis tylko na zywym evencie SSE; po reload graceful fallback do pierwszego dopasowania).
2. **Sound per-strona occurrence dla PDF** - wymaga Route B (page-local offsety w doc_chunks).
3. **Badge groundingu w panelu dokumentu** (decision jest juz w anotacji; render w `DocPanel` = osobny krok UI).
4. **Podmiana needla na `rawText`** - dzis kosmetyczna (letters-only ==), sens dopiero gdyby matcher zaostrzyc.

---

## Konsekwencje

**Pozytywne**: dla powtarzajacej sie frazy UI podswietla wlasciwe wystapienie (DOCX sound, PDF best-effort). Zmiana czysto addytywna, w pelni wstecznie zgodna - bez locatora zachowanie identyczne. Czysta `nthOccurrenceIndex` wspoldzielona przez oba highlightery (zero duplikacji logiki wyboru wystapienia).

**Negatywne / koszt**: PDF occurrence best-effort przez granice ekstrakcji (mitygowane clamp-to-first). Lokator nie jest persystowany -> po reload brak occurrence (fallback). Liczenie wystapien: na sciezce Z occurrence uzywamy PELNEGO segmentu (ordynalnosc zgodna z occurrenceHint backendu liczonym na pelnym rawText); 30-znakowy prefiks zostaje wylacznie dla sciezki BEZ occurrence (tolerancja, gdy cytat dluzszy niz zrodlo) - poprawka z review KROK 7 (prefiks wspoldzielony przez boilerplate liczyl wystapienia inaczej niz backend).

**Bramki PRZED merge**: frontend NIE MA runnera testow (brak vitest/jest, brak skryptu `test`) -> bramka = `tsc --noEmit` exit 0 (SPELNIONE) + `eslint` bez NOWYCH bledow (SPELNIONE: jedyny error - `scrollToHighlightOnPage accessed before declared` w `DocView.tsx` - pre-existuje na HEAD, niezwiazany z tym diffem; mapowane git stash) + `next build` (do uruchomienia przy merge; moze zglosic pre-existing eslint error). `nthOccurrenceIndex` jest czysta i testowalna - dodanie runnera frontendu = osobna decyzja infra. Marko/patron-pr-review 2x; CHANGELOG przy merge; private-remote przed push.
