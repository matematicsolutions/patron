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

Brama: marko-pl / przeglad jakosci kodu + zielone testy.

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
      patron/NOTICE (attribution forka Mike MIT), CONTRIBUTING.md rebrand z tabela licencji,
      ADR-0002 z uzasadnieniem, Konstytucja AI bump v1.0.0->v1.1.0 (Art. 9 doprecyzowany).
- [ ] 5.5 Dokumentacja uzytkownika kancelarii (PL)

Brama: czysta instalacja na maszynie testowej z zera w < 1h wg runbooka.

## FAZA 6 - Go-to-market

Cel: Patron jest sprzedawalny.

- [ ] 6.1 Branding Patron - logo, identyfikacja, landing page (matematic.co)
- [ ] 6.2 Pilotaz z kancelaria - wdrozenie + feedback
- [ ] 6.3 Pricing (skill matematic-pricing) - model wdrozenia + ew. retainer
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
