# ADR-0125: Model governance krawedzi KGLF (typ-jako-dane, ratyfikacja, run-privacy)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Wybor WM 2026-06-14 (T2.1 z backlogu OpenContracts). Implementacja ETAPOWA: **11a** czysty model `kglf-edge.ts` ZROBIONE (+ rewizja: propozycja GLOBALNA gdy runId null - widoczna, by indekser mogl realnie uzywac proposeEdge bez regresji retrievalu); **11b** persystencja ZROBIONE (kolumny `status/origin/run_id/ratified_*` w `citation_graph`, ALTER w bootstrapie SQLite-only, indekser owija krawedzie przez `proposeEdge`->'proposed'/'analysis'/null); **11c** ratyfikacja ZROBIONE (`kglf-edge-store.ts`: `ratifyStoredEdge`/`getStoredEdge` - akt ludzki przez SQLite, deleguje bramke do `ratifyEdge`). POZOSTAJE jako OSOBNA funkcja (nie niedoróbka tego modelu): UI grafu + route ratyfikacji wolajacy `ratifyStoredEdge` z tozsamoscia prawnika + status-aware weighting w retrieval - wymagaja widoku grafu (ktorego PATRON nie ma) i decyzji UX; budowanie route/UI bez widoku grafu = martwy kod. Stacked na ADR-0124 (branch feat/oc-locator-loose-match).

**Data**: 2026-06-14

**Powiazane zasady**: governance #2 (agent PROPONUJE, czlowiek decyduje - ratyfikacja krawedzi jest aktem ludzkim), Art. 1/3 (czysta, deterministyczna warstwa), Art. 7 (fail-closed: zla etykieta/nie-czlowiek/zly stan -> null).

**Powiazane ADR**: ADR-0008 (auto-ekstrakcja encji+krawedzi - zrodlo propozycji), ADR-0007/0054 (citation_graph, hybrid retrieval konsumujacy krawedzie), ADR-0087 (dual-similarity uzywa grafu). Projekt [[knowledge-graph-law-firms]].

---

## Kontekst

PATRON ma auto-ekstrakcje krawedzi (`extractEntitiesAndEdges`, ADR-0008) do `citation_graph`. Wszystkie krawedzie sa traktowane jednakowo (auto, "prawda maszynowa"), z `relation` jako zamknietym enumem `CitationRelation` (9 typow). Ocena OpenContracts (MIT) wskazala trzy braki wzgledem dojrzalego modelu grafu prawnego:
1. **typ jako enum** - dodanie nowej relacji wymaga zmiany kodu + (potencjalnie) migracji; kancelaria nie rozwija ontologii samodzielnie;
2. **brak ratyfikacji** - auto-krawedz to HIPOTEZA, nie fakt; w produkcie prawnym hipoteza agenta musi byc zatwierdzona przez czlowieka zanim stanie sie "wiedza kancelarii";
3. **brak run-privacy** - niezatwierdzona hipoteza analizy nie powinna wyciekac do innych spraw/runow.

OpenContracts rozwiazuje to wzorcem Relationship (typ-jako-dane + `createdByAnalysis` scoped do runu + promocja przez czlowieka). Bierzemy WZORZEC, nie kod (THIRD_PARTY_INSPIRATIONS.md).

## Decyzja

### Etap 11a (ten commit) - czysty model `kglf-edge.ts`

- **`KglfEdge`** z `relationLabel: string` (typ jako DANE, nie enum) + warstwa governance: `status` (proposed/ratified), `origin` (analysis/human), `runId` (prywatnosc), `ratifiedBy`/`ratifiedAt`.
- **`isValidRelationLabel`** - waliduje KSZTALT (`^[a-z][a-z0-9_]{0,63}$`), nie zamknieta liste: znane etykiety PL i rozszerzenia kancelarii przechodza tym samym sitem, smieci/puste/injection odrzucane.
- **`proposeEdge(edge, runId)`** - owija auto-krawedz jako `proposed`/`analysis` prywatna do runu; fail-closed (zla etykieta/pusty run -> null).
- **`ratifyEdge(edge, actorId, at)`** - AKT LUDZKI: `proposed` -> `ratified` (firm-public, runId=null, zapis kto/kiedy); `origin` bez zmian (ratyfikacja != autorstwo). Fail-closed: tylko proposed (idempotencja), `actorId` musi byc czlowiekiem (nie "analysis"/"system"/pusty - blokuje auto-ratyfikacje omijajaca akt ludzki).
- **`isEdgeVisible(edge, queryRunId)`** - run-privacy: `ratified` zawsze; `proposed` tylko w swoim runie.

Czysta (zero IO/LLM), w pelni testowalna (kglf-edge.test.ts).

### Etap 11b (ZROBIONE) - persystencja
Kolumny w `citation_graph`: `status TEXT NOT NULL DEFAULT 'proposed'`, `origin TEXT NOT NULL DEFAULT 'analysis'`, `run_id TEXT`, `ratified_by TEXT`, `ratified_at TEXT` (ALTER w bootstrapie jak ADR-0124; SQLite-only, doc-graph desktopowy). DEFAULT 'proposed'/'analysis' + run_id null dla istniejacych = backward-compat: auto-krawedzie (stare i nowe) sa propozycjami GLOBALNYMI (widoczne, bez regresji retrievalu - `isEdgeVisible` przepuszcza proposed+run_id=null), ale jawnie NIERATYFIKOWANE. Indekser owija kazda krawedz przez `proposeEdge(.., null)`.

### Etap 11c (ZROBIONE) - ratyfikacja (persystencja)
`kglf-edge-store.ts`: `ratifyStoredEdge(edgeId, actorId, at)` laduje krawedz, deleguje bramke do `ratifyEdge` (tylko proposed, tylko czlowiek), persystuje 'ratified'+run_id null+ratified_by/at; `getStoredEdge`. Cykl propose(indekser)->persist->ratify przetestowany e2e na SQLite.

### Pozostaje (OSOBNA funkcja, nie niedoróbka)
UI grafu (widok krawedzi do ratyfikacji - PATRON go nie ma) + route ratyfikacji (frontend wola `ratifyStoredEdge` z tozsamoscia prawnika; NIE narzedzie agenta - to bramka human-in-the-loop) + opcjonalnie status-aware weighting w retrieval (ratified > proposed) + ontologia jako tabela etykiet (CRUD kancelarii). Budowanie route/UI bez widoku grafu byloby martwym kodem.

### Granica governance
Ratyfikacja to akt ludzki z `actorId` (odpowiedzialny prawnik) - spina sie z actorId-per-tool-call hash-chain (wzorzec BigLaw) i AI Act art. 12. Auto-krawedz = propozycja, nigdy nie "fakt kancelarii" bez czlowieka.

---

## Konsekwencje

**Pozytywne**: czytelny, testowalny model przenoszacy zasade governance #2 na graf wiedzy; ontologia rozszerzalna przez kancelarie bez zmiany kodu; run-privacy chroni niezatwierdzone hipotezy. Fundament pod KGLF i pod rozne projekty (model krawedzi jest domenowo-agnostyczny w warstwie governance).

**Negatywne / koszt**: 11a sam nie zmienia zachowania produktu (model bez persystencji/wpiecia); pelna wartosc po 11b/11c. Backward-compat istniejacego grafu wymaga DEFAULT 'ratified' przy migracji (11b) - swiadomy kompromis udokumentowany wyzej.

**Bramki PRZED merge (11a+11b+11c)**: TSC `--noEmit` exit 0 (SPELNIONE); vitest `src/lib/graph`+`retrieval`+`chat`+`citation` 237/237 (SPELNIONE: model 11a +7, propose globalny/run-scoped + widocznosc; 11b persystencja proposed/analysis przez indekser; 11c ratifyStoredEdge akt-ludzki/idempotencja/nie-czlowiek-odrzucony e2e na SQLite); patron-pr-review PASS; CHANGELOG przy merge; private-remote przed push.
