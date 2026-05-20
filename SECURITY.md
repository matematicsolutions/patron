# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Use
[GitHub's private vulnerability reporting](https://github.com/matematicsolutions/patron/security/advisories/new).

We aim to acknowledge within **72 hours** and coordinate a disclosure timeline.

For email contact (if GitHub reporting is unavailable):
**security@matematic.co**

## What we treat as critical

- **Audit chain integrity bypass.** If you find a way to mutate
  `audit_log` without `npm run audit:verify` detecting it,
  this is a P0. Hash-chain integrity is a Constitution-level
  guarantee (Konstytucja AI Art. 3).
- **Tajemnica zawodowa leak.** Any path that surfaces document content,
  chat messages, or user metadata to an unauthorized party (cross-user,
  cross-tenant, public unauthenticated). Patron is built for law firms -
  this is the heaviest single concern.
- **Authentication / Authorization bypass.** Any flow that lets a user
  reach data of another user without an explicit grant.
- **SSRF / RCE / Path traversal** in document conversion (libreoffice),
  PDF extraction (pdfjs), or MCP connector handlers.

## In-scope

- Patron shell (`patron` repo): backend, frontend, governance docs.
- All 5 MCP connectors (`mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`,
  `mcp-eu-sparql`).
- Deployment artifacts (`Dockerfile`, `docker-compose.yml`, `bundle-mcp.cjs`).

## Out-of-scope

- Supabase, MinIO, LibreOffice - report upstream.
- Vulnerabilities in user-supplied LLM providers (Anthropic / Google /
  OpenAI) - report to provider.
- DoS via expensive queries - Patron has rate limiting; we treat
  rate-limit bypass as in-scope but pure traffic flooding is not a
  Patron bug.
- Vulnerabilities in dependencies that are not exploitable in the
  Patron codepath. Reporting tools like Snyk / Dependabot occasionally
  flag transitive deps that we don't actually call.

## PII Pseudonymization Layer (Faza 4.5, status: skeleton)

Patron is growing a **pre-LLM PII pseudonymization layer** that
substitutes Polish identifiers (PESEL, NIP, REGON, KRS) plus names
and organization names with deterministic tokens (`[PERSON_1]`,
`[PESEL_1]`, `[ORG_2]`) **before** the prompt leaves the law firm's
perimeter, then reverses the substitution on the LLM response. The
mapping table never leaves the firm's Postgres.

**Current status (2026-05-20)**: skeleton in `backend/src/lib/pseudonim/`
(7 files, 24 Vitest cases green). NOT wired into
`streamChatWithTools` yet - that's an architectural decision pending
the Owner's sign-off (Postgres vs Redis backing store, SSE streaming
compatibility, latency budget +200-400ms per request).

**Rationale**: Constitution Art. 1 (data locality), Art. 5 (legal
professional privilege), and Art. 7 (data minimization, GDPR art. 5.1.c)
move from *configuration-based* (switch to Ollama if you care about
leaks) to *technical-mechanism-based* (pseudonymization default-on,
regardless of which cloud LLM the firm picks).

**Reference**:
[ADR-0003](governance/adr/0003-pseudonimizacja-pii-pre-llm.md) -
includes the 6-week migration plan from skeleton to default-on for
pilot firms, the rejected alternatives (Hey Jude as docker service /
from-scratch implementation), and the risk register (false-positive
detection = PII leak, mapping table = same retention class as
audit_log).

**Cherry-picked from**: [sure-scale/hey-jude](https://github.com/sure-scale/hey-jude)
(AGPL-3.0). Skeleton inherits AGPL-3.0 from `patron`. Future fork
`matematicsolutions/pseudonim-pl` will keep AGPL-3.0 (Hey Jude's
network copyleft is preserved, not relicensed to MIT).

## Known acceptable risks

| Risk | Mitigation | Accepted because |
|---|---|---|
| CBOSA cert chain not in default trust store | `mcp-nsa` uses `rejectUnauthorized: false` for `orzeczenia.nsa.gov.pl` only | Public judgments data, no PII transit, MITM risk negligible vs reach |
| CSP disabled in helmet | Headers `Permissions-Policy`, `Referrer-Policy`, HSTS still active | CSP tuning for Supabase + MinIO + chat streaming requires per-deployment work; targeted Phase 4.4 follow-up |
| `@anthropic-ai/sdk` < 0.91.1 local FS perms (GHSA-p7fg-763f-g4gf) | Patron does not use Anthropic SDK Memory Tool | Major bump 0.90 → 0.97 scheduled for Phase 4.4 follow-up |

## Supported versions

| Version | Supported |
|---|---|
| 1.x (Konstytucja AI v1.0 / v1.1) | ✅ |
| pre-fork (Mike upstream) | ❌ - report to https://github.com/willchen96/mike |

## How we run security

- **Static**: `npm audit` w CI (planowane Phase 4.4 follow-up).
- **Tests**: 18 testów audit chain w `lib/audit.test.ts` (4 attack scenarios).
- **Reviews**: Każdy PR przeglądany przez przynajmniej jedną osobę,
  PR-y zmieniające `lib/audit.ts`, `lib/mcp/*`, `routes/*` wymagają
  podwójnej akceptacji.
- **Constitution**: Łamanie zasady z `governance/CONSTITUTION.md`
  wymaga ADR i bump wersji konstytucji (MAJOR/MINOR).

## Hardening checklist dla operatorów kancelarii

Patrz `deploy/README.md` § Troubleshooting + `deploy/BACKUP.md`.
Skrót:

- [ ] Rotacja `DOWNLOAD_SIGNING_SECRET` i `USER_API_KEYS_ENCRYPTION_SECRET`
      co najmniej raz w roku.
- [ ] Sekrety w `.env.docker` z ACL `600`, tylko właściciel kontenera czyta.
- [ ] Reverse proxy (Caddy / nginx) terminuje TLS, backend nasłuchuje
      lokalnie (loopback / docker network).
- [ ] `npm run audit:verify` jako cotygodniowy cron (Phase 4.4 follow-up:
      wbudować w `backup.sh`).
- [ ] Backup szyfrowany `age` zgodnie z `deploy/BACKUP.md`, test
      odtworzenia raz na kwartał.
- [ ] Monitoring (Uptime Kuma) na `/health` + healthcheck Postgresa /
      MinIO.
- [ ] Aktualizacje `docker compose pull && docker compose up -d --build`
      co miesiąc albo natychmiast przy security advisory.

## Coordinated disclosure

Po raportowaniu:

1. Potwierdzenie 72h.
2. Wstępna ocena (impact, exploit complexity) w 5 dni.
3. Patch + advisory w 30 dni (P0) / 90 dni (inne).
4. Publikacja po patch + 7 dni heads-up dla głównych instalacji
   (kancelarie pilotażowe).

## Credits

W przyszłości - Hall of Fame dla zgłaszających, gdy będziemy mieli
pierwsze raporty.
