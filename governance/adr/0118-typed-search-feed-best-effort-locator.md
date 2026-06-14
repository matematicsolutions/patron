# ADR-0118: Typed search feed (search->read->cite) z best-effort lokatorem

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Modul `search-feed.ts` (pure shaper) gotowy, eksportowany, przetestowany; wpiecie jako narzedzie agenta + emisja SSE `{type:"citations"}` = rezerwacja (osobny ADR).

**Data**: 2026-06-14

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: czysty shaper nad wynikiem `retrieve()` (lokalny hybrid search). Zero egress, zero LLM.
- **Art. 3 - Audytowalnosc**: deterministyczny - te same hity + to samo zrodlo daja ten sam feed i te same kotwice.
- **Art. 7 - Minimalnosc / rzetelnosc**: feed jest UCZCIWY - `anchor: "exact"|"none"` + `note` jawnie sygnalizuja, czy zbudowano trwaly lokator i dlaczego nie. Brak fabrykowania pozycji; lokator powstaje TYLKO gdy tresc fragmentu wystepuje doslownie w zrodle (niezmiennik ADR-0116).

**Powiazane ADR**:
- ADR-0116 (trwaly lokator) - feed dolacza `CitationLocator` przez `locatorFor`/`findOccurrences`. Niezmiennik verbatim dziedziczony.
- ADR-0117 (bounded document text) - drugi slice T1.1; razem: search (0118) -> read okno (0117) -> cite lokator (0116).
- ADR-0005 (grounding) - feed NIE zastepuje weryfikacji; dostarcza kandydatow z kotwicami, ktore grounding (0005) i tak waliduje przy odpowiedzi.
- ADR-0007/0054/0087/0089 (retrieval/rerank) - `retrieve()` zostaje bez zmian; 0118 tylko nadaje ksztalt jego wynikowi.

Inspiracja: Open-Source-Legal/OpenContracts (MIT), narzedzie `search_corpus` jako typowany feed (dyskryminator passage/block, kazdy hit nosi kotwice cytatu, honesty przy pustym wyniku). Patrz THIRD_PARTY_INSPIRATIONS.md. WZORZEC, nie kod.

---

## Kontekst

`search_corpus` (`lib/chat/tool-dispatch.ts`) zwraca dzis ad-hoc `JSON.stringify({query, results:[{document_id, filename, chunk_index, score, text}], note})`. Trzy braki wzgledem wzorca OpenContracts:
1. **Brak typowanej koperty** - kazde narzedzie serializuje wlasny ksztalt; agent dostaje luzny JSON.
2. **Hit nie nosi kotwicy cytatu** - `RetrievedChunk{chunkId, documentId, chunkIndex, content, score}` nie ma offsetu ani strony; tresc chunka jest dodatkowo ZNORMALIZOWANA whitespace w indekserze (`p.replace(/\s+/g," ")`), wiec nie jest verbatim wycinkiem zrodla.
3. **Brak jawnej honesty** - tylko `note` przy zupelnie pustym wyniku.

WM (2026-06-14) wybral droge: **typowana koperta teraz + lokator best-effort bez migracji**, dokladnosc kotwiczenia ulepszymy pozniej (Route B: offsety w doc_chunks).

---

## Decyzja

Dodac `backend/src/lib/citation/search-feed.ts` - czysty shaper `buildSearchFeed(query, hits, resolveSource, options?)` zwracajacy `SearchFeed`.

### Typy

```ts
type FeedGranularity = "passage" | "block" | "both";
type AnchorKind = "exact" | "none";
interface FeedPassageHit {
  type: "passage";
  documentId: string; chunkIndex: number; score: number; text: string;
  locator: CitationLocator | null;   // ADR-0116; null gdy nie da sie verbatim
  anchor: AnchorKind;                 // honesty: czy zbudowano trwaly lokator
  anchorNote?: string;               // powod (brak zrodla / normalizacja / wieloznacznosc)
}
type FeedHit = FeedPassageHit;
interface SearchFeed { query: string; granularity: FeedGranularity; total: number; results: FeedHit[]; note?: string }
type FeedSourceResolver = (documentId: string) => string | null;
```

### Logika kotwiczenia (best-effort, niezmiennik zachowany)

Dla kazdego hita: `source = resolveSource(documentId)`.
- `source == null` => `anchor:"none"`, `locator:null`, note "brak tekstu zrodlowego".
- inaczej `findOccurrences(hit.text, source)`:
  - 0 wystapien => `anchor:"none"`, `locator:null`, note "tresc znormalizowana, brak verbatim" (typowy przypadek przez normalizacje chunka - uczciwie sygnalizowany).
  - >=1 => `locator = locatorFor(source, {start: pierwsze, end})`, `anchor:"exact"`. Gdy >1 wystapien: `anchorNote` "wieloznaczne - zakotwiczono pierwsze (retrieval nie dostarcza offsetu)".

Pusty feed => `note` "Brak trafien w korpusie..." (lustro istniejacego `search_corpus`).

`granularity` jest zapisywany w kopercie; v1 emituje WYLACZNIE `passage`. `block` (agregacja poddrzewa) = rezerwacja.

### Co pozostaje zarezerwowane (nie w 0118)

1. **Wpiecie w `tools.ts` + `tool-dispatch.ts`** (narzedzie zwracajace SearchFeed) ze scopingiem `projectId -> documents(status=ready) -> documentIds` (BEZ tego feed przecieka miedzy projektami) - osobny ADR.
2. **Route B (dokladne kotwiczenie)** - offsety w `doc_chunks` (wzorzec `extracted_entities.source_offset_*`), wtedy lokator na KAZDYM hicie. v1 best-effort: exact-or-null.
3. **Route A+ (relokacja po znormalizowanym oknie z mapowaniem na surowy offset)** - alternatywa runtime; wieksza skutecznosc niz exact-only, kosztem mapy indeksow. Rezerwacja.
4. **`block` granularity / agregacja poddrzewa** - PATRON nie ma subtree; rezerwacja.

---

## Konsekwencje

**Pozytywne**:
- Typowana koperta + dyskryminator `passage` ustala kontrakt feedu; Route B/A+ pozniej tylko wypelniaja lokatory bez zmiany ksztaltu.
- `anchor`/`anchorNote`/`note` daja agentowi i audytowi UCZCIWY sygnal pewnosci kotwicy zamiast cichej luki (Art. 7).
- Gdy chunk jest verbatim (krotkie frazy, naglowki, komorki tabel, dokladne cytaty) lokator powstaje od razu i komponuje sie z `reanchor` (0116) i oknem (0117) - pelny lancuch search->read->cite.
- Czysty shaper, zero IO, `import type` na RetrievedChunk - brak runtime-couplingu z warstwa retrieval; trywialny test.

**Negatywne / koszt**:
- Przez normalizacje chunka w indekserze wiekszosc passsage'y dostanie `anchor:"none"` w v1. To swiadomy, uczciwy stan przejsciowy - pelne kotwiczenie czeka na Route B. Feed pozostaje uzyteczny (typowany, rankowany, z tekstem), a kotwica pojawia sie tam, gdzie jest pewna.
- Wieloznacznosc (ten sam fragment wielokrotnie) kotwiczona do pierwszego wystapienia, bo retrieval nie dostarcza offsetu - sygnalizowane `anchorNote`.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` exit 0.
- Testy zielone: `src/lib/citation/search-feed.test.ts` (pusty feed -> note; hit verbatim -> anchor exact + niezmiennik slice; source null -> none; tresc nie-verbatim -> none + note; wieloznacznosc -> exact + anchorNote, lokator na pierwszym; granularity zapisany; round-trip locator feedu -> reanchor ten sam span; kolejnosc i total wielu hitow) plus pelny backend bez regresji.
- Marko 2x na tym ADR przed merge. Merge na osobnej galezi, bramka private-remote przed push.
