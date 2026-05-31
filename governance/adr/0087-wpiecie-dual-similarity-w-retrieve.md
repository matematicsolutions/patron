# ADR-0087: Wpiecie dual-similarity w retrieve() (request-path)

**Status**: Wdrozony 2026-05-31 (Faza B, wpiecie). Konstytucja v1.5.0. Domyka rezerwacje ADR-0086 - biblioteka dual-similarity wchodzi w sciezke produkcyjna retrievalu jako etap re-rankingu po RRF, sterowana flaga i alpha z env, z liczbami z ewaluacji rankingowej.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: re-ranking pracuje na danych grafu juz trzymanych lokalnie (citation_graph, extracted_entities). Zero wywolan LLM, zero egress, czysta arytmetyka zbiorow w obrebie jednego zapytania.
- **Art. 3 - Audytowalnosc / determinizm**: te same wejscie (kandydaci RRF + profil referencyjny + alpha) daje ten sam ranking. Brak zegara, brak losowosci, stabilny tie-break dziedziczony z ADR-0086. Kolejnosc cytowanych spraw odtwarzalna w audycie.
- **Art. 7 - Minimalnosc / rzetelnosc**: zero nowej zaleznosci npm. Wpiecie dodaje jeden etap re-rankingu i jeden cienki odczyt profilu per dokument kandydata (z cache w obrebie retrieve). Decyzja o wpieciu poparta pomiarem (nizej), nie heurystyka.

**Powiazane ADR**:
- ADR-0086 (dual-similarity case ranking, biblioteka): ten ADR domyka jego rezerwacje "wpiecie w retrieve()". Reuzywa eksportowanych funkcji czystych (dualSimilarityRank, unionProfiles) i helpera DB (loadStructuralProfile) bez zmiany ich kontraktu.
- ADR-0007 / ADR-0054 (hybrid retrieval RRF nad wektor + BM25 + graf): re-ranking jest etapem po fuzji RRF, nie czwarta lista do RRF. Nie zmienia samej fuzji ani silnikow.
- ADR-0008 (entity extraction + citation_graph, zero LLM): zrodlo profilu strukturalnego.
- ADR-0083/0084/0085 (Faza A), ADR-0086 (Faza B biblioteka): rodzenstwo z tego samego zwiadu CN.

Inspiracja: Ping An US12001466B2 (rodzina CN+US, brak czlonu EP wg zwiadu IP 2026-05-31, wzorzec wolny do stosowania w EU). Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy wzorzec (re-ranking laczacy podobienstwo tresci z podobienstwem strukturalnym grafu sprawy), nie kod ani model.

---

## Kontekst

ADR-0086 dostarczyl deterministyczny silnik dual-similarity jako biblioteke i celowo odlozyl wpiecie w request-path: bez pomiaru re-ranking moze pogorszyc trafnosc, a wybor profilu referencyjnego i alpha nie byly rozstrzygniete. Ten ADR rozstrzyga je liczbami z ewaluacji rankingowej i wpina silnik w retrieve().

Trzy decyzje wymagaly pomiaru: (a) jak budowac profil referencyjny (sprawa-kotwica top-1 czy agregat top-N), (b) gdzie wpiac re-ranking, (c) jaka alpha jako domyslna.

### Ewaluacja rankingowa (przed wpieciem)

Harness `backend/src/lib/retrieval/dualSimilarity.eval.test.ts` (offline, PATRON_DISABLE_VEC=1, BM25 + graf + RRF, zero LLM, deterministyczny). Korpus odtwarza warunek, ktory feature celuje: zapytanie opisuje sytuacje naturalnym jezykiem bez sygnatury; sprawa analogiczna dzieli z kotwica wzorzec cytowan (ten sam precedens + przepis), ale opisuje rzecz innym slownictwem, wiec ma nizszy wynik leksykalny niz tematyczny dystraktor powtarzajacy slowa zapytania, lecz cytujacy inny precedens. Gold = analogia strukturalna. Metryka: sredni nDCG@5 i recall@5 po dwoch zapytaniach (zachowek, rekojmia), sweep alpha w {0.0, 0.3, 0.6, 0.8, 1.0} x referenceTopN w {1, 3}.

Wyniki (te liczby sa strzezone przez asercje w harnessie):

| Konfiguracja | nDCG@5 | recall@5 |
|---|---|---|
| baseline (czysta tresc, RRF) | 0.6611 | 0.6667 |
| dual topN=1, alpha=0.0 / 0.3 / 0.6 | 0.7346 | 0.6667 |
| dual topN=1, alpha=0.8 | 0.6774 | 0.6667 |
| dual topN=1, alpha=1.0 | 0.6611 | 0.6667 |
| dual topN=3, kazda alpha | 0.6611 | 0.6667 |

Odczyt:
- Najlepszy wynik (nDCG@5 0.7346, wzrost o 11.1 procent wzgledem baseline 0.6611) daje profil referencyjny z top-1 (sprawa-kotwica). Agregat top-3 (union profili) nie poprawia nic (0.6611 = baseline), bo trojka czolowych dopasowan tresci zawiera tematyczny dystraktor, ktorego encje rozcienczaja referencje i kasuja separacje. Stad referenceTopN = 1.
- alpha = 0.6 trafia w szczyt (0.7346), zachowujac 60 procent wagi tresci. alpha = 0.0 osiaga ten sam szczyt, ale wyrzuca tresc calkowicie, co jest ryzykowne poza tym korpusem; alpha = 0.8 slabnie (0.6774); alpha = 1.0 odtwarza baseline. Domyslna alpha = 0.6 jest najlepszym punktem bez porzucania sygnalu tresci.
- recall@5 nie zmienia sie (0.6667). Re-ranking poprawia kolejnosc kandydatow, ktorych retrieval wylowil, ale nie odzyskuje dokumentu, ktorego BM25 w ogole nie pobral jako kandydata (sprawa analogiczna o malym pokryciu leksykalnym bywa poza pula kandydatow). To uczciwe ograniczenie: dual-similarity dziala na puli kandydatow retrievalu, nie zastepuje jej rozszerzenia. Zysk jest w trafnosci kolejnosci (nDCG), nie w pokryciu.

### Roznicowanie FTO (recheck przy wpieciu w request-path)

- Thomson Reuters WO2025085566A1 (potwierdzony 2026-05-31, Google Patents): "Retrieval-augmented content generation for legal research", zgloszenie 2024-10-16, publikacja 2025-04-24. To generatywny pipeline RAG (kryteria wyszukiwania z GUI jako prompt do LLM, generacja tresci). Ten ADR to deterministyczne re-rankowanie kandydatow retrievalu po podobienstwie zbiorow encji, bez generacji i bez LLM. Roznica utrzymana.
- Baidu EP4086808A3: contract knowledge-graph consistency check (pending EP wg zwiadu IP). Dotyczy sprawdzania spojnosci umow po grafie, nie re-rankingu wynikow wyszukiwania. Recheck przez ogolny web (US-only) nie indeksuje Espacenet i nie wykazal zmiany; roznicowanie jest domenowe (inny problem), wiec ewentualna zmiana statusu nie rusza pozycji FTO.

---

## Decyzja

Wpiac dual-similarity w `retrieve()` jako etap re-rankingu po fuzji RRF, sterowany flaga opt-out i alpha z env, ze scisla degradacja do kolejnosci tresci gdy brak sygnalu.

### A. Profil referencyjny: sprawa-kotwica (top-1)

Referencja to profil strukturalny dokumentu pierwszego kandydata wg tresci (najmocniejsze dopasowanie RRF). Budowany przez `unionProfiles(orderedProfiles, 1)` - jeden punkt wejscia wspolny z ewaluacja, bez duplikacji. Decyzja oparta na pomiarze (topN=1 bije topN=3).

### B. Punkt wpiecia: osobny etap re-rankingu po RRF

Re-ranking dziala na pelnej liscie kandydatow RRF (przed odcieciem do k), nie jako czwarta lista do RRF. Powod: re-ranking po RRF moze wyniesc sprawe analogiczna z pozycji za k do top-k bez mieszania sygnalu strukturalnego z arytmetyka rang RRF. Po re-rankingu lista jest cieta do k.

### C. Flaga opt-out i degradacja bez regresji

`opts.dualSimilarity?: boolean`, domyslnie wlaczone. Wpiecie jest no-op gdy profil referencyjny jest pusty (graf pusty albo dokument bez encji): structuralScore 0 dla wszystkich kandydatow daje czysta kolejnosc tresci (brzeg ADR-0086). `dualSimilarity: false` pomija caly etap i odczyty profilu z DB (oszczednosc kosztu) oraz zachowuje dokladnie dotychczasowa sciezke (ten sam kod fetch + sort co przed wpieciem), co gwarantuje identyczny wynik dla wywolan bez re-rankingu.

### D. Alpha z env

`PATRON_DUAL_ALPHA` parsowane raz, default 0.6 (z ewaluacji). Wartosci spoza [0,1] przycinane przez dualSimilarityRank (ADR-0086). alpha=1 daje czysta tresc (brak regresji nawet przy wlaczonej fladze).

### E. Koszt: cache profilu w obrebie retrieve

loadStructuralProfile wolane raz per rozny dokument kandydata, wynik cache'owany w mapie w obrebie jednego retrieve. Kandydaci to chunki; chunki tego samego dokumentu dziela profil. Brak odczytu DB poza pula kandydatow (ograniczona przez perEngine).

---

## Konsekwencje

**Pozytywne**:
- Sprawy strukturalnie analogiczne wynoszone nad tylko tematycznie podobne na puli kandydatow retrievalu: nDCG@5 0.7346 vs 0.6611 baseline (wzrost 11.1 procent) na korpusie ewaluacyjnym odtwarzajacym warunek analogii. Bezposrednie wzmocnienie ADR-0054 dla pracy prawnika z precedensami.
- Zero nowej zaleznosci npm, deterministyczny, offline, zero egress, zero kosztu LLM (Art. 1, 3, 7).
- Brzegi bez regresji: flaga off zachowuje dotychczasowa sciezke; alpha=1 oraz pusty profil referencyjny daja kolejnosc tresci. Wpiecie jest zero-ryzyka dla korpusow o rzadkim grafie.
- Jeden punkt utrzymania wyboru referencji (unionProfiles) wspolny z harnessem ewaluacyjnym.

**Negatywne / koszt**:
- Re-ranking dziala tylko na puli kandydatow retrievalu. recall nie rosnie (0.6667 bez zmian w ewaluacji): dokument analogiczny o malym pokryciu leksykalnym, ktorego BM25 nie pobral, nie wroci przez re-ranking. Rozszerzenie puli kandydatow albo query-expansion to osobna rezerwacja.
- Profil referencyjny top-1 jest wrazliwy na bledny pierwszy kandydat tresci. W ewaluacji top-1 wygral, ale przy korpusie, gdzie czolowe dopasowanie tresci jest tematycznym dystraktorem, referencja moze byc nietrafna. Mitygacja: alpha 0.6 utrzymuje 60 procent wagi tresci, wiec bledna referencja nie wywraca rankingu, a tylko nie pomaga.
- Liczby pochodza z malego, syntetycznego korpusu ewaluacyjnego (dwa zapytania, osiem dokumentow + szum). Sa dowodem kierunku i strazem regresji, nie estymata na korpusie pilotazu. Re-pomiar na realnym korpusie kancelarii pozostaje wskazany przed strojeniem alpha per typ zapytania.

**Bramki PRZED merge**:
- TSC clean (backend): `node_modules/.bin/tsc --noEmit` exit 0, zero `any` bez komentarza, zero `@ts-ignore`.
- Testy zielone: harness ewaluacyjny (dual bije baseline, alpha=1 odtwarza baseline, pusty profil odtwarza baseline) + rozszerzenie retrieval.test.ts (analogiczna nad tematyczna, flaga off identyczna jak dotad, graf pusty bez regresji). Pelny backend bez regresji.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi (feat/faza-b-wiring-retrieve), brama private-remote przed push.

## Co pozostaje zarezerwowane

1. **Rozszerzenie puli kandydatow / query-expansion**: re-ranking nie odzyskuje dokumentu spoza puli BM25/wektor. Rozszerzenie puli przed re-rankingiem to osobna decyzja.
2. **Wazenie podobienstwa centralnoscia encji** (rzadka encja wazy wiecej niz pospolita): rezerwacja ADR-0086, nadal otwarta.
3. **Podobienstwo wielohopowe i typowanie rol** (podstawa/roszczenie/dowod): nakladka na Faza C event-centric KG (przeniesiona na ADR-0088, bo ten numer 0087 zajal wpiecie).
4. **Strojenie alpha per typ zapytania** i re-pomiar na korpusie pilotazu: v1 uzywa jednej alpha 0.6 z env.
