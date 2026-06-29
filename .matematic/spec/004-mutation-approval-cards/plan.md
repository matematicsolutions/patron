# Plan: Karty zatwierdzenia mutacji

**Spec:** [spec.md](./spec.md) | **ADR:** 0137 | **Project Type:** agent-product / desktop-app

## Technical Context
- **Language:** TypeScript (backend Node + frontend Next.js App Router)
- **DB:** dual - SQLite (desktop, single-user `LOCAL_USER_ID`) + Postgres/Supabase (serwer). CHECK w SQLite zmienia sie tylko przez rebuild (`migrate.sqlite.ts`, user_version).
- **Audit:** `backend/src/lib/audit.ts` hash-chain, whitelist `EVENT_TYPES`, `appendAuditEvent`.
- **Auth:** `requireAuth` (`res.locals.userId`).
- **Testing:** backend - runner repo (uruchom `npm test` w `backend/`); frontend - brak runnera (tsc/next build + lint).
- **Constraints:** RODO-safe, zero-cloud; payload audytu bez PII; sciezka tool-dispatch krytyczna -> testy regresji.

## Constitution Check (GATE)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | human-in-the-loop = rdzen PATRONa |
| RODO-safe / zero-cloud | PASS | lokalnie, payload bez PII |
| AI Act art. 14 + 12 | PASS | bramka czlowieka + slad w hash-chainie |
| Licencja | PASS | inspiracja open-mercato (MIT), zero portu kodu - wlasna implementacja na prymitywach PATRONa |
| Jakosc | PASS (warunkowo) | wymaga 6 testow migracji (precedens connector.toggle) + regresji czatu przed merge |
| Bezpieczenstwo MCP | PASS | nie dotyka gateway/ring-policy; dziala NAD tool-dispatch |

## Struktura zmian (mapa plikow - z reconu 2026-06-29)

**Faza 2 Foundational (BLOKUJE US1):**
- `backend/src/lib/audit.ts` - dodaj `"mutation.approval.decision"` do `EVENT_TYPES` (~l.55).
- `backend/src/lib/db/schema.sqlite.ts` - tabela `mutation_approvals` + dodaj event do CHECK audit_log (~l.260).
- `backend/schema.sql` - tabela `mutation_approvals` + dodaj event do CHECK.
- `backend/src/lib/db/migrate.sqlite.ts` - krok rebuild (bump user_version): nowy CHECK audit_log + utworzenie `mutation_approvals` dla istniejacych baz.
- `backend/migrations/015_add_mutation_approvals.sql` (Postgres, UP/DOWN).
- `backend/migrations/016_audit_log_event_type_mutation_approval.sql` (Postgres CHECK).

**Faza 3 US1 logika+API:**
- `backend/src/lib/mutation-approval.ts` (NOWY) - czyste funkcje + walidacja przejsc.
- `backend/src/routes/approvals.ts` (NOWY) - 4 trasy `requireAuth`.
- rejestracja routera (tam gdzie pozostale, np. `backend/src/app.ts`/`server.ts`).
- `backend/src/lib/chat/tool-dispatch.ts` - bramka `stageMutationApproval` przed edit/generate.
- testy: `mutation-approval.test.ts` + test migracji audit (6 jak connector.toggle).

**Faza 4 US2 (UI):** `frontend/src/app/(pages)/account/approval-cards/page.tsx`, `frontend/src/app/lib/patronApi.ts` (+3 funkcje), `frontend/src/i18n/{pl,en}.ts` (`approvals.*`).

## Procedura dodania event_type (wg connector.toggle / ADR-0133)
1. `audit.ts` EVENT_TYPES += wpis. 2. `schema.sqlite.ts` CHECK. 3. `schema.sql` CHECK. 4. `migrate.sqlite.ts` rebuild step (bump). 5. Postgres migracja. 6. 6 testow: swieza baza CHECK ok; rebuild starej; insert nowego eventu przechodzi; wiersz przezywa rebuild (hash-chain spojny); 262+ testow db/audit zielone; backend tsc=0.

## Research notes
Inspiracja: open-mercato `prepareMutation`+`confirm-required`+pending+approval-card (.ai/runs deal-analyzer-stage-approval-tool, TC-UMES-ML10). Adaptacja: PATRON nie ma event-bus subscriberow -> kolejka tabelaryczna + bramka w tool-dispatch zamiast inline-subscriber. Reuzycie semantyki cell-review (ADR-0126).
