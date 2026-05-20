# Changelog

All notable changes to **Patron** are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Phase 2.1 — Polish locale `pl` in the frontend UI (Next.js strings,
  date/number formats).
- Phase 2.2 — Polish drafting extension for SYSTEM_PROMPT
  (struktury wniosków / odpowiedzi / apelacji, terminologia,
  citing acts with ELI).
- Phase 2.7 — Schema for law firm domain (`matter` / `client` / docs
  per matter).
- Phase 4.2 — additional event types in audit log (`doc.read`,
  `doc.export`) + RODO endpoint exposed via API (not only CLI).
- Phase 5.5 — Polish user guide for lawyers (`deploy/USER_GUIDE.md`).
- Phase 6.1 — branding + landing page on matematic.co.

---

## [1.0.0] — 2026-05-20

First public release as **Patron** (re-branded fork of
[Mike](https://github.com/willchen96/mike) under AGPL-3.0).

### Added — Phase 2 (polonization & quality)

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

### Added — Phase 3 (Polish legal MCP connectors)

5 separate MIT-licensed repositories, all wired by `mcp-servers.json`:
- [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos)
- [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa)
- [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap)
- [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs)
- [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)

### Added — Phase 4 (compliance)

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
- **Constitution AI v1.1.0** — `governance/CONSTITUTION.md` (9 articles,
  boundaries, 5 roles, audit, evolution, mapping to AI Act + GDPR
  + Polish ethics codes).
- **Implementation Playbook** — `governance/IMPLEMENTATION_PLAYBOOK.md`
  (6-8 week deployment with RACI matrix).
- **ADR-0001** hash-chain audit trail decision record.
- **ADR-0002** dual-license decision record (AGPL shell + MIT connectors).

### Added — Phase 5 (deployment)

- `backend/Dockerfile` — multi-stage Node 20 + libreoffice + non-root
  + healthcheck on `/health`.
- `frontend/Dockerfile` — Next.js standalone, multi-stage, non-root.
- `docker-compose.yml` — backend + frontend, log rotation.
- `scripts/bundle-mcp.cjs` — cross-platform bundler that vendors
  the 5 MCP connectors into `backend/mcp-bundled/`.
- `.env.docker.example` template.
- `deploy/README.md` — 12-step deployment runbook with troubleshooting.
- `deploy/backup.sh` + `restore.sh` — encrypted backups via `age` +
  `pg_dump` + `mc mirror`, SHA-256 manifest, configurable retention.
- `deploy/BACKUP.md` — GDPR art. 32 backup guide.

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
