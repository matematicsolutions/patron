# ADR-0054: Hybrid retrieval + graf cytowan na SQLite (realizacja ADR-0007 i ADR-0008 w stacku zero-cloud)

**Status**: PROPONOWANY (2026-05-28). Realizacja rezerwacji ADR-0007 (hybrid retrieval wektor + BM25 + graf) i ADR-0008 (entity extraction zero LLM) na stacku single-user SQLite z ADR-0053. Warstwa dziala end-to-end (smoke), niewpieta jeszcze w pipeline uploadu ani kontekst czatu.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona, MINOR bump przy wpieciu - realizacja rezerwacji ADR-0007/0008):

- **Art. 2 - Tajemnica zawodowa / zero-cloud** - embeddingi liczone lokalnie w procesie (transformers.js / ONNX), tekst dokumentu nie opuszcza maszyny. Brak zaleznosci od Ollamy ani chmurowego embeddera.
- **Art. 1 - Lokalnosc ekstrakcji** - graf cytowan zasilany przez `extractEntitiesAndEdges` (regex + gazetteery, zero wywolan LLM), zgodnie z ADR-0008.
- **Art. 3 - Audytowalnosc** - ekstrakcja deterministyczna (reprodukowalna), retrieval zwraca realne fragmenty z `doc_chunks` (nie tekst generowany).
- **Art. 4 - Neutralnosc i prostota** - embedder za interfejsem (`lib/retrieval/embeddings.ts`), wymienialny. Warstwa wektorowa wylaczalna (`PATRON_DISABLE_VEC`) z gracefulnym spadkiem do BM25 + graf.
- **Art. 7 - Minimalnosc** - retrieval zwraca top-k fragmentow, nie caly korpus do LLM.

**Powiazane ADR**:

- **ADR-0007** (PROPONOWANY) - rodzic. 3-warstwowy hybrid retrieval z RRF. Ten ADR realizuje go na SQLite (pgvector -> sqlite-vec, tsvector -> FTS5, citation_graph w tabeli SQLite).
- **ADR-0008** (PROPONOWANY) - rodzic. Entity extraction zero LLM. Reuse istniejacego `lib/graph/extractor.ts` + `lib/pl-entities/` bez zmian w logice ekstrakcji.
- **ADR-0053** (PROPONOWANY) - fundament. Bez warstwy SQLite single-user ten ADR nie ma na czym stanac. `vec0` i FTS5 tworzone w `sqlite-connection.ts` po load extension.
- **ADR-0016** (rezerwacja) - multi-hop graph traversal. Tu tylko 1-hop backlink centrality; traversal rekurencyjny (CTE) odlozony.

---

## Decyzja

### A. Warstwa wektorowa - sqlite-vec + lokalny embedder

`vec_chunks using vec0(embedding float[EMBED_DIM])` (sqlite-vec, ladowane w `sqlite-connection.ts`). Embedder `lib/retrieval/embeddings.ts`: transformers.js, model default `multilingual-e5-small` (384d), prefiksy e5 `query:` / `passage:`. Model pobierany raz, liczony w procesie. Zmiana modelu na inny wymiar wymaga re-index (`PATRON_EMBED_DIM` zgodny z modelem).

Pulapka implementacyjna: vec0 wymaga rowid bindowanego jako integer; better-sqlite3 binduje zwykly `number` jako REAL. Insert/delete do `vec_chunks` uzywa `BigInt(rowid)`.

### B. Warstwa BM25 - FTS5

`doc_chunks_fts using fts5(content, tokenize='unicode61 remove_diacritics 2')` (FTS5 wbudowane w better-sqlite3, niezalezne od sqlite-vec). Ranking przez `bm25()`. Zapytanie budowane z tokenow zapytania (OR), bezpieczne dla skladni MATCH (`buildFtsMatch`). Lapie dokladne terminy ktore embedding myli - sygnatury ("III CZP 11/13"), NIP, daty.

### C. Warstwa grafu - citation_graph (SQLite) + reuse extractora

Tabele `extracted_entities` + `citation_graph` (ADR-0008 schema, na SQLite). Indexer wola `extractEntitiesAndEdges` (istniejacy kod, zero zmian), zapisuje encje i krawedzie, mapujac krawedz do encji-celu po lokatorze `ruleId:start:end`. Warstwa grafu w retrievalu szereguje kandydatow (z vec+bm25) wg centralnosci backlink ich dokumentu (ile roznych dokumentow cytuje te same encje). Query-relevant (tylko kandydaci), nie zalewa fuzji centralnymi-ale-nietrafnymi dokumentami.

### D. Fuzja - reciprocal rank fusion

`reciprocalRankFusion(listy, k=RRF_K)`, `RRF_K` default 60 (`PATRON_RRF_K`). Pure, testowalne. `retrieve(query, k, opts)` - `opts` wylacza dowolny silnik (A/B).

### E. Indexer

`lib/retrieval/indexer.ts`: `indexDocument(docId, text)` -> chunk (akapitowo, ~900 znakow) -> embed passages (jezeli warstwa wektorowa aktywna) -> `doc_chunks` + `vec_chunks` + FTS5 -> ekstrakcja encji/krawedzi -> `extracted_entities` + `citation_graph`. Idempotentny (`clearDocumentIndex` przed re-index).

### F. Graceful degradation - PATRON_DISABLE_VEC

Gdy sqlite-vec lub model niedostepny (`PATRON_DISABLE_VEC=1` albo blad load), warstwa wektorowa jest wylaczona, a BM25 + graf dzialaja dalej (Faza 1 wg ADR-0007, akceptowalna). `isVecEnabled()` steruje. Uzywane tez w testach offline.

---

## Roznice wzgledem ADR-0007 (Postgres -> SQLite)

- **pgvector + HNSW** -> **sqlite-vec vec0** (brute-force KNN, bez indeksu ANN). Akceptowalne dla docelowego single-user (rzad wielkosci tysiecy-dziesiatkow tysiecy chunkow); prog oplacalnosci ANN do ustalenia benchmarkiem (rezerwacja).
- **tsvector + pg_trgm PL stemmer** -> **FTS5 unicode61 remove_diacritics**. FTS5 nie stemmuje po polsku, ale dokladne dopasowanie terminow (glowny cel BM25 dla sygnatur) dziala. Stemmer PL do oceny.
- **multilingual-e5-large 1024d przez Ollama** -> **e5-small 384d w procesie (transformers.js)**. Zero zaleznosci od dzialajacej Ollamy. e5-small to ~110 MB wag (384d) vs ~560 MB e5-large (1024d) - mniejszy footprint modelu i wymiar wektora. e5-large opcjonalnie po zmianie `PATRON_EMBED_MODEL` + `PATRON_EMBED_DIM=1024` + re-index.
- **Graf w aplikacji nad Postgres** -> **tabele SQLite**; multi-hop (CTE rekurencyjny, ADR-0016) odlozony, tu 1-hop centralnosc.

---

## Alternatywy odrzucone

1. **Kuzu DB jako osobny silnik grafowy** (roadmapa wymieniala Kuzu). Odrzucone w tej iteracji: druga natywna baza + drugi model mentalny (Cypher) dla korpusu jednego mecenasa to nadmiar. Trawersacja grafu cytowan na tej skali miesci sie w SQLite (rekurencyjne CTE, ADR-0016). Kuzu do rozwazenia gdy pojawi sie analityka grafowa duzej skali (multi-tenant SaaS).
2. **Embedder chmurowy (OpenAI / Voyage) jako default**. Odrzucone: transfer tekstu dokumentu poza maszyne lamie Art. 2. Chmurowy embedder tylko po wyraznym opt-in (rezerwacja), z ostrzezeniem.
3. **Tylko BM25 (bez wektora)**. Odrzucone jako finalne: BM25 nie lapie podobienstwa semantycznego (zapytanie innymi slowami niz dokument). Akceptowalne jako spadek awaryjny (`PATRON_DISABLE_VEC`), nie jako cel.
4. **Chunki z overlapem / chunker zdaniowy zaawansowany**. Odrzucone w MVP: chunker akapitowy ~900 znakow jest deterministyczny i wystarczajacy do pierwszej walidacji. Overlap + tuning rozmiaru = rezerwacja po pomiarze recall.
5. **vec0 z metryka inna niz domyslna**. Odrzucone w MVP: embeddingi e5 sa L2-znormalizowane, wiec dystans domyslny porzadkuje poprawnie. Dostrojenie metryki = rezerwacja.

---

## Bramki PRZED merge (wynik faktyczny)

- **De-risk Windows**: sqlite-vec laduje sie w better-sqlite3 (`vec_version v0.1.9`, vec0 MATCH dziala); transformers.js liczy realny embedding 384d (`multilingual-e5-small`). Oba zweryfikowane przed projektowaniem.
- **TSC clean backend** (`npm run build` exit 0).
- **Vitest backend**: 663 pass / 5 todo / 0 fail (z 655 przed ADR; +8 w `retrieval.test.ts`). Zero regresji.
- **Smoke pelnego stacku** (z modelem, sqlite-vec on): zapytanie semantyczne (bez pokrycia leksykalnego) -> wlasciwy dokument na topie (wektor), zapytanie sygnatura -> wlasciwy dokument (BM25), encja SYGNATURA_ORZECZENIA + krawedz cytuje_orzeczenie zapisane (graf), `vec_chunks` zsynchronizowane z `doc_chunks`.
- **LoC dodanych**: 746 (embeddings.ts 61 + indexer.ts 229 + retrieval.ts 215 + retrieval.test.ts 132 + schema.sqlite.ts +55 + sqlite-connection.ts +54).
- **3 nowe zaleznosci npm**: `sqlite-vec`, `@huggingface/transformers` (+ tranzytywne onnxruntime). Uzasadnienie: lokalne RODO-safe embeddingi + wektor w pliku bazy.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0054

- **Wpiecie w pipeline uploadu** (`input-security/ingest` -> `indexDocument` po skanie bezpieczenstwa) i w **kontekst czatu** (`buildDocContext` -> `retrieve` zamiast ladowania calych dokumentow) -> nastepna jednostka. Warstwa jest zbudowana i przetestowana, ale jeszcze nie wywolywana z zywej sciezki.
- **Audit event `entities.extracted`** -> rezerwacja. event_type poza whitelist (ADR-0035); wpiecie loga wymaga migracji ALTER CHECK + bumpu `EVENT_TYPES` + (tryb supabase) migracji Postgres.
- **Graf boost cold-start flag** (`GRAPH_BOOST_ENABLED`) i tuning wagi backlink -> rezerwacja (ADR-0007 T5).
- **Tuning RRF k** na korpusie PL legal -> rezerwacja (ADR-0007 T4).
- **Multi-hop traversal grafu** (CTE rekurencyjny, reasoning trace) -> ADR-0016.
- **UI grafu** (klikalna mapa relacji) i **panel encji + reczna korekta** -> rezerwacja (ADR-0007 T6, ADR-0008 T6).
- **Reuse warstwy pseudonim** dla imion/firm w grafie -> rezerwacja (ADR-0008 wariant C, T4).
- **Re-embed korpusu przy zmianie modelu** (migracja wektorow) -> rezerwacja.
- **mcp-krs lookup** walidacji firm -> rezerwacja (ADR-0008 T5).
