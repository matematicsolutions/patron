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
grounding), ADR-0006 (audit bundle). Implementacja PL od zera,
nie port kodu.

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
  6 ADR-ow

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
