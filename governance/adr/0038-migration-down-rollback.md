# ADR-0038: Down/rollback dla infrastruktury migracji

> **Uwaga numeracja**: ADR-0038 zarezerwowany explicite w ADR-0035 sekcja "Rezerwacje na kolejne ADR" oraz w CHANGELOG przy ADR-0035 ("Rezerwacje: ADR-0038 (down/rollback migracji)"). Ten ADR realizuje rezerwacje.

**Status**: WDROZONY (2026-05-27). Format `-- UP` / `-- DOWN` sekcji w plikach `backend/migrations/NNN_*.sql` LIVE. Pure helper `extractUpDown` w `backend/src/lib/migrations.ts`. Nowa komenda `npm run migrate:rollback <id>` LIVE w `backend/scripts/run-migrations.ts`. Migracja `001_audit_log_event_type_check.sql` zaktualizowana z `-- DOWN` sekcja (idempotent `DROP CONSTRAINT IF EXISTS`) jako wzorzec dla kolejnych.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.6 -> v1.2.7):
- **Art. 7 - Bramki jakosci** - GLOWNA zasada. Migracja schemy bez planu rollback to single point of failure compliance'owy. Audytor moze odrzucic zmiane w `audit_log` jezeli nie ma deterministycznej drogi powrotu.
- **Art. 3 - Audytowalnosc** - rollback zostawia slad w `schema_migrations` (rekord usuniety + `console.warn` ze structured tag `[MIGRATE-ROLLBACK]`). Pelny audit_log eventu `migrate.rollback` = rezerwacja ADR-0043 (audit dla admin actions).
- **Art. 4 - Neutralnosc wobec dostawcow** - zero nowych zaleznosci npm. Parser `-- UP` / `-- DOWN` to natywny JavaScript regex split.
- **Art. 1 - Lokalnosc danych** - operator wykonuje DOWN SQL manualnie w Supabase SQL Editor / psql / pgAdmin (governance-friendly, ten sam wzorzec co `migrate:plan` z ADR-0035).

**Powiazane ADR**:
- **ADR-0035** - rodzic. Infrastruktura migracji + format `NNN_*.sql` + custom runner + tabela `schema_migrations`. Ten ADR rozszerza rodzica o down/rollback.
- **ADR-0039 (rezerwowane)** - CI gate na drift schema.sql vs migrations. Bez powiazania z down/rollback (drift checker patrzy na up-only sum + porownuje z schema.sql).
- **ADR-0043 (rezerwowane)** - audit_log eventu `migrate.rollback` (oraz `admin.access` z ADR-0034). Wymaga migracji 002 ALTER CHECK whitelist event_type.

---

## Decyzja

### A. Format `-- UP` / `-- DOWN` w tym samym pliku migracji

```sql
-- migrations/NNN_<slug>.sql

-- UP
-- (SQL forward migration: ALTER TABLE / ADD CONSTRAINT / CREATE TABLE / ...)

-- DOWN
-- (SQL rollback: DROP CONSTRAINT / ALTER TABLE / DROP TABLE / ...)
```

Parser w `lib/migrations.ts` rozdziela plik na 2 sekcje przez regex `^--\s*DOWN\s*$` (case-insensitive, jedna linia). Brak `-- UP` na poczatku = caly content do `-- DOWN` traktowany jako UP (back-compat dla 001 sprzed dodania `-- UP`). Brak `-- DOWN` = down-section pusta = `migrate:rollback` zwraca blad "migration NNN has no DOWN section".

Dlaczego ten sam plik a nie osobne `NNN_<slug>.up.sql` + `NNN_<slug>.down.sql`:
- **Jeden plik = pelna definicja migracji** - audytor widzi forward + reverse w jednym miejscu.
- **Latwiej audytowac w git history** - `git log -p NNN_<slug>.sql` pokazuje cala ewolucje.
- **Mniej moves** - operator nie zapomni zaktualizowac drugiego pliku przy edycji.
- **Wzorzec sqitch / Flyway** - branzowy standard.

Alternatywy odrzucone:
- **Osobne pliki UP + DOWN** - 2x wiecej plikow, ryzyko driftu (zmiana UP bez DOWN).
- **`NNN_up_*.sql` + `NNN_down_*.sql` w osobnych katalogach** - jeszcze bardziej rozproszone.
- **Tylko UP, rollback recznie z SQL Editor** - bez deterministycznej droga powrotu, audytor nie ma gwarancji.

### B. Komenda runnera `npm run migrate:rollback <id>`

```
npm run migrate:rollback 001
```

Workflow:
1. Runner czyta plik `NNN_*.sql`, ekstrahuje sekcje `-- DOWN`.
2. Wypisuje SQL na stdout + instrukcje "Skopiuj do Supabase SQL Editor / psql / pgAdmin i wykonaj".
3. Czeka na potwierdzenie operatora (`npm run migrate:rollback:mark <id>` po manualnej aplikacji).
4. `migrate:rollback:mark` usuwa rekord z `schema_migrations` + `console.warn` ze structured tag `[MIGRATE-ROLLBACK]`.

Spojne z governance-friendly wzorcem ADR-0035 (`plan` -> manual SQL -> `mark`).

Komendy w `package.json`:
- `migrate:rollback` - wypisuje DOWN SQL
- `migrate:rollback:mark` - kasuje rekord ze schema_migrations po manualnym wykonaniu

Audit log eventu `migrate.rollback` = rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist event_type). Obecnie `console.warn` jako gateway.

### C. Update migracji 001 z `-- DOWN` sekcja (wzorzec)

```sql
-- backend/migrations/001_audit_log_event_type_check.sql

-- UP
do $$
begin
  if not exists (...) then
    alter table public.audit_log
      add constraint audit_log_event_type_whitelist
      check (event_type in (...));
  end if;
end;
$$;

-- DOWN
alter table public.audit_log
  drop constraint if exists audit_log_event_type_whitelist;
```

Idempotent (`DROP CONSTRAINT IF EXISTS`). Operator moze rollback'owac wielokrotnie bez bledu.

### D. Manual rollback przez operatora (governance-friendly)

Operator wykonuje DOWN SQL recznie w Supabase SQL Editor / psql / pgAdmin (ten sam wzorzec co `migrate:plan` z ADR-0035). Runner tylko wypisuje SQL + kasuje rekord z `schema_migrations` po manualnym wykonaniu (`migrate:rollback:mark`). Powody:
- **Konstytucja Art. 7** - operator widzi DDL przed wykonaniem (rollback `audit_log` to kluczowa decyzja compliance).
- **Konstytucja Art. 4** - zero nowych zaleznosci npm.
- **Audytowalnosc Supabase** - wykonany DDL zostawia slad w Supabase Audit Logs.

Alternatywy odrzucone:
- **Automatyczny rollback przez `pg` lib** - dodaje devDep, operator nie widzi DDL.
- **Atomic transaction UP + ROLLBACK przez database** - dziala tylko dla pojedynczej migracji, nie chroni przed bledem w aplikacyjnej walidacji po DDL.

### Zakres tego ADR
- Update `backend/src/lib/migrations.ts` - dodanie helpera `extractUpDown` + private `stripUpMarker` (pure functions ~30 LoC z komentarzami).
- Update `backend/src/lib/migrations.test.ts` - 8 testow `extractUpDown` (tylko UP / tylko DOWN / oba / brak markerow / case-insensitive / wielokrotne markery / pusta sekcja / whitespace handling).
- Update `backend/scripts/run-migrations.ts` - 2 nowe komendy `rollback <id>` (~45 LoC) + `rollback:mark <id>` (~25 LoC) + dispatcher (~12 LoC) = ~80 LoC.
- Update `backend/migrations/001_audit_log_event_type_check.sql` - dodanie `-- UP` na poczatku + `-- DOWN` sekcja z komentarzem ostrzezenia (~15-20 LoC).
- Update `backend/package.json` - 2 nowe skrypty `migrate:rollback` + `migrate:rollback:mark`.
- Update `governance/CONSTITUTION.md` v1.2.6 -> v1.2.7 PATCH (sekcja 5.2.2 update o down/rollback).
- Update `CHANGELOG.md` entry [Unreleased].

### Czego NIE robimy w tym ADR (osobne ADR-y)
- **NIE robimy audit_log eventu `migrate.rollback`** - rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist event_type).
- **NIE robimy CI gate na drift schema.sql vs migrations** - rezerwacja ADR-0039.
- **NIE robimy `migrate:redo`** (rollback + re-apply) - operator robi recznie `rollback` + `migrate:plan`. Jezeli pojawi sie use case z czestym redo, osobny ADR.
- **NIE robimy automatycznego rollback przy bledzie UP** - operator decyduje czy chce rollback. Atomic transaction UP+ROLLBACK dziala tylko w obrebie jednej migracji Postgres, nie dla aplikacyjnej walidacji.
- **NIE robimy dependency graph migration** (np. "002 wymaga 001 zastosowanej") - linear chain wystarcza dla obecnej skali.

---

## Kontekst

### Dlaczego ADR-0035 zostawil down/rollback jako rezerwacja

ADR-0035 explicite mowi w sekcji "Rezerwacje na kolejne ADR":
> ADR-0038 (proponowany): down/rollback migracji. Pierwsza migracja jest forward-only (CHECK mozna dropowac recznie alter table ... drop constraint). Pelny down-migration framework gdy bedziemy mieli pierwszy realnie wycofywalny refactor schema.

Ten ADR domyka rezerwacje - dodajac format `-- DOWN`, komendy runnera, wzorzec dla 001, i konwencje dla kolejnych migracji.

### Dlaczego idempotent DROP CONSTRAINT IF EXISTS w DOWN

Operator moze przypadkowo uruchomic `migrate:rollback 001` 2x. Pierwsze wywolanie DROP'uje constraint. Drugie wywolanie chce DROP'owac juz nieistniejacy constraint. Bez `IF EXISTS` - blad PostgreSQL "constraint does not exist". Z `IF EXISTS` - no-op, czyste re-run.

Wzorzec analogiczny do `CREATE TABLE IF NOT EXISTS` w UP. Idempotency = bezpieczne re-uruchomienie = mniejsze ryzyko operacyjne.

### Dlaczego brak audit_log w tym ADR

Rollback migracji = dzialanie admin'a, powinien byc audytowany. Ale audit_log eventu `migrate.rollback` wymaga:
1. Migracji 002 ALTER CHECK whitelist event_type dodajacej `migrate.rollback` (oraz `admin.access` z ADR-0034).
2. Tej migracji nie ma jeszcze w repo.
3. Implementacji w `runAutoCompute`-style funkcji.

To wszystko skomplikowane semantycznie - migracja 002 dodaje event_type, ale migracja sama jest dzialaniem admina ktore powinno byc logowane. Chicken-egg. Rezerwacja ADR-0043 rozwiaze to przez wprowadzenie eventu w migracji 002 + retroaktywne pisanie zdarzen dla wszystkich admin actions od momentu wpiecia.

W tej iteracji: `console.warn` ze structured tag `[MIGRATE-ROLLBACK]` jako gateway. Operator widzi w docker logs kazdy rollback.

### Dlaczego rollback NIE jest ON CONFLICT na schema_migrations

Alternatywa: zostawic rekord w schema_migrations z flagą `rolled_back_at` zamiast usuwac. Plusy:
- Pelna historia w jednej tabeli.
- Audytor widzi "migracja byla zaaplikowana 2026-05-27, rolled back 2026-05-28".

Minusy:
- Schema change (dodanie kolumny `rolled_back_at`) - dodatkowa migracja w tej iteracji.
- Komplikuje `selectPendingMigrations` (musi sprawdzac rolled_back).
- Audyt UODO i tak otrzymuje pelen ProofBundle z Merkle - schema_migrations to drugorzedne zrodlo.

Decyzja: usuwac rekord (proste, deterministyczne). Audytor sprawdza historie przez `git log` `migrations/` + Supabase Audit Logs. Pelna historia rollback w audit_log = ADR-0043.

---

## Alternatywy rozwazane

**A. Osobne pliki UP + DOWN**
- Odrzucone. 2x wiecej plikow, drift risk.

**B. Tylko UP, rollback recznie z SQL Editor**
- Odrzucone. Bez deterministycznej drogi powrotu, audytor odrzuca.

**C. Trigger Postgres on DROP CONSTRAINT**
- Odrzucone. Trigger ukrywa logike rollback'a w bazie, operator nie widzi DDL.

**D. node-pg-migrate / sqitch frameworki**
- Odrzucone. Zaleznosc npm, learning curve, sprzecznosc z Konstytucja Art. 4.

**E. Format `-- UP` / `-- DOWN` w jednym pliku + manual rollback (przyjete)** - **przyjete**
- Wzorzec sqitch/Flyway, governance-friendly, zero nowych deps.

---

## Konsekwencje

### Pozytywne
- Kazda migracja ma deterministyczna droge powrotu - audytor widzi `-- DOWN` sekcje w git history.
- Idempotent DROP IF EXISTS - operator moze re-runowac rollback bez bledow.
- Spojne z governance-friendly wzorcem ADR-0035 (operator wykonuje DDL manualnie, runner zarzadza tylko rejestracja/deregistracja w `schema_migrations`).
- Zero nowych zaleznosci npm (Konstytucja Art. 4).
- Reuse runnera ADR-0035 - 2 nowe komendy w istniejacym `run-migrations.ts`, nie nowy plik.
- Wzorzec `-- UP` / `-- DOWN` reusable dla kolejnych migracji (002, 003, ...).

### Negatywne / kosztowe
- +update `lib/migrations.ts` (~20 LoC `extractUpDown` pure helper).
- +update `lib/migrations.test.ts` (~50 LoC, 8 nowych testow).
- +update `scripts/run-migrations.ts` (~70 LoC: 2 nowe komendy).
- +update `migrations/001_audit_log_event_type_check.sql` (~10 LoC: `-- UP` header + `-- DOWN` sekcja).
- +update `package.json` (~2 LoC: 2 nowe skrypty).
- Operator musi pamietac o `-- DOWN` sekcji w kazdej nowej migracji. Wzorzec 001 daje wzor, ale brak walidatora (rezerwacja ADR-0039 CI gate moze sprawdzac).
- `console.warn` jako audit gateway = NIE jest hash-chained. Pelny audit po ADR-0043.

### Bramki PO wpieciu (potwierdzone w tej sesji)
- Testy backend: **524/529 pass** (+8 nowych vs baseline 516/521 z ADR-0034).
- TSC clean.
- Internal QA review (min. 2 rundy) - zalatwione przed commitem.

---

## Atrybucja

Format `-- UP` / `-- DOWN` w jednym pliku - wzorzec branzowy z `sqitch` (David Wheeler, MIT) i `Flyway` (Boxfuse / Red Gate, Apache-2.0). Bez bezposredniego cherry-pick (parser i runner pisane od zera w TypeScript).

Pelna atrybucja zaleznosci backendu: [THIRD_PARTY_INSPIRATIONS.md](../../THIRD_PARTY_INSPIRATIONS.md).
