# Patron

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-69%2F69_passing-brightgreen)](./backend)
[![AI Act](https://img.shields.io/badge/AI_Act-Art._12_record--keeping-orange)](./governance/CONSTITUTION.md)
[![RODO](https://img.shields.io/badge/RODO-art._5%2F25%2F30%2F32-orange)](./governance/CONSTITUTION.md)
[![Stack](https://img.shields.io/badge/stack-zero--cloud-success)](./governance/CONSTITUTION.md)
[![MCP](https://img.shields.io/badge/MCP-5_connectors_PL-blue)](https://github.com/matematicsolutions)
[![Node](https://img.shields.io/badge/Node-20%2B-brightgreen)](https://nodejs.org)

> **Lokalny agent AI dla polskiej kancelarii prawnej.** Self-host
> zero-cloud (Postgres + MinIO), 5 konektorów polskiego prawa
> (SAOS / NSA / ISAP / KRS / EUR-Lex), audit trail z hash-chain (AI Act art. 12),
> bring-your-own-model (Gemini / Claude / Ollama lokalny).

Patron jest forkiem [Mike](https://github.com/willchen96/mike) (dokumentowy
asystent prawny, MIT). Dodaje polonizację, polski legal stack i wymogi
compliance, których potrzebuje kancelaria. Pełne zasady opisuje
[governance/CONSTITUTION.md](./governance/CONSTITUTION.md).

## Zawartość

- `frontend/` - aplikacja Next.js
- `backend/` - Express API, klient MCP, audit trail, dispatch narzędzi
- `backend/schema.sql` - schemat Postgresa (Supabase-compatible)
- `governance/` - **Konstytucja AI Patrona** + Implementation Playbook + ADR
- `deploy/` - runbook wdrożeniowy (`docker-compose`)
- `scripts/bundle-mcp.cjs` - bundler 5 serwerów MCP do obrazu backendu

## Konektory MCP polskiego prawa (osobne repo)

| Konektor | Domena | Zwraca |
|---|---|---|
| [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos) | orzeczenia powszechne, SN, TK, KIO | search / get_judgment / search_by_case |
| [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) | orzecznictwo NSA + 16 WSA (CBOSA) | search / get_judgment / search_by_case |
| [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) | legislacja PL (Dz.U. + M.P., Sejm ELI) | search_acts / get_act / get_act_text |
| [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs) | Krajowy Rejestr Sądowy (MS) | get_entity / get_entity_full / get_board |
| [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql) | prawo UE (EUR-Lex + CJEU) | search_by_celex / search_by_date_range / search_cjeu |

## Wdrożenie produkcyjne

Pełny runbook: **[deploy/README.md](./deploy/README.md)**.
Skrót dla niecierpliwych:

```bash
# 1. Klon 6 repo (patron + 5 mcp-*)
git clone matematicsolutions/patron && cd patron
for d in mcp-saos mcp-nsa mcp-isap mcp-krs mcp-eu-sparql; do
  (cd .. && git clone matematicsolutions/$d && cd $d && npm install && npm run build)
done

# 2. Bundle MCP do obrazu backendu
node scripts/bundle-mcp.cjs

# 3. Config sekretów
cp .env.docker.example .env.docker
nano .env.docker

# 4. Up
docker compose --env-file .env.docker up -d
```

Wymaga osobno postawionego Supabase + MinIO (osobne stack). Patrz runbook.

## Governance (przed wdrożeniem)

- [**Konstytucja AI Patrona v1.1.1**](./governance/CONSTITUTION.md) -
  9 zasad, granice produktu, role (Administrator / Operator / Inspektor),
  audyt, ewolucja. Mapowanie na AI Act art. 12, RODO art. 5/25/30
  i etykę zawodową.
- [**Implementation Playbook**](./governance/IMPLEMENTATION_PLAYBOOK.md) -
  6-8 tygodni wdrożenia krok po kroku, z macierzą RACI.
- [**ADR**](./governance/adr/) - Architecture Decision Records
  ([0001 hash-chain](./governance/adr/0001-hash-chain-audit-trail.md),
  [0002 dual-license](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md)).

Kancelaria przed wdrożeniem czyta i podpisuje **Konstytucję v1.1.1**
(sekcja podpisów na końcu pliku).

## Licencja

Stack jest **dual-license** (zob. [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md)):

- `patron` (ten repo, powłoka) - **AGPL-3.0-only** ([LICENSE](./LICENSE) + [NOTICE](./NOTICE))
- `mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`, `mcp-eu-sparql` - **MIT**

Kancelaria self-host używa, modyfikuje i dystrybuuje Patrona wewnątrz
organizacji bez dodatkowych obowiązków. Konkurent, który oferuje
Patrona jako SaaS osobom trzecim, otwiera swoje modyfikacje.

Patron jest forkiem [Mike](https://github.com/willchen96/mike) (MIT,
©2025 Will Chen). Pełne attribution: [NOTICE](./NOTICE).

---

## Local development

Dalsza część README opisuje uruchomienie lokalne (development).
Do wdrożenia produkcyjnego użyj `deploy/README.md` (Docker).

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
R2_BUCKET_NAME=mike

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
