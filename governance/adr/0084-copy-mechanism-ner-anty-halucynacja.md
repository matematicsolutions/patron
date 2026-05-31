# ADR-0084: Copy-mechanism generative NER (anty-halucynacja wartosci)

**Status**: Wdrozony 2026-05-31 (biblioteka). Konstytucja v1.5.0. Moduly copySpan gotowe, eksportowane, przetestowane; wpiecie w tabular/chat = rezerwacja.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: warstwa jest deterministyczna, offline, bez wywolania LLM. Pracuje na tekscie, ktory backend i tak juz trzyma w pamieci podczas ekstrakcji. Zero egress.
- **Art. 3 - Audytowalnosc**: emisja jest reprodukowalna. Ten sam tekst daje zawsze te same spany z tymi samymi offsetami, bo nie ma temperatury ani seeda. Audyt ekstrakcji jest odtwarzalny (zgodnie z duchem ADR-0008).
- **Art. 7 - Minimalnosc / rzetelnosc**: kazda wyemitowana wartosc liczbowa albo data jest doslownym fragmentem zrodla. Nie generujemy nowych znakow, wiec nie ma czego halucynowac. Wartosc, ktora nie wystepuje w zrodle verbatim, jest odrzucana, a nie poprawiana.

**Powiazane ADR**:
- ADR-0008 (entity extraction przy zapisie, zero wywolan LLM) - ten ADR doklada kolejny modul deterministyczny do biblioteki `pl-entities`, obok `regex.ts`. Reuzywa typu `ExtractedEntity` jako wspolnego kontraktu.
- ADR-0005 (mechaniczna weryfikacja cytatow) - copy-span jest tym samym duchem (wartosc musi byc zakotwiczona w zrodle), tyle ze dla wartosci liczbowych i dat, nie dla cytatow w cudzyslowie.
- ADR-0080 (grounding cytatow w komorkach tabular review) - tam weryfikujemy cytat tekstowy w komorce. Copy-span domyka analogiczna luke dla wartosci liczbowej w komorce: kwota albo data w macierzy DD jest doslownym spanem dokumentu, a nie liczba przepisana z pamieci modelu.

Inspiracja: PMC11622873 (artykul OSS o generatywnym NER z dekoderem ograniczonym do spanow zrodla, mechanizm copy/pointer). Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy wzorzec gwarancji (dekoder moze tylko kopiowac z zrodla), nie kod ani model. Reimplementacja deterministyczna, bez sieci neuronowej.

---

## Kontekst

Generatywny NER (model dekodujacy encje jako tekst) ma znana wade: dekoder moze wygenerowac znaki, ktorych nie ma w zrodle. Dla domeny prawnej to nie jest niedogodnosc kosmetyczna. Jezeli model wyekstrahuje kwote "1 234,56 zl", a w dokumencie stoi "1 254,56 zl", macierz Due Diligence pokazuje liczbe, ktorej nie ma w umowie. Prawnik, ktory na niej polegnie, podejmuje decyzje na halucynacji.

PMC11622873 rozwiazuje to architektonicznie: dekoder jest ograniczony do kopiowania spanow zrodla (copy/pointer mechanism). Model nie generuje nowych znakow, tylko wskazuje fragment wejscia. Z definicji nie ma halucynacji wartosci, bo nie ma generacji znakow spoza zrodla.

Patron nie ma generatywnego NER w runtime (Art. 1 lokalnosc, Art. 7 minimalnosc, ADR-0008 zero-LLM przy zapisie). Ale ten sam wzorzec gwarancji jest cenny niezaleznie od tego, skad wartosc pochodzi. Mamy dwa zrodla wartosci liczbowych w systemie, ktore moga sie rozjechac ze zrodlem:

1. Heurystyki regex (ADR-0008) - same w sobie zwracaja offsety, ale nic nie wymusza, ze offsety wskazuja doslownie na to, co przekazujemy dalej. Inwariant jest zalozeniem, nie kontraktem testowalnym.
2. Wartosci pochodzace z LLM (tabular review ADR-0080, czat) - tu model moze przepisac liczbe z bledem. ADR-0080 weryfikuje cytat tekstowy, ale nie wartosci liczbowe wpisane w pole `summary` bez markera cytatu.

Brakuje warstwy, ktora dla wartosci liczbowej albo daty da twardy, testowalny kontrakt: `sourceText.slice(start, end) === value`. To jest istota copy-mechanism przeniesiona do deterministycznego TypeScript.

---

## Decyzja

Dodac modul `backend/src/lib/pl-entities/copySpan.ts` (obok `regex.ts`), ktory realizuje dwie czesci wzorca copy-mechanism deterministycznie, zero-LLM, offline.

### A. Guard `constrainToSource` (warstwa gwarancji)

`constrainToSource(value, sourceText, options?)` zwraca offsety tylko wtedy, gdy `value` wystepuje doslownie w `sourceText`. W przeciwnym razie zwraca `null` (odrzucenie). To jest brama dla kazdej wartosci, ktorej pochodzenie jest niepewne (output LLM, luzna heurystyka, recznie wpisane pole).

- Pusta wartosc albo puste zrodlo to `null` (nie ma czego kotwiczyc).
- Opcja `from` pozwala szukac od wskazanego offsetu (kotwiczenie kolejnych wystapien tej samej wartosci po kolei).
- Opcja `occurrence: "last"` kotwiczy ostatnie wystapienie.
- Funkcja pomocnicza `constrainAllToSource(value, sourceText)` zwraca wszystkie nienakladajace sie wystapienia (gdy ta sama wartosc pada w dokumencie wielokrotnie).

Kontrakt: jezeli funkcja zwraca `{ start, end }`, to `sourceText.slice(start, end) === value`. Brak fabrykacji, brak normalizacji niszczacej doslownosc.

### B. Ekstraktor copy-span dla wartosci liczbowych i dat

`extractCopySpans(sourceText)` emituje wylacznie doslowne spany jako `ExtractedEntity[]`, z dokladnymi `sourceOffsetStart`/`sourceOffsetEnd`. Pokrywa:

- **Kwoty polskie**: separator tysiecy spacja albo spacja niełamliwa, przecinek dziesietny, jednostka waluty wymagana (`zl`, `zlotych`, `zł`, `złotych`, `PLN`, `EUR`, `USD`, `GBP`, `CHF`, symbole). Jednostka waluty jest obowiazkowa, bo bez niej goly ciag cyfr jest nieodroznialny od numeru, fragmentu PESEL albo numeru strony. Przyklady: `1 234,56 zl`, `12.000,00 PLN`, `500 zl`, `1 000 000,00 zlotych`.
- **Daty polskie**: format ISO `2024-03-12`, format kropkowy `12.03.2024`, format slowny `12 marca 2024 r.` (sufiks `r.` opcjonalny, miesiac w dopelniaczu z zamknietej listy 12 nazw, oba warianty pisowni: z diakrytykiem i bez, bo korpus po OCR bywa zdiakrytyzowany niespojnie). Przyklady: `2024-03-12`, `12.03.2024`, `12 marca 2024 r.`, `5 września 2023 r.`, `1 stycznia 2020`.

Kazdy emitowany byt ma `type` (`KWOTA` albo `DATA`), `value` rowny doslownemu fragmentowi, `valueNormalized` (kanoniczna forma do deduplikacji w grafie, np. data w ISO, kwota bez separatorow tysiecy), `confidence`, `ruleId` i metadane (waluta, format daty). Offsety pochodza bezposrednio z dopasowania, a `value` jest pobierany przez `sourceText.slice`, wiec inwariant jest spelniony z konstrukcji, nie z asercji.

Normalizacja daty slownej do ISO uzywa dopasowania nazwy miesiaca klasa `\p{L}` z flaga `u` (Unicode property escape), zeby objac polskie diakrytyki. Klasa `[A-Za-z-...]` nie obejmuje `ś`/`ź`, wiec daty wrzesniowe i pazdziernikowe (`września`, `października`) emitowalyby sie bez normalizacji do ISO, co lamie cel deduplikacji. Uzycie `\p{L}` zamyka te luke.

### C. Rozstrzyganie nakladania

Reguly moga zlapac ten sam fragment dwoma wzorcami (np. data kropkowa kontra inny wzorzec). Emitujemy posortowane po pozycji, a przy nakladaniu wybieramy dluzsze dopasowanie (wieksza specyficznosc). Spany nienakladajace sie zostaja wszystkie. To jest deterministyczne i nie wymaga stanu wspoldzielonego (regex z flaga `g` re-tworzony per wywolanie, jak w `detectAll`).

### D. Nowe typy encji w ontologii

`EntityType` w `types.ts` dostaje dwa nowe warianty: `KWOTA` i `DATA`. Spojne z istniejaca ontologia legal PL (sygnatury, identyfikatory, daty publikacji). `DATA_PUBLIKACJI` zostaje osobnym typem (data publikacji aktu albo orzeczenia, semantyka inna niz dowolna data w tresci). `DATA` to dowolna data w dokumencie kotwiczona copy-span.

### E. Co pozostaje zarezerwowane (nie w 0084)

1. **Wpiecie copy-span w pole `summary` komorek tabular** (weryfikacja wartosci liczbowej wpisanej przez LLM bez markera cytatu). To rozszerzenie ADR-0080 o wartosci, osobny ADR. W 0084 dostarczamy sam silnik i guard.
2. **Parsowanie semantyczne wartosci** (np. konwersja kwoty na liczbe z walidacja zakresu, rozpoznanie 29 lutego jako niepoprawnej daty w roku nieprzestepnym). v1 kotwiczy doslownie i normalizuje syntaktycznie, nie waliduje semantyki kalendarza. Walidacja kalendarzowa to rezerwacja.
3. **Inne waluty i formaty regionalne** (kropka jako separator dziesietny w stylu anglosaskim) - poza zakresem, Patron celuje w polski format.

---

## Konsekwencje

**Pozytywne**:
- Twardy, testowalny inwariant `sourceText.slice(start, end) === value` dla kazdej emitowanej wartosci. Anty-halucynacja wartosci liczbowych i dat na poziomie kontraktu, nie deklaracji.
- Guard `constrainToSource` jest reuzywalny dla dowolnej wartosci niepewnego pochodzenia (output LLM, heurystyka), nie tylko dla wlasnego ekstraktora. Domyka luke wartosci liczbowych obok grounding cytatow z ADR-0005/0080.
- Normalizacja dat slownych do ISO obejmuje diakrytyki (`\p{L}/u`), wiec `12 marca 2024`, `5 września 2023` i `3 października 2022` deduplikuja sie ze swoimi ISO-bliznakami. To jest dokladnie ta pisownia, ktora produkuje OCR korpusu PL.
- Zero nowej zaleznosci npm, czysty TypeScript + Node 20 stdlib. Zero egress, zero kosztu LLM, deterministyczne (Art. 1, Art. 3).
- Reuzywa wspolnego kontraktu `ExtractedEntity`, wiec graf cytowan i audit bundle dostaja kwoty i daty tym samym kanalem co reszta encji (ADR-0008).

**Negatywne / koszt**:
- Wymog jednostki waluty przy kwotach obniza recall: goly `1 234,56` bez `zl`/`PLN` nie jest lapany. Swiadomy wybor (precyzja przed recall), bez jednostki ryzyko false-positive na numerach jest wysokie. Recall do walidacji benchmarkiem na korpusie pilotazowym.
- v1 nie waliduje semantyki kalendarza (np. `32.13.2024` pasuje syntaktycznie do wzorca kropkowego). Mitygacja: wzorzec ogranicza zakresy dzien 01-31, miesiac 01-12, ale nie sprawdza dni w miesiacu. Pelna walidacja to rezerwacja E.2.
- Dwa nowe typy encji rozszerzaja `EntityType`. Konsumenci robiacy exhaustive switch po typie (jezeli istnieja) dostana nowe warianty do obsluzenia. Do potwierdzenia grepem przy merge, ze nie ma zlamanego exhaustive matchu.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` exit 0.
- Testy zielone: `src/lib/pl-entities/copySpan.test.ts` (inwariant verbatim-span dla kazdego emitowanego bytu, kwoty z separatorami w tym milion z golym ASCII `zlotych`, trzy formaty dat, daty slowne z diakrytykiem `września`/`października`, odrzucenie wartosci spoza zrodla, kotwiczenie wielokrotnych wystapien, rozstrzyganie nakladania) plus pelny backend bez regresji.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
