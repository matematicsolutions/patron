# ADR-0090: Wpiecie event-centric subgraph matching w retrieve() (request-path)

**Status**: Wdrozony 2026-06-01 (Faza C, US3 - wpiecie). Scalony do main. Konstytucja v1.5.0. Domyka rezerwacje US3 z ADR-0089 - biblioteka event-centric (subgraph matching ramek zdarzen) wchodzi w sciezke produkcyjna retrievalu jako kolejny etap re-rankingu po dual-similarity (ADR-0087), sterowana flaga i alpha z env, z liczbami z ewaluacji rankingowej.

**Data**: 2026-06-01

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: re-ranking pracuje na danych juz trzymanych lokalnie (tabele events, event_roles zbudowane przy indeksacji, ADR-0089). Zero wywolan LLM, zero egress, czysta arytmetyka zbiorow w obrebie jednego zapytania.
- **Art. 3 - Audytowalnosc / determinizm**: te same wejscie (kandydaci po dual-similarity + ramki referencyjne + alpha) daje ten sam ranking. Brak zegara, brak losowosci, stabilny tie-break dziedziczony z ADR-0089 (eventSimilarityRank). Kolejnosc cytowanych spraw odtwarzalna w audycie.
- **Art. 7 - Minimalnosc / rzetelnosc**: zero nowej zaleznosci npm. Wpiecie dodaje jeden etap re-rankingu i jeden cienki odczyt ramek per dokument kandydata (z cache w obrebie retrieve). Decyzja o wpieciu poparta pomiarem (nizej), nie heurystyka.

**Powiazane ADR**:
- ADR-0089 (event-centric KG rdzen, US1 baseline): ten ADR domyka jego rezerwacje US3 "wpiecie subgraph matching w retrieve()". Reuzywa eksportowanych funkcji czystych (eventSimilarityRank) i helpera DB (loadEventFrames) bez zmiany ich kontraktu.
- ADR-0087 (wpiecie dual-similarity w retrieve): event-centric jest kolejnym wymiarem strukturalnym wpietym po dual-similarity. Dziedziczy wzorzec wpiecia (etap po RRF, flaga opt-out, alpha z env, referencja top-1, degradacja bez regresji).
- ADR-0007 / ADR-0054 (hybrid retrieval RRF nad wektor + BM25 + graf): re-ranking jest etapem po fuzji RRF, nie czwarta lista do RRF. Nie zmienia samej fuzji ani silnikow.
- ADR-0008 (entity extraction + citation_graph, zero LLM): zrodlo encji budujacych role zdarzen (strona / data / kwota / podstawa); czyn z leksykonu events.ts.

Inspiracja (clean-room, wzorzec nie kod): Tianjin CN112632223B / CN112632225B (rodzina CN-only wg zwiadu IP 2026-05-31, brak czlonu EP, wzorzec wolny do stosowania w EU) - event-node z typowaniem rol i dopasowanie subgrafowe. Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy idee reprezentacji i dopasowania, nie kod ani model ani korpus.

---

## Kontekst

ADR-0089 dostarczyl deterministyczny silnik event-centric jako biblioteke (funkcje czyste buildEventFrames, frameSimilarity, eventSetSimilarity, eventSimilarityRank + cienki loadEventFrames) i builder ramek w indekserze, ale celowo odlozyl wpiecie w request-path jako US3. Bez pomiaru re-ranking moze pogorszyc trafnosc, a punkt wpiecia, wybor ramek referencyjnych i alpha nie byly rozstrzygniete na sciezce produkcyjnej. Ten ADR rozstrzyga je liczbami z ewaluacji rankingowej i wpina silnik w retrieve().

Dual-similarity (ADR-0087) liczy podobienstwo strukturalne jako Jaccard plaskiego zbioru encji dokumentu. Sprawa z tymi samymi wartosciami w innej konfiguracji rol, albo z wartosciami rozsianymi po dokumencie bez zwiazku jednym zdarzeniem, dostaje wysoki wynik mimo braku analogii zdarzeniowej. Event-centric lapie wymiar, ktorego plaski Jaccard nie rozroznia: czy te same wartosci wspolwystepuja w jednej ramce roli (kto zrobil co, na jakiej podstawie). Stad wpiecie po dual-similarity, jako kolejny wymiar, nie zamiast.

### Ewaluacja rankingowa (przed wpieciem)

Harness `backend/src/lib/retrieval/events.wiring.eval.test.ts` (offline, PATRON_DISABLE_VEC=1, BM25 + graf + RRF, zero LLM, deterministyczny, zero zegara w metryce). Encje powstaja przez realny indekser (detectAll: CELEX jako SYGNATURA_AKTU dajaca role podstawa) plus leksykon czynow events.ts (rola czyn). Korpus odtwarza warunek, ktory feature celuje: sprawa-kotwica ma ramke zdarzenia (czyn + podstawa wspolwystepujace); sprawa analogiczna ma te sama ramke innym slownictwem, wiec nizszy wynik leksykalny; dystraktor-pulapka powtarza slowa zapytania (wysoka tresc) i ma te same wartosci, ale rozsiane po dokumencie (duze odstepy), przez co nie tworzy zadnej ramki. Metryka: sredni nDCG@5 po dwoch zapytaniach (roszczenie o zaplate, odszkodowanie).

Wyniki (strzezone asercjami nierownosci w harnessie; korpus deterministyczny):

| Konfiguracja | nDCG@5 |
|---|---|
| baseline (czysta tresc, RRF) | 0.7641 |
| dual-similarity (ADR-0087) | 0.8066 |
| event-centric (US3, sam ponad tresc) | 0.7853 |
| dual + event (sciezka produkcyjna) | 0.8467 |

Odczyt:
- Sygnal zdarzeniowy ponad czysta trescia poprawia trafnosc analogii: 0.7853 vs 0.7641 baseline (wzrost 2.8 procent). Re-ranking spycha pulapke (zdarzeniowe podobienstwo 0) pod analog (1.0, ta sama ramka co kotwica).
- Sciezka produkcyjna (dual + event) bije sam dual: 0.8467 vs 0.8066 (wzrost 5.0 procent wzgledem dual), i bije baseline o 10.8 procent. Event doklada wymiar, ktorego dual nie lapie - dwa sygnaly strukturalne sa komplementarne, nie redundantne.
- Komplementarny dowod mechanizmu (biblioteczny, ADR-0089, events.eval.test.ts): na korpusie syntetycznym z pulapka o identycznym worku wartosci analogia encjowa daje nDCG@5 0.7328, a analogia zdarzeniowa 1.0000. To pokazuje granice plaskiego Jaccarda; eval request-path tu pokazuje zysk wpiecia na realnej puli kandydatow.
- alpha = 0.6 jest dziedziczone z ADR-0087 (60 procent wagi tresci), nie re-strojone osobno. Przy alpha 0.6 zysk jest skromny i ograniczony, bo ramki zdarzen sa rzadkie (oferta encji offline to glownie podstawa z CELEX i czyn z leksykonu; KWOTA / DATA / OSOBA wymagaja warstwy copy-span albo modelu, poza baseline US1). Strojenie alpha per sygnal to rezerwacja.

### Roznicowanie FTO (recheck przy wpieciu w request-path)

- Thomson Reuters WO2025085566A1 (potwierdzony 2026-05-31): generatywny pipeline RAG (kryteria z GUI jako prompt do LLM, generacja tresci). Ten ADR to deterministyczne re-rankowanie kandydatow po podobienstwie subgrafowym ramek zdarzen, bez generacji i bez LLM. Roznica utrzymana.
- Baidu EP4086808A3: contract knowledge-graph consistency check (pending EP wg zwiadu IP). Dotyczy sprawdzania spojnosci umow po grafie, nie re-rankingu wynikow wyszukiwania spraw po podobienstwie zdarzeniowym. Roznicowanie jest domenowe (inny problem). Recheck przez ogolny web (US-only) nie indeksuje Espacenet i nie wykazal zmiany.
- Wzorzec rdzenia (Tianjin CN112632223B/225B) jest CN-only (brak czlonu EP wg zwiadu), wiec wolny do stosowania w EU; reimplementacja clean-room od zera. Recheck Espacenet pozostaje wskazany przy poszerzaniu na model uczony (US2).

---

## Decyzja

Wpiac event-centric subgraph matching w `retrieve()` jako kolejny etap re-rankingu po dual-similarity (ADR-0087), sterowany flaga opt-out i alpha z env, ze scisla degradacja do kolejnosci poprzedniego etapu gdy brak ramek.

### A. Ramki referencyjne: sprawa-kotwica (top-1)

Referencja to ramki zdarzen dokumentu pierwszego kandydata wg biezacej kolejnosci (po dual-similarity). Spojnie z ADR-0087 (top-1). Gdy pierwszy kandydat nie ma ramek, referencja jest pusta i etap jest no-op (nizej).

### B. Punkt wpiecia: etap re-rankingu po dual-similarity

Pipeline re-rankingu na pelnej liscie kandydatow RRF (przed odcieciem do k): najpierw dual-similarity (ADR-0087), potem event-centric. Event po dual, bo lapie wymiar rola->wartosc, ktorego plaski Jaccard encji nie rozroznia; dziala na liscie juz uporzadkowanej strukturalnie i jeszcze ja doprecyzowuje. Po obu etapach lista jest cieta do k.

### C. Flaga opt-out i degradacja bez regresji

`opts.event?: boolean`, domyslnie wlaczone. Wpiecie jest no-op gdy ramki referencyjne sa puste (sprawa-kotwica bez zdarzen): eventSetSimilarity 0 dla wszystkich kandydatow zwraca liste niezmieniona, czyli kolejnosc poprzedniego etapu. `event: false` pomija caly etap i odczyty ramek z DB. Gdy obie flagi (dualSimilarity, event) sa false, retrieve idzie dokladnie dotychczasowa sciezka (ten sam kod fetch + sort co przed wpieciem), co gwarantuje identyczny wynik. To czyni wpiecie zero-ryzyka dla korpusow bez ramek zdarzen (typowych, bo ramki sa rzadkie).

### D. Alpha z env

`PATRON_EVENT_ALPHA` parsowane raz, default 0.6 (dziedziczone z ADR-0087, spojnie). Wartosci spoza [0,1] przycinane przez eventSimilarityRank (ADR-0089). alpha=1 daje czysty wynik poprzedniego etapu (brak regresji nawet przy wlaczonej fladze).

### E. Koszt: cache ramek w obrebie retrieve

loadEventFrames wolane raz per rozny dokument kandydata, wynik cache'owany w mapie w obrebie jednego retrieve. Kandydaci to chunki; chunki tego samego dokumentu dziela ramki. Brak odczytu DB poza pula kandydatow (ograniczona przez perEngine). Subgraph matching liczony na puli kandydatow (bounded, jak ADR-0087), nie na pelnym grafie.

---

## Konsekwencje

**Pozytywne**:
- Sprawy zdarzeniowo analogiczne (ta sama ramka roli) wynoszone nad sprawy o tych samych wartosciach rozsianych bez zwiazku jednym zdarzeniem: nDCG@5 sciezki produkcyjnej 0.8467 vs 0.8066 sam dual vs 0.7641 baseline (wzrost 5.0 procent wzgledem dual, 10.8 procent wzgledem tresci) na korpusie ewaluacyjnym. Dwa sygnaly strukturalne komplementarne.
- Zero nowej zaleznosci npm, deterministyczny, offline, zero egress, zero kosztu LLM (Art. 1, 3, 7).
- Brzegi bez regresji: flaga off zachowuje sciezke poprzedniego etapu; alpha=1 oraz puste ramki referencyjne daja kolejnosc poprzedniego etapu. Pelny suite backendu bez regresji (default-on event re-ranking jest no-op na istniejacych korpusach testowych, bo nie tworza ramek).
- Reuzycie biblioteki US1 bez zmiany kontraktu - jeden punkt utrzymania logiki dopasowania (events.ts).

**Negatywne / koszt**:
- Zysk skromny przy alpha 0.6 i obecnej ofercie encji. Ramki wymagaja co najmniej dwoch roznych rol wspolwystepujacych; przy ekstrakcji offline baseline US1 (CELEX jako podstawa, leksykon czynow) ramki sa rzadkie. Bogatsza ekstrakcja rol (KWOTA / DATA / OSOBA przez copy-span lub model) podnioslaby pokrycie ramek - rezerwacja (m.in. US2).
- Re-ranking dziala tylko na puli kandydatow retrievalu. recall nie rosnie: sprawa zdarzeniowo analogiczna, ktorej BM25 nie pobral, nie wroci przez re-ranking. Rozszerzenie puli / query-expansion to osobna rezerwacja (jak ADR-0087).
- Ramki referencyjne top-1 sa wrazliwe na bledny pierwszy kandydat. Gdy top-1 nie ma ramki, etap jest no-op (nie szkodzi, ale i nie pomaga). Mitygacja: alpha 0.6 utrzymuje wage poprzedniego etapu.
- Liczby pochodza z malego, syntetycznego korpusu (dwa zapytania, siedem dokumentow). Sa dowodem kierunku i strazem regresji, nie estymata na korpusie pilotazu. Re-pomiar na realnym korpusie kancelarii wskazany przed strojeniem alpha.

**Bramki przed merge**:
- TSC clean (backend): `node_modules/.bin/tsc --noEmit` exit 0, zero `any` bez komentarza, zero `@ts-ignore`.
- Testy zielone: harness ewaluacyjny (event bije baseline, dual+event nie regresuje wzgledem dual i bije baseline, korpus bez ramek = no-op, determinizm) + rozszerzenie retrieval.test.ts (analogiczna nad pulapke, flaga off identyczna jak dotad). Pelny backend bez regresji (1021 pass).
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi (feat/faza-c-event-kg), brama private-remote przed push.

## Co pozostaje zarezerwowane

1. **US2: model uczony joint extraction** (wzorzec Balanced-TPLinker), lokalna inferencja, pinned wagi + greedy + model_version w audit_log (C1/C2 ADR-0089). Wchodzi tylko jesli bije baseline US1 mierzalnie. Podnioslby pokrycie ramek (bogatsza ekstrakcja rol), co jest glownym ograniczeniem zysku w tym ADR.
2. **Podobienstwo wielohopowe z typowaniem rol**: obecne dopasowanie jest jednopoziomowe (best-match ramek). Wielohopowe (lancuch zdarzen, role posrednie) to rezerwacja, jak zapisano w US3 ADR-0089.
3. **Rozszerzenie puli kandydatow / query-expansion**: re-ranking nie odzyskuje dokumentu spoza puli BM25/wektor (wspolne ograniczenie z ADR-0087).
4. **Strojenie alpha per sygnal i typ zapytania** plus re-pomiar na korpusie pilotazu: v1 uzywa jednej alpha 0.6 z env, dziedziczonej z ADR-0087.
