# Changelog

All notable changes to **Patron** are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **ADR-0034 - RBAC admin oparty na whitelist emaili w env** (2026-05-27).
  Realizacja rezerwacji "admin RBAC + UI banner mcp-security" w wezszym
  zakresie (scope-down) - tylko backend RBAC; UI banner mcp-security =
  rezerwacja ADR-0042, UI viewer dla audytora = rezerwacja ADR-0040.
  Admin pool zarzadzany przez env `PATRON_ADMIN_EMAILS` (CSV, lowercase,
  trim). Pusta wartosc = brak adminow (`requireAdmin` zwraca 403). Edycja
  wymaga restartu kontenera. Audyt zmian = git history `.env.example`.
  Pure helpers `parseAdminEmails` + `isAdminEmail` (testowalne bez DB/env)
  + middleware `requireAdmin` (zawsze po `requireAuth` w lancuchu) w
  `backend/src/middleware/auth.ts`. Strukturyzowane logi
  `[ADMIN] grant|denied` na stdout. Audit_log eventu `admin.access` =
  rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist
  event_type). Endpoint `GET /api/audit/merkle/verify/:eventId` (ADR-0036)
  zaostrzony z "kazdy zalogowany" do admin-only przez dodanie
  `requireAdmin` w lancuchu middleware. ADR-0036 explicite wzmiankowal ten
  scope-down w sekcji "Autoryzacja". Zero nowych zaleznosci npm (Konstytucja
  Art. 4). +13 testow w `middleware/auth.test.ts` (pure functions, 0 mockow).
  516/521 pass (+13 nowych vs baseline 503/508 z ADR-0036), TSC clean.
  Konstytucja v1.2.5 -> v1.2.6 PATCH (nowa rola 4.6 Admin). Rezerwacje:
  ADR-0040 (UI viewer dla audytora), ADR-0042 (UI banner mcp-security),
  ADR-0043 (audit_log eventu `admin.access`).
- **ADR-0036 - Auto-trigger Merkle audit root + REST endpoint dla audytora**
  (2026-05-27). Realizacja rezerwacji z ADR-0026 (manual trigger -> hybrid
  auto-trigger). Compute Merkle root nastepuje gdy nowych eventow >= 1000
  LUB ostatni root sprzed >= 24h, whichever first (env-tunable:
  `PATRON_MERKLE_AUTO_COUNT_THRESHOLD`, `PATRON_MERKLE_AUTO_INTERVAL_HOURS`,
  `PATRON_MERKLE_CHECK_INTERVAL_MS`). Idempotency check przed compute
  rozwiazuje TODO z `audit-merkle-roots.ts:64-67`. Pure decision function
  `shouldComputeNextRoot` w nowym module `lib/audit-merkle-scheduler.ts`
  (zero IO, testowalna bez DB). Wrapper IO `runAutoCompute` w
  `lib/audit-merkle-roots.ts` (storage layer, czyta max(id) z audit_log
  i ostatni root z audit_merkle_roots). setInterval bootstrap w
  `src/index.ts` (default tick co 1h). Manualny CLI fallback
  `npm run merkle:trigger` (`scripts/trigger-merkle.ts`) - administrator
  wymusza compute przed audytem (np. dzien przed wizyta UODO).
  Nowy router `routes/audit.ts` z endpointem
  `GET /api/audit/merkle/verify/:eventId` chronionym middleware `requireAuth`
  (twarda RBAC admin-only = rezerwacja ADR-0034). Endpoint zwraca
  samowystarczalny ProofBundle (event_hash + proof + merkle_root + zakres
  bloku). Audytor weryfikuje offline przez `audit-merkle-verifier.ts`
  bez dalszego dostepu do bazy kancelarii. Zero nowych zaleznosci npm
  (Konstytucja Art. 4) - setInterval z biblioteki standardowej Node.
  +21 testow w `audit-merkle-scheduler.test.ts` (pure functions, 0 mockow).
  503/508 testow pass (+21 nowych vs baseline 482/487 z ADR-0035), TSC clean.
  Konstytucja Patrona v1.2.4 -> v1.2.5 PATCH (sekcja 5.2.1 zaktualizowana
  o auto-trigger + REST endpoint). Rezerwacje: ADR-0040 (UI viewer dla
  audytora, blocked-by ADR-0034 RBAC), ADR-0041 (distributed lock dla
  multi-instance backend).
- **ADR-0035 - Infrastruktura migracji + CHECK constraint na audit_log.event_type**
  (2026-05-27). Domyka dlug techniczny ADR-0001 (kolumna `event_type` byla
  wolny text bez CHECK). Whitelist 7 produkcyjnych wartosci: `chat.message.user`,
  `chat.message.assistant`, `input_security_scan` (ADR-0020), `mcp_security.gateway`
  (ADR-0033), `ring_policy.decision` (ADR-0027), `rodo.delete`, `rodo.export`.
  Dodawanie nowego event_type wymaga osobnej migracji + ADR. Dwie warstwy
  obrony: TypeScript union literal `EventType` w `lib/audit.ts` (compile time)
  + CHECK constraint `audit_log_event_type_whitelist` w bazie (runtime).
  Nowa infrastruktura migracji: governance-friendly runner
  `backend/scripts/run-migrations.ts` (komendy `plan`/`mark`/`status`) +
  helper pure functions `backend/src/lib/migrations.ts` (parseFilename / sort
  leksykalny / sha256 checksum / dedup po id / selectPending). Operator
  kancelarii aplikuje DDL manualnie w Supabase SQL Editor / psql / pgAdmin,
  potem `npm run migrate:mark NNN` oznacza w rejestrze `public.schema_migrations`
  (id, name, applied_at, checksum). Audytowalne (DDL w Supabase Audit Logs),
  zero nowych zaleznosci npm (Konstytucja Art. 4). Pierwsza migracja
  `backend/migrations/001_audit_log_event_type_check.sql` (idempotent przez
  `pg_constraint` lookup). Nowe skrypty `migrate`, `migrate:mark`,
  `migrate:status` w `package.json`. Konstytucja Patrona v1.2.3 -> v1.2.4
  PATCH (rozszerzenie sekcji 5.1 o 5 event_type, nowa sekcja 5.2.2 o whitelist
  + infrastrukturze migracji + uzupelnienie brakujacych wpisow changelog 1.2.2
  i 1.2.3 z poprzednich iteracji). +23 testy w `migrations.test.ts` (pure
  functions, zero mockow). 482/487 testow pass (+23 nowych vs baseline 459/464),
  TSC clean. Rezerwacje: ADR-0038 (down/rollback migracji), ADR-0039 (CI gate
  na drift schema.sql vs migrations).
- **ADR-0026 - Merkle audit chain upgrade nad hash-chainem** (2026-05-27).
  Implementacja drugiego patternu z ADR-0024 (cherry-pick Microsoft AGT) -
  pattern 1 (MCP Security Gateway) zrobiony w ADR-0025/0028, pattern 3
  (Privilege Rings) w ADR-0027, teraz pattern 2 (Merkle audit chain).
  Warstwa NAD hash-chain (ADR-0001), nie zamiast niego. Daje audytorowi
  (UODO, rewident kancelarii, biegly w postepowaniu) proof-of-inclusion
  w O(log n) zamiast O(n) lancucha - dla kancelarii z 500k events to ~19
  hash'y do zweryfikowania zamiast 500k. Komplementarne z proof receipt
  (ADR-0031 PROPONOWANY) - rozne warstwy weryfikacji decyzji AI.
  Nowa tabela `audit_merkle_roots` w `backend/schema.sql` (chain_block_start,
  chain_block_end, merkle_root, event_count, computed_at, computed_by) z
  3 CHECK constraints (block order, event count consistency, hash format).
  3 nowe moduly w `backend/src/lib/`:
  `audit-merkle.ts` (pure functions `buildMerkleRoot` + `buildMerkleProof`
  + `verifyMerkleProof`, konwencja RFC 6962 - duplicate last leaf dla
  nieparzystej liczby, SHA-256 dla wezlow), `audit-merkle-roots.ts`
  (storage layer: `computeAndStoreRoot` + `fetchProofForEvent`, operacja
  read-only nad audit_log, brak ON CONFLICT - jednokrotnosc wywolania na
  zakres bloku jest odpowiedzialnoscia administratora w manual-trigger
  trybie), `audit-merkle-verifier.ts` (offline verifier `verifyProofBundle`
  dla audytora - zero zaleznosci od bazy, do uruchamiania standalone).
  Manualny trigger compute w tym ADR - automatyzacja (hook po N events
  z check-before-insert) + UI viewer dla audytora = rezerwacja ADR-0036.
  Zewnetrzny znacznik czasu (RFC 3161 / OpenTimestamps) =
  rezerwacja ADR-0037. +30 testow pure function w 2 plikach
  (`audit-merkle.test.ts` 20 testow w 4 sekcjach: buildMerkleRoot /
  round-trip proof / tamper detection / walidacja formatu;
  `audit-merkle-verifier.test.ts` 10 testow w 4 sekcjach: happy path /
  walidacja schematu / walidacja zakresu bloku / tamper detection), zero
  mockow. 459/464 testow pass (+5 todo, +30 nowych), TSC clean. Atrybucja:
  Microsoft AGT (MIT) + RFC 6962 Certificate Transparency
  (Laurie/Langley/Kasper, 2013) - pisane od zera w TypeScript, bez
  zaleznosci od @microsoft/agt.
- **ADR-0027 - Privilege rings dla wywolan narzedzi MCP** (2026-05-25).
  Implementacja trzeciego patternu z ADR-0024 (cherry-pick Microsoft AGT).
  Nowy modul `backend/src/lib/mcp/ring-policy.ts` (pure function
  `decideRing`) wpiety w `runMcpTool` jako gate w czasie wywolania PRZED
  faktycznym `client.callTool`. 3 ringi: Ring 0 (system, dokumentacyjnie
  zarezerwowany), Ring 1 (6 trusted konektorow Patrona z
  `APPROVED_PATRON_CONNECTORS`, allow + audit), Ring 2 (3rd-party,
  fail-closed default `deny`, explicit allow tylko gdy
  `operatorApproved=true` w `mcp-servers.json` + audit). Decyzje
  propagowane do `audit_log` z `event_type = "ring_policy.decision"`
  przez `recordRingPolicyEvent` w `audit-bridge.ts` (reuse modulu z
  ADR-0033). Komplementarne do MCP Security Gateway (ADR-0025/0028):
  Gateway = gate w czasie ladowania, ring-policy = gate w czasie
  wywolania. Defense-in-depth z dwoch perspektyw. +28 testow pure
  function `ring-policy.test.ts` w 5 sekcjach (Ring 1 trusted / Ring 2
  explicit allow / Ring 2 fail-closed / determinism + immutability /
  RingReason values), zero mockow. 429/434 testow pass (+5 todo, +28
  nowych), TSC clean.
- **ADR-0033 - Propagacja decyzji MCP Security Gateway do audit hash-chain**
  (2026-05-24). Decyzje Gateway'a inne niz `allowed-clean` (`audit`,
  `human_review`, `denied`) trafiaja teraz do tabeli `audit_log` z
  `event_type = "mcp_security.gateway"` przez nowy modul
  `backend/src/lib/mcp/audit-bridge.ts`. Realizuje pierwsza polowe zadania
  zostawionego przez ADR-0028 (druga polowa - UI banner dla Operatora +
  admin endpoint - rezerwacja ADR-0034 ze wzgledu na brak patternu RBAC
  w kodzie Patrona). Tryb wyslij-i-zapomnij: porazka audit_log NIE
  blokuje rejestracji toolow (Konstytucja Art. 8). Graceful no-op gdy
  `SUPABASE_*` env brak (analogicznie do `loadConfig`). Payload pomija
  pole `sample` z `McpFinding` (Konstytucja Art. 7 minimalnosc - sample
  moze zawierac fragment opisu 3rd-party konektora). +5 testow
  `audit-bridge.test.ts`. 401/406 testow pass, TSC clean.
- **ADR-0025 / ADR-0028 - MCP Security Gateway** w `backend/src/lib/mcp-security/`
  (2026-05-24). Lokalny, deterministyczny, zero-LLM, zero-cloud skan definicji
  konektorow MCP przed ich zaladowaniem do kontraktu. 4 detektory: typosquat
  (Levenshtein vs 6 zatwierdzonych nazw), drift (SHA256 hash vs baseline w
  `~/.patron/mcp-drift-baseline.json`), hidden-instructions (PL+EN regex
  jailbreak patterns w opisach narzedzi), tool-poisoning (permission expansion
  + schema mismatch). 4 stany akcji: `allowed` / `audit` / `human_review` /
  `denied`. ADR-0025 = skeleton (11 plikow, 25 testow vitest, +0 zaleznosci
  npm). ADR-0028 = wpiecie w `getMcpTools()` jako gate PRZED registracja
  toolow (refactor 2-fazowy: collect + register), baseline persist atomowo,
  +7 testow `baseline.test.ts`. Cherry-pick wzorca z
  [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
  (MIT). 396/401 testow pass, TSC clean.
- **ADR-0024 - cherry-pick decision record** dla Microsoft Agent Governance
  Toolkit (MIT, 1904 star, OWASP Agentic Top 10 10/10, 992 testow conformance).
  Trzy patterny do osobnych ADR-ow implementacyjnych (MCP Security Gateway =
  ADR-0025/0028 wdrozone; Merkle audit chain = ADR-0026 rezerwacja; privilege
  rings = ADR-0027 WDROZONE 2026-05-25). Audyt RODO pakietu `agent-governance-claude-code`
  v3.6.0 = ZIELONY.
- **ADR-0029 PROPONOWANY - Agent SRE Governance** dla wywolan LLM Patrona.
  4 SLI kancelarii-skali: TaskSuccessRate (>=80% w 7d), HallucinationRate
  (<=2% w 30d), CitationCoverage (>=70% pytan prawnych), McpSecurityIncidentRate
  (=0). 3-stanowy circuit breaker SYGNALOWY (NIE autonomiczne wylaczenie -
  zachowuje Art. 6 Konstytucji "human in the loop"). Implementacja w
  przyszlym ADR-0030.
- **ADR-0031 PROPONOWANY - deterministyczna walidacja decyzji z lokalnym
  proof receipt** (kontrpropozycja do ICME Preflight). Cherry-pick wzorca
  SMT-LIB compilation + proof receipt + offline verifier, NIE wpiecie
  zaleznosci HTTP (ICME `api.icme.io` to cloud-only US, lamie Art. 1 + Art. 5).
  3 patterny do osobnego ADR-0032 implementacyjnego (wybor solvera Z3 vs
  minizinc vs cvc5). 5 polityk-szablonow legal AI zaadoptowanych do skilla
  `matematic-konstytucja-ai` Appendix G.
- `THIRD_PARTY_INSPIRATIONS.md` rozszerzony o 3 sekcje
  (microsoft/agent-governance-toolkit, ICME Preflight,
  ICME-Lab/jolt-atlas WATCH LIST) z pelna atrybucja zgodna z kanonem
  cherry-pick MateMatic.

### Changed

- **Konstytucja AI v1.2.1 -> v1.2.2** (PATCH, 2026-05-24). Dodano Zalacznik C:
  mapping OWASP Agentic Top 10 (10 ryzyk ASI-01..ASI-10) na Artykuly Konstytucji
  Patrona + komponenty kodu. Pokrycie 10/10. Formalna deklaracja ze Patron jako
  produkt regulowany adresuje uznane branzowo ryzyka.

---

- ADR-0022 / ADR-0023 - 6. konektor MCP `mcp-eu-compliance` wpiety w
  Patrona (2026-05-22). Offline korpus prawa UE w lokalnym SQLite FTS5,
  verbatim (zero-LLM) - GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA.
  5 narzedzi: `eu_search`, `eu_article`, `eu_compare`, `eu_check_applicability`,
  `eu_evidence`. MIT. Komplementarny do `mcp-eu-sparql` (live SPARQL).
  Konektor jest publicznym repo (`matematicsolutions/mcp-eu-compliance`);
  bundle data via `npm run fetch-corpus` z Ansvar-Systems/EU_compliance_MCP
  (Apache-2.0). Bundler `scripts/bundle-mcp.cjs` i
  `backend/mcp-servers.example.json` zaktualizowane.
- Constitution AI v1.2.0 -> v1.2.1 (PATCH, 2026-05-24) - lista konektorow
  w Art. 9 rozszerzona z 5 do 6. Korpus zasady i model licencyjny bez zmian.
- ADR-0021 - Time-travel nowelizacji (deterministyczny diff przepisu w
  czasie). Decyzja przyjeta 2026-05-22, koncept z chrisryugj/korean-law-mcp
  (MIT) - patrz THIRD_PARTY_INSPIRATIONS.md. Implementacja jako narzedzie
  w `mcp-isap`, NIE zakodowana (T1-T5 w ADR). Bramka ELI zwalidowana.
- Phase 2.7 - Schema for law firm domain (`matter` / `client` / docs
  per matter).
- Phase 4.2 - additional event types in audit log (`doc.read`,
  `doc.export`) + RODO endpoint exposed via API (not only CLI).
- Phase 4.5 - PII pseudonymization layer (skeleton in
  `backend/src/lib/pseudonim/`, 24 Vitest cases green, not wired into
  `streamChatWithTools` yet - ADR-0003 pending Owner sign-off).
- Phase 6.1 - branding + landing page on matematic.co.

## [Unreleased - Constitution AI v1.1.1 - 2026-05-20]

Polish-only terminology patch for AI Constitution.

### Changed - Constitution AI v1.1.0 → v1.1.1 (PATCH, terminology)

- Art. 4 renamed from "Vendor neutrality" to "Neutralność wobec
  dostawców" (article body and contracts unchanged).
- Role 4.5 renamed from "Vendor (MateMatic)" to "Dostawca (MateMatic)".
- All cross-refs synced: `governance/adr/0002-*.md`, `README.md`,
  `deploy/USER_GUIDE.md`.
- Why: align the last English anglicism in Constitution with the rest
  of the PL client-grade documentation (internal redaction QA round 2).
  Article semantics, signatories, and external contracts (AI Act,
  GDPR mapping in App. A) unchanged - PATCH per § 6.1 of the
  Constitution. Version 1.2.0 reserved for the PII pseudonymization
  layer (ADR-0003) once it is wired into `streamChatWithTools`.

## [1.1.0] - 2026-05-20

Drafting extension + user-facing documentation.

### Added - Phase 2.2 (drafting pism PL)

- SYSTEM_PROMPT extended (`backend/src/lib/chat/prompts.ts`) with a
  Polish drafting section: structure of procedural filings (pozew /
  odpowiedź / apelacja / skarga kasacyjna / zażalenie), administrative
  complaints to WSA, appeals under KPA art. 127-141.
- Terminology guard - odwołanie vs skarga, pozew vs wniosek, wyrok vs
  postanowienie vs nakaz zapłaty, apelacja vs skarga kasacyjna.
- Citation conventions - Dz.U. + ELI for statutes, sygnatura akt +
  data + court for case law, CELEX for EU acts. Date format always
  `DD.MM.RRRR` in document text.
- Polite forms - Wysoki Sąd, Szanowny Organie.
- Drafting rule - never sign as the lawyer; output placeholder
  `[Podpis - imię, nazwisko, tytuł zawodowy, nr wpisu]` for the
  human to fill in.
- Added 7 unit tests for drafting section coverage
  (`prompts.test.ts`).

### Added - Phase 5.5 (user-facing documentation)

- `deploy/USER_GUIDE.md` - 9-section Polish manual for the lawyer
  end-user: first login, model selection, document workflow, chat
  best practices, 5 connectors, citation panel, audit transparency,
  FAQ, troubleshooting.

### Tests

- **76 / 76 passing** (up from 69 / 69 in v1.0.0).

---

## [1.0.0] - 2026-05-20

First public release as **Patron** (re-branded fork of
[Mike](https://github.com/willchen96/mike) under AGPL-3.0).

### Added - Phase 2 (polonization & quality)

- Refactor `chatTools.ts` from 3325 lines to 18 lines (thin facade)
  + 12 modules under `backend/src/lib/chat/` (types / prompts / tools
  / citations / messages / pdf / persistence / docx-generate /
  docx-edit / tool-dispatch / stream + barrel).
- Vitest test suite with **69 tests in 6 files** (citations 16,
  messages 10, prompts 7, mcp 12, persistence 6, audit 18).
- MCP citations contract: `McpCitation` type, `runMcpTool` returns
  `{text, citations}`, SSE event `mcp_citations`, persisted to
  `audit_log` with `type:"mcp_citation"` discriminator.
- Frontend `McpCitationsPanel` component under assistant message body,
  loader splits annotations into doc + MCP, labeled sections per
  server.
- SYSTEM_PROMPT extended with Polish jurisdiction and court structure.

### Added - Phase 3 (Polish legal MCP connectors)

5 separate MIT-licensed repositories, all wired by `mcp-servers.json`:
- [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos)
- [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa)
- [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap)
- [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs)
- [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)

### Added - Phase 4 (compliance)

- **Audit trail with SHA-256 hash-chain** for AI Act art. 12
  record-keeping. `audit_log` schema, `lib/audit.ts`, CLI verifier
  (`npm run audit:verify`), 18 attack scenario tests.
- **RODO endpoints as CLI**: `npm run rodo:export` (art. 20),
  `npm run rodo:delete` (art. 17 with audit log anonymization
  `actor_user_id := NULL`), `--confirm` safeguard.
- **Hardening**: `npm audit fix` (8 vulnerabilities → 1, anthropic
  SDK major bump pending), additional security headers
  (`Permissions-Policy` zeroed, `X-DNS-Prefetch-Control` off),
  `SECURITY.md`.
- **Constitution AI v1.1.0** - `governance/CONSTITUTION.md` (9 articles,
  boundaries, 5 roles, audit, evolution, mapping to AI Act + GDPR
  + Polish ethics codes).
- **Implementation Playbook** - `governance/IMPLEMENTATION_PLAYBOOK.md`
  (6-8 week deployment with RACI matrix).
- **ADR-0001** hash-chain audit trail decision record.
- **ADR-0002** dual-license decision record (AGPL shell + MIT connectors).

### Added - Phase 5 (deployment)

- `backend/Dockerfile` - multi-stage Node 20 + libreoffice + non-root
  + healthcheck on `/health`.
- `frontend/Dockerfile` - Next.js standalone, multi-stage, non-root.
- `docker-compose.yml` - backend + frontend, log rotation.
- `scripts/bundle-mcp.cjs` - cross-platform bundler that vendors
  the 5 MCP connectors into `backend/mcp-bundled/`.
- `.env.docker.example` template.
- `deploy/README.md` - 12-step deployment runbook with troubleshooting.
- `deploy/backup.sh` + `restore.sh` - encrypted backups via `age` +
  `pg_dump` + `mc mirror`, SHA-256 manifest, configurable retention.
- `deploy/BACKUP.md` - GDPR art. 32 backup guide.

### Changed

- **License**: MIT (Mike upstream) → AGPL-3.0-only (Patron shell).
  See `NOTICE` for full attribution.
- README rewritten with Polish-first framing, connector table,
  governance pointers.
- `CONTRIBUTING.md` rewritten with dual-license table and DCO
  (no CLA required).

### Removed

- Polish parliamentary proceedings scope (out of MVP; covered by
  `mcp-isap` for legislation, no need for full Sejm proceedings yet).

### Security

- Resolved 7 of 8 npm audit advisories (anthropic SDK major
  bump tracked in `SECURITY.md` § "Known acceptable risks").

---

[Unreleased]: https://github.com/matematicsolutions/patron/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/matematicsolutions/patron/releases/tag/v1.0.0
