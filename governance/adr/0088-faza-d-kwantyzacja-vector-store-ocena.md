# ADR-0088: Faza D - kwantyzacja i lokalny vector store (ocena, decyzja: utrzymac sqlite-vec)

**Status**: Przyjety 2026-05-31 (decyzja evaluation-only: nie adoptowac w tej iteracji; Zvec/Proxima jako bookmark z progiem flip opartym na pomiarze; SINQ odlozony). Faza D roadmapy jest opcjonalna i wydajnosciowa - ten ADR nie zmienia request-path ani schematu, zapisuje decyzje i warunki powrotu.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: oba oceniane narzedzia (SINQ, Zvec/Proxima) sa OSS Apache 2.0 i dzialaja in-process offline, wiec nie lamia zero-cloud same z siebie. Ocena nie wprowadza egress.
- **Art. 2 - Tajemnica / at-rest**: warstwa wektorowa trzyma osadzenia fragmentow akt. Dzis vec_chunks zyje w jednym pliku SQLite objetym szyfrowaniem at-rest (ADR-0072). Osobny store wektorowy musi miec rownowazne szyfrowanie at-rest, inaczej powstaje luka dla danych objetych tajemnica.
- **Art. 7 - Minimalnosc / rzetelnosc**: decyzja oparta na pomiarze status quo, nie na heurystyce. Nie dodajemy zaleznosci natywnej ani drugiego silnika storage bez zmierzonej potrzeby.

**Powiazane ADR**:
- ADR-0053 (SQLite single-user zero-cloud, jeden plik) i ADR-0054 (hybrid retrieval, sqlite-vec jako warstwa wektorowa): ten ADR ocenia, czy zamienic sqlite-vec na ANN-index i czy kwantyzowac model. Decyzja: utrzymac obecny stack.
- ADR-0071 (embedder fail-closed offline) i ADR-0072 (szyfrowanie at-rest DPAPI/SQLCipher): okreslaja ograniczenia, ktore kandydat musialby spelnic.
- ADR-0087 (wpiecie dual-similarity): poprzedni krok roadmapy; Faza D jest po nim, opcjonalna.

Odniesienie do oceny turbovec (rejestr #81, bookmark-nie-adoptowac): tamta ocena odrzucila rustowy indeks wektorowy m.in. na braku bindingu Node. Zvec ten warunek spelnia (pakiet npm), wiec wraca jako powazniejszy kandydat i wymaga wlasnej oceny, nie odeslania do tamtego werdyktu.

---

## Kontekst

Roadmapa wzorcow CN (Faza D) wskazala dwa kandydatury OSS Apache 2.0 do oceny wzgledem obecnego stacku: Huawei SINQ (kwantyzacja) oraz Alibaba Proxima/Zvec (lokalny vector store). Pytanie Fazy D jest jawnie warunkowe: ocenic vs sqlite-vec, moze zostac jak jest, jezeli zysk maly. Ten ADR rozstrzyga je pomiarem, a nie deklaracja.

### Ocena A: SINQ (kwantyzacja wag modelu)

SINQ (Sinkhorn-Normalized Quantization, Huawei, Apache 2.0, huawei-csl/SINQ) zmniejsza pamiec modelu LLM o okolo 60-70 procent, jest training-free i model-agnostic, dziala na wagach PyTorch. To kwantyzacja wag modelu jezykowego, nie warstwa wyszukiwania wektorowego.

Dopasowanie do PATRONa jest waskie. Embedder retrievalu to multilingual-e5-small w ONNX przez transformers.js (ADR-0054/0071) - juz maly, z dostepnymi wariantami ONNX o nizszej precyzji, poza torem PyTorch SINQ. Model czatu jest bring-your-own (Ollama z gotowym GGUF, ktory jest juz kwantyzowany, albo dostawca chmurowy za zgoda Operatora). SINQ wnioslby wartosc tylko, gdyby PATRON sam kwantyzowal wlasny bundlowany lokalny model PyTorch - czego dzis nie robi. Decyzja: odlozyc, bez pracy w tej iteracji.

### Ocena B: Zvec / Proxima (lokalny vector store)

Zvec (Alibaba, Apache 2.0, alibaba/zvec) to embedded, in-process vector store zbudowany na silniku Proxima, pozycjonowany jako "SQLite wektorowych baz". Pakiet npm @zvec/zvec, wsparcie Windows x86_64, dziala w pelni offline (in-process, bez serwera), obsluguje wektory geste i rzadkie z filtrami. Przechodzi bramki, na ktorych odpadl turbovec: binding Node, Windows, offline, licencja Apache 2.0.

Korzysc Zvec to indeks ANN (sub-liniowe wyszukiwanie). sqlite-vec robi exact brute-force (liniowe). Roznica ma znaczenie dopiero przy duzym korpusie. Zeby zwazyc decyzje, zmierzylismy status quo.

### Pomiar status quo (sqlite-vec, reprodukowalny)

Skrypt `backend/scripts/vec-bench.cjs` (losowe wektory 384-wymiarowe L2-znormalizowane jak e5, sam KNN top-24, bez embeddera, offline). Wyniki na maszynie deweloperskiej (Windows 11, Node 24, laptop klasy konsumenckiej) - liczby ms sa sprzetozalezne, wiec operatywnym wyzwalaczem jest re-pomiar tym skryptem na docelowym sprzecie kancelarii, a nie absolutna wartosc ms:

| Korpus (chunki) | KNN avg | KNN p95 | plik DB |
|---|---|---|---|
| 10 000 | ~10 ms | ~11 ms | 15 MB |
| 50 000 | ~48 ms | ~51 ms | 75 MB |
| 100 000 | ~115 ms | ~125 ms | 149 MB |

Latencja rosnie liniowo z korpusem (zgodnie z natura exact brute-force). To dolna granica - sam etap wektorowy, przed RRF, BM25 i grafem. Do okolo 50 tysiecy chunkow warstwa wektorowa miesci sie ponizej 50 ms; przy 100 tysiacach p95 przekracza 100 ms i dalej rosnie liniowo.

### Constitution Check (bramka przed adopcja, nie przed ocena)

- Licencja: SINQ i Zvec sa Apache 2.0 - czyste do uzytku komercyjnego.
- Anty-OS / ToS: brak - oba lokalne, offline, bez warunku uslugi chmurowej.
- Jakosc: indeks ANN jest wyszukiwaniem przyblizonym; przed zastapieniem exact KNN wymaga benchmarku recall@k na korpusie PL (ryzyko pominiecia trafienia istotnego prawnie).
- Strategia: pasuje do osi on-device, ale bez zmierzonej potrzeby przy obecnym profilu pilotazu.

---

## Decyzja

Utrzymac obecny stack: sqlite-vec (ADR-0054) jako warstwa wektorowa, embedder e5-small ONNX (ADR-0071). Nie adoptowac Zvec/Proxima ani SINQ w tej iteracji.

Powody:
1. Brak zmierzonej potrzeby przy realnym profilu pilotazu. Jeden prawnik, korpus rzedu pojedynczych do kilkudziesieciu tysiecy chunkow - to 10-50 ms na etapie wektorowym, w pelni akceptowalne.
2. At-rest. vec_chunks zyje w jednym pliku SQLite objetym szyfrowaniem at-rest (ADR-0072). Osobny store Zvec wymaga rownowaznego szyfrowania at-rest dla danych objetych tajemnica (Art. 2) - nierozwiazane przed adopcja.
3. Minimalnosc (Art. 7). Adopcja oznacza nowa zaleznosc natywna, drugi silnik storage i ryzyko bundlingu w Electron na Windows (rebuild natywny, znany koszt przy better-sqlite3) - bez udowodnionego zysku przy obecnej skali.
4. Przyblizenie ANN. Zastapienie exact KNN wyszukiwaniem przyblizonym niesie ryzyko recall dla pracy prawnika; wymaga benchmarku parytetu zanim wejdzie.

### Warunki flip (zmierzone, konkretne)

Adoptowac Zvec/Proxima gdy spelnione lacznie:
- (a) korpus przekracza okolo 100 tysiecy chunkow, gdzie p95 KNN przekracza okolo 100 ms (mierzalne `backend/scripts/vec-bench.cjs`), albo migracja do wyzszego wymiaru embeddingu (1024/1536), gdzie koszt liniowy rosnie szybciej;
- (b) Zvec zweryfikowany jako szyfrowany at-rest albo PATRON owija jego store w ten sam schemat co ADR-0072;
- (c) benchmark head-to-head recall@k na korpusie PL pokazuje parytet z exact KNN.

SINQ: wrocic, gdy PATRON dostarcza wlasny bundlowany lokalny model do samodzielnej kwantyzacji (dzis bring-your-own przez Ollama z gotowym GGUF).

### FTO

Brak ryzyka. Oba narzedzia to OSS Apache 2.0 bez rodziny patentowej zwiazanej z ich uzyciem; ten ADR jest ocena, nie adaptacja wzorca, wiec nie dotyka THIRD_PARTY_INSPIRATIONS.md.

---

## Konsekwencje

**Pozytywne**:
- Decyzja oparta na pomiarze, nie na heurystyce. Prog flip jest konkretny i reprodukowalny (`backend/scripts/vec-bench.cjs`), wiec nastepna sesja sprawdza go jednym uruchomieniem, a nie ponowna ocena od zera.
- Zero ryzyka dla retrievalu: brak zmian w request-path, schemacie i zaleznosciach.
- Zachowanie jednego szyfrowanego pliku (ADR-0053/0072) i minimalnej liczby zaleznosci natywnych (Art. 7).

**Negatywne / koszt**:
- Utrzymujemy liniowy exact KNN. Przy korpusie powyzej okolo 100 tysiecy chunkow etap wektorowy bedzie zauwazalnie wolniejszy (ponad 100 ms i rosnaco), ale prog jest znany i monitorowalny.
- Zvec ma juz binding Node i wsparcie Windows, wiec bariera wejscia spada. Werdykt wymaga rechecku przy nastepnym duzym korpusie albo zmianie wymiaru embeddingu, nie jest trwaly.
- SINQ pozostaje nieoceniony empirycznie (ocena oparta na dopasowaniu architektonicznym, nie na pomiarze) - dopuszczalne, bo dzis brak toru, w ktorym by wszedl.

## Co pozostaje zarezerwowane

1. **Adopcja Zvec/Proxima** po spelnieniu warunkow flip (a)+(b)+(c): wpiecie jako alternatywny backend wektorowy za flaga (jak isVecEnabled), z zachowaniem parytetu at-rest i pomiarem recall.
2. **Kwantyzacja wlasnego modelu (SINQ)**: dopiero gdy PATRON bundluje lokalny model do samodzielnej kwantyzacji.
3. **Faza C event-centric KG**: przesunieta na ADR-0089 (numer 0088 zajela Faza D), osobny projekt spec-driven, zalezny od ADR-0087.
4. Rezerwacje retrievalu z ADR-0087 (rozszerzenie puli kandydatow / query-expansion dla recall) pozostaja otwarte i niezalezne od Fazy D.
