# Feature: Wydanie 6 edycji jedna komenda (release-all)

**Branch:** `feat/etap-a3-fabryka` (pozycja A3-3)
**Date:** 2026-07-05
**Status:** Implemented

## Problem statement

Release to nadal "wydarzenie": 6x `npm run build:xx` recznie i sekwencyjnie,
reczne zbieranie 18+ artefaktow (exe/blockmap/yml + CHECKSUMS), reczny draft
releasu. Kazdy krok reczny = okazja do pominiecia edycji albo wgrania zlego yml
(auto-update edycji FR pobierze wtedy zle metadane).

## User Stories

### US1 (P1, MVP) - `npm run release:all`

**Acceptance Criteria:**
- [x] AC1.1: buduje 6 edycji SEKWENCYJNIE (lekcja playbooka: rownolegle buildy electron-buildera sie gryza) przez build-locale.cjs; `--locales pl,it` zaweza.
- [x] AC1.2: po kazdej edycji weryfikuje komplet artefaktow (exe + yml; blockmap opcjonalny z ostrzezeniem) i JEDEN wspolny manifest `dist/RELEASE-MANIFEST.md` (lista plikow + SHA256 + rozmiary).
- [x] AC1.3: e2e smoke (spec 013) po buildzie pierwszej edycji (`--no-smoke` wylacza); FAIL smoke = przerwanie release'u.
- [x] AC1.4: `--draft` tworzy DRAFT releasu GitHub przez `gh release create --draft` na repo `mat` i wgrywa assets. Draft jest niewidoczny publicznie; PUBLIKACJA (zdjecie draftu) pozostaje recznym aktem WM w UI GitHub - bramka governance nienaruszona. Bez `--draft` skrypt tylko buduje i weryfikuje.
- [x] AC1.5: fail-fast: blad builda edycji przerywa calosc z jasnym wskazaniem edycji.

## Non-Goals

- Automatyczna publikacja releasu (zdjecie draftu = czlowiek, zawsze).
- Rownolegle buildy (swiadomie sekwencyjnie).
- Bump wersji (świadoma decyzja wydawcy przed komenda; skrypt wypisuje wersje na starcie).

## Uzycie (runbook wydania - aktualizacja spec 008)

```
cd desktop
npm version 2.0.0 --no-git-tag-version   # decyzja wydawcy
npm run release:all                      # build 6 edycji + manifest + smoke
npm run release:all -- --draft           # jw. + draft releasu z assets (gh auth wymagane)
# potem: WM przeglada draft na GitHub -> Publish release (akt ludzki)
```
