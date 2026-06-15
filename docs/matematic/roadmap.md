# Patron - mapa drogowa do produktu

Stan na 2026-05-19: Faza 0 (fork + audyt) i Faza 1 (zero-cloud) zamkniete.
Patron dziala end-to-end lokalnie: Supabase + MinIO self-host, backend, frontend,
konektor SAOS przez MCP, SYSTEM_PROMPT PL. Ponizej droga do wersji wdrozeniowej.

Kryterium "koniec projektu": kancelaria moze zainstalowac Patrona u siebie,
jednym stackiem, bez chmury, i uzywac go produkcyjnie do pracy z orzecznictwem
i dokumentami - z audytowalnoscia wymagana przez RODO i AI Act.

---

## FAZA 2 - Polonizacja i jakosc rdzenia

Cel: rdzen jest polski, przetestowany i utrzymywalny. Bez tego nie wolno
pokazywac produktu kancelarii.

- [ ] 2.1 Locale `pl` w UI frontendu (stringi Next, format dat, waluty)
- [ ] 2.2 Rozszerzyc SYSTEM_PROMPT PL - drafting pism PL, terminologia, cytowanie aktow
- [x] 2.3 Rozbic `chatTools.ts` (3000+ linii monolit) na moduly - ZAMKNIETE 2026-05-20.
      chatTools.ts 3325 -> 18 linii (fasada), 12 modulow chat/ (types/prompts/tools/citations/
      messages/pdf/persistence/docx-generate/docx-edit/tool-dispatch/stream + barrel).
- [x] 2.4 Testy Vitest - ZAMKNIETE 2026-05-20. Vitest 4.1.7 + vitest.config.ts + skrypty
      npm test/test:watch. 69/69 zielono w 6 plikach (citations, messages, prompts, mcp,
      persistence, audit). Auth/storage/E2E czatu - pending dla iteracji.
- [x] 2.5 Strukturyzacja `citations` z wynikow MCP - ZAMKNIETE 2026-05-20. McpCitation typ,
      runMcpTool zwraca {text, citations}, mcp-saos wystawia structuredContent.citations,
      chatTools.ts emituje event SSE `mcp_citations`. Front: MikeMcpCitation typ,
      McpCitationsPanel komponent w AssistantMessage, loader rozdziela mieszane annotations,
      persistence w audit_log z dyskryminatorem type:"mcp_citation".
- [x] 2.6 package.json: rename `mike` -> `patron` - ZAMKNIETE w poprzedniej sesji.
- [ ] 2.7 Schema kancelaria - model danych: sprawa/matter, klient, dokumenty per sprawa

Brama: wewnetrzny review tresci + przeglad jakosci kodu + zielone testy.

## FAZA 3 - Konektory (moat MateMatic)

Cel: Patron siega po polskie zrodla prawa. To jest przewaga, nie powloka czatu.
Kazdy konektor = osobny serwer MCP (wzorzec `mcp-saos`).

- [x] 3.1 Konektor orzecznictwa administracyjnego (`orzeczenia.nsa.gov.pl`) -
      ZAMKNIETE 2026-05-20. mcp-nsa (Node + native https + regex HTML parser),
      3 tooly, 427k+ orzeczen NSA + 16 WSA, LIVE smoke test.
- [x] 3.2 Konektor legislacji ISAP/ELI - ZAMKNIETE 2026-05-20. mcp-isap (Node + fetch + REST JSON),
      3 tooly (search_acts/get_act/get_act_text), 96k+ aktow PL od 1918, LIVE smoke test DU/2018/1000.
- [x] 3.3 Konektor KRS - ZAMKNIETE 2026-05-20. mcp-krs (Node + fetch + REST JSON),
      3 tooly (get_entity/get_entity_full/get_board), oficjalne API MS api-krs.ms.gov.pl
      (publiczne, darmowe, zero-cloud-zgodne). Smoke test LIVE: KRS 28860 = ORLEN SA,
      pelne dane podmiotu + reprezentacja + prokurenci + URL wyszukiwarki MS.
      Bonus: Patron NIE uzywa Gaius-Lex (platne, narusza Art. 1 Konstytucji).
- [x] 3.4 eu-sparql-search (CJEU/EUR-Lex) - ZAMKNIETE 2026-05-20. mcp-eu-sparql (Node + SPARQL),
      3 tooly (search_by_celex/search_by_date_range/search_cjeu), LIVE smoke test CELEX 32016R0679.
- [x] 3.5 Rejestr konektorow w `mcp-servers.json` + dokumentacja wpinania - ZAMKNIETE.
      4 wpisy w mcp-servers.json (saos+nsa+isap+eu-sparql), frontend McpCitationsPanel
      etykietuje 4 sekcje cytatow w panelu UI.

Brama: czat odpowiada na pytanie z kazdej domeny (orzecznictwo powszechne,
administracyjne, legislacja, KRS, prawo UE) z weryfikowalnym cytatem.

## FAZA 4 - Compliance i governance

Cel: produkt jest audytowalny - wymog kancelarii (tajemnica zawodowa, RODO,
AI Act). To rozni Patrona od zwyklego czatu.

- [x] 4.1 Audit trail - hash-chain SHA-256, weryfikator CLI, 18 testow atakow,
      wpiete w chat.ts + projectChat.ts. ZAMKNIETE 2026-05-20.
- [ ] 4.2 RODO - rejestr czynnosci przetwarzania, polityka retencji, eksport/usuniecie danych
- [x] 4.3 Konstytucja AI produktu - governance/CONSTITUTION.md (9 zasad + role + audyt + ewolucja),
      governance/IMPLEMENTATION_PLAYBOOK.md (6-8 tygodni + RACI), governance/adr/0001-hash-chain.md.
      ZAMKNIETE 2026-05-20.
- [ ] 4.4 Hardening - przeglad bezpieczenstwa (skill security-and-hardening),
      sekrety, uprawnienia, izolacja
- [~] 4.5 Pseudonim PII PL (Hey Jude cherry-pick + polonizacja forku) - T1 ZAMKNIETY 2026-05-21.
      Postep:
      * 2026-05-20: SKELETON (d715073) - 7 plikow pseudonim/ z 24 testami zielonymi
      * 2026-05-20: regression set PL 20 cases (74b32b0)
      * 2026-05-21: shared library backend/src/lib/pl-entities/ (a5f03c2) - PESEL/NIP/REGON
        9+14/KRS checksumy + 13 regul ekstrakcji + 44 testy, kanoniczne miejsce algorytmow
      * 2026-05-21: refactor pseudonim/detect.ts -> import z pl-entities/checksums (090344d) -
        DRY, REGON i KRS dostaja walidatory, +1 regression test
      * 2026-05-21: gazetteery sady-pl.json + sygnatury-prefix.json + loader (33431e7) -
        37 sadow trzonowych + 41 prefixow izb, 34 nowe testy
      Status: AGPL-3.0 dziedziczone po patron. NIE WPIETE w streamChatWithTools.
      Plan migracji 6-tygodniowy ADR-0003: T2 LLM-fallback Ollama (pending decyzja modelu),
      T3 wrapper za flaga PSEUDONIM_ENABLED (pending decyzja Postgres vs Redis), T4 shadow mode
      pilotazu, T5 fork matematicsolutions/pseudonim-pl, T6 default-on + Konstytucja MINOR bump
      v1.1.1 -> v1.2.0.
- [~] 4.6 Debate + 3-warstwowa weryfikacja dla high-stakes (Lavern cherry-pick) -
      ADR-0004 PROPONOWANY 2026-05-20, commit ADR (e8668b1). T1 LIVE 2026-05-21
      (a0cc2d6) - klasyfikator reguly-based `backend/src/lib/highstakes/` (4 pliki,
      26 testow): 3 bramki (explicitFlag, alwaysHighStakesTypes opinia/M&A/DD/finansowa,
      typ eskalowalny umowa_handlowa/pismo_procesowe + cm_value >= threshold default
      100k PLN), configFromEnv z HIGH_STAKES_CM_VALUE_THRESHOLD + HIGH_STAKES_ALWAYS_TYPES,
      isInputSufficient bezpiecznik (brak danych = nigdy auto-eskalacji). Pure function
      bez wywolan LLM, deterministyczny audit.
      T2-T6: evaluator + 3 adversarial + synthesizer + 10-pass verifier (kazdy jako
      modul lib/debate/), wpiec w streamChatWithTools z .env DEBATE_ENABLED=false default,
      UI progress streaming, audit log debate transcript do bundle ADR-0006, metryki
      debate.draft_vs_synthesized_delta, pilotaz kancelarii.
      Konstytucja Art. 2 (weryfikowalnosc) + Art. 7 (minimalnosc danych - selektywna
      eskalacja) - bump 1.1.1 -> 1.2.0 wspolnie z 4.5/4.7/4.8/4.9/4.10/4.11.
- [~] 4.7 Mechaniczna weryfikacja cytatow preflight (citation grounding, Lavern cherry-pick) -
      ADR-0005 PROPONOWANY 2026-05-20. Kazdy cytat orzeczenia/przepisu/dokumentu
      klienta przechodzi fuzzy string-match (Levenshtein 0.95) z parsed source
      (mcp-saos pelne brzmienie, mcp-isap artykul, indeks PDF/DOCX projektu).
      3-stopniowy signal: verified / unverified / blocked. Cache parsed orzeczen
      (Postgres lub Redis, TTL 7 dni). UI badge per cytat. Plan migracji 6-tygodniowy
      w governance/adr/0005. Konstytucja Art. 2 - bump 1.1 -> 1.2.
- [~] 4.8 Audit bundle dla zgodnosci z AI Act art. 12 (Lavern + video governance cherry-pick) -
      ADR-0006 PROPONOWANY 2026-05-20, commit ADR (e8668b1). Bundle = deliverable +
      debate_transcript + citation_verification + audit_log_excerpt (hash-chain integrity
      proof) + cost_log + pseudonim_map_excerpt (szyfr osobnym kluczem per kancelaria) +
      prompts_used + model_versions + manifest + signature. Auto-gen dla high-stakes
      (z klasyfikatora 4.6), opt-in dla pozostalych. CLI `audit:bundle:verify`
      dla regulatora. Parafraza AI Act art. 12 z CELEX 32024R1689 + link EUR-Lex.
      Plan migracji 4-tygodniowy w governance/adr/0006.
      Konstytucja Art. 3 (audytowalnosc) + Art. 7 (minimalnosc - bundle tylko dla
      high-stakes) - bump 1.1.1 -> 1.2.0.

- [~] 4.9 Hybrid retrieval 3-warstwowy (gbrain cherry-pick) - ADR-0007 PROPONOWANY 2026-05-21
      (e8668b1). Trzy silniki rownolegle + reciprocal rank fusion (k=60 default):
      (1) wektor multilingual-e5-large przez Ollama lokalnie (1024d, RODO-safe), opcja
      ZeroEntropy/OpenAI/Voyage po opt-in .env z ostrzezeniem;
      (2) BM25 Postgres tsvector z polskim stemmerem (pg_trgm + unaccent) - lapie sygnatury
      orzeczen ktore embedding myli;
      (3) graf cytowan z backlink-boosted ranking - dokument cytowany w 3+ opiniach kancelarii
      dostaje boost (orientacyjnie +20-40%, do walidacji T2).
      Cold start grafu 3 miesiace z GRAPH_BOOST_ENABLED=false. Plan 6-tygodniowy w
      governance/adr/0007.
      Konstytucja Art. 2/4/7/9 - bump 1.1.1 -> 1.2.0.

- [~] 4.10 Entity extraction at write-time, zero LLM calls (gbrain cherry-pick) -
      ADR-0008 PROPONOWANY 2026-05-21 (e8668b1). T1+T2 LIVE 2026-05-21 (a5f03c2 + 33431e7
      + 6a88957):
      * pl-entities/ shared library - 13 regul ekstrakcji (PESEL/NIP/REGON 9+14/KRS +
        email + telefon +48 + 5 kategorii sygnatur SN/NSA/WSA/KIO/TK + CELEX/ELI +
        firmy z forma prawna)
      * gazetteery sady-pl.json (37 sadow) + sygnatury-prefix.json (41 prefixow izb) +
        loader gazetteers.ts z parseSignaturePrefix dla 16 typowych formatow
      * backend/src/lib/graph/ extractor - extractEntitiesAndEdges() z ontologia legal PL
        (9 typow CitationRelation: cytuje_orzeczenie / cytuje_przepis / strona_postepowania
        / reprezentuje / wzorzec_aneksowany / derywat_pisma / przed_sadem / wspomina_firme
        / wspomina_osobe), context-based confidence boost (slowa-trigger "sygn.", "wyrok",
        "uchwala" +0.2; prefix znany w gazetteerze +0.1), enrichSignatureMetadata
        rozszyfrowuje WSA sigPrefix na konkretny sad
      T3-T6: schema SQL extracted_entities + citation_graph, wpiec w lib/docparse.ts
      post-parse hook, reuse output pseudonim/ dla imion/firm (T4), mcp-krs lookup
      walidacja (T5), UI panel encji + manual corrections (T6).
      Konstytucja Art. 1/3/4/7 - bump 1.1.1 -> 1.2.0.

- [~] 4.11 Nocna konsolidacja pamieci + self-healing cytatow (gbrain cherry-pick) -
      ADR-0009 PROPONOWANY 2026-05-21 (e8668b1). Cron 03:00 + przycisk "konsoliduj teraz"
      w UI:
      (1) re-weryfikacja cytatow >30 dni (SAOS/ISAP/EUR-Lex aktualizacje), flaga
          citation_stale + audit log;
      (2) konserwatywna deduplikacja encji - merge wymaga PESEL/NIP/KRS, same imie =
          NIE merge (krytyczne: dwoch klientow Jan Kowalski);
      (3) purge orphans 90d (ORPHAN_RETENTION_DAYS configurable);
      (4) audit chain check incremental + full;
      (5) morning brief markdown w UI rano.
      Job idempotentny, monitorowany przez systemd timer. Plan 6-tygodniowy w
      governance/adr/0009.
      Konstytucja Art. 2/3/6/9 - bump 1.1.1 -> 1.2.0.

Brama: audyt bezpieczenstwa + checklista legal-ai-plugin-governance przechodza.

## FAZA 5 - Pakowanie i wdrozenie

Cel: jeden instalowalny stack. Kancelaria stawia Patrona bez wiedzy devops.

- [x] 5.1 Jednolity `docker-compose` calego Patrona (powloka + Supabase + MinIO)
      ZAMKNIETE 2026-05-20. backend/Dockerfile (multi-stage Node 20 + libreoffice + non-root),
      frontend/Dockerfile (Next.js standalone), docker-compose.yml, .env.docker.example,
      scripts/bundle-mcp.cjs (cross-platform).
- [x] 5.2 Instalator / runbook wdrozeniowy + skrypt pierwszego uruchomienia (sekrety, schema)
      ZAMKNIETE 2026-05-20. deploy/README.md - 12-stopniowy runbook z troubleshooting + backup section.
- [ ] 5.3 Backup szyfrowany (wzorzec matematic-workspace-backup) - art. 32 RODO
- [x] 5.4 Decyzja licencyjna AGPL - ZAMKNIETE 2026-05-20. Dual-license stack:
      patron AGPL-3.0-only (powloka), 5 konektorow MCP MIT (infrastruktura).
      LICENSE pliki we wszystkich 6 repo (4 nowe MIT dla mcp-nsa/isap/krs/eu-sparql),
      patron/NOTICE (attribution forka Mike AGPL-3.0), CONTRIBUTING.md rebrand z tabela licencji,
      ADR-0002 z uzasadnieniem, Konstytucja AI bump v1.0.0->v1.1.0 (Art. 9 doprecyzowany).
      Update 2026-05-22: dodany 6. konektor mcp-eu-compliance (MIT) - ADR-0022/0023.
      Stack to obecnie patron + 6 mcp-* (7 repo lacznie).
- [ ] 5.5 Dokumentacja uzytkownika kancelarii (PL)

Brama: czysta instalacja na maszynie testowej z zera w < 1h wg runbooka.

## FAZA 6 - Go-to-market

Cel: Patron jest sprzedawalny.

- [ ] 6.1 Branding Patron - logo, identyfikacja, landing page (matematic.co)
- [ ] 6.2 Pilotaz z kancelaria - wdrozenie + feedback
- [ ] 6.3 Pricing - model wdrozenia + ew. retainer
- [ ] 6.4 Narracja "Made by Poland" - aktualnosc/post LI, pozycja vs BetterCallMitch/Harvey

---

## Sciezka krytyczna i decyzje

- Krytyczne: 2.3 (refactor) i 2.4 (testy) blokuja wszystko dalsze - dlug
  techniczny rosnie z kazda funkcja dolozona do monolitu bez testow.
- Konektory (Faza 3) mozna rozwijac rownolegle - sa niezalezne (osobne MCP).
- Decyzja AGPL (5.4) - moze zostac otwarta do Fazy 5, nie blokuje budowy.
- Faza 4 (compliance) to argument sprzedazowy - nie pomijac, to rozni produkt.

## Co poza zakresem (swiadomie)

- Wlasny model LLM - Patron jest bring-your-own-model (Gemini/Claude/lokalny).
- Mobile app - web wystarcza dla kancelarii.
- Multi-tenant SaaS - Patron jest self-host per kancelaria (to jest teza zero-cloud).
