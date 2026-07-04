# Feature: Siatka testow frontendu (vitest + testing-library)

**Branch:** `feat/etap-a3-fabryka` (pozycja A3-1; z listy "co do 10/10 fabryki", zielone WM 2026-07-05)
**Date:** 2026-07-05
**Status:** Implemented

## Problem statement

Backend ma 1365 testow, frontend ZERO - kompilator nie wykryje, ze przycisk
"Zatwierdz" wysyla zla akcje. Ficzery governance (human-review komorek,
karty mutacji) sa weryfikowane tylko przez tsc + next build. Najwieksza
pojedyncza dziura fabryki.

## User Stories

### US1 (P1, MVP) - Runner + pierwsze testy komponentow governance

**Acceptance Criteria:**
- [x] AC1.1: vitest + jsdom + @testing-library/react skonfigurowane w frontend/ (`npm test`), alias `@` jak w tsconfig.
- [x] AC1.2: testy TabularCell: badge review per akcja, effective content (corrected -> tresc poprawiona, rejected -> wygaszona), brak badge bez review.
- [x] AC1.3: testy TRSidePanel (DocView/DocxView mockowane): kontrolka review wola onReview z poprawna akcja; "Popraw" wymaga niepustej tresci; stan review widoczny.

### US2 (P1) - Test parytetu i18n (mechaniczny straznik 6 locale)

**Acceptance Criteria:**
- [x] AC2.1: kazdy klucz w slownikach rynkowych istnieje w pl.ts (zrodlo kluczy - lapie literowki/sieroty).
- [x] AC2.2: klucze `tabular.review*` obecne we WSZYSTKICH 6 locale (obietnica spec 007).

### US3 (P2) - CI

**Acceptance Criteria:**
- [x] AC3.1: krok `npm test` w jobie frontend w ci.yml (razem ze spec 015).

## Non-Goals

- Pokrycie calego frontendu (zaczynamy od komponentow governance - tam ryzyko).
- E2E w przegladarce (Playwright) - osobna decyzja po 2.0; spec 013 pokrywa smoke desktopu.
- Snapshot testy (kruche, szum w review).
