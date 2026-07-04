# Feature: E2E smoke spakowanego desktopu jedna komenda

**Branch:** `feat/etap-a3-fabryka` (pozycja A3-2)
**Date:** 2026-07-05
**Status:** Implemented

## Problem statement

`smoke:desktop` (backend) bootuje backend ze ZRODEL - nie testuje spakowanej
aplikacji (Electron main.js + zbundlowany backend/frontend z dist-resources +
Node wbudowany w Electron). 6 edycji x wydanie = 6 recznych testow "czy wstaje".
Pierwszy klient edycji ES nie moze byc wykrywaczem bledu bootowania, ktorego
edycja PL nigdy nie miala.

## User Stories

### US1 (P1, MVP) - `npm run e2e:smoke` na outputach build:dir

**Jako** wydawca (WM/agent) **chce** jedna komenda zbootowac SPAKOWANA
aplikacje (win-unpacked) na czystym, tymczasowym profilu i mechanicznie
sprawdzic, ze caly stack wstal, **zeby** kazda edycje dalo sie przetestowac
w minuty, nie recznie.

**Acceptance Criteria:**
- [x] AC1.1: skrypt `desktop/scripts/e2e-smoke.cjs` odpala `dist/win-unpacked/PATRON.exe` z APPDATA/LOCALAPPDATA przekierowanym do katalogu tymczasowego (zero dotykania realnego profilu i danych).
- [x] AC1.2: czeka na backend (`/health` -> `{ok:true}`) i frontend (GET / -> 200 + HTML) z twardym timeoutem; po tescie ubija cale drzewo procesow.
- [x] AC1.3: pre-check portow 3000/3001 (dzialajacy PATRON = jasny komunikat, nie falszywy wynik); brak win-unpacked = exit 2 z instrukcja `npm run build:dir`.
- [x] AC1.4: exit 0/1 + czytelne podsumowanie checkow.

## Non-Goals

- Test instalatora NSIS (cicha instalacja /S) - nastepny szczebel, wymaga VM.
- Interakcja z UI (klikanie) - to smoke bootowania stacku, nie e2e funkcjonalne.
- CI (runner ubuntu; artefakt jest Windows-only) - komenda lokalna, wpieta w checkliste wydania.

## Wpiecie w proces wydania

Checklista wydania (tracker): przed uploadem assets kazdej edycji
`npm run build:dir` (albo pelny build) + `npm run e2e:smoke`. Spec 014
(release-all) wywoluje smoke automatycznie po zbudowaniu kazdej edycji
(flaga --no-smoke wylacza).
