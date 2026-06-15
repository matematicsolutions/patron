# ADR-0011: Span-level character offsets + column type taxonomy (extends ADR-0010)

**Status**: Proponowany (cherry-pick uzupelniajacy ADR-0010, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona v1.1.1, Art. 3 (audytowalnosc - cytat per komorka musi byc mechanicznie weryfikowalny), Art. 4 (neutralnosc dostawcow - taxonomia kolumn pozostaje agnostyczna wobec dostawcy embeddings), Art. 7 (minimalnosc - prawnik definiuje typ pytania, Patron nie odgaduje)
**Powiazane ADR**: ADR-0005 (citation grounding mechaniczny - ten ADR uszczegolawia format cytatu), ADR-0007 (hybrid retrieval - typ kolumny `span` korzysta z hybrid retrieval), ADR-0008 (entity extraction - typ kolumny `entity` korzysta z extraction worker), ADR-0010 (contract review module - ten ADR uzupelnia model danych komorki tabeli)
**Inspiracja cherry-pick**: [isaacus-dev/cookbooks/tabular-review](https://github.com/isaacus-dev/cookbooks/tree/main/cookbooks/tabular-review) (MIT, autor Isaacus, snapshot 2026-04-22). **NIE forkujemy** - cherry-pick patternu modelu danych komorki tabeli i rozroznienia typu kolumny. Caly pipeline AI Patron pisze od zera pod multi-provider + RODO-safe + Postgres.

## Decyzja

ADR-0010 (Contract Review Module) zdefiniowal modul tabular review na poziomie UI i pipeline. Ten ADR **uszczegolawia model danych komorki tabeli i rozroznia typ kolumny** wzorujac sie na patternie API isaacus tabular-review.

Wprowadzamy:

1. **Format komorki `cell` z character offsets** w dokumencie zrodlowym:
   ```typescript
   interface Cell {
     value: string;                  // wartosc widoczna w gridzie
     metadata: {
       segment_id: string;           // identyfikator segmentu zrodlowego (akapit/pkt/sekcja)
       start: number;                // offset znaku poczatku cytatu w dokumencie
       end: number;                  // offset znaku konca cytatu w dokumencie
     };
     score: number | null;           // dla typu 'span' - cosine similarity; dla 'entity' - null
     confidence: 'high' | 'medium' | 'low' | 'failed';  // ADR-0005 mechanical
     extracted_by: string;           // identyfikator modelu (np. 'ollama:bielik-7b-q4')
   }
   ```
   Format jest **kompatybilny z ADR-0005 citation grounding** (offsety pozwalaja deterministycznie wyciagac cytat z `documents.content` w Postgres) i wpina sie w hash-chain (ADR-0001) jako pelna sygnatura komorki.

2. **Taxonomia typu kolumny `col_type`**:
   - **`span`** - kolumna typu *retrieval* (semantic search). Worker pyta hybrid retrieval (ADR-0007) z thresholdem cosine (domyslnie 0.4, konfigurowalny per projekt). Zwraca najlepszy span z dokumentu jako wartosc komorki. Use-case: "Jaka jest klauzula MFN?" -> zwraca cytat z umowy.
   - **`entity`** - kolumna typu *structured extraction*. Worker pyta entity extractor (ADR-0008) o konkretny atrybut. Zwraca identyfikator (lub liste identyfikatorow) z grafu wiedzy projektu. Use-case: "Kto jest strona umowy?" -> zwraca `[ORG_1, ORG_2]` z linkiem do encji w grafie.
   - **`boolean`** (rozszerzenie poza isaacus) - kolumna typu *yes/no extraction*. Worker odpowiada tak/nie + cytat wspierajacy. Use-case: "Czy umowa zawiera klauzule change of control?" -> `true` + cytat.
   - **`enum`** (rozszerzenie poza isaacus) - kolumna typu *classification* z predefiniowana lista wartosci. Worker klasyfikuje. Use-case: "Prawo wlasciwe umowy" -> jedna z `[PL, EN, DE, US, ...]`.

3. **Threshold filtering w UI** - prawnik widzi w gridzie indykator pewnosci per komorka. Kolor:
   - zielony: `score >= 0.7` ALBO `confidence: high` (entity z weryfikacja w grafie)
   - zolty: `0.4 <= score < 0.7` ALBO `confidence: medium`
   - czerwony: `score < 0.4` ALBO `confidence: low` (poniza thresholdu, fallback z empty)
   - szary: `confidence: failed` (extraction worker zwrocil blad, np. timeout LLM)

## Kontekst

ADR-0010 ustanowil tabular contract review jako modul, ale **operowal na poziomie wartosci komorki bez formalnego modelu danych**. Wpisy w T3 ADR-0010 mowily:

> extraction worker zwraca nie tylko wartosc komorki ale tez offset cytatu w dokumencie zrodlowym (uses ADR-0005)

To wystarczalo do MVP, ale 2 problemy stoja na drodze do pilota u kancelarii:

**Problem 1: Brak rozroznienia typu pytania**. Pytanie "Jakie jest prawo wlasciwe umowy?" jest *enum* (jedna z 5 wartosci). Pytanie "Jaka jest klauzula MFN?" jest *span* (cytat z umowy). Pytanie "Kto jest strona umowy?" jest *entity* (lista podmiotow). Bez rozroznienia typu kolumny Patron probowalby ten sam pipeline dla wszystkich, marnujac LLM calls i degradujac jakosc.

Isaacus tabular-review rozroznia `span` vs `entity` jako pierwszoklasowy `col_type` w API:

```python
# Z notebooka isaacus
{
  "query": "What are the confidentiality obligations?",
  "col_type": "span"  # albo "entity"
}
```

To prosta dystynkcja, ale **krytyczna dla kosztu i jakosci** - inne typy kolumn idą inną sciezką przetwarzania.

**Problem 2: Brak konfigurowalnego thresholdu i widocznosci pewnosci**. ADR-0010 wspomina `confidence_score` jako mitigacje ryzyka, ale nie definiuje skali ani UX. Prawnik audytujacy 47 umow MUSI widziec ktora komorka jest "zielona", "zolta", "czerwona" zeby skoncentrowac wzrok na watpliwych. Isaacus uzywa `threshold` (domyslnie 0.4 cosine) jako filtr w Qdrant - prosta liczba, prosta kalibracja.

## Co bierzemy z isaacus tabular-review (cherry-pick)

1. **Format komorki z `metadata.segment_id + start + end`** - przekladamy 1:1 na nasze Postgres `cells.metadata` JSONB. Offsety sa znakami w `documents.content`, segment_id mapuje na `documents.segments[i].id`.
2. **Taxonomia `col_type: span | entity`** - przyjmujemy jako pierwszorzedne pola w `columns.col_type`. Rozszerzamy lokalnie o `boolean` i `enum` (legal use-cases polskie wymagaja).
3. **Threshold filtering** - `projects_contract_review.threshold_cosine` (default 0.4, prawnik moze podniesc do 0.6 dla strict mode).
4. **Score per komorka** w UI - kolor indykator (zielony/zolty/czerwony/szary) na podstawie `score` + `confidence`.

## Czego NIE bierzemy

1. **Kanon 2 Enricher / Embedder / Answer Extractor** - **closed-weight API Isaacus** (US/AU SaaS). Konflikt z Konstytucja Art. 1 (lokalnosc) i Art. 4 (neutralnosc dostawcow). Patron uzywa wlasnej warstwy: `multilingual-e5` (Ollama) dla embeddings, `pl-entities` + Ollama LLM dla extraction.
2. **ILGS (Isaacus Legal Graph Schema)** - hierarchiczna segmentacja units/items/containers. Patron polega na Docling (ADR-0010) i istniejacym `pl-entities` grafie. ILGS jest tu zbedny.
3. **Qdrant w pamieci** - isaacus uzywa Qdrant in-memory. Patron uzywa pgvector w Postgres (ADR-0007) jako single-source. Zero dodatkowego servisu.
4. **FastAPI server architektury** - isaacus opiera viewer o FastAPI endpoint. Patron uzywa istniejacego API TS Patrona (`/api/v1/contract-review/cells/extract`).

## Refactor pod architekture Patrona

| Element isaacus tabular-review | Refactor Patrona |
|---|---|
| `kanon-2-embedder` model API | `multilingual-e5-large` lokalnie (Ollama). Embeddings w `documents.embeddings` (pgvector). |
| `kanon-2-enricher` (ILGS knowledge graph) | Istniejacy `pl-entities` graf + Docling segmenty (ADR-0010 T1). |
| `kanon-answer-extractor` (QA) | Multi-provider LLM (Ollama default, Claude/Gemini opt-in) wywolywany przez `services/contract-review/extraction.ts` (ADR-0010 T2). |
| Qdrant in-memory | pgvector w Postgres (ADR-0007). Threshold w SQL `WHERE 1 - (embedding <=> query_embedding) >= $threshold`. |
| `col_type: span | entity` | `columns.col_type ENUM ('span', 'entity', 'boolean', 'enum')` w Postgres. |
| Cell `metadata.segment_id + start + end` | `cells.metadata JSONB` z polami `segment_id`, `start_char`, `end_char`. Cytat re-derywowalny: `SELECT substring(content from start_char+1 for end_char-start_char) FROM documents WHERE id=...`. |
| Cell `score` | `cells.retrieval_score NUMERIC(4,3)` (cosine 0.000-1.000) NULL dla `entity`/`boolean`/`enum`. |
| Threshold filtering | `projects_contract_review.threshold_cosine NUMERIC(3,2) DEFAULT 0.4`. UI slider dla prawnika. |

## Algorytm wyznaczania pola `confidence`

Pole `confidence: 'high' | 'medium' | 'low' | 'failed'` jest **wyliczane mechanicznie** w extraction worker (nie subiektywna ocena LLM). Regula per typ kolumny:

- **`col_type = 'span'`**:
  - `high` - `score >= 0.7` ORAZ mechanical citation check (ADR-0005) przeszedl (cytat re-derywowalny z `start_char/end_char/segment_id`, byte-equal z `documents.content`)
  - `medium` - `0.4 <= score < 0.7` ORAZ ADR-0005 check przeszedl
  - `low` - `score < 0.4` ALBO ADR-0005 check fail przy score >= 0.4 (cytat nie zgadza sie z dokumentem, hallucination ryzyko)
  - `failed` - extraction worker rzucil wyjatek (timeout LLM, retrieval pusty, bledny segment_id)

- **`col_type = 'entity'`**:
  - `high` - entity wskazany przez LLM wystepuje w `pl-entities` grafie projektu z >=2 wystapieniami w dokumentach datasetu
  - `medium` - 1 wystapienie w grafie
  - `low` - entity wskazany przez LLM, brak wystapien w grafie (hint bez weryfikacji)
  - `failed` - LLM nie zwrocil zadnego entity lub format niezgodny ze schema

- **`col_type = 'boolean'`**:
  - `high` - odpowiedz tak/nie + cytat wspierajacy przeszedl ADR-0005 check
  - `low` - odpowiedz tak/nie bez cytatu lub cytat fail ADR-0005 (komorka wartosc `null` zamiast tak/nie, zeby nie zafalszowac)
  - `failed` - LLM nie zwrocil tak/nie lub format niezgodny

- **`col_type = 'enum'`**:
  - `high` - klasyfikator zwrocil wartosc z predefiniowanej listy + cytat wspierajacy ADR-0005 ok
  - `medium` - wartosc z listy ale cytat niepelny (czesciowo wystepuje w dokumencie)
  - `low` - wartosc z listy bez cytatu wspierajacego
  - `failed` - klasyfikator zwrocil wartosc spoza listy (mimo constrained generation) lub timeout

`medium` nie wystepuje dla `boolean` (nie ma posredniego stanu). Powyzsze progi sa default; per projekt prawnik moze podniesc `high` na 0.8 cosine dla *strict mode*.

## Plan migracji (uzupelnia plan ADR-0010 T1-T7)

Ten ADR **nie dodaje nowych tygodni do roadmapy** - uszczegolawia T2 (Extraction worker) i T4 (Frontend grid) z ADR-0010:

- **T2 (uszczegolowienie)**: Extraction worker rozpoznaje `col_type` i kieruje requesta do odpowiedniego pipeline:
  - `span` -> hybrid retrieval (ADR-0007) z thresholdem; zwraca top-1 span z `segment_id + start_char + end_char + score`
  - `entity` -> entity extractor (ADR-0008); zwraca liste entity IDs z grafu projektu
  - `boolean` -> LLM yes/no + cytat wspierajacy (musi przejsc mechanical citation check ADR-0005)
  - `enum` -> LLM classification z predefiniowana lista wartosci (constrained generation)
- **T4 (uszczegolowienie)**: Frontend grid renderuje kolory per komorka na podstawie `score`/`confidence`. Threshold slider w project settings. Tooltip nad komorka pokazuje `metadata.segment_id`, fragment cytatu (substring 200 znakow z highlightem).

## Konsekwencje

**Pozytywne:**

- Patron komorki tabeli sa **mechanicznie weryfikowalne** - cytat re-derywowalny z offsetow, audit hash-chain ma pelna sygnature.
- Prawnik widzi gdzie skoncentrowac uwage (zolte/czerwone komorki) - oczekiwana redukcja czasu audytu wzgledem flat gridu jest hipoteza do walidacji na pilocie u kancelarii w T7 ADR-0010 (porownanie czasu audytu 20 umow w trybie z indykatorem vs bez).
- Threshold konfigurowalny - kancelaria *strict* (0.6) vs *exploratory* (0.3) tryb pracy.
- Taxonomia `col_type` otwiera droge do nowych typow w przyszlosci (np. `date_range`, `currency_amount`) - czysta hierarchia w Postgres.

**Negatywne / koszty:**

- Wieksza zlozonosc UI grid - kolor per komorka, tooltip, threshold slider. Dodatkowe ~3 dni dev w T4.
- Migracja schema: `cells.metadata JSONB`, `cells.retrieval_score`, `columns.col_type ENUM`, `projects_contract_review.threshold_cosine`. Migracja idempotentna, default values dla istniejacych rekordow.
- Extraction worker dluzszy o gałąź `col_type` routing (~50 lin TS).

**Ryzyka:**

- **Kalibracja thresholdu 0.4** - isaacus uzywa tej wartosci dla angielskich umow + Kanon 2 Embedder. Polskie umowy + multilingual-e5 moga miec inna optymalna wartosc. Mitigacja: test set 30 par (query, expected_span) z umow polskich, kalibracja w T2.
- **Hallucination ryzyko w `boolean`/`enum`** - LLM moze "uzgodnic" yes/no bez cytatu. Mitigacja: mechanical citation check ADR-0005 jest hard requirement (komorka `null` jesli cytat nie da sie zwerifikowac).
- **score=null dla `entity` myli prawnika** - jak interpretowac "brak score"? UX decyzja: dla `entity` pokazujemy `confidence: high` jesli entity ma >=2 wystapienia w grafie projektu, `medium` jesli 1, `low` jesli LLM hint bez weryfikacji w grafie.

## Atrybucja

Pattern modelu danych komorki tabeli i rozroznienia typu kolumny (`span` vs `entity`):
cherry-pick z [isaacus-dev/cookbooks/tabular-review](https://github.com/isaacus-dev/cookbooks/tree/main/cookbooks/tabular-review)
(MIT, autor Isaacus, snapshot 2026-04-22, commit z `pushed_at=2026-04-22T23:49:16Z`).

Implementacja pipeline AI Patrona (multilingual-e5 zamiast Kanon 2 Embedder,
pl-entities zamiast ILGS, multi-provider LLM, Postgres+pgvector zamiast
in-memory Qdrant, rozszerzenia `boolean`/`enum` poza taxonomie isaacus,
RODO-safe + audit hash-chain) - **napisane od zera** pod architekture Patrona
i wymagania kancelarii polskich. NIE jest to fork ani tlumaczenie.

Wpis do `THIRD_PARTY_INSPIRATIONS.md` przy commicie tego ADR - sekcja "isaacus-dev/cookbooks (MIT)".

## Decyzja oczekiwana od Wieslawa

1. **Czy taxonomia `col_type` ograniczona do `span | entity` (jak isaacus)** czy rozszerzona o `boolean | enum` (jak proponujemy) - decyzja zakres v1?
2. **Czy threshold cosine domyslny 0.4** (isaacus default) czy 0.5 (strict default dla legal)? Kalibracja w T2 zweryfikuje, ale potrzebujemy startowej wartosci.
3. **Kolory indykatora** zielony >=0.7, zolty 0.4-0.7, czerwony <0.4 - akceptujemy czy zmienic progi?
4. **Wpiecie ADR** + wewnetrzny review 2x runda PRZED commitem (zgodnie z wewnetrznego review tresci).
