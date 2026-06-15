# ADR-0113: Proweniencja strony w chunkach RAG - cytat "str. N"

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P2 #10. `doc_chunks` trzymal tylko `chunk_index`, bez numeru strony -> RAG nie potrafil wskazac "str. N" przy cytacie (styl pism mecenasa: "cytat + sygnatura + strona"). `documents.structure_tree` to tylko outline/lista stron, BEZ tekstu/offsetow per strona - nie nadaje sie do mapowania chunk->strona.

## Decyzja

Wykorzystanie istniejacych markerow: `extractPdfText` (`lib/chat/pdf.ts`) JUZ poprzedza tekst kazdej strony markerem `[Page N]`. Pion:

1. **Schema:** `doc_chunks.page_no INTEGER` (nullable, bez CHECK) - w `SQLITE_SCHEMA` (swieze bazy) + `ensureSchemaUpgrades` ADD COLUMN (istniejace; stare chunki page_no=null do re-indeksu).
2. **Indexer:** nowy `splitByPageMarkers(text)` dzieli tekst na segmenty per strona po `[Page N]`; `indexDocument` chunkuje KAZDY segment osobno i taguje chunki `page_no`. Brak markerow (docx/plain) -> jeden segment `page=null` -> `chunkLegalText(text)` jak dotad (zero regresji). Marker `[Page N]` NIE wchodzi juz do tresci chunku (dotad zanieczyszczal embeddingi/FTS - latentny bug naprawiony przy okazji).
3. **Retrieve:** `RetrievedChunk.pageNo` + `page_no` w obu sciezkach SELECT (z/bez rerank).
4. **search_corpus:** pole `page` w wynikach -> model moze cytowac "str. N" z RAG (parytet z czytaniem przez `[Page N]` w read_document i polem `page` w kontrakcie <CITATIONS> SYSTEM_PROMPT).

## Konsekwencje

- (+) Pinpoint citation "str. N" dla cytatow z RAG - zgodnie ze stylem pism kancelarii. Dane sa w warstwie backendu (page_no), gotowe pod render w cytacie.
- (+) Naprawiony latentny bug: markery `[Page N]` nie trafiaja juz do embeddingow/FTS (czystszy retrieval).
- (~) Chunkowanie per strona: chunk nie przekracza granicy strony (fakt na styku stron ciety na granicy). Dla pinpoint citation to akceptowalne/pozadane; ADR-0083 (ciecie po jednostkach redakcyjnych) dziala teraz w obrebie strony.
- (~) Render "str. N" w UI cytatu = frontend (poza tym repo) - backend dostarcza dane.
- (-) Stare chunki maja page_no=null do re-indeksu - brak regresji (null = jak dotad).
- **Testy:** vitest 1149 pass / 0 fail / 5 todo. `pageProvenance.test.ts` (+5): parser markerow (brak/rozbicie/wstep), page_no end-to-end przez indexDocument+retrieve, brak markera w tresci chunku, back-compat null dla zrodel bez stron.
