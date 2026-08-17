# Feature: Runbook backup/odzyskania kluczy szyfrowania (KEK) + skrypt weryfikacji

**Branch:** `feat/etap-a2-fabryka` (pozycja A2-3 roadmapy 2.0)
**Date:** 2026-07-04
**Status:** Implemented

## Problem statement

Szyfrowanie bez procedury odzyskania = ryzyko nieodwracalnej utraty akt -
odwrotnosc obietnicy produktu. ADR-0138 (field-level) i ADR-0072 (at-rest)
sa fail-loud z zalozenia: utrata KEK = utrata danych. Pytanie Q6 spec 005
("backup KEK") podniesione do WARUNKU WYDANIA 2.0: zanim jakakolwiek
kancelaria wlaczy flagi szyfrowania, musi istniec procedura Operatora
"co gdy zgubimy klucz" + narzedzie, ktore dowodzi ze kopia escrow dziala.

## User Stories

### US1 (P1, MVP) - Runbook Operatora

**Jako** Operator PATRONA w kancelarii **chce** miec spisana procedure
backupu i odzyskania kluczy (inwentarz kluczy, escrow przy aktywacji,
scenariusze utraty, weryfikacja kwartalna), **zeby** wlaczenie szyfrowania
nie moglo skonczyc sie nieodwracalna utrata akt.

**Acceptance Criteria:**
- [x] AC1.1: `governance/runbooks/kek-backup-recovery.md` - inwentarz WSZYSTKICH kluczy (at-rest ADR-0072, field-KEK ADR-0138, sekrety pomocnicze), procedura escrow PRZY aktywacji (nie po), scenariusze "zgubilismy klucz" z drzewkiem decyzyjnym, harmonogram weryfikacji.
- [x] AC1.2: runbook mowi wprost, czego NIE da sie odzyskac (fail-loud by design) - zero falszywych obietnic.
- [x] AC1.3: gotcha DPAPI: blob db_key.enc jest zwiazany z profilem Windows i maszyna - kopia bloba NIE jest backupem przenosnym.

### US2 (P1) - Skrypt weryfikacji kopii KEK

**Jako** Operator **chce** jedna komenda sprawdzic, ze kopia escrow KEK
odszyfrowuje owiniete DEK-i w bazie, **zeby** kwartalna weryfikacja backupu
byla mechaniczna, a nie na wiare.

**Acceptance Criteria:**
- [x] AC2.1: `npm run kek:verify` (backend/scripts/verify-kek-backup.ts) - czyta kandydata KEK z `--kek-file` lub env, odwija wszystkie `encryption_keys.wrapped_dek`, raport per tenant.
- [x] AC2.2: exit 0 = wszystkie DEK odwiniete; exit 1 = zly klucz/uszkodzony wiersz; exit 2 = brak wierszy (szyfrowanie nieaktywowane) z jasnym komunikatem.
- [x] AC2.3: skrypt jest read-only (zero zapisu do bazy) i zero-cloud.

## Non-Goals

- Rotacja KEK/DEK (US3+ spec 005 - osobny cykl).
- UI odzyskiwania w aplikacji (runbook = narzedzie Operatora, nie prawnika).
- Key escrow u MateMatic ("nawet my nie odczytamy waszych akt" - klucz zostaje w kancelarii).

## Open Questions

- Q6 spec 005 pozostaje do sign-off WM, ale ma teraz tresc-rekomendacje: escrow
  wydrukowany + pendrive offline w sejfie kancelarii, weryfikacja kwartalna kek:verify.
