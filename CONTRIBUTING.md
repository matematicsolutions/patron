# Contributing to Patron

Thanks for helping improve **Patron** — a local AI agent for Polish law firms.
This document covers contribution norms, the dual-license setup, and how to
submit a pull request that has a chance of being merged.

## License model (read this first)

Patron is a **dual-license stack**. Pick the right repo for your contribution:

| Repo | License | When to contribute here |
|---|---|---|
| `patron` (this one) | **AGPL-3.0-only** | shell features: chat UX, audit trail, document tools, schema, governance |
| `mcp-saos` | MIT | judgments connector (powszechne / SN / TK / KIO) |
| `mcp-nsa` | MIT | administrative court connector (NSA + WSA) |
| `mcp-isap` | MIT | legislation connector (Sejm ELI) |
| `mcp-krs` | MIT | company registry connector (MS KRS) |
| `mcp-eu-sparql` | MIT | EU law connector (EUR-Lex + CJEU) |

By opening a pull request you confirm that your contribution is licensed
under the destination repo's license (AGPL-3.0-only for `patron`, MIT for
each `mcp-*`). No CLA — the Developer Certificate of Origin
(<https://developercertificate.org>) is sufficient. We do not require a
`Signed-off-by` trailer but it is welcome.

## Guidelines

- **Targeted edits over broad refactors.** Big sweeps go through an issue first.
- **One PR = one bug / one feature / one cleanup.**
- **Update docs + env examples** when changing setup, config, or user-facing behavior.
- **Update `governance/` when you change a contract** that the Constitution
  promises: SSE event shape, MCP citation format, audit log payload, public API
  endpoints. Bump the Constitution version and add an ADR.
- **Don't commit secrets**, API keys, private documents, or local `.env` files.

## What we welcome (Patron shell, AGPL)

- Polish locale improvements (UI strings, date/number formats, legal terms).
- New SSE event types (with backward-compatible defaults).
- Audit trail extensions (new event types, exporters, retention controls).
- New built-in tools (search-style helpers that don't fit MCP).
- Tests (Vitest) — especially for `lib/chat/*` and the audit chain.
- Documentation: runbook (`deploy/`), playbook (`governance/`), ADRs.

## What goes into separate MCP repos (MIT)

- New Polish legal data sources (e.g. UODO decisions, BIK, GUS).
- New tools on existing connectors (e.g. `nsa__search_by_judge`).
- HTTP transport variants of existing stdio connectors.

The same `MikeMcpCitation` contract applies: every tool must return
`structuredContent.citations[]` with `title` (or `url`) so the Patron panel
renders them under a labeled section.

## Before opening a PR

- Run the relevant build or test command for the area you changed:
  - `npm run build --prefix backend`
  - `npm run build --prefix frontend`
  - `npm test --prefix backend` (must stay green)
  - `npx tsc --noEmit` in either subproject
- Re-bundle MCP if you touched a connector and want to test in Docker:
  - `node scripts/bundle-mcp.cjs`
- Check `git diff` and remove unrelated changes.
- Write a concise Markdown PR description:
  - **Summary** (one paragraph)
  - **Changes** (bullet list of files / behaviors)
  - **Why** (link to issue or describe motivation)
  - **Testing** (how reviewer can verify locally)

## Security

**Do not open a public issue for security vulnerabilities.**
Use GitHub private vulnerability reporting:
<https://github.com/matematicsolutions/patron/security/advisories/new>

We aim to acknowledge within 72 hours and coordinate a disclosure timeline.

For the hash-chain audit trail specifically: if you find a way to mutate
`audit_log` undetected by `npm run audit:verify`, that's a critical bug.
Report it privately.

## Local development

Backend:

```bash
cd backend
npm install
npm run dev    # tsx watch
npm test       # vitest
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Full stack (Docker):

```bash
# Requires all 5 mcp-* repos cloned next to patron/ and built.
node scripts/bundle-mcp.cjs
cp .env.docker.example .env.docker     # fill values
docker compose --env-file .env.docker up -d
```

## Code style

- TypeScript strict mode (already in tsconfig).
- No `any` unless absolutely necessary (use `unknown` + type guards).
- Prefer named exports over default exports.
- Comments in Polish are welcome for domain logic (we are building for
  Polish law firms); code identifiers stay in English.

## Vendor neutrality (don't break it)

Patron is bring-your-own-model. Don't add features that work only with
one provider. If you need provider-specific behavior, gate it on the
configured model and provide a graceful fallback.
