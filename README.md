# Patron

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-1267_passing-brightgreen)](./backend)
[![AI Act](https://img.shields.io/badge/AI_Act-Art._12_record--keeping-orange)](./governance/CONSTITUTION.md)
[![RODO](https://img.shields.io/badge/RODO-art._5%2F25%2F30%2F32-orange)](./governance/CONSTITUTION.md)
[![Stack](https://img.shields.io/badge/stack-zero--cloud-success)](./governance/CONSTITUTION.md)
[![MCP](https://img.shields.io/badge/MCP-6_connectors-blue)](https://github.com/matematicsolutions)
[![Node](https://img.shields.io/badge/Node-20%2B-brightgreen)](https://nodejs.org)

🇬🇧 **English** · 🇵🇱 **Polski poniżej ↓** · [matematicsolutions.com/en/patron](https://matematicsolutions.com/en/patron)

> **A local AI agent for a law firm.** A zero-cloud desktop app (Electron), single-user by default (local SQLite): 6 connectors to Polish and EU law (SAOS / NSA / ISAP / KRS / EUR-Lex / EU-Compliance), a hash-chain audit trail (AI Act art. 12), bring-your-own-model (Gemini / Claude / local Ollama / OpenRouter).

Patron is a fork of [Mike](https://github.com/willchen96/mike) (AGPL-3.0); the Patron shell inherits AGPL-3.0 as a derivative work. It adds Polish localisation, a Polish legal stack and the compliance a law firm needs. Product overview in English: **[matematicsolutions.com/en/patron](https://matematicsolutions.com/en/patron)**.

*The detailed documentation below is in Polish.*

---

> **Lokalny agent AI dla polskiej kancelarii prawnej.** Aplikacja desktop (Electron)
> zero-cloud, single-user: domyślnie lokalny SQLite ([ADR-0053](./governance/adr/0053-sqlite-single-user-zero-cloud.md)), 6 konektorów polskiego i unijnego prawa
> (SAOS / NSA / ISAP / KRS / EUR-Lex / EU-Compliance), audit trail z hash-chain (AI Act art. 12),
> bring-your-own-model (Gemini / Claude / Ollama lokalny / OpenRouter). Tryb serwerowy (Postgres + MinIO) pozostaje jako alternatywa.

Patron jest forkiem [Mike](https://github.com/willchen96/mike) (dokumentowy
asystent prawny, **AGPL-3.0**) - powłoka Patrona dziedziczy AGPL-3.0 jako dzieło
zależne. Dodaje polonizację, polski legal stack i wymogi compliance, których
potrzebuje kancelaria. Pełne zasady opisuje
[governance/CONSTITUTION.md](./governance/CONSTITUTION.md).

## Zawartość

- `frontend/` - aplikacja Next.js
- `backend/` - Express API, klient MCP, audit trail, dispatch narzędzi
- `backend/src/lib/input-security/` - lokalny, deterministyczny skan dokumentów wejściowych (prompt-injection / ukryte akcje PDF / zaciemnienie) przed wejściem do modelu lub RAG (ADR-0019/0020)
- `backend/src/lib/mcp-security/` - lokalny, deterministyczny skan definicji konektorów MCP (typosquat / drift opisu / hidden-instructions / tool-poisoning) PRZED ich załadowaniem do kontraktu MCP (ADR-0025/0028)
- `backend/schema.sql` - schemat Postgresa (tryb serwerowy, Supabase-compatible); tryb desktop używa lokalnego SQLite (ADR-0053)
- `governance/` - **Konstytucja AI Patrona** + Implementation Playbook + ADR
- `deploy/` - runbook wdrożeniowy (`docker-compose`)
- `scripts/bundle-mcp.cjs` - bundler 6 serwerów MCP do obrazu backendu

## Konektory MCP polskiego i unijnego prawa (osobne repo)

| Konektor | Domena | Zwraca |
|---|---|---|
| [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos) | orzeczenia powszechne, SN, TK, KIO | search / get_judgment / search_by_case |
| [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) | orzecznictwo NSA + 16 WSA (CBOSA) | search / get_judgment / search_by_case |
| [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap) | legislacja PL (Dz.U. + M.P., Sejm ELI) | search_acts / get_act / get_act_text |
| [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs) | Krajowy Rejestr Sądowy (MS) | get_entity / get_entity_full / get_board |
| [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql) | prawo UE (EUR-Lex + CJEU, live SPARQL) | search_by_celex / search_by_date_range / search_cjeu |
| [`mcp-eu-compliance`](https://github.com/matematicsolutions/mcp-eu-compliance) | compliance UE offline (GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) | eu_search / eu_article / eu_compare / eu_check_applicability / eu_evidence |

## Wdrożenie produkcyjne

Pełny runbook: **[deploy/README.md](./deploy/README.md)**.
Skrót dla niecierpliwych:

```bash
# 1. Klon 7 repo (patron + 6 mcp-*)
git clone matematicsolutions/patron && cd patron
for d in mcp-saos mcp-nsa mcp-isap mcp-krs mcp-eu-sparql mcp-eu-compliance; do
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

- [**Konstytucja AI Patrona v1.6.1**](./governance/CONSTITUTION.md) -
  9 zasad, granice produktu, role (Administrator / Operator / Inspektor),
  audyt, ewolucja. Mapowanie na AI Act art. 12, RODO art. 5/25/30/32
  i etykę zawodową. Art. 5 obejmuje kontrolę wejścia dokumentów.
- [**Implementation Playbook**](./governance/IMPLEMENTATION_PLAYBOOK.md) -
  6-8 tygodni wdrożenia krok po kroku, z macierzą RACI.
- [**ADR**](./governance/adr/) - Architecture Decision Records (0001-0130),
  m.in. [0001 hash-chain](./governance/adr/0001-hash-chain-audit-trail.md),
  [0002 dual-license](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md),
  [0019 skan dokumentów wejściowych](./governance/adr/0019-input-document-security-pipeline-pl.md),
  [0020 wpięcie w ingest](./governance/adr/0020-wpiecie-input-security-w-ingest.md).

Kancelaria przed wdrożeniem czyta i podpisuje **Konstytucję v1.6.1**
(sekcja podpisów na końcu pliku).

## Standard otwarty — MCS v0.1

Patron jest **implementacją referencyjną** otwartego standardu cytowań
[**MateMatic Connector Standard (MCS) v0.1**](./MCS-v0.1.md): kontrakt
`structuredContent.citations` (source_id / url / exact_quote / locator / confidence)
+ 3-kolorowy gradient wiarygodności (`verbatim` / `paraphrase` / `unverified` =
istnienie / treść / fragment) + test zgodności (citation roundtrip). Każdy konektor
do źródła prawa, który spełnia MCS, wpina się w warstwę weryfikacji cytatów bez przeróbek.

## Licencja

Stack jest **dual-license** (zob. [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md)):

- `patron` (ten repo, powłoka) - **AGPL-3.0-only** ([LICENSE](./LICENSE) + [NOTICE](./NOTICE))
- `mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`, `mcp-eu-sparql`, `mcp-eu-compliance` - **MIT**

Kancelaria self-host używa, modyfikuje i dystrybuuje Patrona wewnątrz
organizacji bez dodatkowych obowiązków. Konkurent, który oferuje
Patrona jako SaaS osobom trzecim, otwiera swoje modyfikacje.

Patron jest forkiem [Mike](https://github.com/willchen96/mike) (AGPL-3.0,
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
