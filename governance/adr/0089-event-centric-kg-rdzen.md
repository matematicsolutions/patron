# ADR-0089: Event-centric legal KG - rdzen (schema zdarzen + typowanie rol + subgraph matching)

**Status**: Zaproponowany 2026-05-31 (Faza C, US1 - deterministyczny baseline). Flip do Wdrozony po scaleniu do main. Konstytucja v1.5.0. Rdzen architektoniczny event-centric KG: schemat zdarzen, typowanie rol, deterministyczny builder z encji (ADR-0008) i biblioteka dopasowania subgrafowego z liczbami z ewaluacji rankingowej. Wpiecie w retrieve() (US3) i model uczony joint extraction (US2) sa rezerwacjami tego ADR.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: builder zdarzen pracuje na encjach juz wykrytych lokalnie (extracted_entities, ADR-0008) i leksykonie czynow. Zero wywolan LLM, zero egress, czysta arytmetyka w obrebie jednego dokumentu i jednego zapytania.
- **Art. 2 - Tajemnica / at-rest**: tabele events i event_roles zyja w tym samym pliku SQLite objetym szyfrowaniem at-rest (ADR-0072). Graf zdarzen to pochodna akt objetych tajemnica; zaden eksport poza maszyne.
- **Art. 3 - Audytowalnosc / determinizm**: baseline US1 jest w pelni deterministyczny (regex + gazetteer + klastrowanie po bliskosci, stabilny tie-break). Te same wejscie daje te same ramki i ten sam ranking. Brak zegara w logice dopasowania, brak losowosci.
- **Art. 7 - Minimalnosc / rzetelnosc**: zero nowej zaleznosci npm. Rdzen dodaje dwie tabele, jeden modul biblioteczny funkcji czystych i jeden krok zapisu w indekserze. Decyzja o wartosci sygnalu poparta pomiarem (nizej), nie heurystyka. Model uczony (US2) jest etapowany i wchodzi tylko jesli bije baseline.

**Powiazane ADR**:
- ADR-0008 (entity extraction + citation_graph, zero LLM): zrodlo encji (OSOBA/FIRMA -> strona, SYGNATURA_AKTU -> podstawa, DATA/DATA_PUBLIKACJI -> data, KWOTA -> kwota). Rdzen jest nadbudowa nad ta warstwa.
- ADR-0086 (dual-similarity case ranking, biblioteka) i ADR-0087 (wpiecie dual-similarity w retrieve): event-centric KG to nastepny wymiar strukturalny ponad plaskim Jaccardem encji. Wpiecie subgraph matching planowane jako kolejny etap re-rankingu po ADR-0087 (US3, rezerwacja).
- ADR-0072 (at-rest): tabele zdarzen objete tym samym szyfrowaniem.
- ADR-0085 (WuManber weak-supervision bootstrap): zrodlo bootstrapu anotacji dla modelu US2 (rezerwacja).
- ADR-0083/0084 (Faza A): clause-boundary chunking i copy-mechanism NER (encje KWOTA/DATA) zasilaja role zdarzen.

Inspiracja (clean-room, wzorzec nie kod): Tianjin CN112632223B / CN112632225B (rodzina CN-only wg zwiadu IP 2026-05-31, brak czlonu EP, wzorzec wolny do stosowania w EU) - event-node z typowaniem rol i dopasowanie subgrafowe. Joint extraction inspirowany wzorcem Balanced-TPLinker (one-stage, anty-kaskada bledow) jako kierunek dla US2. Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy idee reprezentacji i dopasowania, nie kod ani model ani korpus.

---

## Kontekst

Graf cytowan (ADR-0008) laczy dokument z plaska encja (cytuje_przepis, przed_sadem, wspomina_osobe). Dual-similarity (ADR-0086/0087) liczy podobienstwo strukturalne jako Jaccard plaskiego zbioru encji dokumentu. Oba traktuja encje jak worek: sprawa, w ktorej te same przepisy wystepuja w innej konfiguracji rol, dostaje wysoki wynik mimo braku analogii zdarzeniowej.

Prawnik szukajacy analogii potrzebuje dopasowania po wzorcu zdarzeniowym (kto zrobil co, kiedy, za ile, na jakiej podstawie), a nie po wspolnym worku slow czy przepisow. To jest wymiar, ktorego ani tresc (BM25/wektor), ani centralnosc backlink, ani Jaccard encji (ADR-0087) nie lapia.

### Decyzje rdzenia

1. **Reprezentacja zdarzenia.** Zdarzenie to ramka rol wspolwystepujacych w obrebie okna tekstu. Wezel = tabela events (span ramki), krawedzie typowane = tabela event_roles (rola -> wartosc znormalizowana). Role v1 (decyzja C4, waski zestaw): strona, czyn, data, kwota, podstawa.
2. **Builder deterministyczny (US1).** Ramki budowane regula + bliskosc z encji ADR-0008 oraz leksykonu czynow (gazetteer pojec materialnoprawnych). Klastrowanie po odstepie znakowym; klaster zostaje ramka tylko gdy ma co najmniej dwie rozne role (wspolwystepowanie = istota zdarzenia). Zero LLM, w pelni reprodukowalne.
3. **Dopasowanie subgrafowe.** Podobienstwo dwoch ramek to makro-srednia Jaccarda liczona osobno per rola (podstawa z podstawa, czyn z czynem). Podobienstwo dwoch spraw to symetryczne best-match ramek. Kluczowa roznica wobec ADR-0087: wartosc liczy sie tylko wtedy, gdy stoi w tej samej roli, i tylko gdy wspolwystepuje w jednej ramce.

### Ewaluacja rankingowa (przed flipem na Wdrozony)

Harness `backend/src/lib/retrieval/events.eval.test.ts` (offline, deterministyczny, zero LLM, zero zegara). Korpus syntetyczny odtwarza warunek, ktory feature celuje: sprawa-kotwica ma jedna ramke (strona powod, czyn zachowek, podstawa art. 991 kc, kwota). Dystraktor pulapkowy ma identyczny worek wartosci co kotwica, ale rozsiany po dokumencie (duze odstepy pozycji), przez co nie tworzy zadnej ramki. Plaski Jaccard worka encji (mechanizm ADR-0087) stawia ten dystraktor na pierwszym miejscu; dopasowanie zdarzeniowe spycha go na dol, bo nie ma wspolwystepujacej ramki.

Metryka: nDCG@5. Porownanie analogii encjowej (plaski Jaccard, mechanizm ADR-0087) z analogia zdarzeniowa (ten modul). Liczby strzezone asercjami w harnessie:

| Sygnal rankingu | nDCG@5 |
|---|---|
| analogia encjowa (plaski Jaccard worka encji, mechanizm ADR-0087) | 0.7328 |
| analogia zdarzeniowa (dopasowanie subgrafowe ramek) | 1.0000 |

Mechanizm przewagi (mierzony osobnymi asercjami): dystraktor pulapkowy ma plaski Jaccard 1.0 wobec kotwicy (identyczny worek wartosci) i jednoczesnie wynik zdarzeniowy 0 (zero ramek, bo wartosci sa rozsiane). Analogia encjowa myli go z trafna sprawa; analogia zdarzeniowa go odrzuca.

---

## Decyzja

Przyjac event-centric KG jako rdzen sygnalu strukturalnego retrievalu:

1. Schemat: tabele events i event_roles w pliku SQLite (ADR-0053/0072), tworzone przez create-if-not-exists w SQLITE_SCHEMA (idempotentny upgrade istniejacych baz przy starcie; desktop bez runnera migracji).
2. Biblioteka `backend/src/lib/retrieval/events.ts`: funkcje czyste (buildEventFrames, frameSimilarity, eventSetSimilarity, eventSimilarityRank) testowalne bez bazy + cienka warstwa DB (loadEventFrames). Wzorzec dyscypliny z ADR-0086/0087.
3. Builder w indekserze: po ekstrakcji encji (ADR-0008) zapis ramek zdarzen, deterministyczny, idempotentny przy re-indeksie.
4. Role v1 waskie (C4): strona, czyn, data, kwota, podstawa. Rozszerzalne bez breakingu (kolumna role tekstowa).

Decyzje clarifications (Owner, 2026-05-31): C1 - dla przyszlego ekstraktora uczonego (US2) przypiete wagi + greedy inferencja + model_version w audit_log traktujemy jako audytowalnie reprodukowalne dla potrzeb Art. 3; baseline US1 pozostaje w pelni deterministyczny. C2 - runtime US2 docelowo ONNX/transformers.js (jeden runtime z embedderem, Art. 7). C3 - dane US2 bootstrapowane WuManberem (ADR-0085) z reczna korekta na probce. C4 - role v1 waskie (piec powyzej).

## Konsekwencje

Pozytywne:
- Nowy wymiar rankingu, mierzalnie lepszy od plaskiego Jaccarda encji na analogii zdarzeniowej (1.0 vs 0.7328 nDCG@5 na korpusie celujacym w ten warunek).
- Pelny determinizm baseline US1 (Art. 3) - bez modelu, bez zegara w logice.
- Zero nowej zaleznosci; tabele w istniejacym pliku at-rest.
- Ratowalny MVP: wartosc dostarczona nawet jesli model US2 nie wejdzie.

Koszty i ograniczenia:
- Builder leksykonowy czynow dopasowuje po formie podstawowej (fleksja PL nie jest lematyzowana). To celowa minimalnosc US1; bogatsza ekstrakcja czynow to rezerwacja US2.
- Subgraph matching liczony na puli kandydatow retrievalu (bounded, jak ADR-0087), nie na pelnym grafie - utrzymac przy wpieciu US3 (pomiar skali ADR-0088).

## Rezerwacje (poza tym wdrozeniem US1)
- US2: model uczony one-stage joint extraction (wzorzec Balanced-TPLinker), lokalna inferencja, pinned wagi + greedy + model_version w audit_log (C1/C2). Wchodzi tylko jesli bije baseline US1 mierzalnie (jak Faza D zostawila sqlite-vec).
- US3: wpiecie subgraph matching w retrieve() jako etap re-rankingu po ADR-0087, flaga opt-out, waga z env, zero regresji gdy brak zdarzen; podobienstwo wielohopowe z typowaniem rol (domyka rezerwacje ADR-0086/0087).

## FTO (recheck przy wpieciu US3)

Subgraph matching retrievalu rozniczkuje sie od dwoch zegarow FTO ze zwiadu 2026-05-31:
- Baidu EP4086808A3 (contract-consistency check, KG sprawdzania spojnosci umow, pending EP): tamto sprawdza spojnosc tresci umowy wzgledem grafu; nasz feature szereguje sprawy analogiczne po wzorcu zdarzeniowym w retrievalu. Inny cel, inny mechanizm.
- TR WO2025085566A1 (generatywny RAG legal): tamto generuje odpowiedz; nasz feature jest deterministycznym re-rankingiem bez generacji.

Wzorzec rdzenia (Tianjin CN112632223B/225B) jest CN-only (brak czlonu EP wg zwiadu), wiec wolny do stosowania w EU; reimplementacja clean-room od zera. Recheck Espacenet przy wpieciu w request-path (US3).
