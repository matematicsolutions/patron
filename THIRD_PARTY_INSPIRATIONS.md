# Third-party inspirations

Patron czerpie z otwartych projektow OSS w domenie legal-tech i AI
governance **wzorce architektoniczne** (patterny, struktury, decyzje
projektowe), zachowujac przy tym **wlasna implementacje** w ekosystemie
prawa polskiego.

Cherry-pick **wzorca** (idea / pattern) NIE jest derivative work. Cherry-pick
**kodu** podlega licencji projektu zrodlowego. Patron eksplicitnie
oznacza, ktora droga wybrano dla kazdego przypadku.

## sure-scale/hey-jude (AGPL-3.0)

**Repo**: https://github.com/sure-scale/hey-jude
**Licencja**: AGPL-3.0
**Pattern wzorcowany**: pseudonimizacja PII przed wywolaniem LLM
(detect -> map -> wrap LLM call -> unwrap response).

**Co Patron bierze (wzor)**:
- 4-etapowa architektura warstwy pseudonimizacji
  (detect entitities -> build token map -> wrap prompt -> unwrap response)
- Skladnia tokenow `[PERSON_1]`, `[ORG_2]` jako deterministyczna,
  czytelna dla czlowieka w logach
- Pattern *separable middleware* - warstwa wlaczalna flaga `.env`
  bez zmian kontraktu LLM

**Czego Patron NIE bierze**:
- Kodu Python / FastAPI / Redis Hey Jude (Patron jest TypeScript /
  Node / Postgres - reimplementacja od zera)
- Angielskiego promptu detekcji (Patron polonizuje: PESEL, NIP, REGON,
  KRS, polskie formy prawne, polska fleksja imion - patrz ADR-0003,
  Discovery 1)
- OpenAI-compatible API jako wymuszonego interfejsu

**Wdrozenie**: ADR-0003 (skeleton TS w powloce Patrona, AGPL-3.0
dziedziczone po Patronie). Planowany przyszly fork
`matematicsolutions/pseudonim-pl` jako derivative work Hey Jude
(licencja AGPL-3.0 zachowana).

## AnttiHero/lavern (Apache 2.0)

**Repo**: https://github.com/AnttiHero/lavern
**Licencja**: Apache 2.0
**Pattern wzorcowany**: orchestracja debate + verification dla
zadan high-stakes; mechaniczna weryfikacja cytatow; audit bundle.

**Co Patron bierze (wzor)**:
- 5-fazowy debate pipeline (evaluator -> adversarial builder -> attacker
  -> synthesizer -> 10-pass verifier) z brama klasyfikatora high-stakes
  (ADR-0004)
- Preflight mechanical citation verifier (string-match LLM-quote
  vs parsed_source) z 3-stopniowym signalem
  verified / unverified / blocked (ADR-0005)
- Audit bundle pattern: deliverable + debate transcript + verification
  + cost log alongside the output (ADR-0006), wzmocniony PL-specific
  rozszerzeniami (pseudonim_map_excerpt z ADR-0003, hash-chain
  audit_log_excerpt z ADR-0001)
- Provider-agnostyczny adapter tool-calling: `ToolRegistry` budowany z
  definicji narzedzi MCP, odporny fallback per narzedzie (zlamane
  inputSchema nie kladzie calego rejestru). Plik wzorcowy
  `src/providers/tool-converter.ts` (ADR-0014 T2b)
- Precedent board: pamiec ustalen (findings) per klient - index po
  przetworzeniu, query przed nowym dokumentem, izolacja per klient,
  confidence-decaying, evidence-linked. Plik wzorcowy
  `src/claw/precedent-board.ts` (ADR-0018). Pamiec WNIOSKOW, odrebna od
  retrieval dokumentow (ADR-0007)

**Czego Patron NIE bierze**:
- 67 promptow agentow (Lavern celuje w US contract review,
  semantyka anglosaska common law - irrelevant dla PL)
- 5 datasetow contract review jako RUNTIME / tresc PL (CUAD, MAUD, ACORD,
  UNFAIR-ToS, LEDGAR - korpus anglosaski, IRR dla polskiego prawa). Wyjatek:
  LEDGAR uzyty WYLACZNIE jako zbior testowy mechanizmu groundingu w osobnym
  projekcie eval (nie w runtime Patrona, nie redystrybuowany) - patrz "Status
  wdrozenia" nizej
- Workflow templates contract review (US-centric)
- Branding Clawern, menubar UI
- Kodu TypeScript Lavern (Patron implementuje od zera w wlasnym
  ekosystemie konektorow PL: mcp-saos, mcp-isap, mcp-eurlex)

**Wdrozenie**: ADR-0004 (debate + verification), ADR-0005 (citation
grounding), ADR-0006 (audit bundle), ADR-0014 T2b (adapter tool-calling),
ADR-0018 (precedent board). Implementacja PL od zera, nie port kodu.

**Status wdrozenia (2026-05-29)**: ADR-0005 poziom 1 (dokumenty klienta) LIVE -
deterministyczny weryfikator `lib/citation/grounding.ts` wpiety w `chat/stream.ts`,
walidowany na eval harness (LEDGAR/lex_glue CC BY-SA 4.0 uzyte WYLACZNIE jako
zbior testowy mechanizmu w osobnym projekcie legal-eval-harness, NIE jako runtime
PL ani redystrybuowane dane - patrz nizej "NIE bierze 5 datasetow"). Domkniete
warstwami widocznymi (ADR-0065): UI badge 3-stopniowy + persystencja werdyktu +
audit summary. Konstytucja v1.3.4. Poziomy 2/3 (SAOS / ISAP-EUR-Lex) rezerwacja.
ADR-0006 RDZEN (audit bundle) LIVE - `lib/audit-bundle.ts` builder + offline
verifier CLI `audit:verify-bundle`, integralnosc SHA-256 (reuse audit-pack), bundle
sklejajacy deliverable + grounding + audit_log_excerpt; bez podpisu (rezerwacja
ADR-0049), bez auto-trigger/UI/schema (rezerwacja). Konstytucja v1.3.5 (ADR-0066).
Pozostale ADR z blueprintu: 0004 (debate), 0014 (adapter, prawie zywy przez
OpenRouter ADR-0059), 0018 (precedent board) - nadal blueprint.

**Watch**: v0.16+ Lavern czy autor dorobi EU connectors (EUR-Lex /
CJEU) - roadmap wspomina bez timeline. Status 2026-06-17 do 07-01 -
potencjalnie mocniejszy cherry-pick lub bezposrednie uzycie konektorow
jako dependency.

## garrytan/gbrain (MIT)

**Repo**: https://github.com/garrytan/gbrain
**Licencja**: MIT
**Pattern wzorcowany**: warstwa pamieci dla agenta - hybrid retrieval
(wektor + BM25 + graf z backlink-boosted ranking), entity extraction przy
zapisie bez wywolan LLM, nocna konsolidacja pamieci z self-healing cytatow.

**Co Patron bierze (wzor)**:
- Hybrid 3-warstwowy retrieval (wektor + BM25 + graf) z reciprocal rank
  fusion - ADR-0007. Backlink-boost wykorzystuje wlasna prace kancelarii
  jako signal trafnosci
- Entity extraction at write-time, zero LLM calls (regex + gazetteer +
  checksumy) - ADR-0008. Reuse output warstwy pseudonim (ADR-0003) dla
  imion/firm
- Overnight memory consolidation z cron jobs + self-healing cytatow + dedup
  encji + purge orphans + audit chain check - ADR-0009

**Czego Patron NIE bierze**:
- Kodu TypeScript gbrain (Patron implementuje od zera w wlasnym ekosystemie
  konektorow PL)
- Ontologii VC dealflow gbrain (typed links `works_at` / `invested_in` /
  `founded` / `advises` - irrelevant dla PL legal). Patron wprowadza
  ontologie legal PL (`cytuje_orzeczenie` / `strona_postepowania` /
  `reprezentuje` / `wzorzec_aneksowany` / `derywat_pisma` / `przed_sadem`)
- ZeroEntropy jako default embedder (US API, RODO red flag). Patron default
  to multilingual-e5 przez Ollama lokalnie. ZeroEntropy/OpenAI/Voyage
  dostepne po wyraznym opt-in `.env` z ostrzezeniem
- Stack Postgres+pgvector tightly coupled - Patron dziedziczy stack z forku
  willchen96/mike
- Branding "Garry Tan's brain" / OpenClaw / Hermes - Patron pitched dla
  polskich kancelarii prawnych, US VC brand-association = anty-referencja
- Hermes (agent runner Tana) - workflow CEO YC (X/Twitter ingest, VC
  people CRM), niekompatybilny z domena PL legal. Patron uzywa **wlasnej
  orkiestracji** (flota subagentow MateMatic, ekosystem Anthropic skills)

**Wdrozenie**: ADR-0007 (hybrid retrieval), ADR-0008 (entity extraction
zero-LLM), ADR-0009 (overnight consolidation). Implementacja PL od zera,
nie port kodu gbrain. Bumpa Konstytucji v1.2.0 -> v1.3.0 wspolny dla
wszystkich trzech ADR PO wpieciu Faza 6.

**Decyzje strategiczne**:
- **NIE instalujemy** gbrain jako runtime dependency. Cherry-pick wzorca,
  reimplementacja od zera. Powod: ontologia VC niekompatybilna, brand
  toxicity, stack mismatch (Patron leci na audytowalnym TS+Postgres,
  nie zmieniamy)
- **NIE forkujemy** gbrain. Powod: 80% rewrite (ontologia, gazetteery,
  regex PL) = lepiej napisac od zera niz utrzymywac fork
- **NIE pozyczamy** brand-association. THIRD_PARTY_INSPIRATIONS.md to
  uczciwa atrybucja patternu, NIE marketing referencyjny dla klientow
  kancelarii

**Watch**: monitoring kierunku rozwoju gbrain (czy autor doda EU/RODO
features, czy ontologia legal w roadmap). Status 2026-08 do 2026-10 -
ponowny check czy v0.5+ ma cokolwiek bezposrednio uzytecznego dla PL.

## willchen96/mike (MIT - baza forka)

**Repo**: https://github.com/willchen96/mike (original)
**Licencja**: MIT
**Pattern wzorcowany**: caly szkielet aplikacji asystenta dokumentowego
(chat / projekty / tabular reviews / workflowy / lib/llm) jako baza
Patrona.

**Co Patron bierze**: hard fork - rdzen aplikacji.

**Co Patron dodaje / zmienia**:
- Pelna polonizacja UI (i18n iter 1-4, ~180 kluczy w slowniku PL)
- Konektor mcp-saos (orzeczenia PL)
- Skill eu-sparql-search (EUR-Lex / CJEU)
- Skill saos-orzecznictwo + legal-data-hunter-pl (zrodla PL)
- Stack zero-cloud (Supabase + MinIO self-hosted, ADR-0002 dual-license)
- Hash-chain audit log (ADR-0001)
- Pseudonimizacja PII pre-LLM (ADR-0003, skeleton)
- Planowane: debate (ADR-0004), citation grounding (ADR-0005), audit
  bundle (ADR-0006)
- Stack governance: Konstytucja, IMPLEMENTATION_PLAYBOOK, USER_GUIDE,
  17 ADR-ow (0001-0017)

**Licencja**: Patron jako derivative work willchen96/mike pozostaje
w schemacie dual-license (powloka AGPL-3.0 + konektory MIT), patrz
ADR-0002.

## isaacus-dev/cookbooks (MIT)

**Repo**: https://github.com/isaacus-dev/cookbooks (folder `cookbooks/tabular-review`)
**Licencja**: MIT
**Snapshot**: 2026-04-22 (pushed_at z gh API)
**Pattern wzorcowany**: model danych komorki tabular review z character-offset
grounding + taxonomia typu kolumny + self-contained HTML viewer.

**Co Patron bierze (wzor)**:
- **Format komorki** `metadata: {segment_id, start, end}` + `score` + viable
  re-derivation cytatu z offsetow (ADR-0011)
- **Taxonomia `col_type: span | entity`** (Patron rozszerza o `boolean`,
  `enum` dla polskich legal use-cases - ADR-0011)
- **Threshold cosine filtering** (default 0.4, konfigurowalny per projekt -
  ADR-0011)
- **Self-contained single-file HTML viewer** (Vue 3 + Tailwind/Lucide z
  CDN/inline fallback, drag-drop JSON, zero install u klienta) - czwarty
  format eksportu obok docx/csv/audit-bundle (ADR-0012)
- **Entity filtering UI** z color coding per typ encji + hover popup z
  metadata + resizable panes (ADR-0012)

**Czego Patron NIE bierze**:
- **Kanon 2 Enricher / Embedder / Answer Extractor** - closed-weight API
  Isaacus (US/AU SaaS). Konflikt z Konstytucja Art. 1 (lokalnosc) i Art. 4
  (neutralnosc dostawcow). Patron uzywa `multilingual-e5` (Ollama lokalnie)
  zamiast Kanon 2 Embedder, `pl-entities` + Ollama LLM zamiast Kanon
  Answer Extractor.
- **Wewnetrzny format isaacus** (skrot "ILGS" uzywany w README isaacus bez
  rozwiniecia w publicznej dokumentacji; hierarchiczna segmentacja
  units/items/containers). Patron polega na Docling pipeline (ADR-0010)
  i istniejacym grafie `pl-entities`.
- **Qdrant in-memory** - Patron uzywa pgvector w Postgres (ADR-0007)
  jako single source. Zero dodatkowego serwisu.
- **FastAPI architektury** - Patron uzywa istniejacego TS API.
- **External JSZip / Mammoth** w viewer - niepotrzebne dla Patron
  use-case.
- **Brand "Harvey-style"** - amerykanski brand, my robimy "Przeglad
  tabelaryczny".

**Wdrozenie**:
- ADR-0011 (Span-level offsets + column type taxonomy) - uszczegolawia T2/T4
  ADR-0010, zero dodatkowych tygodni
- ADR-0012 (Self-contained Viewer HTML) - 4. format eksportu, ~13 dni dev
  dodanych do T6 ADR-0010
- Implementacja Patrona napisana **od zera** pod multi-provider LLM,
  Postgres+pgvector persistence, audit hash-chain, pseudonimizacja PRZED
  ekstrakcja, polskie entity types, brand matematicsolutions, i18n pl-PL.

## gregmos/PII-Shield (MIT)

**Repo**: https://github.com/gregmos/PII-Shield
**Licencja**: MIT
**Snapshot**: 2026-05-21 (v2.0.2 z 28.04.2026, 92 gwiazdek, autor Grigorii
Moskalev - Microsoft Presidio team)
**Pattern wzorcowany**: 5 patternow operacyjnych warstwy pseudonimizacji
(TTL mapping cleanup / source_hash per dokument / session_id w docx custom
properties / AES-GCM session archive / plain-text audit log dla Inspektora).

**Co Patron bierze (wzor)**:
- **TTL mapping cleanup** - automatyczne usuwanie pseudonim-mapping po N
  dniach (default 7, configurable per kancelaria), zgodnie z RODO art. 5
  ust. 1 lit. e (ograniczenie przechowywania) - ADR-0013, T1
- **`source_hash` per dokument** (sha256) - deterministyczny dowod ze
  konkretny plik audytowany byl tym samym co pseudonimizowany, AI Act
  art. 12 record-keeping - ADR-0013, T1
- **`session_id` w docx custom properties** - reopen workflow tygodnie
  pozniej, deanonymize jednym klikiem jezeli mapping wciaz w TTL -
  ADR-0013, T2
- **AES-GCM session archive** z scrypt-derived key - szyfrowany transfer
  sesji miedzy maszynami, RODO art. 32 - ADR-0013, T3
- **Plain-text `pseudonim_audit.log` dla Inspektora** - rownolegly do
  hash-chain ADR-0001, czytelny bez deszyfrowania, AI Act art. 12 + art. 13
  (instrukcje uzytkowania) - ADR-0013, T1

**Czego Patron NIE bierze**:
- **GLiNER zero-shot NER + ONNX Runtime** (>100 MB modeli) - lamie ADR-0008
  (entity extraction zero-LLM przy zapisie). Patron uzywa deterministycznych
  regex + checksum (PESEL wagi 1-3-7-9, NIP mod 11, REGON, IBAN PL).
- **MCP server architecture** - PII-Shield jest MCP serverem dla Claude
  Desktop. Hey Jude jest shared library w Patron backend (in-process
  calls). Cherry-pick MCP konektora pseudonim do osobnej decyzji.
- **33 entity types US/UK/DE/FR/IT/ES/CY** - Patron skupia sie na polskich
  PII (Konstytucja Art. 1 lokalnosc + AGENTS.md "polskie kancelarie -
  polskie PII"). EU_VAT moze sie przydac do CJEU/EUR-Lex, ale to drobiazg.

**Wdrozenie**:
- ADR-0013 (PII-Shield patterns cherry-pick) - 5 patternow operacyjnych,
  ~10h dev rozlozone na 2-3 sesje (T1-T5)
- Plan implementacyjny: `backend/src/lib/pl-entities/PII_SHIELD_PATTERNS_PLAN.md`
- Implementacja Patrona napisana **od zera** pod schema Postgresa, hash-chain
  ADR-0001, polskie PII (PESEL/NIP/REGON/IBAN PL), Konstytucja v1.1.1
  (vendor-neutrality, lokalnosc, audytowalnosc). NIE jest to fork ani port.

## earendil-works/pi (MIT)

**Repo**: https://github.com/earendil-works/pi
**Licencja**: MIT
**Snapshot**: 2026-05-21 (v0.75.4 z 20.05.2026, 52.3k gwiazdek, 4227 commitow
na main, organizacja earendil-works, monorepo 4 pakietow: pi-coding-agent /
pi-agent-core / pi-ai / pi-tui)
**Pattern wzorcowany**: warstwa abstrakcji LLM (jeden interfejs, N providerow,
capability flags na providera, router z fallback chain) oraz format storage
sesji uzytkownika (JSONL append-only z `parentId` budujacym drzewo wariantow,
in-place branching, standalone HTML export).

**Co Patron bierze (wzor)**:
- **Interfejs `LLMProvider`** z capability flags (egress / tool calling /
  vision / context window / structured output), router wybierajacy providera
  na podstawie data classification + required capabilities + .env primary +
  fallback chain - ADR-0014
- **Provider-agnostic message format** (jeden wewnetrzny typ `Message[]`,
  kazdy provider tlumaczy na natywny format) - ADR-0014
- **Failover/retry chain** (`LLM_FALLBACK_CHAIN=anthropic,gemini,ollama`) z
  rate limit + timeout + retry-with-backoff + circuit breaker per provider -
  ADR-0014
- **Cost estimation per call** PRZED wywolaniem (limit per call, alert) -
  ADR-0014
- **Format JSONL one-message-per-line** z `id` + `parentId` budujacym drzewo
  sesji (zamiast linear listy) - ADR-0015
- **In-place branching** (branch zyje w tym samym pliku co parent) +
  standalone HTML export drzewa - ADR-0015

**Czego Patron NIE bierze**:
- **Kod `@earendil-works/pi-ai` jako dependency** - dolozenie zaleznosci
  runtime na warstwie LLM = ryzyko (zmiana licencji, supply chain). Patron
  reimplementuje od zera w `backend/src/lib/llm/` (AGPL-3.0 powloka)
- **Pelny zestaw 8+ providerow pi** (DeepSeek, Groq, Bedrock, Azure, Mistral,
  ...) - MVP Patrona 4 providery (Anthropic, Gemini, Ollama, OpenAI opt-in),
  wiecej dodajemy gdy pojawi sie potrzeba kancelarii
- **Session sharing pi** ("encourages session sharing for OSS improvement") -
  **RODO red flag**. Sesje kancelaryjne nie wychodza poza serwer. Eksport
  sesji do HTML w Patronie ma inny cel - artefakt zgodnosci AI Act art. 12,
  nie content do udostepnienia OSS
- **Pi compaction algorithm** - Patron uzywa wlasnej logiki podsumowywania
  (ADR-0009 overnight consolidation z gbrain wzorem)
- **Pi message queuing UI** (Enter steer / Alt+Enter follow-up) - to pattern
  terminal UI; Patron ma frontend Next.js, watch list jako osobny ADR UI
  w przyszlosci
- **Kod pi-tui** (terminal UI) - Patron ma frontend Next.js
- **Brand "earendil" / "pi"** - amerykanski projekt, my robimy polski legal
  product. Atrybucja w tym pliku, brak brand-association w UI Patrona

**Wdrozenie**:
- ADR-0014 (Multi-provider abstraction layer) - operacjonalizacja Art. 4
  Konstytucji v1.1.1, ~5 tygodni dev (T1-T6)
- ADR-0015 (In-place session branching JSONL) - artefakt zgodnosci AI Act
  art. 12 + eksploracja wariantow decyzyjnych prawnika, ~8-10 tygodni dev
  (T1-T9, mozliwe rownoleglenie)
- Implementacja Patrona napisana **od zera** pod multi-provider z polskimi
  klasyfikacjami danych (`attorney_client_privileged`, `case_id`), pseudonim
  layer pre-LLM (ADR-0003), hash-chain audit (ADR-0001), retencja zgodna z
  art. 118 KC i regulacjami korporacyjnymi samorzadow prawniczych

**Decyzje strategiczne**:
- **NIE forkujemy** pi - 95% kodu pi to terminal UI (`pi-tui`, `pi-coding-agent`)
  irrelevant dla frontend Next.js Patrona
- **NIE instalujemy** pi jako runtime dependency - cherry-pick wzorca,
  reimplementacja od zera. Powod: kluczowa warstwa (LLM + sessions) =
  niezaleznosc ewolucyjna ([zasada 4 cherry-pick MateMatic](#zasada-cherry-pick-matematic))
- **NIE adoptujemy** filozofii "session sharing for OSS improvement" - RODO
  niezgodne z duchem projektu

**Watch**: monitoring kierunku rozwoju pi - czy v1.0 zaproponuje nowe
patterny LLM abstraction lub session storage warte cherry-pick. Status
2026-09 do 2026-11 - ponowny check.

## Shubhamsaboo/awesome-llm-apps - knowledge_graph_rag_citations (Apache 2.0)

**Repo**: https://github.com/Shubhamsaboo/awesome-llm-apps (folder
`rag_tutorials/knowledge_graph_rag_citations`)
**Licencja**: Apache 2.0
**Snapshot**: 2026-05-22 (repo 111378 gwiazdek wg gh API, push 2026-05-21,
nie fork/archiwum)
**Upstream demka**: [bibinprathap/VeritasGraph](https://github.com/bibinprathap/VeritasGraph)
(named inspiration wg README demka - GraphRAG multi-hop + verifiable attribution;
**brak zadeklarowanej licencji** wg gh API 2026-05-22 = all rights reserved,
NIE cherry-pickujemy z niego, tylko z demka Apache 2.0; kandydat do osobnej oceny)
**Pattern wzorcowany**: multi-hop reasoning po grafie wiedzy z jawna sciezka
wnioskowania (reasoning trace) eksponowana obok cytatow.

**Co Patron bierze (wzor)**:
- **Multi-hop traversal grafu jako mechanizm wyprowadzania odpowiedzi** na
  pytania wielodokumentowe (nie flat similarity) - ADR-0016
- **Reasoning trace jako jawna struktura** (from -> relation -> to + zrodlo per
  hop), nie czarna skrzynka - ADR-0016
- **Lokalnosc stacku** (demo: Neo4j+Ollama lokalnie) potwierdza, ze pattern
  dziala bez chmury - zgodne z Konstytucja Art. 1

**Czego Patron NIE bierze**:
- **Kodu Python/Streamlit** demo (Patron: TypeScript/Node/Postgres, od zera)
- **Neo4j** - Patron uzywa `citation_graph` w Postgres (ADR-0007/0008), zero
  dodatkowego serwisu grafowego
- **Generycznej ontologii** demo (person/org/concept/technology) - Patron uzywa
  ontologii legal PL z ADR-0008 (`cytuje_orzeczenie` / `derywat_pisma` /
  `przed_sadem`...)
- **Trace jako wygody UX** - Patron traktuje reasoning trace jako **artefakt
  zgodnosci AI Act art. 12** (audit bundle ADR-0006 + hash-chain ADR-0001),
  nie tylko element interfejsu
- **Naiwnego traversalu bez weryfikacji** - Patron wpina ADR-0005 verifier
  na kazdy hop (ucina error propagation), demo tego nie ma
- **Braku limitu ekspansji** - Patron dodaje hop-budget + beam search pod
  Konstytucja Art. 7 (minimalnosc)

**Wdrozenie**: ADR-0016 (multi-hop graph traversal + reasoning trace), ~4-5
tygodni dev (T1-T5), twarda zaleznosc od ADR-0007 (hybrid retrieval) i ADR-0008
(entity extraction / `citation_graph`). Implementacja PL od zera, nie port kodu.

**Druga apka z tego repo - `rag_failure_diagnostics_clinic`** (ten sam Apache 2.0):

**Pattern wzorcowany**: klasyfikacja awarii RAG wg taksonomii (wg README demka:
12 generycznych trybow IT) + strukturalny zapis do post-mortem.

**Co Patron bierze (wzor)**:
- **Klasyfikacja awarii wg taksonomii** + strukturalny zapis diagnozy - ADR-0017

**Czego Patron NIE bierze**:
- **12 generycznych trybow IT** demka - Patron pisze wlasna **taksonomie PL legal**
  (brak_zrodla_w_SAOS / zrodla_sprzeczne / przepis_nieaktualny / cytat_unverified
  / pokrycie_czesciowe / sygnatura_nieistniejaca)
- **Dev-time triage po fakcie** - Patron robi **runtime gate** sygnalizujacy
  wiarygodnosc prawnikowi PRZED oparciem sie na odpowiedzi (Konstytucja Art. 6)
- **LLM-only klasyfikacja** (wg README demka gpt-4o) - Patron liczy wiekszosc sygnalow
  deterministycznie z istniejacych warstw (0005/0007/0016), LLM tylko dla oceny
  sprzecznosci zrodel (Art. 3 reprodukowalnosc + Art. 7 minimalnosc)
- **Kodu Python/CLI** i plaskiego JSON - Patron: TypeScript/Postgres, audit bundle
  z hash-chain (ADR-0006/0001), eskalacja do debate (ADR-0004)

**Wdrozenie**: ADR-0017 (diagnostyka wiarygodnosci odpowiedzi), ~3-4 tygodnie dev
(T1-T4), zaleznosc od ADR-0005 (verification rate) i ADR-0007 (score retrievalu).

**Uwaga o repo zrodlowym**: awesome-llm-apps to **katalog ~111 demo-aplikacji**
(tutoriale), nie produkcyjne narzedzie. Werdykt oceny MateMatic: **bank pomyslow
/ blueprint**, demo-grade (cloud-first, klucze API w kodzie, brak persistence/
audit/PII w wiekszosci apek) - **nic stad nie idzie pod marke MateMatic jako
kod**. Cherry-pickujemy wylacznie wzorce architektoniczne wybranych apek
(KG-citations -> ADR-0016, failure-diagnostics -> ADR-0017).

## jdai-ca/atticus (Apache-2.0 OR Commercial)

**Repo**: https://github.com/jdai-ca/atticus
**Licencja**: dual `Apache-2.0 OR Commercial` - bierzemy galaz **Apache-2.0**
(w kanonie cherry-pick MateMatic). Trademark "Atticus" zastrzezony (John Kost /
JDAI.ca) - nazwy nie uzywamy.
**Snapshot**: 2026-05-22 (38 gwiazdek, v0.9.20, push 2026-05-19, nie fork/archiwum)
**Pattern wzorcowany**: 5-fazowy pipeline skanu bezpieczenstwa dokumentu
wejsciowego (`src/services/fileSecurityPipeline.ts` + `src/services/security/`) -
triage typu pliku -> ekstrakcja -> rownolegle detektory -> scoring -> raport z akcja.
**Wdrozenie**: ADR-0019 (input document security pipeline PL-aware), T1 skeleton
zakodowany 2026-05-22 w `backend/src/lib/input-security/`; wpiecie w kontrakt =
przyszly ADR-0020.

**Co Patron bierze (wzor)**:
- **5-fazowy orchestrator** (u Atticusa `analyzeFile()`, u nas `analyzeInput()`)
- **Model akcji** czterostanowy: `allowed` / `quarantined` / `human_review` / `blocked`
- **Taksonomia kategorii**: adversarial / steganography / obfuscation / evasion
- **Idea skanu wejscia pre-LLM** jako artefakt audytu (zbiezne z ADR-0001/0006, AI Act art. 12)

**Czego Patron NIE bierze (i dlaczego)**:
- **Kodu detektorow** - w Atticusie sa **English-only** (listy `PROMPT_INJECTION_SIGNALS`,
  `JAILBREAK_PATTERNS` po angielsku) i czesciowo **wrogie polszczyznie**
  (`detectHomoglyphs` lapie cyrylice, `detectEmbeddingAnomalies` ma `[^\x00-\x7F]{3,}`
  = false-positive na kazdym polskim diakrytyku). Detektory piszemy od zera, PL-aware.
- **Naiwnych heurystyk**: LSB obrazu (chi-kwadrat na surowych bajtach, nie pikselach),
  porownanie NFC/NFD (lamie sie na polskich znakach), "perplexity" jako entropia slow.
- **Electron/React/Zustand stacku** - Patron to TypeScript/Node/Postgres.
- **PII-detektora** - Patron ma wlasny PL (pl-entities, ADR-0003/0013), mocniejszy
  dla fleksji i checksum GUS.

## chrisryugj/korean-law-mcp (MIT)

**Repo**: https://github.com/chrisryugj/korean-law-mcp
**Licencja**: `MIT` (zweryfikowane realnym plikiem LICENSE - `gh repo view` zwracal
falszywe NONE; zawsze czytaj plik). Bierzemy KONCEPT, nie kod.
**Snapshot**: 2026-05-22 (1806 gwiazdek, v4.0.4, push 2026-05-19, TypeScript, nie fork/archiwum)
**Pattern wzorcowany**: narzedzie `time_travel` - auto-diff przepisu miedzy dwiema
datami (anti-halucynacja przez mechaniczne porownanie zrodel, nie streszczenie modelu).
Korea opakowuje 41 panstwowych API KR; my mamy wlasny konektor ISAP na polskim ELI.
**Wdrozenie**: ADR-0021 (time-travel diff nowelizacji) - SZKIC, czeka wewnetrzny review tresci 2x + decyzje Wieslawa.

**Co Patron bierze (wzor)**:
- **Model "dwa punkty w czasie -> diff"** + mapowanie zmiany na akt nowelizujacy
- **Filozofia anti-halucynacji przez mechanike** (zbiezne z ADR-0005 citation-grounding)

**Czego Patron NIE bierze (i dlaczego)**:
- **Kodu** - opakowuje koreanskie API panstwowe (KR-specific). Implementujemy od zera
  na `api.sejm.gov.pl/eli`, rozszerzajac wlasny konektor ISAP o historie wersji.
- **`impact_map`** (graf wplywu przepisu) - nie dublujemy; graf zaleznosci to rozszerzenie
  istniejacego grafu (ADR-0007/0016), nie nowy mechanizm.
- **`citation-verification`** - juz pokryte mechanicznie ADR-0005.
- **`action_plan`** (przewodnik obywatelski) - segment access-to-justice, nie kancelaryjny Patron.

## Zasada cherry-pick MateMatic

Patron stosuje wzorzec **cherry-pick wzoru zamiast adopcji narzedzia**
utrwalony w MateMatic (patrz pamiec dewa: `feedback_consolidation_pattern_2026-05-14`
i `reference_narzedzia_oceny_2026-05-14`):

1. **4 bramki oceny** kazdego znalezionego repo (licencja / anty-OS
   ToS / jakosc / strategia)
2. **Cherry-pick wzorca, nie kodu** - czytamy struktura,
   reimplementujemy w wlasnym ekosystemie
3. **Atrybucja w THIRD_PARTY_INSPIRATIONS.md** (ten plik) zawsze,
   nawet jezeli kodu nie kopiujemy - to kwestia uczciwosci, nie
   wylacznie obowiazku licencyjnego
4. **Nie tworzymy zaleznosci runtime** od projektow, ktore moga
   zmienic licencje albo zniknac - reimplementacja daje **niezaleznosc
   ewolucyjna**

Patron jest **polonizacja swiatowych patternow** w ekosystemie polskiego
prawa - to wartosc, nie wstyd.

## microsoft/agent-governance-toolkit (MIT)

**Repo**: https://github.com/microsoft/agent-governance-toolkit
**Licencja**: MIT (Microsoft Corporation, monorepo: Python + TypeScript + .NET + Rust + Go SDK).
**Snapshot**: 2026-05-24 (1904 gwiazdek, pushedAt `2026-05-24T17:02:19Z`, 352 forki, 992 testow conformance, OpenSSF Best Practices project 12085, OpenSSF Scorecard, OWASP Agentic Top 10 10/10, 25 ADR z RFC 2119 specs).
**Status Public Preview** (Microsoft explicite: "may have breaking changes before GA") - cherry-pick patternow, NIE wpinanie zaleznosci.
**Pattern wzorcowany (ADR-0024 + ADR-0025)**:
- Taksonomia 4 detektorow MCP Security Gateway (typosquat, drift, hidden-instructions, tool-poisoning).
- Pojecie "scan przed zaladowaniem do kontraktu" jako fail-closed gate.
- Decyzja allow/deny/audit/human-review w runtime z fail-closed semantics.
- Merkle-chained audit log nad hash-chain ADR-0001 (WDROZONY w ADR-0026, 2026-05-27).
- 3-poziomowy ring model uprawnien dla wywolan narzedzi (WDROZONY w ADR-0027, 2026-05-25).

**Wdrozenie**:
- **ADR-0024** - cherry-pick decision record (3 patterny, granice "co NIE bierzemy").
- **ADR-0025** - MCP Security Gateway, skeleton w `backend/src/lib/mcp-security/` (11 plikow, 25 testow vitest, +0 zaleznosci npm). NIE wpiety w startup (osobny ADR-0028).
- **ADR-0026** - Merkle audit chain upgrade, 3 moduly w `backend/src/lib/audit-merkle*.ts` (30 testow vitest, +0 zaleznosci npm). Lisce = audit_log.hash, konwencja RFC 6962 (Laurie/Langley/Kasper 2013). Manual trigger; auto-trigger + UI = rezerwacja ADR-0036.
- **ADR-0027** - Privilege Rings dla wywolan MCP, `backend/src/lib/mcp/ring-policy.ts` (28 testow vitest). Ring 1 trusted + Ring 2 default-deny + audit propagation.
- Audyt RODO pakietu `agent-governance-claude-code` v3.6.0 = **🟢 ZIELONY** (zero HTTP/telemetrii w hooks+lib+server zweryfikowane grepem, SDK deps czyste `@noble/*` + `js-yaml`, hash-chain audit lokalny w `~/.claude/agt/`, MCP server bundled stdio). Dopuszczony do PATRON dev environment z pinem wersji 3.6.0. NIE dopuszczony do maszyn kancelarii klienckich bez DPA z Microsoft. Pelny raport: `memory/audit_agent_governance_claude_code_2026-05-24.md`.

**Co NIE bierzemy (twarda granica)**:
- Pelne wpiecie `@microsoft/agent-governance-toolkit` jako npm/pip dependency (Public Preview = breaking changes; Patron jest produktem regulowanym).
- Zero-Trust Identity (Ed25519 + ML-DSA-65 trust scoring) - Patron single-tenant per kancelaria, ekonomika nie domyka.
- 4-poziomowy ring model z hardware-style isolation - adaptujemy do 3 ringow (System / Trusted MCP / Untrusted, planowany ADR-0027).
- RL Training Governance (Lightning Fast-Path), Framework Adapter Contract (10 frameworkow) - przeskalowane dla naszej skali.
- Shadow AI Discovery w Patronie - to pattern dla skilla `matematic-konstytucja-ai` (audyt klienta), nie samego Patrona.
- `agent-governance-claude-code` plugin na maszynach kancelarii klienckich bez osobnego DPA z Microsoft.

**Co jest NASZE (kod od zera)**:
- TypeScript strict, vitest, Node 20+ - zgodne ze stosem Patrona.
- Polski + angielski korpus wzorcow w hidden-instructions i tool-poisoning.
- 5-fazowy orchestrator i 4 stany akcji wziete z naszego wlasnego `input-security` (ADR-0019).
- Lista 6 zatwierdzonych konektorow Patrona jako baseline typosquat (saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia).
- Hash SHA256 z (server.name + tools[].name + tools[].description) jako drift fingerprint.
- 25 testow jednostkowych pod kazda kategorie detektora i pipeline agregujacy.

**Atrybucja w kodzie**: naglowek w kazdym pliku `backend/src/lib/mcp-security/*.ts` + `README.md` modulu + ADR-0024 + ADR-0025.

## ICME Preflight (MIT + cloud-only SaaS)

**Repo (open)**: [ICME-Lab/icme-preflight-guardrail](https://github.com/ICME-Lab/icme-preflight-guardrail) (MIT, snapshot 2026-05-24, push 2026-04-01, 1 star)
**Repo integracyjne (open)**: [hshadab/preflight-mike](https://github.com/hshadab/preflight-mike) (MIT, snapshot 2026-05-24, push 2026-05-24, drop-in patch dla Mike - PATRON forkuje Mike)
**Repo zarchiwizowane**: [hshadab/mikeoss](https://github.com/hshadab/mikeoss) (AGPL-3.0, ARCHIVED 2026-05-22, reference impl - przerzucone do preflight-mike)
**SaaS hosted**: `api.icme.io/v1/{checkLogic,checkRelevance,checkIt,checkItPaid,verify,verifyPaid,verifyProof,...}` - cloud-only, US, brak EU region, brak DPA template, brak self-host
**Autor**: Houman Shadab (Stanford CodeX Fellow, National Law Journal Trailblazer)
**Pricing**: pay-per-use ($3 makeRules / $0.01 checkIt / $0.10 verifyPaid przez x402 USDC Base), bez subscription
**Status**: produkcyjny SaaS (jeszcze nie GA officially declared, ale aktywne deployments na Mike)

**Pattern wzorcowany (ADR-0031)**:
- **Plain English -> SMT-LIB compilation -> lokalny solver** (Z3 / minizinc / cvc5 - decyzja techniczna w ADR-0032 implementacyjnym). Deterministyczna walidacja decyzji AI, SAT = allowed / UNSAT = blocked. Niezalezne od probabilistycznego LLM-judge.
- **Proof receipt** z `check_id` (UUID) + `policy_hash` (SHA256 ze skompilowanej polityki) + `verdict` + `latency_ms` + `created_at`. Zapisywany w istniejacym audit hash-chain Patrona (ADR-0001) jako nowy typ eventu `policy_verdict`.
- **Public verifier offline** (CLI tool `patron-verify`) - regulator UODO/KIRP/klient kancelarii dostaje paczke `proofs.tar.gz` + binarka i weryfikuje deterministycznie BEZ dostepu do reszty systemu kancelarii. Adaptacja wzorca ICME `icme.io/proofs/<check_id>` na lokalny offline binary.
- **5 polityk-szablonow dla legal AI** (no unauthorized advice / privilege boundary / PII egress / citation integrity / escalation scope) - adoptowane do skilla `matematic-konstytucja-ai` Appendix G jako gold template polityk kancelaryjnych.
- **Iterator polityki** (scenarios -> feedback -> refine -> tests) - polityka traktowana jak kod, kompilowana i testowana przed deploymentem. Adoptowane do skilla `matematic-konstytucja-ai` Appendix G.

**Wdrozenie**:
- **ADR-0031 PATRON** PROPONOWANY - decision record dla 3 patternow (compiler + receipt + verifier). Implementacja w osobnym ADR-0032 po wybraniu solvera.
- **matematic-konstytucja-ai SKILL Appendix G** LIVE - 5 polityk-szablonow PL + iterator polityki "jako kod".
- **legal-ai-audit-bundle SKILL** - dodana sekcja "Roadmap rozszerzenie 2: per-decision proof receipt" obok wczesniejszego Merkle. Trzy warstwy audytu: Merkle (integralnosc lancucha) + proof receipt (dowod decyzji) + paczka audytowa (kontekst sprawy).

**Co NIE bierzemy (twarda granica)**:
- **HTTP klient do `api.icme.io`** - cloud-only narusza Art. 1 Konstytucji Patrona (Lokalność danych). `structured action` (matter, input, tool) opuszcza maszyne kancelarii bez DPA + bez EU region. Nawet "free" checkLogic wysyla `reasoning` text do US.
- **Drop-in patch `preflight-mike`** (MIT) - jako patch wlasciwie dziala technicznie (PATRON forkuje Mike), ale zawiera `backend/lib/preflight.ts` ktory dzwoni api.icme.io. Czerwony zakaz.
- **`Private Venice tier` "zero data retention contractually"** - umowna gwarancja, nie techniczna. Polega na zaufaniu do ICME. Niedostateczne dla tajemnicy zawodowej art. 6 Pr.Adw.
- **`zk_proof_id` i jolt-atlas zkVM** (ICME-Lab/jolt-atlas, 64 star, Rust, Other license) - przeskalowane. Nasz hash-chain SHA256 (ADR-0001) + Merkle audit chain (ADR-0026 WDROZONY) = wystarczajacy dla audytora polskiego. zkVM na watch list (gdyby regulacja kiedys wymagala zero-knowledge proof).
- **x402 USDC on Base payment** - kancelaria PL nie placi w stablecoin za walidacje wlasnej polityki AI.
- **Policy text jako workproduct ICME** - kompilacja u nich, my nie mamy kompilatora. Filozoficznie sprzeczne z naszą teza "kancelaria pisze wlasna Konstytucje AI".

**Co jest NASZE (kod od zera)**:
- TypeScript strict, Node 20+, lokalny solver Z3/minizinc/cvc5 (do ustalenia w ADR-0032).
- Polskie 5 polityk-szablonow zaadaptowane do realia kancelaryjne PL (art. 6 Pr.Adw., RODO art. 5/32, art. 28 Pr.Adw.).
- CLI tool `patron-verify` dla regulatorow polskich - Node binary z embedded solver, weryfikuje proofs.tar.gz offline.
- DB schema migration: nowe pole `policy_verdict` w `audit_events` lub osobna tabela `policy_verdicts`.
- UI badge "Zweryfikowano" + UNSAT explanation flow dla Operatora kancelarii.
- Iterator polityki PL: generator scenariuszy + feedback flow w UI + test runner CLI.

**Atrybucja w kodzie**: naglowek w kazdym pliku Patrona dotyczacym tej warstwy + ADR-0031 + dokumentacja `matematic-konstytucja-ai` Appendix G + ten plik.

## ai-infra-curriculum/ai-infra-engineer-learning (MIT)

**Repo**: [ai-infra-curriculum/ai-infra-engineer-learning](https://github.com/ai-infra-curriculum/ai-infra-engineer-learning) (snapshot 2026-05-27, 423 star, ~7 mies aktywne, Python).
**Licencja**: MIT, Copyright 2024 AI Infrastructure Learning - kompatybilna z AGPL-3.0-only shell Patrona.
**Co**: 10-modulowe curriculum AI Infrastructure Engineer (foundations / cloud / containers / k8s / data pipelines / mlops / GPU / monitoring observability / IaC / LLM infrastructure) + 3 projekty production-ready + 62 labs + 265 quizow.

**Cherry-pick w ADR-0037 (mod-108 Monitoring and Observability)**: pattern Prometheus metrics endpoint + Grafana dashboard JSON dla AI/ML system observability. NIE kod, NIE dependency npm - pattern (czyli "co eksponowac jako metryki, w jakim formacie, jak dashboardowac") adaptowany do specyfiki Patrona (audit chain monitoring zamiast LLM inference monitoring; zero-cloud single-tenant zamiast cloud-native multi-tenant).

**Konkretnie wykorzystane patterny**:
- Endpoint `/metrics` w Prometheus exposition format (text/plain, publiczny protokol).
- Counter + gauge metrics z labelami (event_type, action).
- Dashboard JSON: timeseries (rate), stat (current count), gauge (threshold colors), uptime.
- Brak push gateway - scrape-based (zgodne z Konstytucja Art. 1 lokalnosc).

**Czego NIE wzielismy**:
- prom-client npm dependency (Patron renderuje exposition format natywnie, ~80 linii kodu w `lib/metrics-render.ts`).
- Cloud-native framing (FAANG/Netflix/OpenAI use cases nie pasuja do kancelarii self-host).
- OpenTelemetry collector stack (overengineered dla single-instance Patrona).

**Atrybucja w kodzie**: naglowek w `backend/src/routes/metrics.ts` + ADR-0037 + ten plik.

**Watch list dla przyszlych iteracji**:
- Module 110 (RAG / vLLM / Vector DB patterns) jako inspiracja `matematic-stack-zero-cloud` blueprint (Bielik / PLLuM lokalnie + Vector DB).
- 10-modulowa struktura jako wzorzec dydaktyczny dla `matematic-konstytucja-ai` workshop syllabus (NIE copy, inspiracja).

## ICME-Lab/jolt-atlas (Other license)

**Repo**: [ICME-Lab/jolt-atlas](https://github.com/ICME-Lab/jolt-atlas) (snapshot 2026-05-24, push 2026-05-18, 64 star, Rust)
**Licencja**: "Other" (niezdeklarowana standardowa OSS) - **wymaga osobnego audytu licencji przed jakimkolwiek cherry-pick**.
**Co**: zkVM (zero-knowledge virtual machine) zaadaptowany przez ICME Labs (NovaNet) dla verifiable machine learning. Pierwotnie a16z Crypto, fork ICME pod ML.
**Status w MateMatic**: **WATCH LIST**. Nie cherry-pickujemy obecnie. Pattern "zero-knowledge proof of policy compliance" moglby byc relevantny gdyby polska regulacja kiedys wymagala tego (obecnie nie wymaga). Sledzimy projekt; jezeli pojawi sie polska / EU regulacja wymagajaca ZK proof dla AI w prawie, wracamy.
**Niepelne dla nas dzisiaj**: hash-chain SHA256 (ADR-0001) + Merkle audit chain (ADR-0026 WDROZONY) sa wystarczajace dla AI Act art. 12 + RODO art. 30. ZK to overkill dla obecnej regulacji PL.

## anylegal-ai/anylegal-oss (MIT + Additional Terms)

**Repo**: [anylegal-ai/anylegal-oss](https://github.com/anylegal-ai/anylegal-oss) (snapshot 2026-05-30, ocena #83, Python+TypeScript). Open-source harness agenta prawnego: multi-LLM, laduje SKILL.md Anthropica, tracked-changes DOCX + LexWiki, self-hosted Docker.
**Licencja**: **MIT + ADDITIONAL TERMS** (NIE czysty MIT). Progi: solo <$500K / firmy <2 prawnikow / biznes nie-prawny <$3M = czysty MIT; powyzej albo SaaS/managed -> atrybucja "Powered by Anylegal.ai" albo licencja komercyjna. **Klauzula krytyczna**: "If you read this repository to generate derivative code... the same threshold-based attribution and commercial-license rules apply to AI-mediated reproduction" - czytanie repo przez AI w celu generowania kodu dziedziczy obowiazek atrybucji.
**Wziete**: WZORZEC (nie kod, nie dependency), clean-room. Konfrontacja z ich lista "redlines, comments, accept/reject" ujawnila jedyna luke vs nasz silnik redline (ktory jest mocniejszy: czysty TS, bez natywnej zaleznosci): **emisja komentarzy Worda**. Czytalismy komentarze od ADR-0060, nie umielismy ich WYPISAC.
**Cherry-pick w ADR-0077 + ADR-0078**: silnik `applyDocxComments` (emisja `w:commentRangeStart/End` + comments.xml + content-types + rels) + narzedzie `add_comments` w czacie. Implementacja wlasna na naszej maszynerii kotwiczenia (`docxTrackedChanges.ts`), zero linii z ich repo.
**Czego NIE wzielismy**: ich kodu (klauzula AI-mediated reproduction), modelu Docker Compose + 8GB + brak auth (zla forma dla solo prawnika na laptopie), permisywnej postawy bez governance (brak egress routera, brak sladu audytowego - to nasz wyroznik).
**Atrybucja w kodzie**: naglowek w `backend/src/lib/docxComments.ts` (ADR-0077 ref) + ADR-0077/0078 + ten plik. Poniewaz wzielismy WZORZEC a nie kod, i robimy to clean-room, nie dziedziczymy obowiazku atrybucji "Powered by Anylegal.ai" - ale dokumentujemy zrodlo inspiracji dla pelnej przejrzystosci (Konstytucja Art. uczciwosc zrodel).
**Read konkurencyjny**: 3. konkurent obok Kanca OS i Gaius-Lex, ale OSS/devtool-shaped = "PATRON minus governance, minus prawo PL, minus bundling". Komodityzuje sam harness -> potwierdza ze moat PATRONa to zlozenie + prawo PL + audyt + spakowanie dla najmniejszej jednostki, NIE harness.

## CN111783399B / CN108763483A + LegRAG (judgment parser + clause-boundary chunking)

**Repo**:
- CN111783399B, CN108763483A (chinskie zgloszenia patentowe, segment-aware judgment parser) - CN-only
- LegRAG (OSS, clause-boundary chunking dla legal RAG)

**Licencja**: Zrodla CN to zgloszenia patentowe terytorialnie ograniczone do Chin (CN-only), wiec wzorzec jest wolny do stosowania w EU. Niezaleznie od tego Patron NIE kopiuje kodu - bierze sama idee. LegRAG to projekt OSS, z ktorego rowniez bierzemy wzorzec architektoniczny, nie kod.

**Pattern wzorcowany**: chunkowanie tekstu prawniczego po naturalnych granicach przed chunkowaniem RAG zamiast slepego okna znakowego. Dwa rodzaje granic: (1) sekcje kanoniczne wyroku/uzasadnienia (naglowek+sygnatura, oznaczenie stron, zadanie/wnioski, ustalenia faktyczne, ocena prawna/rozwazania, sentencja/rozstrzygniecie), (2) jednostki redakcyjne (artykul, paragraf, ustep, punkt, litera).

**Co Patron bierze (wzor)**:
- Idea "tnij po granicy jednostki sensu, nie po sztywnym oknie" jako wstep do chunkowania RAG.
- Lista kanonicznych sekcji polskiego wyroku jako punkty ciecia.
- Jednostka redakcyjna jako naturalna granica chunku.

**Czego Patron NIE bierze**:
- Kodu zrodlowego (zarowno CN, jak i LegRAG - reimplementacja od zera w TypeScript / Node 20 stdlib, zero nowej zaleznosci npm).
- Chinskiej taksonomii sekcji wyroku (Patron polonizuje pod polski wyrok i polskie akty normatywne: Art./Par./ust./pkt/lit., "Sad zwazyl co nastepuje", "Ustalenia faktyczne").
- Zadnego modelu ML / embeddingu z LegRAG do segmentacji - Patron tnie deterministycznie wyrazeniami regularnymi (Konstytucja Art. 1, 3, zero LLM w runtime).

**Wlasne wzmocnienie (poza wzorcem zrodlowym)**: brama trybu prawniczego z dwiema klasami markerow (mocne vs slabe). Pospolite polskie slowa-naglowki (Wniosek, przeciwko, Rozwazania, Ocena prawna) nie aktywuja ciecia w zwyklej notatce/mailu - granice licza sie tylko gdy dokument zawiera marker mocny (sygnatura, WYROK, "Sad ustalil"/"Sad zwazyl") albo jednostke redakcyjna. To gwarantuje zero regresji dla dokumentow nieprawniczych (wynik identyczny z dotychczasowym akapitowym chunkText), czego sam wzorzec judgment-parser nie adresuje.

**Wdrozenie**: ADR-0083 (`backend/src/lib/retrieval/legalChunker.ts`, AGPL-3.0 dziedziczone po powloce Patrona). Funkcja `chunkLegalText` reuzywa istniejacy `chunkText` (ADR-0054) jako fallback dla dokumentow bez struktury prawniczej oraz jako jednolita sciezke normalizacji kazdego bloku - zero regresji, brak duplikacji logiki akapitowej. Wpiete w `indexDocument` zamiast bezposredniego `chunkText`.

## PMC11622873 - copy-mechanism generative NER (OSS, artykul naukowy)

**Repo / zrodlo**: PMC11622873 (PubMed Central, artykul open-access o generatywnym NER z dekoderem ograniczonym do spanow zrodla - copy/pointer mechanism).
**Licencja**: tresc naukowa open-access (Creative Commons typowe dla PMC, do potwierdzenia konkretnego wariantu CC w samym artykule przed cytowaniem doslownym). Bierzemy wzorzec (idea architektoniczna), nie kod ani wagi modelu - clean-room, reimplementacja deterministyczna od zera.
**Snapshot**: 2026-05-31 (ocena w ramach gleboki zwiad retrievalu, patrz reference_china_patent_recon_2026-05-31).
**Pattern wzorcowany**: dekoder generatywnego NER, ktory moze tylko kopiowac fragmenty tekstu zrodlowego (pointer/copy mechanism), nigdy generowac nowych znakow. Z definicji zero halucynacji wartosci - model wskazuje span wejscia zamiast go wymyslac.

**Co Patron bierze (wzor)**:
- Warstwa gwarancji `constrainToSource` - guard zwracajacy offsety tylko gdy wartosc wystepuje doslownie w zrodle, inaczej odrzucenie. Brama dla wartosci niepewnego pochodzenia (output LLM, luzna heurystyka) - ADR-0084.
- Ekstraktor copy-span dla wartosci liczbowych i dat (polskie kwoty `1 234,56 zl`, daty `12 marca 2024 r.` / `2024-03-12` / `12.03.2024`), emitujacy wylacznie doslowne spany z dokladnymi offsetami - ADR-0084.
- Inwariant testowalny `sourceText.slice(start, end) === value` jako kontrakt copy-mechanism (brak fabrykacji wartosci) - ADR-0084.

**Czego Patron NIE bierze**:
- Sieci neuronowej / dekodera generatywnego - Patron jest zero-LLM przy zapisie (ADR-0008, Konstytucja Art. 1/3/7). Bierzemy wzorzec gwarancji, realizujemy go deterministycznie (regex + slice), bez modelu.
- Kodu i wag - clean-room, czysty TypeScript + Node 20 stdlib, zero nowej zaleznosci npm.
- Domeny zrodlowej (biomedyczny NER artykulu) - Patron polonizuje pod kwoty i daty prawa polskiego (przecinek dziesietny, separator tysiecy spacja/kropka, nazwy miesiecy w dopelniaczu z diakrytykiem i bez).

**Wdrozenie**: ADR-0084 (copy-mechanism generative NER, anty-halucynacja wartosci), modul `backend/src/lib/pl-entities/copySpan.ts`. Synergia z ADR-0005 (grounding cytatow) i ADR-0080 (grounding tabular) - copy-span domyka anty-halucynacje dla wartosci liczbowych, ktorych grounding cytatow tekstowych nie pokrywal. Implementacja PL od zera, nie port.

## CN115221265A (CN-only, prior-art bibliograficzny)

**Repo**: brak (publikacja patentowa CNIPA, nie repozytorium OSS). Identyfikator CN115221265A.
**Licencja**: dokument patentowy, nie kod OSS. Brak kodu zrodlowego do dziedziczenia. CN-only (brak rodziny EP/US/PCT wg zwiadu IP 2026-05-31), wiec jako prior-art z Chin wolny do stosowania w EU. Niezaleznie od statusu NIE kopiujemy kodu - reimplementacja clean-room od zera.
**Pattern wzorcowany**: auto-anotacja korpusu slownikiem termow (gazetteer) algorytmem multi-pattern string matching typu WuManber, w celu bootstrapu zbioru treningowego NER bez recznej anotacji (weak supervision, mnoznik danych proporcjonalny do rozmiaru korpusu).

**Co Patron bierze (wzor)**:
- Wlasna implementacja WuManber (Wu, Manber 1994) - multi-pattern exact matching: bad-character SHIFT na blokach B znakow liczona z minimalnej dlugosci wzorca, HASH konczacych blokow + weryfikacja wstecz, separator klucza NUL. Czysty TS, deterministyczny, jedno przejscie po tekscie zamiast N przejsc naiwnego indexOf-per-term. ADR-0085, `backend/src/lib/pl-entities/wuManber.ts`.
- Anotator `bootstrapAnnotate` - bierze tekst + slownik `{term, label}` (nazwy sadow i aliasy splaszczone z gazetteera COURTS ADR-0008, prefiksy sygnatur SIGNATURE_PREFIXES case-sensitive, lokalna lista form prawnych, slownik kancelarii) i emituje weak-label spany `{start, end, term, label}` do przyszlego fine-tune PL NER. ADR-0085, `backend/src/lib/pl-entities/bootstrapAnnotate.ts`.

**Czego Patron NIE bierze**:
- Kodu z publikacji patentowej (clean-room, reimplementacja od zera w stacku Patrona).
- Chinskiego korpusu, ontologii i etykiet - Patron uzywa wlasnej ontologii legal PL (SAD / SYGNATURA_PREFIX / FORMA_PRAWNA + slownik kancelarii) z gazetteera ADR-0008.
- Wpiecia anotatora w sciezke produkcyjna - bootstrap jest OFFLINE (pipeline danych treningowych), produkcyjna ekstrakcja przy zapisie zostaje przy ADR-0008 (regex + gazetteer + checksumy).
- Zaleznosci runtime / npm - zero nowej zaleznosci, Node 20 stdlib.

**Wdrozenie**: ADR-0085 (WuManber weak-supervision bootstrap PL NER). Dwa moduly w `backend/src/lib/pl-entities/`, eksportowane z `index.ts` jako biblioteka offline. Konsumpcja spanow do dotrenowania malego modelu PL NER (LoRA) = rezerwacja FAZA2 poza tym ADR. Implementacja PL od zera, nie port.
