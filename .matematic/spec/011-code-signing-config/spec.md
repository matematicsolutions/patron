# Feature: Konfiguracja code signing instalatora (przygotowanie pod B5)

**Branch:** `feat/etap-a2-fabryka` (pozycja A2-5 roadmapy 2.0)
**Date:** 2026-07-04
**Status:** Implemented (aktywacja czeka na zakup certu - bramka B5, akt WM)

## Problem statement

Instalator niepodpisany = SmartScreen straszy kazdego klienta (tarcie adopcji,
project_patron_unsigned_installer_2_0). Cert kupuje WM (akt zakupowy = czlowiek,
bramka B5); po zakupie aktywacja ma byc trywialna - zero grzebania w buildzie.

## User Stories

### US1 (P1) - Podpis w pipeline build-locale bez zmiany kodu po zakupie certu

**Jako** WM po zakupie certu OV/EV **chce** wlaczyc podpisywanie samymi
zmiennymi srodowiskowymi, **zeby** flip nie wymagal zmian w repo.

**Acceptance Criteria:**
- [x] AC1.1: `PATRON_CODE_SIGNING=on` + (`PATRON_CERT_SHA1` albo `PATRON_CERT_SUBJECT`) wlacza krok signtool w build-locale.cjs (po rename na kanoniczna nazwe, przed checksumami).
- [x] AC1.2: podpis = signtool `/fd SHA256 /td SHA256 /tr <timestamp>` (default digicert, override `PATRON_TIMESTAMP_URL`); `SIGNTOOL_PATH` gdy signtool poza PATH.
- [x] AC1.3: metadane auto-update pozostaja SPOJNE z podpisanym plikiem: sha512+size w latest[-xx].yml przeliczane po podpisie, blockmap regenerowany (app-builder) - podpis nie psuje spec 008.
- [x] AC1.4: brak wymaganych env przy PATRON_CODE_SIGNING=on = twardy blad buildu (fail-loud), nie cichy build niepodpisany.
- [x] AC1.5: domyslnie (bez env) build identyczny jak dotad - zero zmiany zachowania.

### US2 (P1) - Runbook signtool dla WM

**Acceptance Criteria:**
- [x] AC2.1: `governance/runbooks/code-signing.md`: wybor certu (OV vs EV + SmartScreen), instalacja (store vs token USB), komendy weryfikacji, flip env, ograniczenia (uninstaller NSIS niepodpisany w tym wariancie; CI nie podpisuje - token u WM).

## Non-Goals

- Zakup certu (B5, akt ludzki WM).
- Podpisywanie w CI (klucz prywatny/token nie wchodzi do GitHub - podpis lokalny u WM).
- Integracja z natywnym signingiem electron-buildera (EV na tokenie USB wymaga
  interaktywnego PIN - krok post-build signtool jest standardowym obejsciem;
  rewizyta mozliwa po wyborze certu).
