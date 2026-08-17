# Tasks: UI human-review komorek tabular

## Phase 1 - Setup
- [x] T001 Branch feat/etap-a2-fabryka od release/v2.0.0-prep

## Phase 2 - Foundational
- [x] T002 [P] types.ts: pola review_action/reviewed_by/reviewed_at/corrected_content w TabularCell
- [x] T003 [P] patronApi.ts: reviewTabularCell()
- [x] T004 [P] i18n: klucze tabular.review* w pl/en/it/de/es/fr (US3)

## Phase 3 - US1 (MVP): panel boczny
- [x] T010 [US1] TRSidePanel: sekcja review (3 akcje + textarea korekty + stan + re-review)
- [x] T011 [US1] TabularReviewView: handleReviewCell (API + aktualizacja cells/expandedCell, rollback przy bledzie)

## Phase 4 - US2: badge w macierzy
- [x] T020 [US2] TabularCell.tsx: ReviewBadge + rendering effective content (corrected/rejected)

## Phase 5 - Polish
- [x] T030 tsc --noEmit frontend + next build zielone
- [x] T031 Commit (bez polskich znakow), CHANGELOG przy merge release

## Parallel Opportunities
T002/T003/T004 niezalezne pliki. T010/T020 po T002.
