# ADR-0080: Grounding cytatow w komorkach tabular review

**Status**: Wdrozony 2026-05-31. Konstytucja v1.5.0. (merge 1b6fa23 do main, push na prywatny origin)

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: weryfikacja jest deterministyczna, offline, bez wywolania LLM. Zero egress - sprawdzamy cytat wzgledem markdownu dokumentu, ktory i tak jest juz w pamieci backendu podczas ekstrakcji.
- **Art. 7 - Minimalnosc / rzetelnosc**: macierz Due Diligence, ktora pokazuje cytat bez sprawdzenia, czy ten cytat istnieje w dokumencie, jest mniej rzetelna niz ta sama macierz z jawnym sygnalem "niezweryfikowany". Koszt sygnalu: jedna ikona na komorke.

**Powiazane ADR**: ADR-0005 (silnik mechanicznej weryfikacji cytatow `lib/citation/grounding.ts` - ten ADR reuzywa jego czystego `verifyOne`, dokladajac adapter formatu inline). Inspiracja tabular: `isaacus/tabular-review` (patrz THIRD_PARTY_INSPIRATIONS.md) - mechanizm odziedziczony, grounding jest naszym rozszerzeniem.

---

## Kontekst

Tabular review (routes/tabular.ts) kaze modelowi opatrywac kazdy fakt w polu `summary`/`reasoning` komorki inline-cytatem `[[page:N||quote:doslowny fragment]]` - widac to w `formatPromptSuffix`, `EXTRACTION_SYSTEM` i systemowym promptcie `queryTabularAllColumns`. Front (citation-utils.ts) parsuje te markery i renderuje je jako klikalne pigulki cytatow.

Do tej pory NIKT nie sprawdzal, czy `quote` faktycznie wystepuje w dokumencie. Model moze zhalucynowac cytat - i macierz wyglada na ugruntowana, bo pigulka cytatu renderuje sie identycznie niezaleznie od tego, czy cytat jest prawdziwy. To uderza w rdzen produktu: caly moat Patrona to anty-halucynacja i record-keeping (AI Act art. 12). W przegladzie DD na kilkadziesiat umow prawnik nie ma jak recznie zweryfikowac kazdej komorki - dlatego sygnal musi byc maszynowy.

Wazne: PATRON i forki rodzenstwa (np. veronica-builds/emilie) dziedzicza tabular review z `willchen96/mike`. W wersjach przejrzanych 2026-05-31 zaden z nich nie weryfikuje cytatu w komorce wzgledem dokumentu - emituja go i renderuja bez sprawdzenia. To jest miejsce, gdzie nasza istniejaca warstwa groundingu (ADR-0005, dzis uzywana tylko w czacie) domyka luke bez nowej zaleznosci, bo weryfikator juz istnieje i jest przetestowany na eval harness (351 przypadkow).

Przyczyna luki jest waska: weryfikator z ADR-0005 obsluguje format bloku `<CITATIONS>` z czatu (`{ref, doc_id, page, quote}`), a komorki tabular uzywaja innego, inline'owego formatu `[[page:N||quote:...]]` i nie maja `doc_id` (zrodlem jest dokument tej komorki). Brakowalo wiec tylko adaptera formatu, nie nowego silnika.

---

## Decyzja

Podpiac mechaniczna weryfikacje cytatow do ekstrakcji tabular, reuzywajac czystego weryfikatora ADR-0005. Werdykt persystowany na komorce i pokazany jako badge.

### A. Serwerowy parser inline (`lib/tabular/grounding.ts`)

`parseInlineCitations(text)` wyciaga `[[page:N||quote:...]]` z tekstu komorki. Regex jest lustrem frontowego `PAGE_CITATION_RE` (citation-utils.ts) - akceptuje wariant z prefiksem `quote:` i bez, oraz zagniezdzone `[...]` (luki w cytacie). Deterministyczny, bez stanu wspoldzielonego (`lastIndex` resetowany).

### B. Reuzycie czystego weryfikatora (zero nowego silnika)

`groundCellText(summary, reasoning, documentText)` parsuje cytaty z `summary` + `reasoning`, mapuje kazdy na `ParsedCitation { ref, doc_id: "self", page, quote }` i wola `verifyOne` z ADR-0005 z `documentText` jako zrodlem. `documentText` to ten sam markdown, ktory ekstrakcja juz trzyma w pamieci (`queryTabularCell` / `queryTabularAllColumns`) - zero dodatkowego I/O, zero egress.

Rollup do zwiezlego werdyktu `{ total, verified, modified, unverified, status }`, gdzie `status` to najgorszy stan po wszystkich cytatach: `unverified` (jest halucynacja) > `modified` (drobne roznice interpunkcja/uciecie, prog edit-distance z ADR-0005) > `verified` (wszystkie trafione doslownie).

### C. Brak sygnalu zamiast falszywego alarmu

`groundCellText` zwraca `undefined` (komorka bez badge'a) gdy:
- komorka nie ma cytatow inline (kolumna free-text, "Not Found"), albo
- `documentText` jest pusty (np. ekstrakcja skanu/PDF zwrocila pusty markdown).

W obu wypadkach milczenie jest uczciwsze niz czerwony alarm: nie krzyczymy "halucynacja", gdy po prostu nie ma czego albo czym weryfikowac. To swiadomy wybor - patrz rezerwacja D.2.

### D. Persystencja i UI

- Werdykt dolaczany do wyniku komorki (`CellResult.grounding`) i zapisany razem z `summary`/`flag`/`reasoning` jako JSON (`tabular_cells.content`). `parseCellContent` zachowuje pole przy odczycie.
- Front (`TabularCell.tsx`): badge-tarcza obok flagi - czerwona dla `unverified`, bursztynowa dla `modified`, zielona dla `verified`, z tooltipem PL. Czyni grounding widocznym wprost w macierzy.

### E. Co pozostaje zarezerwowane (NIE w 0080)

1. **Propagacja werdyktu do audit hash-chain** (AI Act art. 12 jako trwaly slad, nie tylko stan komorki). Wymaga nowego `event_type` w `audit_log` = migracja CHECK (wzorzec ADR-0035) + wpiecie w generate/regenerate. Rezerwacja: **ADR-0082**. W 0080 werdykt zyje na komorce (queryable, widoczny), co juz jest substancja record-keepingu, ale nie jest niezmienny.
2. **Mapowanie `page:N` na realna strone PDF**. v1 weryfikuje sam tekst cytatu wzgledem calego markdownu dokumentu, nie sprawdza zgodnosci numeru strony. Numer strony pozostaje sygnalem nawigacyjnym, nie weryfikowanym.
3. **Grounding poziom 2/3 w komorce** (cytat z orzeczenia SAOS / przepisu ISAP-EUR-Lex w komorce, nie z dokumentu klienta). Poza zakresem - tabular ekstrahuje z dokumentu, resolver jest lokalny.

---

## Konsekwencje

**Pozytywne**:
- Macierz DD z anty-halucynacja: kazdy zhalucynowany cytat dostaje czerwona tarcze, zanim prawnik na nim polegnie. Bezposrednie wzmocnienie moatu (grounding + AI Act art. 12).
- Zero nowej zaleznosci i zero nowego silnika - reuzyty `verifyOne` z ADR-0005, przetestowany na eval harness. Zero egress, zero kosztu LLM (czysta arytmetyka stringow).
- Ten sam odziedziczony tabular, ale z mechaniczna weryfikacja cytatu - bez nowej zaleznosci i bez kosztu LLM.
- Obie sciezki ekstrakcji pokryte: pojedyncza (`regenerate-cell`) i wsadowa (`generate`).

**Negatywne / koszt**:
- Werdykt nie jest jeszcze niezmienny (zyje na komorce, nadpisywany przy regeneracji). Trwaly slad audytowy to rezerwacja ADR-0082.
- `modified` opiera sie na progu edit-distance z ADR-0005 - moze zaklasyfikowac realnie inny cytat jako "drobna roznica" przy bardzo krotkich frazach. Mitygacja: prog walidowany na eval harness; krotkie cytaty i tak rzadkie w tabular (model instruowany cytowac <=25 slow).
- Badge dodaje jedna ikone na komorke z cytatami - minimalny szum wizualny. Zielony stan jest celowo pokazywany (reassurance), nie tylko ostrzezenia.

**Bramki PRZED merge**:
- TSC clean (backend + frontend). Zrealizowane: oba `tsc --noEmit` EXIT 0.
- Testy zielone. Zrealizowane: `src/lib/tabular/grounding.test.ts` 10 pass (parser + rollup verified/modified/unverified/none/empty-source); pelny backend bez regresji.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
