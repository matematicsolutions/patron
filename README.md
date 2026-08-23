# Patron

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-1471_backend_%2B_86_frontend-brightgreen)](./backend)
[![AI Act](https://img.shields.io/badge/AI_Act-Art._12_record--keeping-orange)](./governance/CONSTITUTION.md)
[![RODO](https://img.shields.io/badge/RODO-art._5%2F25%2F30%2F32-orange)](./governance/CONSTITUTION.md)
[![Stack](https://img.shields.io/badge/stack-zero--cloud-success)](./governance/CONSTITUTION.md)
[![MCP](https://img.shields.io/badge/MCP-20_connectors-blue)](https://github.com/matematicsolutions)
[![Node](https://img.shields.io/badge/Node-20%2B-brightgreen)](https://nodejs.org)

> **A local-first, self-hosted AI agent for a law firm.** A zero-cloud, single-user desktop
> application (Electron): local SQLite by default ([ADR-0053](./governance/adr/0053-sqlite-single-user-zero-cloud.md)), 20 bundled connectors to Polish, EU and national law
> (SAOS / NSA / ISAP / KRS / EUREKA / EUR-Lex / EU-Compliance), a hash-chained audit trail (AI Act art. 12),
> bring-your-own-model (Gemini / Claude / local Ollama / OpenRouter). A server mode (Postgres + MinIO) remains available as an alternative.

Patron is a fork of [Mike](https://github.com/willchen96/mike) (a document-centric
legal assistant, **AGPL-3.0**). The Patron shell inherits AGPL-3.0 as a derivative
work. It adds Polish localization, a Polish legal stack, and the compliance
requirements a law firm needs. The full rules live in
[governance/CONSTITUTION.md](./governance/CONSTITUTION.md).

## What Patron does

Everything below ran end-to-end on 2026-08-23 against a real model on synthetic contract fixtures
(`npm run smoke:surfaces`, `smoke:desktop`, packaged app `e2e:smoke`); nothing here is a roadmap item.

- **Chat over the case files** with a colour badge next to every citation from your own documents:
  green (verbatim), yellow (paraphrase), red (the source does not support the claim). A local
  paraphrase judge, never a cloud call, decides the colour.
- **Case law, legislation and tax practice while answering** - 20 MCP connectors ship in the
  installer: 7 for Polish and EU sources (SAOS, NSA, ISAP, KRS, EUREKA, EUR-Lex/CJEU) queried live,
  plus 13 national ELI connectors (DE, FR, IT, ES, NL, SE, AT, FI, IE, LU, BR, GB, US) that follow
  the European Legislation Identifier. On top of that an offline EU compliance corpus (GDPR, AI Act,
  DORA, NIS2, eIDAS 2.0, CRA) that works without internet. Connector answers carry source, signature or
  identifier, date and URL (measured on SAOS and EUREKA; the same MCS contract applies to the rest).
- **A table from a batch of contracts** (Tabular Review): you define the columns as questions,
  Patron fills one cell per document with the answer, a quote from the source page and a
  confidence flag (green / yellow / red / grey).
- **Editing documents as a lawyer does** - you ask for a change and review it as Word tracked
  changes, then accept or reject. A file edited in Word comes back into Patron with its changes
  intact.
- **Drafting** - generate a new .docx from the chat, or run a whole pleading through a review,
  devil's advocate and language pass before it leaves the firm.
- **Workflows** - saved prompts and column sets you reuse across cases.
- **Human-in-the-loop for agent writes** (optional, ADR-0137): edits and generated files can be
  staged as approval cards; nothing is written until a human approves.
- **An audit trail you can hand to a regulator** - every model interaction hash-chained (AI Act
  art. 12) with a Merkle root, exportable as a ZIP that ships its own verifier (a browser page and a
  Python script), so a court, the DPA or the client can check it without this repository (ADR-0142).
- **PII does not leave the machine by accident** - names, companies, PESEL/NIP/REGON are masked before
  any cloud model; a per-case cloud consent and an egress guard sit in front of every outbound call.
- **Bring your own model** - Gemini, Claude, OpenRouter, or a local Ollama model, chosen in
  settings or per conversation.
- **9 installer editions** from one code line: PL, EN (EU-first), US, GB, BR, IT, DE, ES, FR - each
  with its home jurisdiction connector on by default. Downloads: [matematicsolutions.com/pobierz](https://matematicsolutions.com/pobierz).

Two limits we say out loud. Citations returned by MCP connectors are shown with their source but
do not pass through the colour badge verification that citations from your own documents get; treat
them as unverified until you open the source. The Windows installer is not code-signed, so SmartScreen
warns on first run.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, MCP client, audit trail, tool dispatch
- `backend/src/lib/input-security/` - a local, deterministic scan of incoming documents (prompt injection / hidden PDF actions / obfuscation) before they reach the model or RAG (ADR-0019/0020)
- `backend/src/lib/mcp-security/` - a local, deterministic scan of MCP connector definitions (typosquatting / description drift / hidden instructions / tool poisoning) BEFORE they are loaded into the MCP contract (ADR-0025/0028)
- `backend/schema.sql` - Postgres schema (server mode, Supabase-compatible); desktop mode uses local SQLite (ADR-0053)
- `governance/` - **Patron AI Constitution** + Implementation Playbook + ADRs
- `deploy/` - deployment runbook (`docker-compose`)
- `scripts/bundle-mcp.cjs` - bundler that packs the 7 MCP servers into the backend image

## MCP connectors for Polish and EU law (separate repos)

| Connector | Domain | Returns |
|---|---|---|
| [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos) | common courts, Sad Najwyzszy (Supreme Court), Trybunal Konstytucyjny (Constitutional Tribunal), KIO | search / get_judgment / search_by_case |
| [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) | NSA (Supreme Administrative Court) + 16 WSA (regional administrative courts) case law (CBOSA) | search / get_judgment / search_by_case |
| [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) | Polish legislation (Dziennik Ustaw / Journal of Laws + Monitor Polski, Sejm ELI) | search_acts / get_act / get_act_text |
| [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs) | Krajowy Rejestr Sadowy (National Court Register, Ministry of Justice) | get_entity / get_entity_full / get_board |
| [`mcp-eureka`](https://github.com/matematicsolutions/mcp-eureka) | Polish tax rulings: KIS individual interpretations, WIS, WIA (EUREKA, Ministry of Finance) - the authorities' practice, not a source of law | search / get_interpretation / search_by_signature / list_categories |
| [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql) | EU law (EUR-Lex + CJEU, live SPARQL) | search_by_celex / search_by_date_range / search_cjeu |
| [`mcp-eu-compliance`](https://github.com/matematicsolutions/mcp-eu-compliance) | offline EU compliance (GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) | eu_search / eu_article / eu_compare / eu_check_applicability / eu_evidence |

## The whole fleet: 44 open connectors

The seven connectors above ship inside the desktop installer. They are part of a larger fleet: 44 open MCP connectors under [github.com/matematicsolutions](https://github.com/matematicsolutions), one repo per source, each reading an official government API or gazette. Language editions of Patron pair the same AGPL shell with the connectors for that jurisdiction. The full catalog with install commands lives at [MateMatic Boutique](https://matematicsolutions.com/en/boutique/connectors).

**Poland** (MIT / Apache-2.0):

| Connector | Reads |
|---|---|
| [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos) | common and Supreme Court case law via the SAOS API |
| [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) | administrative court rulings (NSA + 16 WSA) via CBOSA |
| [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) | legislation (Dziennik Ustaw + Monitor Polski) via the Sejm ELI API, 96k+ acts since 1918 |
| [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs) | the National Court Register (KRS) via the official Ministry of Justice API |
| [`mcp-eureka`](https://github.com/matematicsolutions/mcp-eureka) | tax interpretations (KIS / Ministry of Finance) via EUREKA, 550k+ documents |
| [`kio-orzeczenia-mcp`](https://github.com/matematicsolutions/kio-orzeczenia-mcp) | public-procurement case law (National Appeals Chamber, KIO) |

**European Union** (TypeScript, MIT):

| Connector | Reads |
|---|---|
| [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql) | EU legislation and 57k+ CJEU rulings via the EUR-Lex SPARQL endpoint |
| [`mcp-eu-compliance`](https://github.com/matematicsolutions/mcp-eu-compliance) | an offline corpus of EU compliance law (GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) |

**France, offline** (JavaScript, MIT):

| Connector | Reads |
|---|---|
| [`mcp-fr-legal`](https://github.com/matematicsolutions/mcp-fr-legal) | an offline full-text corpus of French codes and case law |

**National legislation, 33 jurisdictions** (Python, Apache-2.0) - the `xx-eli-mcp` family, each reading the official national source with ELI-style citable references:

[Austria](https://github.com/matematicsolutions/at-eli-mcp) · [Australia](https://github.com/matematicsolutions/au-eli-mcp) · [Belgium](https://github.com/matematicsolutions/be-eli-mcp) · [Brazil](https://github.com/matematicsolutions/br-eli-mcp) · [Canada](https://github.com/matematicsolutions/ca-eli-mcp) · [Chile](https://github.com/matematicsolutions/cl-eli-mcp) · [Colombia](https://github.com/matematicsolutions/co-eli-mcp) · [Croatia](https://github.com/matematicsolutions/hr-eli-mcp) · [Czechia](https://github.com/matematicsolutions/cz-eli-mcp) · [Denmark](https://github.com/matematicsolutions/dk-eli-mcp) · [Finland](https://github.com/matematicsolutions/fi-eli-mcp) · [France](https://github.com/matematicsolutions/fr-eli-mcp) · [Germany](https://github.com/matematicsolutions/de-eli-mcp) · [Hungary](https://github.com/matematicsolutions/hu-eli-mcp) · [Ireland](https://github.com/matematicsolutions/ie-eli-mcp) · [Israel](https://github.com/matematicsolutions/il-eli-mcp) · [Italy](https://github.com/matematicsolutions/it-eli-mcp) · [Japan](https://github.com/matematicsolutions/jp-eli-mcp) · [Lithuania](https://github.com/matematicsolutions/lt-eli-mcp) · [Luxembourg](https://github.com/matematicsolutions/lu-eli-mcp) · [Malaysia](https://github.com/matematicsolutions/my-eli-mcp) · [Malta](https://github.com/matematicsolutions/mt-eli-mcp) · [Netherlands](https://github.com/matematicsolutions/nl-eli-mcp) · [Pakistan](https://github.com/matematicsolutions/pk-eli-mcp) · [Romania](https://github.com/matematicsolutions/ro-eli-mcp) · [Singapore](https://github.com/matematicsolutions/sg-eli-mcp) · [Slovakia](https://github.com/matematicsolutions/sk-eli-mcp) · [Spain](https://github.com/matematicsolutions/es-eli-mcp) · [Sweden](https://github.com/matematicsolutions/se-eli-mcp) · [Switzerland](https://github.com/matematicsolutions/ch-eli-mcp) · [Turkey](https://github.com/matematicsolutions/tr-eli-mcp) · [United Kingdom](https://github.com/matematicsolutions/gb-eli-mcp) · [United States](https://github.com/matematicsolutions/us-eli-mcp)

**Cross-jurisdiction** (Python, Apache-2.0):

| Connector | Reads |
|---|---|
| [`legalize-mcp`](https://github.com/matematicsolutions/legalize-mcp) | the legalize-dev law-as-git corpus: 32 jurisdictions, Git-versioned, ELI citable |
| [`boutique-mcp`](https://github.com/matematicsolutions/boutique-mcp) | the Boutique catalog itself, so the agent can find and install the right connector |

## Production deployment

Full runbook: **[deploy/README.md](./deploy/README.md)**.
The short version:

```bash
# 1. Clone the 8 repos (patron + 7 mcp-*)
git clone matematicsolutions/patron && cd patron
for d in mcp-saos mcp-nsa mcp-isap mcp-krs mcp-eureka mcp-eu-sparql mcp-eu-compliance; do
  (cd .. && git clone matematicsolutions/$d && cd $d && npm install && npm run build)
done

# 2. Bundle MCP into the backend image
node scripts/bundle-mcp.cjs

# 3. Configure secrets
cp .env.docker.example .env.docker
nano .env.docker

# 4. Up
docker compose --env-file .env.docker up -d
```

This requires a separately provisioned Supabase + MinIO (a separate stack). See the runbook.

## Governance (before deployment)

- [**Patron AI Constitution v1.7.2**](./governance/CONSTITUTION.md) -
  9 principles, product boundaries, roles (Administrator / Operator / Inspector),
  audit, and evolution. Mapped to AI Act art. 12, RODO art. 5/25/30/32,
  and professional ethics. Art. 5 covers input-document control.
- [**Implementation Playbook**](./governance/IMPLEMENTATION_PLAYBOOK.md) -
  a 6-8 week step-by-step rollout with a RACI matrix.
- [**ADRs**](./governance/adr/) - Architecture Decision Records (0001-0145),
  including [0001 hash-chain](./governance/adr/0001-hash-chain-audit-trail.md),
  [0002 dual-license](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md),
  [0019 input-document scan](./governance/adr/0019-input-document-security-pipeline-pl.md),
  [0020 wiring into ingest](./governance/adr/0020-wpiecie-input-security-w-ingest.md).

The firm reads and signs the **Constitution v1.7.2** before deployment
(the signature section is at the end of the file).

## Open standard - MCS v0.1

Patron is the **reference implementation** of the open citation standard
[**MateMatic Connector Standard (MCS) v0.1**](./MCS-v0.1.md): the
`structuredContent.citations` contract (source_id / url / exact_quote / locator / confidence)
plus a 3-color credibility gradient (`verbatim` / `paraphrase` / `unverified` =
existence / content / fragment) plus a conformance test (citation roundtrip). Any legal-source
connector that satisfies MCS plugs into the citation-verification layer with no changes.

## License

The stack is **dual-licensed** (see [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md)):

- `patron` (this repo, the shell) - **AGPL-3.0-only** ([LICENSE](./LICENSE) + [NOTICE](./NOTICE))
- `mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`, `mcp-eu-sparql`, `mcp-eu-compliance` - **MIT**

A self-hosting firm can use, modify, and distribute Patron inside its
organization with no extra obligations. A competitor that offers Patron
as SaaS to third parties must open its modifications.

Patron is a fork of [Mike](https://github.com/willchen96/mike) (AGPL-3.0,
(c) 2025 Will Chen). Full attribution: [NOTICE](./NOTICE).

---

## Local development

The rest of this README covers the local (development) setup.
For a production deployment, use `deploy/README.md` (Docker).

### Contents (legacy)

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` - Supabase schema for fresh databases
- `backend/migrations/` - incremental database updates for existing deployments

## Prerequisites

- Node.js 20 or newer
- npm
- git
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

## Database Setup

For a new Supabase database, open the Supabase SQL editor and run:

```sql
-- copy and run the contents of:
-- backend/schema.sql
```

The schema file is based on `supabase-migration.sql` and folds in the later files in `backend/migrations/`.

For an existing database, do not run the full schema file over production data. Apply the incremental files in `backend/migrations/` instead.

## Environment

Create local env files:

```bash
touch backend/.env
touch frontend/.env.local
```

Create `backend/.env`:

```bash
PORT=3001
FRONTEND_URL=http://localhost:3000
DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-key

R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=patron

GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
RESEND_API_KEY=your-resend-key
USER_API_KEYS_ENCRYPTION_SECRET=your-long-random-secret
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Supabase values come from the project dashboard. Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for the backend `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

Provider keys are only needed for the models and email features you plan to use. Model provider keys can be configured in `backend/.env` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `backend/.env`, that provider is available by default and the matching browser API key field is read-only.

## Install

Install each app package:

```bash
npm install --prefix backend
npm install --prefix frontend
```

## Run Locally

Start the backend:

```bash
npm run dev --prefix backend
```

Start the main app:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## First Run

1. Sign up in the app.
2. If you did not set provider keys in `backend/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.
3. Create or open a project and start chatting with documents.

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

## Useful Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```
