# Faza C: event-centric legal knowledge graph - kickoff spec-driven

Data: 2026-05-31. Autor: Opus 4.8. Metodyka: matematic-spec-driven (4 fazy + Constitution Check GATE). Status: KICKOFF (Konstytucja Check + Spec + Plan + Zadania). Implementacja = nastepna sesja / osobny projekt wielodniowy.

Adaptacja pod PATRON: PATRON ma juz wlasna Konstytucje (governance/CONSTITUTION.md v1.5.0) i system ADR (0001-0088). NIE tworzymy osobnej `.matematic/konstytucja.md` (skill ostrzega przed podwojnym trackingiem). Faza 1 = Constitution Check 4 bramek MateMatic + mapowanie na istniejace artykuly Konstytucji PATRONa. Rdzen architektoniczny zostanie zapisany jako ADR-0089 dopiero gdy clarifications (nizej) sa rozstrzygniete - przedwczesny ADR przed pomiarem/analiza lamie dyscypline repo.

Wzorzec zrodlowy (clean-room, wzorzec nie kod): Tianjin CN112632223B / CN112632225B (CN-only wg zwiadu IP 2026-05-31, brak rodziny EP -> wolne do stosowania w EU; nie kopiujemy kodu ani modelu). Joint extraction inspirowany wzorcem Balanced-TPLinker (one-stage, anty-kaskada bledow). Zaleznosc: ADR-0087 (dual-similarity wpiety - DONE), nadbudowa nad ADR-0008 (citation_graph) i ADR-0054/0007 (hybrid retrieval).

---

## FAZA 1 - Constitution Check (GATE)

Faza C dotyka rdzenia governance PATRONa (ekstrakcja z akt + nowy sygnal retrievalu), wiec GATE jest twardy. Mapowanie na Konstytucje PATRONa v1.5.0:

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | Lepsze wyszukiwanie spraw analogicznych po STRUKTURZE zdarzen (strona/czyn/data/kwota/podstawa) = bezposrednie wzmocnienie pracy prawnika z precedensami. Najwyzsza dzwignia retrievalu wg roadmapy. |
| Art. 1 - Lokalnosc danych | PASS-z-warunkiem | Ekstraktor zdarzen MUSI dzialac offline, in-process, zero egress (jak embedder e5 ONNX, ADR-0071). ZAKAZ ekstrakcji zdarzen przez chmurowy LLM na aktach. Jezeli model uczony - lokalna inferencja (ONNX/transformers.js albo Ollama lokalny). |
| Art. 2 - Tajemnica / at-rest | PASS-z-warunkiem | Graf zdarzen to pochodna akt objetych tajemnica. Tabele zdarzen zyja w tym samym pliku SQLite objetym szyfrowaniem at-rest (ADR-0072). Zaden eksport zdarzen poza maszyne. |
| Art. 3 - Audytowalnosc / determinizm | RYZYKO - kluczowa decyzja | citation_graph (ADR-0008) jest deterministyczny (regex+gazetteer, zero LLM). Ekstrakcja zdarzen przez model UCZONY jest probabilistyczna. Reprodukowalnosc wymaga: przypietych wag (pinned), deterministycznej inferencji (greedy/seed), wersjonowania modelu w audit_log przy kazdej ekstrakcji. Inaczej lamie "te same wejscie = ten sam graf". Patrz NEEDS CLARIFICATION C1. |
| Art. 7 - Minimalnosc / rzetelnosc | RYZYKO | Joint extraction model = potencjalnie nowa zaleznosc (runtime modelu) + pipeline treningowy + dane. To najwiekszy przyrost zlozonosci w calej roadmapie. Wymaga jawnego uzasadnienia w Complexity Tracking i etapowania (najpierw deterministyczny baseline, model dopiero gdy baseline niewystarczajacy). |
| Bramka licencji | PASS | Wzorzec CN-only (wolny w EU), clean-room. Jezeli uzyjemy bazowego modelu/biblioteki - tylko MIT/Apache, snapshot licencji w THIRD_PARTY_INSPIRATIONS.md. |
| Bramka ToS / anty-OS | PASS | Brak - lokalne, offline. Korpus treningowy: wlasny (Koziatek 2755 skanow, za zgoda) lub publiczny orzeczniczy. ZAKAZ trenowania na aktach klienta bez podstawy. |
| Bramka jakosci (kapital) | PASS-z-warunkiem | Projekt wielodniowy, klasy badawczej. WARUNEK: etapowanie z ratowalnym MVP (US1 deterministyczny baseline daje wartosc nawet jesli model US2 sie poslizgnie). Nie zaczynac od najtrudniejszej czesci. |
| Bramka strategii | PASS | Pasuje do moatu retrievalu (analogiczne sprawy = wartosc dla prawnika), zgodne z [[reference_china_patent_recon_2026-05-31]] (darmowy roadmap z IP). |

WERDYKT GATE: PASS warunkowy. Dwa twarde warunki przed implementacja rdzenia: (1) rozstrzygnac determinizm/audyt ekstraktora uczonego (Art. 3, C1); (2) etapowanie - deterministyczny baseline zdarzen PRZED modelem uczonym (Art. 7). Oba zaadresowane w Spec (US1 vs US2) i Complexity Tracking.

---

## FAZA 2 - Specyfikacja

**Problem.** Obecny graf (ADR-0008) laczy dokument z plaska encja (cytuje_orzeczenie, cytuje_przepis, przed_sadem). Nie reprezentuje ZDARZEN ani ich rol: kto (strona) zrobil co (czyn) kiedy (data) za ile (kwota) na jakiej podstawie (przepis). Dual-similarity (ADR-0087) liczy podobienstwo po zbiorze encji (Jaccard) - nie odroznia sprawy, gdzie te same przepisy wystepuja w innej konfiguracji rol. Prawnik szukajacy analogii potrzebuje dopasowania po WZORCU zdarzeniowym (np. "powod zada zachowku od obdarowanego, podstawa art. 991, darowizna przekracza udzial"), nie po wspolnych slowach czy wspolnych przepisach.

**Cel.** Reprezentowac zdarzenia jako wezly typowane rolami i dodac subgraph matching jako sygnal retrievalu, ktory wynosi sprawy o analogicznym WZORCU zdarzeniowym - wymiar, ktorego ani tresc (BM25/wektor), ani centralnosc backlink, ani Jaccard encji (ADR-0087) nie lapia.

### US1 (P1, MVP) - Deterministyczny baseline zdarzen z istniejacych encji

**Jako** prawnik **chce** zeby sprawy o tej samej konfiguracji rol (ta sama podstawa prawna powiazana z ta sama klasa czynu i strony) byly wynoszone w wynikach **zeby** znajdowac analogie strukturalne, nie tylko leksykalne.

Zakres MVP: zbudowac zdarzenia regula+gazetteer (zero LLM, deterministyczne) z JUZ ekstrahowanych encji (ADR-0008) + bliskosci w tekscie (encja-przepis + encja-kwota + encja-strona w obrebie sekcji = kandydat na ramke zdarzenia). To NIE jest pelny joint extraction - to deterministyczny szkielet, ktory daje pierwsza wartosc i baseline do pomiaru modelu.

**Acceptance Criteria:**
- [ ] AC1.1: schema zdarzen (event nodes + role edges) w SQLite, w tym samym pliku co reszta (ADR-0053/0072 at-rest).
- [ ] AC1.2: deterministyczny builder zdarzen z encji+bliskosci, zero LLM, reprodukowalny (Art. 3).
- [ ] AC1.3: subgraph similarity (czysta funkcja, testowalna bez bazy, jak dualSimilarity.ts) - dopasowanie ramek zdarzeniowych dwoch spraw.
- [ ] AC1.4: eval rankingowy (jak B1): korpus gdzie analogia ZDARZENIOWA bije analogie encjowa (ADR-0087); nDCG@k z vs bez sygnalu zdarzeniowego. Liczby do ADR-0089.

**Independent Test:** zindeksuj 2 sprawy o tych samych przepisach ale innej konfiguracji rol + 1 o tej samej konfiguracji; sygnal zdarzeniowy wynosi te o tej samej konfiguracji; bez US2 (model) dziala w pelni.

### US2 (P2) - Joint extraction zdarzen modelem uczonym (anty-kaskada)

**Jako** zespol PATRON **chcemy** ekstrakcje zdarzen niezalezna od kruchych regul bliskosci **zeby** lapac zdarzenia, ktorych baseline US1 nie sklada (zlozone zdania, odlegle role).

Zakres: clean-room reimplementacja wzorca one-stage joint extraction (Balanced-TPLinker: jednoczesne tagowanie encji i relacji, bez kaskady NER->RE). Lokalna inferencja (Art. 1). Trening na korpusie orzeczniczym (Koziatek + publiczne), bootstrap anotacji moze reuzyc ADR-0085 (WuManber weak supervision).

**Acceptance Criteria:**
- [ ] AC2.1: model lokalny, offline, inferencja deterministyczna (pinned wagi + greedy), wersja w audit_log (Art. 3, C1).
- [ ] AC2.2: bench ekstrakcji (precision/recall ramek zdarzen) vs baseline US1 na trzymanym zbiorze testowym.
- [ ] AC2.3: model wchodzi tylko jesli bije baseline US1 mierzalnie (inaczej zostajemy na US1 - jak Faza D zostawila sqlite-vec).

**Independent Test:** bench ekstrakcji na labeled zbiorze; metryka per typ roli.

### US3 (P3) - Wpiecie subgraph matching w retrieve() + multi-hop

**Jako** prawnik **chce** zeby sygnal zdarzeniowy laczyl sie z dual-similarity (ADR-0087) i RRF **zeby** ranking uwzglednial tresc + strukture encji + strukture zdarzen razem.

**Acceptance Criteria:**
- [ ] AC3.1: subgraph matching jako kolejny etap re-rankingu po ADR-0087 (lub wymiar w nim), flaga opt-out, alpha/waga z env, zero regresji gdy brak zdarzen.
- [ ] AC3.2: podobienstwo wielohopowe (walk > 1, typowanie rol) - domyka rezerwacje ADR-0086/0087.
- [ ] AC3.3: eval end-to-end: nDCG@k pelnego retrievalu z vs bez warstwy zdarzen.

**Independent Test:** retrieve() z flaga zdarzen on/off; analogia zdarzeniowa nad encjowa; flaga off = identyczny wynik jak po ADR-0087.

### Non-Goals (anti-scope)
- Generatywne streszczanie zdarzen przez LLM (to nie ekstrakcja, to inny produkt; Art. 1/3).
- Trening na aktach klienta bez podstawy prawnej (RODO).
- Cross-matter graf wspoldzielony miedzy kancelariami (single-tenant, ADR-0053).
- Wizualizacja grafu zdarzen w UI (osobny ficzer po rdzeniu).

### NEEDS CLARIFICATION
- [ ] C1 (Art. 3 determinizm): akceptowalny poziom determinizmu dla modelu uczonego? Propozycja: pinned wagi + greedy inferencja + model_version w audit_log = "audytowalne reprodukowalne", traktowane jak deterministyczne dla potrzeb Art. 3. Do potwierdzenia przez Ownera.
- [ ] C2: runtime modelu US2 - ONNX przez transformers.js (spojne z embedderem) czy osobny (PyTorch/llama.cpp)? Preferencja: ONNX dla jednego runtime (Art. 7 minimalnosc).
- [ ] C3: zrodlo labeled danych do US2 (ile rak anotacji vs bootstrap WuManber ADR-0085)? Wplywa na timeline.
- [ ] C4: typologia rol zdarzen - minimalny zestaw v1 (strona/czyn/data/kwota/podstawa) czy szerszy? Mniej = szybciej, wystarczy do MVP.

---

## FAZA 3 - Plan

**Project Type:** web-app feature (backend/ TypeScript + SQLite), nadbudowa nad istniejacym retrievalem. Zgodne ze stackiem PATRONa, bez nowego project type.

### Technical Context
- Language: TypeScript 5.x (backend), Node 20+.
- Storage: SQLite single-file (ADR-0053), at-rest DPAPI/SQLCipher (ADR-0072). Nowe tabele: events, event_roles (krawedzie typowane). rowid spojne z doc_chunks/documents.
- Extraction baseline (US1): regex+gazetteer+bliskosc, reuzycie pl-entities + graph/extractor.ts (ADR-0008). Zero nowej zaleznosci.
- Extraction model (US2): lokalny, offline; runtime do rozstrzygniecia (C2). Trening osobno, artefakt = pinned model.
- Testing: vitest. Dyscyplina B1: czyste funkcje testowalne bez bazy (subgraph similarity) + eval rankingowy z liczbami do ADR + testy regresji (flaga off = bez zmian, brak zdarzen = bez regresji).
- Constraints: offline, RODO-safe, deterministyczne (lub audytowalnie-reprodukowalne dla US2), zero egress.
- Scale: jeden prawnik, korpus do ~100k chunkow (patrz pomiar ADR-0088). Subgraph matching liczony na puli kandydatow retrievalu (jak ADR-0087), nie na calym grafie.

### Constitution Check (re-check w planie)
Powtorzony GATE z Fazy 1: PASS warunkowy. Warunki przeniesione do Complexity Tracking i kolejnosci faz (US1 deterministyczny przed US2 uczonym).

### Project Structure (proponowana)
```
backend/src/lib/retrieval/
  events.ts              # czyste funkcje: budowa ramek zdarzen, subgraph similarity (US1, AC1.2/1.3)
  events.test.ts         # jaccard rol, dopasowanie ramek, determinizm, brzegi
  events.eval.test.ts    # eval rankingowy zdarzeniowy (US1, AC1.4) - liczby do ADR-0089
backend/src/lib/db/
  schema.sqlite.ts       # + tabele events, event_roles (US1, AC1.1)
backend/src/lib/retrieval/
  retrieval.ts           # wpiecie subgraph matching po ADR-0087 (US3, za flaga)
backend/src/lib/graph/
  event-extractor.ts     # model uczony (US2) - osobny modul, lokalna inferencja
governance/adr/
  0089-event-centric-kg-rdzen.md   # rdzen, gdy C1-C4 rozstrzygniete
```

### Research notes
- Wzorzec Tianjin (CN112632223B/225B): event-node + role typing + subgraph matching. Clean-room - czytamy opis patentu (publiczny), reimplementujemy od zera.
- Balanced-TPLinker: one-stage joint entity+relation tagging, unika kaskady NER->RE (blad NER nie propaguje). Wzorzec, nie kod.
- Reuzycie wewnetrzne: ADR-0008 (encje+citation_graph) jako wejscie; ADR-0085 (WuManber) jako bootstrap anotacji dla US2; ADR-0087 (dual-similarity) jako miejsce wpiecia US3 i wzorzec dyscypliny (eval-first, czyste funkcje, flaga, env, zero regresji).
- Pomiar skali z ADR-0088: subgraph matching trzymac na puli kandydatow (bounded), nie na pelnym grafie - inaczej koszt.

### Complexity Tracking (violations uzasadnione)
| Violation | Why Needed | Prostsze odrzucone bo |
|---|---|---|
| Model uczony (US2) - przyrost zlozonosci, Art. 7 | Baseline regulowy (US1) nie zlozy zdarzen ze zlozonych zdan / odleglych rol | Sam baseline US1 zostaje jako MVP; model wchodzi TYLKO jesli bije baseline (AC2.3) - etapowanie ogranicza ryzyko |
| Ekstraktor probabilistyczny vs determinizm Art. 3 | Joint extraction wymaga modelu | Mitygacja: pinned wagi + greedy + model_version w audit (C1) = audytowalnie reprodukowalne; baseline US1 pozostaje w pelni deterministyczny |

---

## FAZA 4 - Zadania (z markerami [P])

```
## Phase 1 - Setup
- [ ] T001 Branch feat/faza-c-event-kg od main; rozstrzygnac C1-C4 z Ownerem PRZED kodem rdzenia
- [ ] T002 [P] Snapshot wzorca Tianjin + Balanced-TPLinker do THIRD_PARTY_INSPIRATIONS.md (clean-room, atrybucja)

## Phase 2 - Foundational (BLOKUJE US1-US3)
- [ ] T003 Schema events + event_roles w schema.sqlite.ts + ensureSchemaUpgrades (ALTER idempotentny, desktop bez runnera migracji) [AC1.1]
- [ ] T004 ADR-0089 rdzen (event-node schema + role typing + subgraph matching) - status Zaproponowany; flip Wdrozony po eval US1

## Phase 3 - US1 (P1, MVP) - deterministyczny baseline
- [ ] T010 [P] [US1] events.ts: czyste funkcje budowy ramek z encji+bliskosci (zero LLM, deterministyczne) [AC1.2]
- [ ] T011 [P] [US1] events.ts: subgraph similarity (Jaccard rol / dopasowanie ramek), czysta funkcja [AC1.3]
- [ ] T012 [US1] events.test.ts: determinizm, brzegi, symetria (depends T010/T011)
- [ ] T013 [US1] builder zapisu zdarzen w indexer.ts (po ekstrakcji encji ADR-0008)
- [ ] T014 [US1] events.eval.test.ts: korpus analogii zdarzeniowej, nDCG@k z vs bez (liczby do ADR-0089) [AC1.4]
**Checkpoint:** US1 daje sygnal zdarzeniowy deterministyczny; ratowalny MVP nawet bez US2/US3.

## Phase 4 - US2 (P2) - model uczony (osobny pod-projekt, wielodniowy)
- [ ] T020 [US2] Dane: bootstrap anotacji WuManber (ADR-0085) + ew. reczna anotacja [C3]
- [ ] T021 [US2] Trening clean-room one-stage joint extraction (Balanced-TPLinker wzorzec)
- [ ] T022 [US2] event-extractor.ts: lokalna inferencja offline, pinned wagi, model_version w audit_log [AC2.1, C1/C2]
- [ ] T023 [US2] Bench precision/recall ramek vs baseline US1 [AC2.2]; wchodzi tylko jesli bije [AC2.3]

## Phase 5 - US3 (P3) - wpiecie + multi-hop
- [ ] T030 [US3] Wpiecie subgraph matching w retrieve() po ADR-0087, flaga + env, zero regresji gdy brak zdarzen [AC3.1]
- [ ] T031 [US3] Podobienstwo wielohopowe + typowanie rol (domyka rezerwacje ADR-0086/0087) [AC3.2]
- [ ] T032 [US3] Eval end-to-end nDCG@k pelnego retrievalu [AC3.3]

## Phase N - Polish
- [ ] T040 [P] Marko 2x na ADR-0089
- [ ] T041 [P] Aktualizacja AGENTS.md / THIRD_PARTY_INSPIRATIONS.md
- [ ] T042 FTO recheck (Baidu EP4086808A3 contract-KG - rozniczkowac od subgraph matching retrievalu; TR WO2025085566A1)
- [ ] T043 [P] anthropic-skills:matematic-reviewer / security-review na nowym module

## Parallel Opportunities
- T010 + T011 (rozne funkcje w events.ts, ale ten sam plik - serializowac zapis jak w workflow patterns) -> realnie [P] dla projektowania, serial-write
- T002, T040, T041, T043 czysto [P]
```

---

## Punkt wejscia nastepnej sesji
1. Rozstrzygnij C1-C4 z Wieslawem (15 min intake, jak reality-check briefingu).
2. Phase 1-2 (schema + ADR-0089 Zaproponowany).
3. US1 MVP (deterministyczny baseline + eval) - to pierwsza ratowalna wartosc, dyscyplina jak ADR-0087 (eval-first, czyste funkcje, flaga, zero regresji).
4. US2 (model) = osobny wielodniowy pod-projekt, tylko jesli baseline US1 niewystarczajacy (mierzony AC2.3).

FTO: subgraph matching retrievalu rozniczkowac od Baidu EP4086808A3 (contract-consistency check) i TR WO2025085566A1 (generatywny RAG) - jak w ADR-0087. Recheck przy wpieciu US3.

Zaleznosci pamieci: [[reference_china_patent_recon_2026-05-31]], [[session_summary_2026-05-31_faza-b1-wiring-retrieve]], [[reference_faza_d_vector_store_eval_2026-05-31]].
