# Plan: Runbook KEK + skrypt weryfikacji

**Spec:** ./spec.md
**Project Type:** web-app (backend tooling + governance doc)

## Technical Context

- Skrypt TS w `backend/scripts/` (konwencja: tsx, jak rodo-export/verify-audit-*).
- Reuzycie `src/lib/crypto/dek.ts` (loadKek HKDF) i `field-crypto.ts` (decryptField)
  oraz shima `createServerSupabase` - dziala w SQLite i Postgres bez rozgalezien.
- Runbook w `governance/runbooks/` (nowy katalog; dashboardy/pilotaz juz maja swoje).

## Constitution Check (GATE)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | domyka obietnice "szyfrowanie bez ryzyka utraty akt" |
| RODO art. 32 | PASS | procedura ciaglosci dostepu do danych = element bezpieczenstwa |
| Zero-cloud | PASS | skrypt lokalny, klucz nie opuszcza kancelarii |
| Fail-loud | PASS | skrypt nie maskuje bledow; runbook nazywa nieodzyskiwalne wprost |
| Bramka jakosci | PASS | smoke-test pozytywny i negatywny przed commitem |

## Pliki

- `governance/runbooks/kek-backup-recovery.md` (nowy)
- `backend/scripts/verify-kek-backup.ts` (nowy)
- `backend/package.json` - script `kek:verify`
