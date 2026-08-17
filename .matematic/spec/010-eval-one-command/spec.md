# Feature: Eval jedna komenda (bramka flipu flag)

**Branch:** `feat/etap-a2-fabryka` (pozycja A2-4 roadmapy 2.0)
**Date:** 2026-07-04
**Status:** Implemented

## Problem statement

Eval jest warunkiem flipu flag (tracker B2/B3; konwencja ADR-0101/0102), ale dzis
to "wydarzenie": trzy rozproszone narzedzia (evale deterministyczne w vitest,
harness LEDGAR w ~/Projects/legal-eval-harness, sedzia PL na Ollama) odpalane
recznie, bez wspolnego raportu. Ma byc narzedzie: jedna komenda, jeden raport,
artefakt CI.

## User Stories

### US1 (P1, MVP) - `node scripts/run-eval.cjs` = jeden raport

**Jako** WM przed decyzja o flipie flag **chce** jedna komenda dostac raport
ze wszystkich dostepnych evali, **zeby** bramka B2 byla mechaniczna.

**Acceptance Criteria:**
- [x] AC1.1: Etap A (zawsze): deterministyczne evale retrieval (vitest `*.eval.test.ts` - dual-similarity ADR-0087, event-KG ADR-0090) z parsowaniem pass/fail.
- [x] AC1.2: Etap B (capability-detected): harness grounding LEDGAR (legal-eval-harness; python + skill citation-grounding-pl); brak python/harness/skilla = SKIPPED z powodem, nie FAIL.
- [x] AC1.3: Etap C (capability-detected): sedzia PL (eval-judge-pl.ts, Ollama local-only); brak Ollamy = SKIPPED z powodem. `PATRON_EVAL_JUDGE=off` wylacza jawnie.
- [x] AC1.4: Raport `eval-report/eval-report.md` + `eval-report.json` (statusy etapow, metryki, timestamp, commit). Katalog gitignorowany.
- [x] AC1.5: Exit 0 = zadien wykonany etap nie zawiodl; exit 1 = ktorys wykonany etap FAIL albo Etap A nie mogl ruszyc.

### US2 (P2) - Artefakt CI

**Acceptance Criteria:**
- [x] AC2.1: workflow `.github/workflows/eval.yml` (workflow_dispatch) - checkout, npm ci backend, run-eval, upload-artifact eval-report.
- [x] AC2.2: W CI etapy B/C auto-SKIPPED (brak skilla/Ollamy na runnerze) - raport z Etapu A + jawne powody pominiec. Pelny raport (A+B+C) powstaje lokalnie u WM ta sama komenda.

## Non-Goals

- Progi automatycznej decyzji (flip flag = decyzja WM po lekturze raportu, bramka ludzka B3).
- Hostowanie korpusow w repo (seeds CC BY-SA pobierane lokalnie, nie commitowane - uwaga licencyjna z README harnessa).
- Eval w kazdym push (eval to bramka wydania, nie lint - workflow_dispatch wystarczy).

## Open Questions

- brak.
