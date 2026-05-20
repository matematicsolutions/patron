# Changelog

All notable changes to **Patron** are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  of the PL client-grade documentation (Marko-PL round 2 rollout).
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
