# Tasks: Karty zatwierdzenia mutacji

Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (rozne pliki, bez zaleznosci).

## Phase 1 - Setup
- [x] T001 Branch `feat/mutation-approval-cards` off `release/v1.0.0-prep`
- [x] T002 ADR-0137 + spec/plan/tasks

## Phase 2 - Foundational (BLOKUJE US1) - wg precedensu connector.toggle (ADR-0133)
- [ ] T010 `backend/src/lib/audit.ts`: dodaj `"mutation.approval.decision"` do `EVENT_TYPES`
- [ ] T011 `backend/src/lib/db/schema.sqlite.ts`: tabela `mutation_approvals` + event w CHECK audit_log
- [ ] T012 `backend/schema.sql`: tabela `mutation_approvals` + event w CHECK
- [ ] T013 `backend/src/lib/db/migrate.sqlite.ts`: krok rebuild (bump user_version) - nowy CHECK audit_log + utworzenie `mutation_approvals` dla istniejacych baz
- [ ] T014 [P] `backend/migrations/015_add_mutation_approvals.sql` (Postgres UP/DOWN)
- [ ] T015 [P] `backend/migrations/016_audit_log_event_type_mutation_approval.sql` (Postgres CHECK)
- [ ] T016 Test migracji (6): swieza baza CHECK ok; rebuild starej; insert eventu przechodzi CHECK; wiersz przezywa rebuild (hash-chain spojny); suite db/audit zielona; backend tsc=0

**Checkpoint:** schema dual zgodna, event_type w hash-chainie, testy migracji zielone. (To samodzielnie weryfikowalny fundament - bezpieczny do merge nawet bez US1 logiki.)

## Phase 3 - US1 (P1, MVP) logika + API + bramka
- [ ] T020 [US1] `backend/src/lib/mutation-approval.ts`: typy + `stageMutationApproval/approve/reject/getPending` + walidacja przejsc (fail-closed)
- [ ] T021 [P] [US1] `backend/src/lib/mutation-approval.test.ts`: przejscia stanu, scoping user_id, fail-closed, audyt
- [ ] T022 [US1] `backend/src/routes/approvals.ts`: GET list, GET :id, POST :id/approve (wykonuje narzedzie + audit), POST :id/reject (+audit) - `requireAuth`
- [ ] T023 [US1] rejestracja routera approvals
- [ ] T024 [US1] `backend/src/lib/chat/tool-dispatch.ts`: bramka `stageMutationApproval` przed `runEditDocument`/`generateDocx`; staged -> pending + odpowiedz z id, brak wykonania
- [ ] T025 [US1] test regresji czatu (sciezka narzedzi nie zepsuta; akcja staged nie wykonuje sie)

**Checkpoint:** edit/generate agenta -> karta pending; approve -> wykonanie + event; reject -> brak zapisu + event. US1 deployowalne jako MVP.

## Phase 4 - US2 (P2) UI inbox
- [ ] T030 [P] [US2] `frontend/src/app/lib/patronApi.ts`: `listApprovalCards/approveCard/rejectCard`
- [ ] T031 [P] [US2] `frontend/src/i18n/pl.ts` + `en.ts`: namespace `approvals.*`
- [ ] T032 [US2] `frontend/src/app/(pages)/account/approval-cards/page.tsx`: lista + podglad payloadu + approve/reject (wzorzec connectors page)
- [ ] T033 [US2] zakladka w nawigacji konta; frontend tsc/next build = 0

## Phase 5 - US3 (P3) pelne pokrycie + polityka
- [ ] T040 [US3] objac `add_comments`, `resolve_tracked_change`, `export_document`
- [ ] T041 [US3] polityka low-risk/high-stakes (spiec z `classifyHighStakes` ADR-0092)

## Phase N - Polish
- [ ] T050 [P] marko/reviewer dla copy UI (PL+EN)
- [ ] T051 [P] bramka `matematic-patron-pr-review-pl` na pelnym diffie
- [ ] T052 CHANGELOG + aktualizacja AGENTS.md jezeli dotyczy

## Parallel Opportunities
T014+T015 razem; T021 obok T020; T030+T031 obok siebie; T050+T051 na koncu.
