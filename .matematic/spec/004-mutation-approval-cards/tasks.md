# Tasks: Karty zatwierdzenia mutacji

Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (rozne pliki, bez zaleznosci).

## Phase 1 - Setup
- [x] T001 Branch `feat/mutation-approval-cards` off `release/v1.0.0-prep`
- [x] T002 ADR-0137 + spec/plan/tasks

## Phase 2 - Foundational (BLOKUJE US1) - wg precedensu connector.toggle (ADR-0133)
- [x] T010 `backend/src/lib/audit.ts`: dodaj `"mutation.approval.decision"` do `EVENT_TYPES`
- [x] T011 `backend/src/lib/db/schema.sqlite.ts`: tabela `mutation_approvals` + event w CHECK audit_log
- [x] T012 `backend/schema.sql`: tabela `mutation_approvals` + event w CHECK
- [x] T013 `backend/src/lib/db/migrate.sqlite.ts`: krok rebuild v4 (bump user_version) - nowy CHECK audit_log + utworzenie `mutation_approvals` dla istniejacych baz
- [x] T014 [P] `backend/migrations/015_add_mutation_approvals.sql` (Postgres UP/DOWN)
- [x] T015 [P] `backend/migrations/016_audit_log_event_type_mutation_approval.sql` (Postgres CHECK)
- [x] T016 Test migracji (6 nowych w `migrate.sqlite.test.ts`): swieza baza CHECK ok; rebuild starej; insert eventu przechodzi CHECK; wiersz przezywa rebuild (hash-chain spojny); tabela+enum status; samo-pomijalny. Suite full 1295 pass/0 fail; backend tsc=0

**Checkpoint:** schema dual zgodna, event_type w hash-chainie, testy migracji zielone. (To samodzielnie weryfikowalny fundament - bezpieczny do merge nawet bez US1 logiki.)

## Phase 3 - US1 (P1, MVP) logika + API + bramka
- [x] T020 [US1] `backend/src/lib/mutation-approval.ts`: typy + `stageMutationApproval/approve/reject/getPending/getApprovalById` + `canTransition` (fail-closed) + `isMutationApprovalEnabled` (env opt-in) + executor wstrzykiwany
- [x] T021 [P] [US1] `backend/src/lib/mutation-approval.test.ts`: przejscia stanu, scoping user_id, fail-closed (404/409/403), audyt (10 testow)
- [x] T022 [US1] `backend/src/routes/approvals.ts`: GET list, GET :id, POST :id/approve (executeStagedTool + audit), POST :id/reject (+audit) - `requireAuth`
- [x] T023 [US1] rejestracja routera approvals (`/mutation-approvals` w index.ts)
- [x] T024 [US1] `backend/src/lib/chat/tool-dispatch.ts`: bramka `maybeStageMutation` przed `runEditDocument`/`generateDocx`; staged -> pending + odpowiedz z id, brak wykonania (fail-closed na bledzie stage). Executor: `chat/mutation-approval-executor.ts`. Shim: `tool_payload` w JSON_COLUMNS.
- [x] T025 [US1] test regresji czatu `chat/tool-dispatch-mutation-gate.test.ts` (sciezka narzedzi nie zepsuta; akcja staged nie wykonuje sie; OFF=proceed)

**Checkpoint:** edit/generate agenta -> karta pending; approve -> wykonanie + event; reject -> brak zapisu + event. US1 deployowalne jako MVP. WERYFIKACJA: tsc=0, full suite 1308 pass/0 fail. **Default OFF (env `PATRON_MUTATION_APPROVAL=true`)** do czasu UI inbox (Phase 4) - potem flip na ON.

## Phase 4 - US2 (P2) UI inbox
- [x] T030 [P] [US2] `frontend/src/app/lib/patronApi.ts`: `ApprovalCard` + `listApprovalCards/approveCard/rejectCard`
- [x] T031 [P] [US2] `frontend/src/i18n/pl.ts` + `en.ts`: namespace `approvals.*` (parytet PL+EN) + `account.approvals` label
- [x] T032 [US2] `frontend/src/app/(pages)/account/approval-cards/page.tsx`: lista pending + podglad payloadu (details/pre) + approve/reject + pole powodu (wzorzec connectors page)
- [x] T033 [US2] zakladka `account.approvals` w nawigacji konta. WERYFIKACJA: frontend tsc=0, eslint 0 errors, `next build` OK (route /account/approval-cards w manifescie)

## Phase 5 - US3 (P3) pelne pokrycie + polityka
- [x] T040 [US3] objac `add_comments` (bramka + executor + test). UCZCIWY ZAKRES: `resolve_tracked_change` i `export_document` to AKCJE CZLOWIEKA (trasy), nie narzedzia agenta - resolve juz audytowane (`document.edit_resolved`, ADR-0070), export = pobranie (nie mutacja tresci); `replicate_document` celowo niegated (duplikacja, nizsza stawka, rezerwacja). Pokryte narzedzia agenta mutujace tresc: edit_document + generate_docx + add_comments = komplet.
- [x] T041 [US3] polityka `shouldStageMutation` + `mutationStagingMode` (off|all|high-stakes). high-stakes wpiety w `classifyHighStakes` (ADR-0092) FAIL-CLOSED: stage gdy `isInputSufficient=false` (PATRON nie ma jeszcze metadanych deliverable na tym poziomie -> high-stakes = jak `all`, selektywnosc po dodaniu metadanych). 5 testow (mode + decision fail-closed). backend 1313 pass/0 fail, tsc 0.

## Phase N - Polish
- [ ] T050 [P] marko/reviewer dla copy UI (PL+EN)
- [~] T051 [P] bramka `matematic-patron-pr-review-pl` na pelnym diffie Phase 2+3 - PRZESZLA: 0 blockerow; 3 should-fix NAPRAWIONE (parytet edits staged/inline; RODO art.17 rodo-delete + art.20 rodo-export o `mutation_approvals`); mikro-race approve = udokumentowany (desktop single-user OK). Re-run na Phase 4.
- [x] T052 CHANGELOG (Unreleased/Added) + AGENTS.md (bullet human-in-the-loop write staging + odswiezony licznik testow 1308/1313) + ADR-0137 status (review round 1 PRZESZEDL). PENDING WM (nie falszuje): review round 2 + akceptacja ADR -> Przyjety + bump SEMVER Konstytucji.

## Parallel Opportunities
T014+T015 razem; T021 obok T020; T030+T031 obok siebie; T050+T051 na koncu.
