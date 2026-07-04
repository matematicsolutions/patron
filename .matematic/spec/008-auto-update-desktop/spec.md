# Feature: Auto-update aplikacji desktop (electron-updater, 6 edycji)

**Branch:** `feat/etap-a2-fabryka` (pozycja A2-2 roadmapy 2.0)
**Date:** 2026-07-04
**Status:** Implemented

## Problem statement

6 edycji jezykowych x kazde wydanie = 6 recznych reinstalacji u kazdego klienta.
Bez auto-update kazda poprawka bezpieczenstwa wymaga akcji recznej kancelarii -
najwyzszy ROI z rzeczy nieobecnych (opinia CTO 2026-07-04).

## User Stories

### US1 (P1, MVP) - Aktualizacja z GitHub Releases z kanalem per edycja

**Jako** prawnik z zainstalowanym PATRONEM **chce** by aplikacja sama pobrala
nowe wydanie SWOJEJ edycji jezykowej i zaproponowala restart, **zeby** miec
poprawki bez recznej reinstalacji.

**Acceptance Criteria:**
- [x] AC1.1: electron-updater z providerem GitHub (matematicsolutions/patron, repo publiczne - bez tokena).
- [x] AC1.2: kanal per locale: pl=latest, en=latest-en, it=latest-it, de=latest-de, es=latest-es, fr=latest-fr - edycja IT nigdy nie dostanie instalatora PL.
- [x] AC1.3: update pobierany w tle; instalacja TYLKO po decyzji czlowieka (dialog restart teraz / przy zamknieciu) - zadnego niespodziewanego restartu w trakcie pracy nad sprawa.
- [x] AC1.4: kill-switch `PATRON_AUTO_UPDATE=off` (kancelaria o zaostrzonym rygorze moze wylaczyc); w dev (nie-packaged) wylaczone.
- [x] AC1.5: blad update (offline, brak yml) = log, zero wplywu na prace aplikacji.

**Independent Test:** build lokalny z podbita wersja + release draft z yml ->
starsza instalacja wykrywa, pobiera, dialog, quitAndInstall dziala.

### US2 (P1) - Artefakty update per edycja z build-locale.cjs

**Acceptance Criteria:**
- [x] AC2.1: build-locale.cjs po rename exe produkuje `latest[-xx].yml` z URL wskazujacym kanoniczna nazwe artefaktu (PATRON-Setup-Windows[-XX].exe) i kopiuje .blockmap pod kanoniczna nazwe.
- [x] AC2.2: sha512 w yml pozostaje poprawny (kopia bajt-w-bajt, tylko nazwa/URL patchowane).
- [x] AC2.3: build lokalny NIGDY nie publikuje sam (--publish=never na sztywno; upload assets = akt ludzki WM, zgodnie z bramka "push publiczny").

## Non-Goals

- Staged rollout / kanal beta (backlog; wymaga procesu wydawniczego, ktorego nie ma).
- Delta updates gwarantowane (blockmap dolaczamy; gdy go braknie - full download fallback).
- Auto-publish z CI (wydanie publiczne pozostaje recznym aktem WM).

## Runbook wydania (dopisek do checklisty release)

1. Podbij `desktop/package.json` version (jedna wersja dla 6 edycji).
2. `npm run build:pl && build:en && ... build:fr` (sekwencyjnie - lekcja z playbooka).
3. Do releasu GitHub wgraj per edycja: `PATRON-Setup-Windows[-XX].exe`,
   `PATRON-Setup-Windows[-XX].exe.blockmap`, `latest[-xx].yml` + CHECKSUMS.txt.
4. Release oznacz jako Latest (nie pre-release) - GitHubProvider czyta najnowszy release.

## Open Questions

- Instalator niepodpisany (do B5): SmartScreen moze ostrzegac takze przy update -
  code signing (spec 011) usuwa; nie blokuje mechanizmu.
