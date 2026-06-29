# Feature: Karty zatwierdzenia mutacji (mutation approval cards)

**Branch:** `feat/mutation-approval-cards` (off `release/v1.0.0-prep`)
**Date:** 2026-06-29
**Status:** Draft
**Project Type:** `agent-product` / `desktop-app`
**ADR:** [0137](../../../governance/adr/0137-mutation-approval-cards-human-in-the-loop.md)

## Problem statement

Narzedzia agenta o skutkach ubocznych (edycja dokumentu, generowanie .docx, dodanie komentarzy, rozwiazanie tracked change, eksport) wykonuja sie w PATRONie **natychmiast**, bez jawnego zatwierdzenia czlowieka i bez odrebnego sladu audytowego aktu zatwierdzenia. To luka wzgledem AI Act art. 14 (nadzor czlowieka) i wzgledem doktryny MateMatic (agent przygotowuje draft, czlowiek wykonuje akt nieodwracalny/na zewnatrz). Cel: kazda taka akcja moze byc **stage'owana jako karta do zatwierdzenia**; wykonuje sie dopiero po decyzji czlowieka.

## Granica (twarda)

| Co | Decyzja |
|---|---|
| Staging akcji OUTBOUND (edit/generate/comments/export/resolve) za bramka czlowieka | ✅ rdzen ficzury |
| Zatwierdzenie/odrzucenie | ✅ tylko czlowiek (`requireAuth`), fail-closed |
| Slad w hash-chainie (art. 12) | ✅ nowy `event_type mutation.approval.decision` |
| Architektura gateway / ring-policy / cell-review | ❌ niezmieniona - approval-cards dziala NAD sciezka narzedzi |
| Inbound (input-security scan) | ❌ poza zakresem - to mechanizm OUTBOUND |
| `operatorApproved` (per-konektor) | ❌ nie reuzywany - to statyczny flag, nie kolejka per-akcja |

## User Stories

### US1 (P1, MVP) - Fundament + zatwierdzanie zapisu dokumentu
**Jako** mecenas **chce**, zeby akcja edycji/generowania dokumentu przez agenta czekala na moje zatwierdzenie **zeby** zaden zapis nie nastapil bez mojej decyzji (AI Act art. 14).

**Acceptance Criteria:**
- [ ] AC1.1: tabela `mutation_approvals` (dual SQLite+Postgres) ze stanami `pending|approved|rejected` + metadanymi (staged_at/by, approved_at/by, rejection_reason, executed_at, execution_error), scoping `user_id`.
- [ ] AC1.2: `event_type "mutation.approval.decision"` w whitelist (audit.ts + schema.sqlite CHECK + schema.sql CHECK + migracja SQLite rebuild + migracja Postgres) - wzorzec connector.toggle.
- [ ] AC1.3: lib `mutation-approval.ts` - czyste funkcje: `stageMutationApproval`, `approveMutationApproval` (wykonuje narzedzie), `rejectMutationApproval`, `getPendingApprovals` (scoping user_id), walidacja przejsc stanu (fail-closed).
- [ ] AC1.4: trasy `GET /mutation-approvals`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject` (`requireAuth`), kazda approve/reject pisze audit event.
- [ ] AC1.5: `tool-dispatch.ts` - przed `runEditDocument`/`generateDocx` wstawiona bramka `stageMutationApproval`; gdy staged -> zapis pending + odpowiedz z id karty, akcja sie NIE wykonuje.

**Independent Test:** swieza baza + rebuild starej -> nowy event_type przechodzi CHECK, wiersz audit przezywa rebuild (hash-chain ok); stage edit -> wiersz pending, brak zapisu dokumentu; approve -> dokument zapisany + event; reject -> brak zapisu + event. (6 testow jak przy connector.toggle.)

### US2 (P2) - Inbox kart w UI
**Jako** mecenas **chce** widziec liste oczekujacych kart i zatwierdzac/odrzucac z panelu.
**AC:** strona `account/approval-cards` (wzorzec connectors page), `patronApi` (`listApprovalCards/approveCard/rejectCard`), i18n `approvals.*` (pl+en), podglad payloadu, przycisk approve/reject + pole powodu.

### US3 (P3) - Pelne pokrycie akcji + polityka
**Jako** kancelaria **chce** objac staging takze `add_comments`, `resolve_tracked_change`, `export_document`, oraz polityke "low-risk natychmiast / high-stakes zawsze staging" (spiec z `classifyHighStakes` ADR-0092).

## Non-Goals
- Wiele poziomow zatwierdzajacych / workflow eskalacji (jeden czlowiek-operator wystarcza w MVP).
- Zmiana modelu inbound input-security.
- Event-bus / subscriber pipeline (model open-mercato) - PATRON nie ma go dla mutacji dokumentow.

## Open Questions / NEEDS CLARIFICATION
- [ ] Q1: czy w trybie desktop (single-user SQLite, LOCAL_USER_ID) staging jest domyslnie ON dla wszystkich akcji, czy tylko high-stakes? (proponowane: konfigurowalne, domyslnie ON dla outbound).
- [ ] Q2: retencja kart `approved/rejected` (czyscic czy trzymac dla audytu - sugestia: trzymac, to dowod art. 12).
