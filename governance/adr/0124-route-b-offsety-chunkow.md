# ADR-0124: Route B - surowe offsety chunkow dla exact lokatora search-time

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Decyzja Route B (odblokowana przez WM 2026-06-14 po wczesniejszym odlozeniu z ADR-0118). Implementacja ETAPOWA: **9a** `locateChunkSpans` (locator.ts, czysty mapper + testy) ZROBIONE; **9b** migracja `doc_chunks` (offsety) + populacja w indekserze = REZERWACJA; **9c** wpiecie w `search-feed.ts` (exact lokator bez czytania zrodla) = REZERWACJA. Stacked na ADR-0116/0120/0121/0122/0123 (branch feat/oc-locator-loose-match).

**Data**: 2026-06-14

**Powiazane zasady**: Art. 1 (offline, czysta funkcja), Art. 3 (deterministyczne mapowanie), Art. 7 (fail-closed: chunk nieodnaleziony -> null span, feed/grounding robi fallback).

**Powiazane ADR**: ADR-0118 (typed feed - "dokladne kotwiczenie czeka na offsety w doc_chunks, rezerwacja Route B"), ADR-0121 (`collapseWhitespaceWithMap` - reuzyty), ADR-0116 (`locatorFor`/`CitationLocator`), ADR-0054/0083 (indekser/chunker), ADR-0053 (SQLite single-user), ADR-0008 (`extracted_entities` - wzorzec kolumn `source_offset_start/end`).

---

## Kontekst

`search-feed.ts` (ADR-0118) dolacza trwaly lokator do hitow wyszukiwania TYLKO gdy `hit.content` wystepuje doslownie w zrodle. Ale tresc chunka jest znormalizowana whitespace przez indekser (`\s+`->`" "`), wiec w v1 wiekszosc passage'y dostaje anchor "none" (NORMALIZED_NOTE) - mimo ze fragment OCZYWISCIE jest w dokumencie. Zeby kotwiczyc dokladnie, chunk musi niesc swoj surowy span w zrodle.

**Odkrycie upraszczajace**: chunker NIE wymaga reworku. Tresc chunka jest w formie collapsed (single-space, bez nowych linii), wiec jest ciaglym podlancuchem ZWINIETEGO zrodla. Surowy span odzyskujemy ta sama maszyneria collapse co `locatorFromCollapsedQuote` (ADR-0121) - post-hoc, bez dotykania `chunkText`/`chunkLegalText` (zero regresji chunkowania).

## Decyzja

### Etap 9a (ten commit) - `locateChunkSpans` (locator.ts, czysty)

`locateChunkSpans(sourceText, chunkContents): (ChunkSpan|null)[]`:
- jeden `collapseWhitespaceWithMap` na CALY dokument (O(n), nie O(n*m) jak per-chunk `locatorFromCollapsedQuote`),
- **forward-scan kursorem**: chunki w kolejnosci dokumentu; dwa o identycznej tresci dostaja KOLEJNE wystapienia (nie zawsze pierwsze - inaczej niz `locatorFromCollapsedQuote`),
- mapuje granice zwinietego dopasowania z powrotem na surowy span `{start,end}` (UTF-16, end exclusive),
- chunk nieodnaleziony -> `null` (fail-closed); puste zrodlo/chunk -> null.

Niezmiennik: `collapse(sourceText.slice(start,end)).trim() === collapse(content).trim()`; span re-kotwiczalny przez `locatorFor`. Czysta, testowalna (locator.test.ts +5).

### Etap 9b (rezerwacja) - migracja + populacja

- `doc_chunks`: kolumny `source_offset_start INTEGER NULL`, `source_offset_end INTEGER NULL` (nullable - wzorzec `extracted_entities`).
- **Migracja SQLite (decyzja WM 2026-06-14 "ALTER w bootstrapie")**: `schema.sqlite.ts` create-table z kolumnami dla nowych baz + idempotentny guard `ALTER TABLE ADD COLUMN` przy starcie dla istniejacych baz desktop. Backfill = re-index (stare chunki NULL -> feed fallback).
- **Postgres (server)**: osobny plik `migrations/NNN_doc_chunks_source_offsets.sql`.
- Indekser: po `locateChunkSpans(text, pieces.map(p=>p.content))` zapisuje offsety obok chunka (ma surowy `text` w reku, zero dodatkowego IO).

### Etap 9c (rezerwacja) - wpiecie w feed

`retrieve()` zwraca `source_offset_start/end` na `RetrievedChunk`; `buildSearchFeed` gdy offsety obecne buduje lokator wprost z `locatorFor(source, {start,end})` (exact, bez `findOccurrences`) - lub gdy zdecydujemy nie czytac zrodla wcale, lokator z samego spanu. NULL offset (stare chunki) -> dzisiejsza sciezka best-effort.

### Granica governance
Offsety to liczby (pozycje), nie tresc - moga isc gdziekolwiek. `rawText` (tresc) budowany dopiero przy lokatorze z `source.slice` - ta sama granica co ADR-0120 (do SSE/feed, nie audit_log).

---

## Konsekwencje

**Pozytywne**: exact kotwica dla wiekszosci passage'y search-time (dzis "none"); reuzycie sprawdzonej maszynerii collapse (ADR-0121), zero reworku chunkera, zero regresji chunkowania. Etap 9a czysty i niezalezny od migracji.

**Negatywne / koszt**: 9b dotyka migracji (dwa tryby); stare chunki bez offsetow do re-indeksu (graceful fallback). Forward-scan zaklada zgodnosc kolejnosci chunkow z kolejnoscia w zrodle (prawda dla chunkLegalText/chunkText - tna w kolejnosci dokumentu).

**Bramki PRZED merge (9a)**: TSC `--noEmit` exit 0 (SPELNIONE); vitest `src/lib/citation/locator.test.ts` 30/30 (SPELNIONE, +5: mapowanie collapsed->surowy, forward-scan identycznych chunkow, fail-closed null, puste, round-trip przez locatorFor); patron-pr-review PASS; CHANGELOG przy merge; private-remote przed push.
