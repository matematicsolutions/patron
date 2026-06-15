# ADR-0007: Hybrid retrieval (wektor + BM25 + graf z backlink-boosted ranking)

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalnosc - retrieval musi
zwracac realne fragmenty zrodla, nie wymyslone), Art. 4 (neutralnosc wobec dostawcow -
warstwa retrieval niezalezna od konkretnego embeddera), Art. 7 (minimalnosc - retrieval
zwraca top-k najbardziej trafnych fragmentow, nie caly korpus do LLM), Art. 9
(dostepnosc wiedzy - graf cytowan wzmacnia widocznosc rzadkich orzeczen)
**Powiazane ADR**: ADR-0005 (citation grounding - retrieval karmi verifier),
ADR-0006 (audit bundle), wzorzec architektoniczny
[garrytan/gbrain](https://github.com/garrytan/gbrain) (MIT)

## Decyzja

Patron wprowadza **3-warstwowy hybrid retrieval** dla wyszukiwania w lokalnym
korpusie projektu (dokumenty klienta, notatki, wczesniejsze odpowiedzi Patrona,
zapisane orzeczenia z mcp-saos). Kazde zapytanie biegnie rownolegle przez trzy
silniki:

```
zapytanie -> [silnik wektorowy]  -> top-k_v fragmentow + score_v
          -> [silnik BM25]       -> top-k_b fragmentow + score_b
          -> [silnik grafu]      -> top-k_g fragmentow + score_g (backlink-boosted)
          -> reciprocal rank fusion -> top-k finalne -> kontekst dla LLM
```

Trzy silniki:

1. **Wektor** (pgvector + HNSW). Embedding lokalny (multilingual-e5-large przez
   Ollama, 1024d) - default RODO-safe. Opcjonalnie ZeroEntropy / OpenAI / Voyage
   po wlaczeniu flagi `.env` (z ostrzezeniem o transferze poza UE).

2. **BM25** (Postgres `tsvector` z polskim stemmerem `pg_trgm` + `unaccent`).
   Lapie dokladne dopasowania terminow ktore embedding czesto myli (sygnatury
   typu "III CZP 11/13", numery NIP, daty publikacji DzU).

3. **Graf cytowan** (tabela `citation_graph` z krawedziami `cited_by`,
   `mentions_party`, `derived_from`). Ranking dokumentu rosnie liniowo z
   liczba dokumentow z projektu ktore go cytuja - **fragment cytowany przez
   3 wczesniejsze opinie kancelarii dostaje boost** (orientacyjnie +20-40%
   do score, **do walidacji T2**).

Wyniki laczone przez **reciprocal rank fusion**:
`score_final(d) = sum_silnik (1 / (k + rank_silnik(d)))`, k=60 (standardowy default
RRF z literatury, **do walidacji T4** czy nie warto zmienic dla domeny PL legal).

## Kontekst

Obecny Patron (fork willchen96/mike) uzywa **tylko wyszukiwania wektorowego**
(pgvector cosine similarity, OpenAI embedding default). To ma trzy
udokumentowane slabosci:

- **Sygnatury orzeczen i numery przepisow** (III CZP 11/13, art. 415 KC,
  CELEX 32016R0679) - embedding traktuje je jak zwykle stringi, nie lapie
  dokladnego dopasowania. Zapytanie "co orzekl SN w III CZP 11/13" czesto
  zwraca **inne** orzeczenia z domeny tematycznej, nie konkretne. **BM25 to
  rozwiazuje**.

- **Rzadkie orzeczenia** (np. SKO, KIO, niepublikowane). Embedding training
  data underrepresent polski legal corpus, vector neighborhood
  niewystarczajacy. **Graf cytowan** (jezeli kancelaria cytowala juz
  to orzeczenie w 2 wczesniejszych pismach) wzmacnia widocznosc.

- **Brak signal "wlasna praca kancelarii"** - dokument cytowany w 5
  wczesniejszych opiniach Patrona jest najpewniej **istotny** dla biezacego
  zapytania. Vector similarity tego nie widzi.

[gbrain Garry'ego Tana](https://github.com/garrytan/gbrain) pokazuje pattern
**hybrid 3-warstwowy z backlink-boosted ranking** na produkcji (17.8k★, MIT;
wg [gbrain README](https://github.com/garrytan/gbrain) benchmark autora vs
OpenAI/Voyage zglasza 2.2x szybciej i 2.6x taniej - **do walidacji T0**
niezaleznym benchmarkiem na korpusie PL legal, niekoniecznie odtwarzalne).
Patron cherry-pickuje
**wzorzec architektoniczny**, NIE kod (TS gbrain operuje na ontologii VC
dealflow: `works_at` / `invested_in` / `founded` - irrelevant dla PL legal).

## Rozwazane sciezki

### Wariant A - tylko wektor (status quo)

**Plusy**: prostota, jedna kolumna w schema, jeden silnik.

**Minusy**: trzy slabosci powyzej, **udokumentowane** w pilotazu mike na ~50
zapytaniach (sygnatura missed rate ~30%, **do walidacji T1** na biezacym
korpusie Patron). Konstytucja Art. 2 spelniona slabo - retrieval zwraca
fragmenty "podobne tematycznie", nie "dokladnie te cytowane przez prawnika".

**Odrzucony**.

### Wariant B - wektor + BM25 (hybrid 2-warstwowy)

**Plusy**: rozwiazuje slabosc sygnatury. Standardowy pattern w nowoczesnych
RAG (LangChain, LlamaIndex - default).

**Minusy**: nie wykorzystuje signalu "wlasna praca kancelarii" / graf cytowan.
Dla kancelarii ktora pracuje na powtarzajacych sie tematach (RODO,
zamowienia publiczne) to **strata** - dokumenty cytowane wielokrotnie sa
najpewniej najistotniejsze.

**Odrzucony jako finalny, akceptowalny jako Faza 1**.

### Wariant C - hybrid 3-warstwowy z grafem (WYBRANY)

Wektor + BM25 + graf cytowan z RRF fusion.

**Plusy**:
- Rozwiazuje wszystkie trzy slabosci
- Graf cytowan sluzy podwojnie: retrieval boost ORAZ audit bundle
  (ADR-0006) ma dowod "ten fragment byl cytowany w X wczesniejszych opiniach"
- Backlink-boost wzmacnia powtarzalnosc kancelarii - jezeli prawnik
  cytowal orzeczenie w 5 opiniach, 6-ta opinia z duzym prawdopodobienstwem
  tez powinna je rozwazyc (**do walidacji T5** na realnym korpusie)
- gbrain pokazuje ze pattern dziala produkcyjnie - wg
  [Little Might explainer 2026](https://www.littlemight.com/g-brain/)
  na deploy Garry'ego Tana 17888 stron / 4383 osob / 723 firm (atrybucja
  zewnetrzna, **nie wlasna walidacja**)

**Minusy**:
- Schema rozrasta sie o 2 tabele (`bm25_index` zarzadzane przez Postgres,
  `citation_graph` rzeczna w aplikacji)
- Latency retrieval +50-150 ms (trzy queries rownolegle, **do walidacji T3**
  benchmarkiem)
- Cold start: graf cytowan pusty na poczatku, boost = 0 dla nowej kancelarii.
  **Mitigation**: przez pierwsze 3 miesiace pilotazu graf nie wplywa na rank
  (flag `.env GRAPH_BOOST_ENABLED=false`), tylko sie buduje. Po 100+
  dokumentach w korpusie wlaczamy boost.

**Wybrany**.

## Konsekwencje

### Plusy

- Konstytucja Art. 2 spelniona **silnie** (retrieval zwraca realne fragmenty,
  BM25 + graf wzmacniaja precyzje)
- Konstytucja Art. 4 (neutralnosc dostawcow) - warstwa abstrakcji nad
  embedderem, default lokalny multilingual-e5, opcja chmurowa po flagize
- Konstytucja Art. 7 - top-k zamiast caly korpus do LLM (mniej tokenow)
- Audit bundle wzbogacony - dla kazdego cytatu w odpowiedzi Patrona znamy
  **wszystkie 3 score'y** (vec / bm25 / graf), prawnik widzi *czemu*
  retrieval pokazal ten fragment
- Backlink-boost wykorzystuje **wlasna prace kancelarii** jako signal
  (powtarzajace sie tematy, podobne sprawy)

### Minusy i ograniczenia

- **Latency retrieval +50-150 ms** (3 queries rownolegle przez async).
  Akceptowalne (LLM call to 3-10s, retrieval to <5% narzutu). **Walidacja
  T3** benchmark.
- **Schema 2 nowe tabele** (`citation_graph` + indexy BM25 na `documents`).
  Migracja jednorazowa, nie zaburzajaca existing data.
- **Cold start grafu** 3 miesiace pilotazu z flag `GRAPH_BOOST_ENABLED=false`.
  Pattern znany z systemow rekomendacji (Spotify Discover Weekly, Netflix) -
  bootstrap moze byc takze przez "graf semantyczny" (orzeczenia cytujace sie
  wzajemnie wyciagniete z parsed PDFs przed Patron pilotazem) - **wariant
  do walidacji T5**, ryzyko false-positive cytowan
- **Embeddery alternatywne** (jezeli kancelaria chce OpenAI dla jakosci) -
  trzeba re-embed korpus po przelaczeniu. Mitigation: kolumna `embedding`
  + `embedding_model`, dopuszczamy mixed-model w korpusie z degradacja
  precyzji (vec scores niewporownywalne miedzy modelami)
- **RRF k=60** - arbitralny default z literatury. **Walidacja T4** -
  dostroic na 100 zapytaniach pilotazu (czy lepiej k=40 / k=80 dla PL legal)
- **Nie pomaga jezeli korpus jest pusty** - graf zaczyna sie budowac dopiero
  od 1. zapisanego dokumentu. Pierwsze 10-20 zapytan w nowej kancelarii =
  retrieval wektor+BM25 only

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump v1.2.0 -> v1.3.0** planowany PO
  wpieciu warstwy do produkcji (laczy sie z ADR-0008 + ADR-0009). Art. 9
  (dostepnosc wiedzy) dostaje w sekcji "Mechanizmy techniczne" punkt
  `(planowane Faza 6) hybrid retrieval 3-warstwowy z grafem cytowan`
- **Schema SQL** - nowa tabela `citation_graph` (kolumny: `from_doc_id`,
  `to_doc_id`, `relation_type`, `extracted_at`, `confidence_score`) +
  indexy BM25 na `documents.content_tsv` (Postgres `tsvector` PL).
- **Kontrakty LLM** - sygnatura `retrieve` w `lib/retrieval/` zmienia sie
  z `retrieve(q, k)` na `retrieve(q, k, opts: RetrievalOpts)` gdzie opts
  pozwala wylaczyc dowolny z 3 silnikow (dla A/B testow)

## Plan migracji 6-tygodniowy

### Tydzien 1 - benchmark obecnego retrieval + zbiorka zapytan

- [ ] Skrypt `scripts/retrieval-bench.ts` - 50 realnych zapytan z pilotazu
      (anonimizowanych) + groundtruth (jaki fragment **powinien** byc na
      top-3 wedlug prawnika)
- [ ] Baseline: current vector-only retrieval, mierzymy recall@3, recall@10,
      MRR (mean reciprocal rank), latency p50/p95
- [ ] Cel: po 6 tygodniach poprawa recall@3 o >20% (**do walidacji T6**)

### Tydzien 2 - BM25 layer

- [ ] Migracja Postgres: `documents.content_tsv` jako `tsvector` z polskim
      stemmerem (`config_pl` z `pg_trgm` + `unaccent`)
- [ ] `backend/src/lib/retrieval/bm25.ts` - query builder + ranking
- [ ] Re-bench: vector vs BM25 vs RRF(vector+BM25). Spodziewane: RRF
      poprawia recall@3 o 5-15% (**do walidacji T2**)

### Tydzien 3 - graf cytowan (cold start, bez boost)

- [ ] Migracja Postgres: tabela `citation_graph`
- [ ] `backend/src/lib/retrieval/graph.ts` - extractor (ekstrakcja cytowan
      przy zapisie dokumentu, **wpiec do ADR-0008 entity extraction**)
- [ ] Flag `.env GRAPH_BOOST_ENABLED=false` - graf sie buduje, nie wplywa
      na rank jeszcze
- [ ] Test extractora na 20 dokumentach: precision >0.85, recall >0.7
      (**do walidacji T3**)

### Tydzien 4 - RRF fusion + tuning k

- [ ] `backend/src/lib/retrieval/fusion.ts` - reciprocal rank fusion
- [ ] Benchmark k=40 / 60 / 80 na zbiorze T1
- [ ] Wybor finalnego k, wpisanie do `.env` (`RRF_K=60` default)

### Tydzien 5 - graf boost on (jezeli korpus >100 dokumentow)

- [ ] Wlaczenie `GRAPH_BOOST_ENABLED=true` dla pilotazowej kancelarii
      jezeli ma >100 dokumentow w korpusie. Mniejszy korpus = czekamy
- [ ] Re-bench - czy graf boost daje dodatkowe +5-10% recall@3 (**do
      walidacji T5**)
- [ ] A/B test: pol prawnikow z boost, pol bez - subjective rating
      "trafnosc retrievalu" 1-5

### Tydzien 6 - UI debug panel + audit bundle integration

- [ ] UI: badge per cytowany fragment "wektor 0.82 / BM25 0.71 / graf 0.6"
      (toggleable, debug-mode)
- [ ] Audit bundle (ADR-0006) - dla kazdego cytatu w odpowiedzi zapisz
      `retrieval_scores` JSON {`vec`, `bm25`, `graf`}
- [ ] Decyzja Wieslawa: ujawniac scores w UI prawnikowi (transparency)
      czy tylko w audit bundle (mniej noise)

## Status weryfikacji

- [ ] Benchmark baseline vector-only (T1)
- [ ] BM25 indexy + tsvector PL migracja (T2)
- [ ] `bm25.ts` query builder + ranking
- [ ] Graf cytowan migracja + extractor (T3, wpiec do ADR-0008)
- [ ] RRF fusion module + k-tuning (T4)
- [ ] Graf boost on dla pilotazu >100 docs (T5)
- [ ] UI debug panel retrieval scores
- [ ] Integracja z audit bundle (ADR-0006)
- [ ] Decyzja Wieslawa: embedder default - multilingual-e5 (lokalny RODO)
      vs OpenAI (jakosc, ale chmura). Rekomendacja: multilingual-e5
      default, OpenAI po wyraznym opt-in `.env`
- [ ] Decyzja Wieslawa: RRF k default 60 czy wlasna dostrojona wartosc
      po T4
- [ ] Decyzja Wieslawa: cold-start grafu - bootstrap z parsed PDFs
      (T5 wariant ryzykowny) vs czekamy az kancelaria zbuduje organicznie

## Licencja blueprintu

gbrain jest **MIT**. Cherry-pick **wzorca** (hybrid 3-warstwowy retrieval
z backlink-boosted graphem) NIE jest derivative work. Patron implementuje
od zera w wlasnym ekosystemie (Postgres + multilingual-e5 Ollama + PL
stemmer + ontologia legal `cited_by` / `mentions_party` / `derived_from`,
nie VC `works_at` / `invested_in` / `founded`). Linkujemy w
`THIRD_PARTY_INSPIRATIONS.md` jako blueprint. **NIE portujemy** kodu TS
gbrain - jego implementacja jest zwiazana z ontologia VC dealflow Garry'ego
Tana, irrelevant dla PL legal corpus.
