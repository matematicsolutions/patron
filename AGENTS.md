# AGENTS.md - Patron

An [agents.md](https://agents.md) standard file (Linux Foundation / Agentic AI Foundation) - canonical instructions for AI agents working with this repository. Read natively by Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf (Cognition), Aider, Amp, Factory, GitHub Copilot and other tools on the [official list](https://agents.md/#supported-tools).

> **For the agent:** if you change anything in this repo, start by reading three files in order: this file (AGENTS.md), [governance/CONSTITUTION.md](./governance/CONSTITUTION.md), [README.md](./README.md). This is not a formality - Patron is a governance product, not ordinary code.

## Project goal

Patron is a **local, GDPR-safe AI agent for law firms**. A zero-cloud, single-user desktop application (Electron): local SQLite by default ([ADR-0053](./governance/adr/0053-sqlite-single-user-zero-cloud.md)) + 6 MCP connectors for Polish and EU law, an audit trail with a hash chain (AI Act art. 12), bring-your-own-model (Gemini / Claude / local Ollama / OpenRouter). Server mode (Postgres + MinIO + Supabase) remains available as an alternative. A fork of [willchen96/mike](https://github.com/willchen96/mike) (AGPL-3.0) - the Patron shell inherits AGPL-3.0 as a derivative work; the MCP connectors are separately licensed under MIT - see [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md).

## MateMatic context (HARD CONSTRAINTS)

The repo is maintained by [MateMatic Solutions](https://matematicsolutions.com). Patron is a **regulated product** and is subject to:

- **Attorney and legal-adviser professional secrecy** (PoA art. 6, URP art. 3) - absolute. Patron does not send case files to the cloud without the Operator's consent ([Constitution](./governance/CONSTITUTION.md) Art. 2).
- **GDPR art. 5/25/30/32** - minimization, privacy by design, records of processing activities, security. The data schema (local SQLite in desktop mode - ADR-0053; Postgres `backend/schema.sql` in server mode) is designed for art. 30 and 32.
- **AI Act art. 6 (high-risk AI in law, from 2026-08-02)** + **art. 12 (record-keeping)** - every LLM interaction is logged with a hash chain (ADR-0001).
- **Vendor neutrality** ([Constitution](./governance/CONSTITUTION.md) Art. 4) - Patron does not favor any LLM or provider. Do NOT introduce a dependency on a single provider in the shell code.

## Build and test

```bash
# Backend (Node 20+, TypeScript)
cd backend && npm install && npm run build && npm test

# Frontend (Next.js)
cd frontend && npm install && npm run build && npm test

# Bundle the 6 MCP connectors into the backend image (SERVER mode / docker)
node scripts/bundle-mcp.cjs

# Bundle the 6 MCP connectors + embedder model into the DESKTOP installer (Electron)
# handled in prepare-resources.cjs (stageMcpConnectors + stageEmbedModel),
# requires the 6 built mcp-* repos next to patron/ (MCP_REPOS_DIR, default `..`).
# See ADR-0100. When adding a NODE connector, keep its name in sync in THREE places:
# backend/src/lib/mcp-security/pipeline.ts (APPROVED_PATRON_CONNECTORS),
# desktop/scripts/prepare-resources.cjs (MCP_SERVERS) and mcp-servers.example.json -
# a name mismatch means the typosquat gate + ring-policy block YOUR OWN connector (ADR-0027/0028).
#
# PYTHON connectors (9 EU national ones, Option C - ADR-0136): do NOT freeze per connector,
# but rather ONE bundled standalone CPython + `uv pip install` the 9 into its site-packages
# at build time (stageBundledPython in prepare-resources.cjs). The eli repos live in ~/Projects
# (MCP_PY_REPOS_DIR, not next to patron). 3-way name sync: pipeline.ts APPROVED +
# prepare-resources.cjs MCP_SERVERS_PYTHON + mcp-servers.example.json. Spawn:
# py-runtime/python.exe -s -E -c "from <module>.server import main; main()".
# Build locale: NEXT_PUBLIC_PATRON_LOCALE=en gives the EU-first set + EN tutorial.
cd desktop && npm run build

# Full stack (Docker, requires Supabase + MinIO separately)
cp .env.docker.example .env.docker
# (fill in secrets)
docker compose --env-file .env.docker up -d
```

Tests: 1341/1346 pass (5 todo, 0 fail) as of 2026-07-30 (backend vitest). TSC clean (backend + frontend); frontend `next build` green. **Do not commit if tests fail** - quality gate from the [Constitution](./governance/CONSTITUTION.md) Art. 7.

## Code rules

- **TypeScript strict**. No `any` in new code, no `// @ts-ignore` without a comment explaining why.
- **Audit-first** - every new LLM interaction goes through `backend/src/lib/audit/` (hash chain). A bypass is a critical error.
- **Pseudonymization/anonymization** - sensitive data (PESEL/first name/last name/address) passes through `backend/src/lib/pl-entities/` BEFORE being sent to the LLM. See [ADR-0003](./governance/adr/0003-hey-jude-pseudonim-pipeline.md).
- **Input security** - input documents (PDF/DOCX/TXT) pass through `backend/src/lib/input-security/` (prompt injection / steganography / homoglyphs / evasion) BEFORE RAG indexing. Both upload seams (single-document and project) share ONE `backend/src/lib/documentIngest.ts` function - do not copy the ingest logic, import it. See [ADR-0019](./governance/adr/0019-input-document-security-pipeline-pl.md) + [ADR-0020](./governance/adr/0020-wpiecie-input-security-w-ingest.md) + [ADR-0055](./governance/adr/0055-parytet-skanu-input-security-sciezka-projektowa.md).
- **MCP security gateway** - MCP connector definitions pass through `backend/src/lib/mcp-security/` (typosquat / drift / hidden-instructions / tool-poisoning) BEFORE tools are registered at runtime. A `denied`/`human_review` decision blocks the hookup. Decisions other than `allowed-clean` propagate to the audit hash chain (`event_type = "mcp_security.gateway"`) via `backend/src/lib/mcp/audit-bridge.ts`. See [ADR-0025](./governance/adr/0025-mcp-security-gateway-wdrazenie.md) + [ADR-0028](./governance/adr/0028-wpiecie-mcp-security-gateway-w-startup.md) + [ADR-0033](./governance/adr/0033-propagacja-mcp-security-do-audit-hash-chain.md).
- **Merkle audit chain** - on top of the existing hash chain (ADR-0001) a Merkle tree (RFC 6962) is built. The auditor gets proof-of-inclusion in O(log n) instead of O(n) over the chain. Table `audit_merkle_roots` (block_start, block_end, merkle_root, event_count). 3 modules in `backend/src/lib/`: `audit-merkle.ts` (pure functions), `audit-merkle-roots.ts` (storage layer, does not modify audit_log), `audit-merkle-verifier.ts` (offline verifier for the auditor). Manual trigger in this iteration (compute root by the firm administrator); automation + UI viewer = reserved in ADR-0036; RFC 3161 timestamping = reserved in ADR-0037. See [ADR-0026](./governance/adr/0026-merkle-audit-chain-upgrade.md).
- **Human-in-the-loop write staging (ADR-0137)** - agent actions with side effects (`edit_document` / `generate_docx`) can pass through the `maybeStageMutation` gate in `backend/src/lib/chat/tool-dispatch.ts` BEFORE execution - staged as `mutation_approvals` cards (`pending`); only a human decision executes them (`backend/src/routes/approvals.ts`, `requireAuth`, fail-closed, `user_id` scoping). Post-approve execution in `backend/src/lib/chat/mutation-approval-executor.ts`; pure core in `backend/src/lib/mutation-approval.ts`. The decision (approve/reject) goes into the audit hash chain (`event_type = "mutation.approval.decision"`, payload without document content). Inbox UI: `frontend/src/app/(pages)/account/approval-cards`. OFF by default (`PATRON_MUTATION_APPROVAL=true` enables). When adding a new `event_type`: 5 mirrors per the connector.toggle precedent (audit.ts + schema.sqlite.ts CHECK + schema.sql CHECK + migrate.sqlite.ts rebuild + Postgres migration). See [ADR-0137](./governance/adr/0137-mutation-approval-cards-human-in-the-loop.md).
- **i18n** - translations in `frontend/src/i18n/` (`pl.ts` is the source of keys, `en.ts` is a deep-partial + PL fallback, `index.ts` = `t()` + locale-aware format helpers). One language per installation, no next-intl/locale-in-URL. See [ADR-0132](./governance/adr/0132-locale-selection-jeden-jezyk-per-instalacja.md). Dictionary BEFORE components.
- **No Polish characters in commit messages** - organization convention (a -> a, e -> e, l -> l, o -> o, s -> s, n -> n, c -> c, z -> z).
- **An ADR before every non-trivial architectural decision** - `governance/adr/NNNN-slug.md`. Internal content review, 2 rounds, BEFORE merge.

## What NOT to do (hard rules)

- **Do NOT add an LLM provider in the core path without an ADR.** Patron is vendor-neutral by design.
- **Do NOT send law-firm client data to the US.** A transfer outside the EEA requires a DPA + DPF and a decision by the Controller (a role from the [Constitution](./governance/CONSTITUTION.md)).
- **Do NOT disable the audit trail** or its hash-chain verification. It is the only proof of compliance.
- **Do NOT fork the structure of Polish entities** (PESEL/NIP/REGON/case signatures) - they live in `backend/src/lib/pl-entities/` as a shared library with tests.
- **Do NOT commit** node_modules / dist / .env / database dumps.

## Sources of truth (reading order)

1. [README.md](./README.md) - description for humans
2. [governance/CONSTITUTION.md](./governance/CONSTITUTION.md) - 9 principles, roles, audit (v1.6.1, signed by the firm)
3. [governance/IMPLEMENTATION_PLAYBOOK.md](./governance/IMPLEMENTATION_PLAYBOOK.md) - 6-8 week rollout, RACI
4. [governance/adr/](./governance/adr/) - Architecture Decision Records (0001-0130)
5. [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md) - what we cherry-picked and from where (Mike, Lavern, gbrain, isaacus/tabular-review, PII-Shield, earendil/pi, awesome-llm-apps)
6. [CHANGELOG.md](./CHANGELOG.md), [SECURITY.md](./SECURITY.md), [CONTRIBUTING.md](./CONTRIBUTING.md)

## Agent compatibility

This file (AGENTS.md) is the [agents.md](https://agents.md) standard supported by the **Linux Foundation / Agentic AI Foundation**. Read natively by 20+ tools.

For Claude Code there is additionally a [CLAUDE.md](./CLAUDE.md) file that imports this document (`@AGENTS.md`).

For agents running in containers: the full `AGENTS.md` must be present in the backend image (copy it in the Dockerfile).

## License and attribution

- **Shell** (`backend/`, `frontend/`, `deploy/`, `governance/`, `scripts/`) - **AGPL-3.0**. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
- **6 MCP connectors** (separate `mcp-*` repos) - **MIT**.
- Cherry-picks and attributions: [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md).

Citation: *MateMatic Solutions (2026), Patron - a local AI agent for law firms, https://github.com/matematicsolutions/patron, AGPL-3.0.*
