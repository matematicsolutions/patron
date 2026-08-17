# ADR-0116: Trwaly lokator cytatu (re-anchoring rawText + hint)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Modul `locator.ts` gotowy, eksportowany, przetestowany; wpiecie w persystencje cytatow / render highlightu = rezerwacja (osobny ADR).

**Data**: 2026-06-14

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: re-kotwiczenie jest deterministyczne, offline, zero-LLM. Pracuje na tekscie, ktory backend juz trzyma. Zero egress.
- **Art. 3 - Audytowalnosc**: re-anchoring jest reprodukowalny. Ten sam `(rawText, hint)` na tym samym zrodle daje zawsze ten sam span i ten sam wybor wystapienia. Brak temperatury, brak seeda.
- **Art. 7 - Minimalnosc / rzetelnosc**: lokator jest doslownym fragmentem zrodla. `rawText` nie znaleziony verbatim => `null` (fail-closed), nigdy zgadywanie pozycji. Cytat, ktorego nie da sie zakotwiczyc, nie jest renderowany ani zapisywany jako zweryfikowany.

**Powiazane ADR**:
- ADR-0005 (mechaniczna weryfikacja cytatow) - 0005 odpowiada na pytanie *czy cytat istnieje / czy tresc sie zgadza* (gradient ISTNIENIE/TRESC) na tekscie **znormalizowanym**, zwracajac jeden ulotny `offset` pierwszego segmentu. 0116 odpowiada na pytanie *gdzie DOKLADNIE w surowym dokumencie jest TEN cytat, gdy dokument przeparsowano* (tier FRAGMENT) - offsety w tekscie **surowym**, gotowe do `slice`/highlightu. To dwie warstwy tego samego gradientu, nie duplikat.
- ADR-0084 (copy-mechanism NER) - 0116 buduje wprost na `constrainAllToSource` z `pl-entities/copySpan.ts`. Dziedziczy jego niezmiennik (`sourceText.slice(start,end) === rawText`) i dodaje brakujacy element: **wybor wystapienia** gdy `rawText` pada w dokumencie wielokrotnie.
- ADR-0008 (entity extraction) - lokator uzywa tej samej semantyki offsetow UTF-16 co `ExtractedEntity` i `SourceSpan`.

Inspiracja: Open-Source-Legal/OpenContracts (MIT), funkcja `_anchor_text` (`utils/annotation_anchoring.py`) - produkcyjny wzorzec "rawText = zrodlo prawdy, offset = samonaprawiajacy hint". Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy WZORZEC (algorytm re-kotwiczenia), nie kod (Python/Django).

---

## Kontekst

Cytat w Patronie to dzis para `(doc_id, quote)` (`ParsedCitation`). ADR-0005 weryfikuje go mechanicznie i zwraca `offset` w **znormalizowanym** zrodle. Ten offset jest ulotny i nie sluzy do renderowania: normalizacja (lowercase, zwiniecie bialych znakow, ujednolicenie cudzyslowow/myslnikow, usuniecie dzielenia wyrazow) zmienia dlugosc tekstu, wiec offset w znormalizowanym tekscie NIE wskazuje pozycji w surowym dokumencie. Do podswietlenia fragmentu w wyswietlanym PDF/DOCX potrzebny jest offset w tekscie surowym.

Druga luka jest powazniejsza dla trwalosci. Cytat zapisany w bazie (audit bundle, komentarz, edycja) musi przetrwac **przeparsowanie dokumentu** - inny parser, ponowny OCR, zmiana wersji z tracked-changes. Po reparse pozycje znakowe sie przesuwaja. Jedyne, co jest stabilne, to sam `rawText`. Ale gdy `rawText` wystepuje w dokumencie wielokrotnie (typowe: powtarzajaca sie klauzula, nazwa strony, ten sam zwrot), samo `indexOf` (pierwsze wystapienie) zakotwiczy NIE TEN fragment, ktory cytat oryginalnie wskazywal.

`copySpan.ts` (ADR-0084) ma `constrainToSource` (pierwsze/ostatnie/od-offsetu) i `constrainAllToSource` (wszystkie wystapienia), ale nie ma logiki *wybierz wystapienie najblizsze ostatnio znanej pozycji*. To jest dokladnie element, ktory w OpenContracts realizuje `_anchor_text`: znajdz wszystkie wystapienia `rawText`, wybierz to najblizsze zapamietanemu offsetowi (hint). Dzieki temu zapisany cytat samonaprawia sie po reparse - offset jest tylko wskazowka, `rawText` jest kanonem.

---

## Decyzja

Dodac modul `backend/src/lib/citation/locator.ts` (obok `grounding.ts`), deterministyczny, zero-LLM, offline, budujacy na `constrainAllToSource` z `pl-entities`.

### A. Typ trwalego lokatora

```ts
interface CitationLocator {
  rawText: string;          // ZRODLO PRAWDY - doslowny cytowany fragment
  startHint?: number;       // ostatni znany offset (samonaprawiajacy hint)
  occurrenceHint?: number;  // alternatywa: indeks wystapienia 0-based
}
```

`rawText` jest jedynym polem wymaganym i jedynym kanonem. `startHint` i `occurrenceHint` to wskazowki do rozstrzygania wieloznacznosci - wolno je zgubic bez utraty mozliwosci zakotwiczenia (degradacja do pierwszego wystapienia).

### B. Re-kotwiczenie `reanchor(loc, sourceText)`

Zwraca `ResolvedAnchor { start, end, occurrence, total, ambiguous }` albo `null`:
1. Zbierz wszystkie nienakladajace sie wystapienia `rawText` (`constrainAllToSource`).
2. Brak wystapien => `null` (FAIL-CLOSED, Art. 7).
3. `occurrenceHint` w zakresie => wybierz to wystapienie.
4. inaczej `startHint` podany => wybierz wystapienie o najmniejszym `|start - startHint|` (remis: wczesniejsze, deterministycznie).
5. inaczej => pierwsze wystapienie.

Niezmiennik dziedziczony po `constrainAllToSource`: `sourceText.slice(start, end) === rawText` dla wyniku != null. `ambiguous = total > 1` jest sygnalem dla UI/audytu (cytat wieloznaczny - prawnik moze chciec potwierdzic, ktory fragment).

### C. Budowa lokatora `locatorFor(sourceText, span)`

Z biezacego spanu `{start,end}` buduje trwaly `CitationLocator` do zapisu: `rawText = slice`, `startHint = start`, `occurrenceHint =` indeks tego spanu wsrod wystapien. Domyka round-trip: to, co zapisujemy, zakotwiczy sie z powrotem na tym samym fragmencie.

### D. Co pozostaje zarezerwowane (nie w 0116)

1. **Persystencja lokatora w schemacie** (kolumny/tabela dla zapisanych cytatow z lokatorem) - osobny ADR, dotyka migracji SQLite.
2. **Re-anchoring rozmyty** - gdy `rawText` zmienil sie minimalnie po reparse (inny OCR). 0116 kotwiczy doslownie; rozmyte dopasowanie nalezy do warstwy 0005 (gradient TRESC). Most 0116<->0005 = rezerwacja.
3. **Lokator dla PDF token/bbox** - 0116 jest dla strumienia tekstowego (DOCX/TXT/PDF-text). Kotwiczenie geometryczne (bounding box strony) to osobny model (wzorzec PAWLS), osobny ADR.

---

## Konsekwencje

**Pozytywne**:
- Zapisany cytat przezywa przeparsowanie dokumentu: `rawText` jest kanonem, offset tylko hintem. To jest warunek wiarygodnosci audit bundle (AI Act art. 12) - cytat w archiwum musi dac sie odtworzyc po latach, mimo zmiany pipeline'u parsowania.
- Wybor wystapienia najblizszego hintowi rozwiazuje problem powtarzajacego sie `rawText`, ktorego `indexOf` nie obsluguje. Sygnal `ambiguous` daje UI podstawe do potwierdzenia przez prawnika (human-in-the-loop).
- Offsety w tekscie surowym sa gotowe do renderowania highlightu (czego offset z 0005 w tekscie znormalizowanym nie zapewnia).
- Zero nowej zaleznosci npm. Buduje na istniejacym `constrainAllToSource` - nie forkuje, nie duplikuje pl-entities (twarda regula AGENTS.md). Czysty TypeScript strict, deterministyczny (Art. 1, Art. 3).

**Negatywne / koszt**:
- 0116 kotwiczy DOSLOWNIE. Jezeli `rawText` po reparse rozni sie choc jednym znakiem (inny OCR), `reanchor` zwroci `null`. Mitygacja swiadoma: fail-closed jest poprawnym zachowaniem (Art. 7) - rozmyte dopasowanie nalezy do 0005, nie do warstwy kotwiczacej. Most = rezerwacja D.2.
- `startHint` po duzej edycji przed cytatem (wstawienie akapitu) moze wskazac sasiednie wystapienie. `occurrenceHint` jest odporniejszy na lokalne edycje za cytatem, ale wrazliwy na zmiane liczby wystapien przed nim. Zadna pojedyncza wskazowka nie jest doskonala - dlatego `rawText` jest kanonem, a `ambiguous` sygnalizuje ryzyko.
- Offsety UTF-16 (spojnie z copySpan/ExtractedEntity). Tekst z parami surogatow (rzadkie w korpusie prawnym PL) liczony w jednostkach UTF-16, nie codepointach - swiadomy, spojny z reszta biblioteki.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` exit 0.
- Testy zielone: `src/lib/citation/locator.test.ts` (niezmiennik verbatim dla wyniku != null; fail-closed na braku rawText; wybor po startHint; wybor po occurrenceHint; remis -> wczesniejsze; degradacja do pierwszego bez hintu; round-trip locatorFor -> reanchor na tym samym spanie; rawText wieloznaczny ustawia ambiguous) plus pelny backend bez regresji.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push (push = decyzja Operatora).
