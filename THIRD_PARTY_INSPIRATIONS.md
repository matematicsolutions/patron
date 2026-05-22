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

**Czego Patron NIE bierze**:
- 67 promptow agentow (Lavern celuje w US contract review,
  semantyka anglosaska common law - irrelevant dla PL)
- 5 datasetow contract review (CUAD, MAUD, ACORD, UNFAIR-ToS, LEDGAR -
  korpus anglosaski, IRR dla PL)
- Workflow templates contract review (US-centric)
- Branding Clawern, menubar UI
- Kodu TypeScript Lavern (Patron implementuje od zera w wlasnym
  ekosystemie konektorow PL: mcp-saos, mcp-isap, mcp-eurlex)

**Wdrozenie**: ADR-0004 (debate + verification), ADR-0005 (citation
grounding), ADR-0006 (audit bundle), ADR-0014 T2b (adapter tool-calling).
Implementacja PL od zera, nie port kodu.

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
