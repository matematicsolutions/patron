# AGENTS.md - Patron

This is the [agents.md](https://agents.md) file (Linux Foundation / Agentic AI Foundation) - the canonical instructions for AI agents working in this repository. Read natively by Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf (Cognition), Aider, Amp, Factory, GitHub Copilot and the other tools on the [official list](https://agents.md/#supported-tools).

> **For the agent:** before you change anything in this repo, read three files in this order: this file (AGENTS.md), [governance/CONSTITUTION.md](./governance/CONSTITUTION.md), [README.md](./README.md). This is not a formality - Patron is a governance product, not ordinary code.

## Purpose

Patron is a **local-first, self-hosted AI agent for a Polish law firm, built for GDPR and professional-secrecy compliance**. A zero-cloud, single-user desktop application (Electron): local SQLite by default ([ADR-0053](./governance/adr/0053-sqlite-single-user-zero-cloud.md)) plus MCP connectors to Polish and EU law (7 Node connectors: SAOS, NSA, ISAP, KRS, EUR-Lex SPARQL, EU compliance, EUREKA; 13 Python ELI connectors for national law), an audit trail with a hash chain (AI Act art. 12), bring-your-own-model (Gemini / Claude / local Ollama / OpenRouter). Server mode (Postgres + MinIO + Supabase) remains available as an alternative. A fork of [willchen96/mike](https://github.com/willchen96/mike) (AGPL-3.0) - Patron's shell inherits AGPL-3.0 as a derivative work; the MCP connectors are separate and MIT-licensed - see [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md).

## MateMatic context (HARD CONSTRAINTS)

The repository is maintained by [MateMatic Solutions](https://matematicsolutions.com). Patron is a **regulated product** - it is bound by:

- **Professional secrecy of advocates and legal advisers** (Polish Bar Act art. 6, Legal Advisers Act art. 3) - absolute. Patron does not send case files to the cloud without the Operator's informed decision ([Constitution](./governance/CONSTITUTION.md) Art. 1 and Art. 5).
- **GDPR art. 5/25/30/32** - data minimisation, privacy by design, records of processing, security. The data schema (local SQLite in desktop mode - ADR-0053; Postgres `backend/schema.sql` in server mode) is designed around art. 30 and 32.
- **AI Act art. 6 (high-risk AI in the legal domain, from 2026-08-02)** + **art. 12 (record-keeping)** - every LLM interaction is logged with a hash chain (ADR-0001).
- **Vendor neutrality** ([Constitution](./governance/CONSTITUTION.md) Art. 4) - Patron does not favour any LLM or provider. Do NOT introduce a single-provider dependency into the shell code.

## Build and test

```bash
# Backend (Node 20+, TypeScript)
cd backend && npm install && npm run build && npm test

# Frontend (Next.js)
cd frontend && npm install && npm run build && npm test

# Bundle the Node MCP connectors into the backend image (SERVER / docker mode)
node scripts/bundle-mcp.cjs

# Bundling the Node MCP connectors + the embedder model into the DESKTOP installer
# (Electron) happens in prepare-resources.cjs (stageMcpConnectors + stageEmbedModel);
# it needs the built mcp-* repos next to patron/ (MCP_REPOS_DIR, default `..`).
# See ADR-0100. When you add a NODE connector, sync its name in SIX places:
# backend/src/lib/mcp-security/pipeline.ts (APPROVED_PATRON_CONNECTORS),
# backend/src/lib/mcp/connectors.ts (JURISDICTION_BY_CONNECTOR - otherwise the picker
# files it under "OTHER"), desktop/scripts/prepare-resources.cjs (MCP_SERVERS AND the
# local JURISDICTION mirror + ORDER_PL/ORDER_EN - without the mirror entry the connector
# ships in the installer as enabled=false, measured 2026-08-17 on eureka),
# desktop/scripts/connectors-expected.cjs (the per-edition gate's expectation - it is
# hand-written ON PURPOSE and does NOT import prepare-resources.cjs, so a gate that
# computed the expectation from the code under test would pass its own exam) and
# mcp-servers.example.json; for docker mode additionally scripts/bundle-mcp.cjs.
# A name mismatch = the typosquat gate + ring policy block OUR OWN connector (ADR-0027/0028).
# State on 2026-08-17: 7 Node connectors (6 + eureka); the eureka repo lives in
# ~/Projects/mcp-eureka and is visible next to patron/ through the junction ~/mcp-eureka.
#
# PYTHON connectors (national ELI connectors, Option C - ADR-0136): NOT frozen per
# connector; ONE bundled standalone CPython + `uv pip install` of all of them into its
# site-packages at build time (stageBundledPython in prepare-resources.cjs). The eli
# repos live in ~/Projects (MCP_PY_REPOS_DIR, not next to patron). 4-way name sync:
# pipeline.ts APPROVED + prepare-resources.cjs MCP_SERVERS_PYTHON + mcp-servers.example.json
# + desktop/scripts/connectors-expected.cjs (per-edition expectation, see above).
# Spawn: py-runtime/python.exe -s -E -c "from <module>.server import main; main()".
# Build locale (ADR-0132/0139): NEXT_PUBLIC_PATRON_LOCALE in {pl,en,it,de,es,fr,pt,gb,us}
# (source of truth: SUPPORTED_LOCALES in frontend/src/i18n/index.ts; gb and us reuse the
# en dictionary and differ only in the jurisdiction profile + home connector).
# en = EU-first connector set + EN tutorial; it/de/es/fr = home connector ON + national
# substance in the prompts (PROFILES in backend/src/lib/chat/prompts.ts).
# Prefer `npm run build:<locale>` (desktop/scripts/build-locale.cjs) - it sets the locale,
# the NSIS language and the canonical artifact name PATRON-Setup-Windows[-XX].exe.
cd desktop && npm run build

# Full stack (Docker; needs Supabase + MinIO separately)
cp .env.docker.example .env.docker
# (fill in the secrets)
docker compose --env-file .env.docker up -d
```

Tests: backend vitest 1467 pass / 0 fail / 5 todo, frontend vitest 43 pass, on 2026-08-18. TSC clean (backend + frontend). **Do not commit if tests fail** - the quality gate from [CONTRIBUTING.md](./CONTRIBUTING.md) (`npm test --prefix backend` must stay green). Before a release, additionally run `npm run smoke:surfaces` (backend, real model: tabular / workflows / DOCX / research + MCP grounding / draft-refine) and `npm run build:dir && npm run e2e:smoke` (desktop, packaged app on a clean profile) - the build tooling exits 0 even when the package is incomplete; only the e2e catches that. It now asserts three kinds of incompleteness before booting the app: empty `resources/{backend,frontend}/node_modules` (electron-builder 26 strips them), a missing OCR engine or the language pack of THIS edition, and an MCP connector manifest that does not match the edition (`desktop/scripts/connectors-gate.cjs`). The connector check also runs on the artifact inside `npm run build:<locale>`, so a wrong manifest stops the build before the installer is renamed and checksummed.

## Code rules

- **TypeScript strict**. No `any` in new code, no `// @ts-ignore` without a comment explaining why.
- **Audit-first** - every new LLM interaction goes through `backend/src/lib/audit/` (hash chain). Bypassing it is a critical bug.
- **Pseudonymisation / anonymisation** - sensitive data (PESEL / first name / surname / address) goes through `backend/src/lib/pl-entities/` BEFORE it is sent to the LLM. See [ADR-0003](./governance/adr/0003-hey-jude-pseudonim-pipeline.md).
- **Input security** - input documents (PDF/DOCX/TXT) go through `backend/src/lib/input-security/` (prompt injection / steganography / homoglyphs / evasion) BEFORE RAG indexing. Both upload seams (single document and project) share ONE function, `backend/src/lib/documentIngest.ts` - do not copy the ingest logic, import it. See [ADR-0019](./governance/adr/0019-input-document-security-pipeline-pl.md) + [ADR-0020](./governance/adr/0020-wpiecie-input-security-w-ingest.md) + [ADR-0055](./governance/adr/0055-parytet-skanu-input-security-sciezka-projektowa.md).
- **MCP security gateway** - MCP connector definitions go through `backend/src/lib/mcp-security/` (typosquat / drift / hidden instructions / tool poisoning) BEFORE tools are registered at runtime. A `denied` / `human_review` decision blocks the connector. Decisions other than `allowed-clean` propagate to the audit hash chain (`event_type = "mcp_security.gateway"`) through `backend/src/lib/mcp/audit-bridge.ts`. See [ADR-0025](./governance/adr/0025-mcp-security-gateway-wdrazenie.md) + [ADR-0028](./governance/adr/0028-wpiecie-mcp-security-gateway-w-startup.md) + [ADR-0033](./governance/adr/0033-propagacja-mcp-security-do-audit-hash-chain.md).
- **Merkle audit chain** - a Merkle tree (RFC 6962) is built on top of the existing hash chain (ADR-0001). An auditor gets a proof of inclusion in O(log n) instead of walking the O(n) chain. Table `audit_merkle_roots` (block_start, block_end, merkle_root, event_count). Three modules in `backend/src/lib/`: `audit-merkle.ts` (pure functions), `audit-merkle-roots.ts` (storage layer, does not modify audit_log), `audit-merkle-verifier.ts` (offline verifier for the auditor). Manual trigger in this iteration (the firm's administrator computes the root); automation + UI viewer = reserved as ADR-0036; RFC 3161 timestamping = reserved as ADR-0037. See [ADR-0026](./governance/adr/0026-merkle-audit-chain-upgrade.md).
- **Human-in-the-loop write staging (ADR-0137)** - agent actions with side effects (`edit_document` / `generate_docx`) can pass through the `maybeStageMutation` gate in `backend/src/lib/chat/tool-dispatch.ts` BEFORE execution - staged as `mutation_approvals` cards (`pending`); only a human approval executes them (`backend/src/routes/approvals.ts`, `requireAuth`, fail-closed, scoped by `user_id`). Execution after approval lives in `backend/src/lib/chat/mutation-approval-executor.ts`; the pure core in `backend/src/lib/mutation-approval.ts`. The decision (approve/reject) goes to the audit hash chain (`event_type = "mutation.approval.decision"`, payload without document content). Inbox UI: `frontend/src/app/(pages)/account/approval-cards`. OFF by default (`PATRON_MUTATION_APPROVAL=true` enables it) until ADR-0137 is accepted. When you add a new `event_type`: five mirrors, following the connector.toggle precedent (audit.ts + schema.sqlite.ts CHECK + schema.sql CHECK + a NEW migrate.sqlite.ts rebuild step with the FULL list + a Postgres migration with the FULL list) - guarded by `backend/src/lib/db/event-type-parity.test.ts` (compares all five mirrors; measured 2026-08-18: `cost_cap` had dropped out of three Postgres migrations and three SQLite rebuilds, fixed by step v5 + migration 019). See [ADR-0137](./governance/adr/0137-mutation-approval-cards-human-in-the-loop.md).
- **Citation grounding, including MCP sources (ADR-0005 / ADR-0146)** - quotes from firm documents are string-matched against the document text (`groundCitationsByRef`); spans the model presents as verbatim quotes from external sources (blockquotes, quotation marks) are matched against the text the MCP connector actually returned in that turn (`backend/src/lib/citation/mcp-grounding.ts`, SSE event `mcp_grounding`). Deterministic, offline, no LLM. Verdicts are advisory (green / yellow / red); a missing source text is yellow "not verified", never green, and a grounding failure is an explicit signal in the UI, never silence. The audit log receives counts only - never the quote text. See [ADR-0146](./governance/adr/0146-grounding-cytatow-mcp.md).
- **The audit export ships with its verifier (ADR-0142)** - `GET /api/audit/export/:eventId` returns a ZIP: the artifact + `SPRAWDZ-TEN-PLIK.html` + `verify.py` + instructions. The content of both verifiers is **EMBEDDED** in `backend/src/lib/audit-verifier-assets.ts` (`String.raw`), NOT read from disk - a file skipped by Electron packaging would vanish silently while the export still succeeded, so the recipient would get an archive without the tool. When you edit those strings, run `audit-verifier-assets.test.ts` - it checks that the Python verifier, the browser verifier and the production code give THE SAME verdict (canonicalisation + tampering cases). Do not add a backtick or `${` to them. The instructions inside the artifact must point to the tools IN THE ARCHIVE, never to the `backend/` directory - the recipient does not have it. See [ADR-0142](./governance/adr/0142-weryfikator-w-paczce-eksportu-audytowego.md).
- **Two audit exports, two questions (ADR-0047 / ADR-0152)** - `GET /api/audit/export/:eventId` returns ONE event from the log for an auditor and is **admin-only**; `GET /api/audit/bundle/:messageId` returns the whole deliverable together with the evidence of how it came about (content, the verdict on every citation including MCP sources, the hash-chain excerpt, model versions) and is **NOT admin-only** - it is gated by the case boundary (owner of the chat, or project access per ADR-0148), because the person who needs it is the author of the document, not the firm's auditor. No access returns **404, not 403**: the existence of somebody else's message is itself information about a case. The export writes `deliverable.bundle_export` to the hash chain **fail-closed** - if the audit write fails (for instance a Postgres deployment without migration 020) the export does NOT happen, otherwise a package containing case content would leave the firm with no trace. Both exports reuse the same ZIP + verifier machinery (ADR-0142); the verifiers already understood `deliverable_audit_bundle`. See [ADR-0152](./governance/adr/0152-wpiecie-pakietu-dowodowego-deliverable.md).
- **Skills: integrity and egress (ADR-0143)** - the audit records a skill as `version` plus `prompt_sha256`, not just `id`: `importSkill` upserts by `id` when the manifest is unsigned, so the pair `(id, version)` does NOT identify the content. The hash is computed AT READ TIME in `backend/src/lib/skills/integrity.ts` (`canonicalSha256` from ADR-0142 - one canonicalisation in the project). The `egress` declaration from the manifest is ENFORCED before execution (`partitionSkillsByEgress`): a `no-egress` skill does not go to a model that leaves the machine, and the omission is recorded in the audit as `skipped_skills` with a reason. When you add a new `surface`, route it through the same gate, otherwise the gap returns. See [ADR-0143](./governance/adr/0143-integralnosc-skilla-i-bramka-egress.md).
- **i18n** - translations live in `frontend/src/i18n/` (`pl.ts` is the source of keys, `en.ts` is deep-partial with fallback to PL, `index.ts` = `t()` + locale-aware format helpers). One language per installation, no next-intl / no locale in the URL. See [ADR-0132](./governance/adr/0132-locale-selection-jeden-jezyk-per-instalacja.md). Dictionary BEFORE components.
- **A commit message is a public artifact.** It says WHAT was fixed. It never carries the name of a client, a prospect, a pilot firm or a third person, a commercial promise, or an internal decision trail - those go to the ADR and the CHANGELOG, where they have context and can be edited. A commit message cannot be corrected without rewriting history, and a force-push does not erase it (GitHub keeps orphaned commits reachable by SHA). Gate: `.githooks/commit-msg` locally plus a CI backstop in `publication-gate.yml`; after cloning run `git config core.hooksPath .githooks`.
- **`.matematic/` and `.claude/` are the private workshop** - release trackers, specs, internal audits, machine-local settings. They live on disk, they are NOT tracked, and `deny_paths` in `.publication-gate.json` blocks them from coming back. ADRs that link to `.matematic/spec/...` point at a document the public reader does not get; that is intentional.
- **No Polish diacritics in commit messages** - organisation convention (ą -> a, ę -> e, ł -> l, ó -> o, ś -> s, ń -> n, ć -> c, ż/ź -> z).
- **Registry of migration/ADR numbers** - BEFORE you create a new Postgres migration or ADR, take the number from the registry in `.matematic/releases/<current release>/README.md`, section "Rejestr wolnych numerow" (that directory is the **private workshop** described above - in a public clone it is absent, and the gate says so out loud rather than skipping the check silently), and bump the counter IN THE SAME commit. Numbers reserved "by eye" on parallel branches collided (migration 014 twice). Mechanical gate: `python scripts/adr_number_gate.py .` (a duplicate ADR/migration number prefix or an un-bumped registry = fail; runs in CI in `publication-gate.yml`).
- **Branch hygiene** - WIP is always committed (even as `wip:`); delete a branch once its content has been merged into the release line; remove a worktree once its phase is done; test data = a synthetic cast from the FIRST commit (scrubbing after the fact creates false conflicts across the whole history). Measure a branch against the release with `git log --cherry-pick --right-only`, not is-ancestor.
- **An ADR before every non-trivial architectural decision** - `governance/adr/NNNN-slug.md`. Two rounds of internal content review BEFORE merge.

## What NOT to do (hard rules)

- **Do NOT add an LLM provider to the core path without an ADR.** Patron is vendor-neutral by design.
- **Do NOT send the law firm's client data to the US.** A transfer outside the EEA requires a DPA + DPF and a decision of the Controller (a role from the [Constitution](./governance/CONSTITUTION.md)).
- **Do NOT disable the audit trail** or its hash-chain verification. It is the only evidence of compliance.
- **Do NOT fork the structure of the Polish entities** (PESEL/NIP/REGON/case signatures) - they live in `backend/src/lib/pl-entities/` as a shared library with tests.
- **Do NOT commit** node_modules / dist / .env / database dumps.

## Sources of truth (reading order)

1. [README.md](./README.md) - description for humans
2. [governance/CONSTITUTION.md](./governance/CONSTITUTION.md) - 9 principles, roles, audit (v1.7.2, signed by law firms)
3. [governance/IMPLEMENTATION_PLAYBOOK.md](./governance/IMPLEMENTATION_PLAYBOOK.md) - 6-8 week rollout, RACI
4. [governance/adr/](./governance/adr/) - Architecture Decision Records (0001-0146)
5. [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md) - what we cherry-picked and from where (Mike, Lavern, gbrain, isaacus/tabular-review, PII-Shield, earendil/pi, awesome-llm-apps)
6. [CHANGELOG.md](./CHANGELOG.md), [SECURITY.md](./SECURITY.md), [CONTRIBUTING.md](./CONTRIBUTING.md)

## Agent compatibility

This file (AGENTS.md) follows the [agents.md](https://agents.md) standard backed by the **Linux Foundation / Agentic AI Foundation**. Read natively by 20+ tools.

For Claude Code there is additionally [CLAUDE.md](./CLAUDE.md), which imports this document (`@AGENTS.md`).

For agents running in containers: the full `AGENTS.md` must be present in the backend image (copy it in the Dockerfile).

## Licence and attribution

- **Shell** (`backend/`, `frontend/`, `deploy/`, `governance/`, `scripts/`) - **AGPL-3.0**. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
- **MCP connectors** (separate `mcp-*` repositories) - **MIT**.
- Cherry-picks and attributions: [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md).

Citation: *MateMatic Solutions (2026), Patron - a local AI agent for the Polish law firm, https://github.com/matematicsolutions/patron, AGPL-3.0.*
