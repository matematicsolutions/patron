# ADR-0016: Multi-hop graph traversal z jawnym reasoning trace (sciezka wnioskowania jako artefakt audytu)

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-22
**Powiazane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalnosc - kazdy
hop wskazuje realny fragment zrodla, nie wymyslone powiazanie), Art. 3
(audytowalnosc - sciezka wnioskowania jest reprodukowalnym artefaktem
AI Act art. 12), Art. 6 (granica bledu / human-in-the-loop - prawnik widzi
*jak* Patron doszedl do wniosku i moze odrzucic kazdy hop), Art. 7
(minimalnosc - hop-budget ogranicza traversal, nie wciagamy calego grafu do
LLM), Art. 9 (dostepnosc wiedzy - multi-hop ujawnia powiazania, ktorych
flat retrieval nie widzi)
**Powiazane ADR**: ADR-0005 (citation grounding - kazdy hop weryfikowany
mechanicznie), ADR-0007 (hybrid retrieval - dostarcza encje startowe dla
traversalu), ADR-0008 (entity extraction - buduje `citation_graph` po
ktorym chodzimy), ADR-0006 (audit bundle - reasoning trace laduje do bundla),
wzorzec architektoniczny
[awesome-llm-apps / knowledge_graph_rag_citations](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/rag_tutorials/knowledge_graph_rag_citations)
(Apache 2.0) oraz jego upstream
[VeritasGraph](https://github.com/bibinprathap/VeritasGraph) (named inspiration;
**brak zadeklarowanej licencji** wg gh API 2026-05-22 = all rights reserved,
dlatego cherry-pick opieramy o demo Apache 2.0, NIE o VeritasGraph)

## Decyzja

Patron wprowadza **multi-hop traversal grafu cytowan jako mechanizm
wyprowadzania odpowiedzi na zlozone (wielodokumentowe) pytania**, w ktorym
**sciezka wnioskowania (reasoning trace) jest jawnym artefaktem** zwracanym
prawnikowi i zapisywanym w audit bundle.

To NIE jest powtorzenie ADR-0007. ADR-0007 (hybrid retrieval) odpowiada na
pytanie *"ktore top-k fragmentow sa najbardziej podobne do zapytania"* - flat,
single-hop, similarity-based. ADR-0016 odpowiada na pytanie *"jaki lancuch
powiazan laczy zapytanie z odpowiedzia"* - przechodzi krawedzie
`citation_graph` (ADR-0008) i **eksponuje sama sciezke** jako wynik.

```
zapytanie
  -> [ADR-0007 hybrid retrieval] -> encje startowe (top-k, ze score)
  -> [traversal grafu, max N hopow] -> sciezka:
       encja_A --cytuje_orzeczenie--> orzeczenie_B
       orzeczenie_B --derywat_pisma--> art. X KC
       art. X KC --podstawa--> orzeczenie_C  (rzadkie, flat retrieval pominal)
  -> [ADR-0005 verifier] -> kazdy hop sprawdzony: fragment realny? cytat realny?
  -> [synteza LLM] -> odpowiedz + reasoning trace jako struktura
  -> [ADR-0006 audit bundle] -> trace zapisany jako dowod AI Act art. 12
```

Reasoning trace to **struktura danych**, nie proza LLM. Kazdy krok zawiera:
`from_entity`, `relation_type` (ontologia PL z ADR-0008), `to_entity`,
`source_doc_id`, `source_offset` (offsety z ADR-0011), `verification_status`
(verified / unverified / blocked z ADR-0005). Prawnik dostaje **graf wniosku**,
nie czarna skrzynke.

## Kontekst

Demo `knowledge_graph_rag_citations` z awesome-llm-apps (Apache 2.0, 111378
gwiazdek repo wg gh API 2026-05-22, push 2026-05-21) pokazuje pattern **multi-hop
reasoning z reasoning-trace visibility** na lokalnym stacku (wg README demka:
Neo4j przez Docker + Ollama). Jego differentiator wzgledem flat vector RAG:
obsluguje pytania laczace wiele dokumentow i pokazuje *sciezke derywacji* obok
cytatow. Demo jawnie deklaruje, ze jest "inspired by" frameworkiem **VeritasGraph**
(wg README demka: on-premise deployment, visual reasoning traces, LoRA-tuned
integration - **niezweryfikowane przez nas**).

Patron ma juz wszystkie cegly OPROCZ tej jednej:
- **ADR-0008** buduje `citation_graph` (krawedzie `cytuje_orzeczenie` /
  `strona_postepowania` / `derywat_pisma` / `przed_sadem`...) - ale dzis graf
  sluzy TYLKO jako boost rankingu w retrievalu (ADR-0007, backlink-boost). Nikt
  po nim nie *chodzi* w celu wyprowadzenia odpowiedzi.
- **ADR-0007** zwraca top-k fragmentow - ale flat. Pytanie typu *"czy linia
  orzecznicza z III CZP 11/13 zostala podtrzymana w pozniejszych sprawach
  dotyczacych art. 415 KC"* wymaga PRZEJSCIA: orzeczenie -> przepis -> inne
  orzeczenia cytujace ten przepis -> ich powiazania. Flat similarity tego nie
  zrobi (orzeczenie C moze byc niepodobne tekstowo do zapytania, a kluczowe).
- **ADR-0005** weryfikuje cytaty - ale dzis weryfikuje cytaty w FINALNEJ
  odpowiedzi. Tu weryfikujemy **kazdy hop sciezki**, zanim trafi do syntezy.

Wartosc dodana dla polskiej kancelarii (czego demo NIE ma):

- **Reasoning trace = artefakt AI Act art. 12** (Konstytucja Art. 3). Demo
  pokazuje trace dla wygody UX. Patron traktuje go jako **dowod zgodnosci** -
  zapisuje do audit bundle z hash-chainem (ADR-0001), prawnik moze odtworzyc
  *dlaczego* Patron polaczyl te orzeczenia w razie reklamacji albo kontroli.
- **Hop-by-hop verification** (Konstytucja Art. 2). Multi-hop reasoning ma znana
  patologie: im dluzsza sciezka, tym wieksza szansa, ze jeden falszywy hop
  zatruwa wniosek (error propagation). Patron wpina ADR-0005 verifier **na kazdym
  hopie**, nie tylko na koncu - falszywy hop jest blokowany u zrodla.
- **Human-in-the-loop nad sciezka** (Konstytucja Art. 6). Prawnik nie dostaje
  "ufaj, sa powiazane". Dostaje klikalna sciezke, gdzie kazdy hop ma zrodlo i
  status weryfikacji - moze odrzucic hop i wymusic re-synteze.
- **Ontologia PL** (z ADR-0008), nie generyczne entity demo. Hopy to relacje
  legal PL, nie person/org/concept.

## Rozwazane sciezki

### Wariant A - flat retrieval wystarcza (status quo, ADR-0007 only)

Pomysl: top-k hybrid retrieval pokrywa wiekszosc zapytan. Multi-hop to
over-engineering.

**Plusy**: zero nowego kodu, jeden mechanizm retrievalu.

**Minusy**:
- Pytania wielodokumentowe (linia orzecznicza, lancuch derywacji przepisu,
  powiazania stron przez kilka spraw) sa **slabo** obslugiwane - flat
  similarity nie widzi posrednich ogniw
- Graf z ADR-0008 jest **niedowykorzystany** - budujemy go (koszt ekstrakcji),
  ale uzywamy tylko jako mnoznik rankingu. Marnotrawstwo aktywa
- Brak reasoning trace = slabszy artefakt audytu (Art. 3). Audit bundle ma
  "te fragmenty", nie "ta sciezka rozumowania"

**Odrzucony** jako finalny, **akceptowalny jako Faza 1** (multi-hop wlaczamy
dopiero gdy graf ma sensowna gestosc - patrz cold-start nizej).

### Wariant B - multi-hop bez verification per hop (naiwny traversal)

Pomysl: chodzimy po grafie do N hopow, zwracamy sciezke, weryfikujemy dopiero
finalna odpowiedz (ADR-0005 jak dzis).

**Plusy**: prostszy, jeden punkt weryfikacji.

**Minusy**:
- **Error propagation** - falszywy hop (np. extractor z ADR-0008 zlapal
  `confidence: low` krawedz, ktora jest false-positive) przenosi sie przez cala
  sciezke. Finalna weryfikacja sprawdza cytaty w odpowiedzi, nie integralnosc
  sciezki ktora do niej doprowadzila
- Konstytucja Art. 2 spelniona slabo - "wniosek wyprowadzony z czesciowo
  falszywej sciezki" nadal moze miec poprawne cytaty na koncu, ale rozumowanie
  jest skazone

**Odrzucony**. Komponent "weryfikuj na koncu" zachowany jako uzupelnienie, nie
zamiennik.

### Wariant C - multi-hop z hop-budget + per-hop verification + jawny trace (WYBRANY)

Pomysl: traversal z twardym limitem hopow (domyslnie 3, configurable, **do
walidacji T4**), kazdy hop przechodzi ADR-0005 verifier zanim wejdzie do
sciezki, sciezka eksponowana jako struktura + ladowana do audit bundle.

**Plusy**:
- Rozwiazuje pytania wielodokumentowe
- Wykorzystuje graf z ADR-0008 zgodnie z jego przeznaczeniem
- Konstytucja Art. 2 mocno (per-hop verification ucina error propagation)
- Konstytucja Art. 3 mocno (reasoning trace = artefakt audytu reprodukowalny)
- Konstytucja Art. 6 mocno (prawnik widzi i koryguje sciezke)
- Konstytucja Art. 7 zachowana (hop-budget ogranicza ekspansje - NIE wciagamy
  tranzytywnego domkniecia grafu do LLM; tylko zweryfikowana sciezka top-1..top-k)
- Demo dowodzi, ze pattern dziala na lokalnym stacku (Ollama) - zgodne z Art. 1

**Minusy**:
- **Latency** - traversal + per-hop verification dokladaja czas. Mitigation:
  hop-budget 3 + cache zweryfikowanych krawedzi (ADR-0005 ma juz cache, TTL 7
  dni). **Walidacja T3** benchmarkiem
- **Cold start grafu** - jak ADR-0007, multi-hop ma sens dopiero przy gestosci
  grafu. Pusty graf = brak krawedzi do przejscia. Mitigation: flag
  `.env MULTIHOP_ENABLED=false` przez pierwsze 3 miesiace pilotazu, fallback do
  flat retrieval (ADR-0007). Wlaczamy po >100 dokumentach + minimalnej gestosci
  krawedzi (**prog do walidacji T5**)
- **Eksplozja sciezek** - graf gesty = wykladnicza liczba sciezek przy N hopach.
  Mitigation: beam search (top-b sciezek wg sumy score krawedzi z ADR-0007 RRF),
  nie pelny BFS/DFS. `b` configurable, default 5 (**do walidacji T4**)
- **Falszywe krawedzie z ADR-0008** (`confidence: low`) - multi-hop je
  propaguje. Mitigation: traversal domyslnie chodzi tylko po krawedziach
  `confidence >= 0.8` (prog z ADR-0008 auto-accept), krawedzie `low` wymagaja
  potwierdzenia prawnika zanim wejda do sciezki

**Wybrany**.

## Konsekwencje

### Plusy

- Pytania wielodokumentowe (linie orzecznicze, lancuchy derywacji) obslugiwane
- Graf ADR-0008 wykorzystany do wnioskowania, nie tylko rankingu
- Reasoning trace wzbogaca audit bundle (ADR-0006) - dowod *jak*, nie tylko *co*
- Per-hop verification (ADR-0005 reuse) ucina error propagation u zrodla
- Prawnik dostaje klikalna, korygowalna sciezke (Art. 6)
- Pattern lokalny (Ollama + Postgres graf) - zero transferu poza RODO (Art. 1)

### Minusy i ograniczenia

- **Latency** traversal + per-hop verify - hop-budget 3 + beam 5 + cache.
  **Walidacja T3**
- **Cold start** - `MULTIHOP_ENABLED=false` do >100 docs + prog gestosci.
  **Walidacja T5**
- **Eksplozja sciezek** - beam search zamiast pelnego przeszukania. **Walidacja T4**
- **Falszywe krawedzie low-confidence** - traversal tylko po `>= 0.8`, reszta
  za potwierdzeniem prawnika
- **Pytania single-hop** (wiekszosc) NIE zyskuja - dla nich flat retrieval
  (ADR-0007) jest szybszy. Router decyduje: jezeli zapytanie zwraca spojny
  top-k bez potrzeby posrednich ogniw, multi-hop sie nie wlacza. Heurystyka
  "kiedy multi-hop" **do walidacji T2** (kandydaci: zapytanie wspomina relacje
  "linia orzecznicza" / "podtrzymane" / "w zwiazku z", albo top-k retrieval ma
  niski wewnetrzny coherence score)

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump** wspolny z ADR-0007/0008/0009
  (Faza 6, graf). Art. 3 (audytowalnosc) dostaje w "Mechanizmy techniczne"
  punkt `(planowane Faza 6) reasoning trace multi-hop jako artefakt audytu
  AI Act art. 12`. NIE jest to osobny bump - laczy sie z bumpem warstwy grafu
- **Schema SQL** - tabela `reasoning_trace` (kolumny: `response_id`, `hop_index`,
  `from_entity_id`, `relation_type`, `to_entity_id`, `source_doc_id`,
  `source_offset_start`, `source_offset_end`, `verification_status`,
  `edge_confidence`, `created_at`). FK do `extracted_entities` (ADR-0008) i
  `citation_verification` (ADR-0005)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie. Traversal
  dzieje sie **przed** synteza (faza retrieval-augmentation). LLM dostaje
  zweryfikowana sciezke jako kontekst, generuje odpowiedz
- **Brak** zmiany kontraktu ADR-0007 retrieve - multi-hop konsumuje jego output
  (encje startowe), nie modyfikuje go

## Plan migracji (szacunek ~4-5 tygodni, PO ADR-0007 + ADR-0008 w produkcji)

> Twarda zaleznosc: ADR-0016 wymaga dzialajacego `citation_graph` (ADR-0008) i
> hybrid retrieval (ADR-0007). NIE startuje przed nimi.

### Tydzien 1 - traversal engine (bez verification, bez UI)

- [ ] `backend/src/lib/retrieval/graph-traversal.ts` - beam search po
      `citation_graph`, hop-budget z `.env` (`MULTIHOP_MAX_HOPS=3`,
      `MULTIHOP_BEAM=5`), tylko krawedzie `confidence >= 0.8`
- [ ] Input: encje startowe z ADR-0007. Output: lista sciezek (struktura
      `ReasoningPath[]`) ze score
- [ ] Testy: graf syntetyczny 20 wezlow, sprawdz beam + hop-budget + brak
      cykli (visited set)

### Tydzien 2 - router single-hop vs multi-hop

- [ ] `graph-traversal.ts` - heurystyka "kiedy multi-hop" (**walidacja T2**):
      trigger-frazy relacyjne + coherence score top-k z ADR-0007
- [ ] Flag `.env MULTIHOP_ENABLED` (default false do cold-start)
- [ ] Fallback: jezeli multi-hop off albo graf za rzadki - flat retrieval
      (ADR-0007), zero regresji

### Tydzien 3 - per-hop verification (reuse ADR-0005)

- [ ] Wpiec ADR-0005 verifier na kazdy hop PRZED wejsciem do sciezki
- [ ] Krawedz z hopem `unverified` - oznaczona, nie blokuje sciezki ale obniza
      jej score; `blocked` (zrodlo nie istnieje) - hop wyciety
- [ ] Reuse cache cytatow ADR-0005 (TTL 7 dni) dla krawedzi
- [ ] Test: sciezka z 1 falszywym hopem - sprawdz, ze error propagation ucieta

### Tydzien 4 - schema + audit bundle integration

- [ ] Migracja Postgres: tabela `reasoning_trace` (FK do `extracted_entities`,
      `citation_verification`)
- [ ] Audit bundle (ADR-0006) - reasoning trace serializowany do bundla,
      objety hash-chainem (ADR-0001)
- [ ] Test: bundle zawiera odtwarzalna sciezke (reprodukowalnosc Art. 3)

### Tydzien 5 - UI sciezki wnioskowania + human correction

- [ ] Frontend: komponent "Sciezka wnioskowania" - klikalny graf hopow, kazdy
      hop z badge weryfikacji (zielony/pomaranczowy/czerwony z ADR-0005)
- [ ] Prawnik moze odrzucic hop -> re-synteza bez tego hopa
- [ ] i18n: klucze PL w `frontend/messages/` PRZED komponentem (regula AGENTS.md)
- [ ] Decyzja UI: trace domyslnie zwiniety (mniej noise) czy rozwiniety
      (transparency) - **decyzja Wieslawa**

## Status weryfikacji

- [ ] Traversal engine beam search + hop-budget (T1)
- [ ] Router single vs multi-hop + heurystyka trigger (T2)
- [ ] Per-hop verification reuse ADR-0005 (T3)
- [ ] Schema `reasoning_trace` + audit bundle integration (T4)
- [ ] UI sciezki + human correction (T5)
- [ ] Benchmark latency: multi-hop vs flat na zapytaniach wielodokumentowych (T3)
- [ ] Prog gestosci grafu dla `MULTIHOP_ENABLED=true` (T5)
- [ ] Decyzja Wieslawa: hop-budget default 3 czy konfigurowalny per kancelaria
- [ ] Decyzja Wieslawa: trace w UI domyslnie zwiniety czy rozwiniety
- [ ] Decyzja Wieslawa: krawedzie `confidence 0.5-0.8` - czy dopuszczac do
      traversalu za potwierdzeniem prawnika, czy calkowicie poza sciezka

## Licencja blueprintu

Demo `knowledge_graph_rag_citations` jest czescia repo awesome-llm-apps na
licencji **Apache 2.0**. Cherry-pick **wzorca** (multi-hop traversal grafu z
jawnym reasoning trace) NIE jest derivative work. Patron implementuje od zera:

- **Ontologia legal PL** (relacje z ADR-0008: `cytuje_orzeczenie` /
  `derywat_pisma` / `przed_sadem`...), NIE generyczne person/org/concept demo
- **Per-hop verification** wpiety w istniejacy ADR-0005 verifier (SAOS / ISAP /
  EUR-Lex / docs klienta) - demo tego nie ma
- **Reasoning trace jako artefakt AI Act art. 12** w audit bundle z hash-chainem
  (ADR-0001/0006) - demo traktuje trace jako wygode UX, nie dowod zgodnosci
- **Stack**: Postgres `citation_graph` (ADR-0007/0008), NIE Neo4j demo. Ollama
  lokalnie do syntezy (Art. 1), NIE wymuszony provider
- **Beam search + hop-budget** pod Konstytucje Art. 7 (minimalnosc) - demo nie
  ma limitu ekspansji

**NIE portujemy** kodu Python/Streamlit demo. Linkujemy w
`THIRD_PARTY_INSPIRATIONS.md` jako blueprint. Upstream **VeritasGraph**
([bibinprathap/VeritasGraph](https://github.com/bibinprathap/VeritasGraph),
named inspiration demka) - kandydat do osobnej oceny 4-bramkowej, ale **brak
zadeklarowanej licencji** (gh API 2026-05-22) blokuje cherry-pick kodu;
dlatego cherry-pick opieramy wylacznie na publicznym wzorcu demka Apache 2.0.
