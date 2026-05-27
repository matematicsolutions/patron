# ADR-0035: Infrastruktura migracji + CHECK constraint na audit_log.event_type

> **Uwaga numeracja**: ADR-0035 zarezerwowany explicite w `backend/src/lib/audit.ts` (komentarz przy konwencji nazewnictwa event_type, ADR-0033 era). Ten ADR realizuje rezerwacje - dodaje (1) infrastrukture migracji ktorej dotychczas brak w repo, (2) pierwsza migracje aplikujaca CHECK constraint na `audit_log.event_type` z whitelist 7 produkcyjnych wartosci.

**Status**: WDROZONY (2026-05-27). Governance-friendly runner `backend/scripts/run-migrations.ts` LIVE (komendy `plan`/`mark`/`status`). Pierwsza migracja `backend/migrations/001_audit_log_event_type_check.sql` gotowa do manualnej aplikacji przez Operatora kancelarii w Supabase SQL Editor / psql / pgAdmin. `backend/schema.sql` zaktualizowany (zawiera CHECK + tabele `schema_migrations` z dwoma CHECK formatowymi - synchronizacja fresh-setup z istniejacymi deploymentami). Komentarz konwencji w `lib/audit.ts` zsynchronizowany z faktem (7 prod w CHECK + 3 rezerwacje testowe / planowane).

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.3 -> v1.2.4, zweryfikowane grepem):
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - GLOWNA zasada tego ADR. Whitelist wymusza deterministyczna taksonomie zdarzen w audit_log. Audytor (UODO, rewident kancelarii, biegly w postepowaniu) widzi zamkniety katalog typow zdarzen - nie musi dyskryminowac czy "tool.call.saos__search.v2" to legalny event_type czy artefakt bugu/ataku. Nowy event_type wymaga osobnej migracji + ADR - kazdy nowy typ przechodzi review przed wejsciem do produkcji.
- **Art. 4 - Neutralnosc wobec dostawcow** - custom TS runner zamiast knex/prisma/sqitch/node-pg-migrate. Zero nowych zaleznosci npm. Patron pozostaje vendor-neutral w warstwie infrastruktury.
- **Art. 7 - Bramki jakosci** - migracje aplikowane idempotentnie (sprawdzenie `schema_migrations` przed wykonaniem) i transakcyjnie (rollback przy bledzie). Failed migration = brak czesciowego stanu.
- **Art. 1 - Lokalnosc danych** - runner uzywa istniejacego `SUPABASE_URL` + `SUPABASE_SECRET_KEY` z env, nie wprowadza nowych endpointow ani transferow.

**Powiazane ADR**:
- **ADR-0001** - rodzic. Hash-chain audit_log z kolumna `event_type text not null` (bez constraint). Ten ADR domyka dlug techniczny ADR-0001.
- **ADR-0026** - sasiad (kompatybilnosc). Merkle hashuje `audit_log.hash`; whitelist event_type wymusza walidacje PRZED INSERT, nie zmienia formatu hash. Lancuch hash + Merkle root pozostaja identyczne przed/po migracji.
- **ADR-0027** - wprowadzil `ring_policy.decision`. Trafia do whitelist.
- **ADR-0028** + **ADR-0033** - wprowadzily `mcp_security.gateway`. Trafia do whitelist.
- **ADR-0019/0020** - wprowadzily `input_security_scan`. Trafia do whitelist.

---

## Decyzja

### A. Whitelist 7 produkcyjnych event_type w CHECK constraint

```sql
constraint audit_log_event_type_whitelist
check (event_type in (
  'chat.message.user',
  'chat.message.assistant',
  'input_security_scan',
  'mcp_security.gateway',
  'ring_policy.decision',
  'rodo.delete',
  'rodo.export'
))
```

Tylko wartosci faktycznie wywolywane przez `appendAuditEvent` w kodzie produkcyjnym (poza testami). Rezerwacje (`chat.created`, `tool.call`, `entities.extracted`) NIE sa w CHECK - sa udokumentowane w komentarzu `lib/audit.ts` jako kandydaci do przyszlych migracji.

Konsekwencja: dodanie nowego event_type = nowa migracja `NNN_audit_log_event_type_add_<slug>.sql` + ADR (jezeli nietrwialny semantycznie) + bump audit.ts. Kazda zmiana taksonomii zdarzen przechodzi review przed wejsciem.

### B. Governance-friendly runner (plan + mark + status), DDL aplikowany manualnie

`backend/scripts/run-migrations.ts` (~140 LoC) z `backend/src/lib/migrations.ts` (pure functions ~60 LoC). Trzy komendy:

- `npm run migrate` (alias `migrate:plan`) - wypisuje pending migracje w odpowiedniej kolejnosci leksykalnej, z pelnym SQL kazdej z nich + instrukcja "skopiuj do Supabase SQL Editor / psql / pgAdmin i wykonaj". NIE aplikuje DDL.
- `npm run migrate:mark <id>` - po manualnym wykonaniu DDL operator wpisuje rekord do `public.schema_migrations` (id, name, applied_at, checksum). Runner sprawdza ze checksum z pliku zgadza sie z planem przed insertem.
- `npm run migrate:status` - lista wszystkich migracji z stanem `applied` / `pending`, plus ostrzezenie gdy checksum zaaplikowanej migracji rozni sie od checksumu pliku (drift detection).

Dlaczego ten pattern:
- **Konstytucja Art. 4** - zero nowych zaleznosci npm. Supabase-js (juz w deps) nie ma raw SQL execute. Dodanie `pg` (35MB transitive) dla 1 migracji rocznie to overengineering.
- **Konstytucja Art. 7** - Operator kancelarii widzi KAZDY DDL przed wykonaniem na audit_log (tabela kluczowa dla compliance AI Act), aplikuje go swiadomie, potem oznacza w rejestrze. Automatyczne DDL na starcie kontenera odebraloby ta widocznosc.
- **Audytowalnosc Supabase** - DDL wykonany w Supabase SQL Editor zostawia slad w Supabase Audit Logs (admin role, IP, timestamp). Kontener backendu wykonujacy DDL bezposrednio dawalby tylko "service role z N kontenerow".

Alternatywy odrzucone:
- **Automatyczny runner z `pg`** - 35MB devDep + automatyczne DDL na audit_log = utrata operator awareness (Art. 7).
- **node-pg-migrate** - dodaje 1 zaleznosc + CLI; up/down/redo to overengineering dla 1 migracji rocznie.
- **Supabase CLI migrations** - wymaga `supabase` CLI w deploy/CI, wprowadza zaleznosc od jednego dostawcy w warstwie infrastruktury (sprzecznosc z Art. 4).
- **sqitch/knex/prisma** - zbyt ciezkie dla zakresu.

### Bootstrap dla istniejacych deployments

Bootstrap tabeli `schema_migrations` (jednorazowo, przed pierwszym `migrate:mark`). Identyczne jak w `backend/schema.sql` dla fresh setup - existing deployment dostaje ten sam schemat:

```sql
create table if not exists public.schema_migrations (
  id           text primary key,
  name         text not null,
  applied_at   timestamptz not null default now(),
  checksum     text not null,
  constraint schema_migrations_id_format check (id ~ '^\d{3}$'),
  constraint schema_migrations_checksum_format check (checksum ~ '^[0-9a-f]{64}$')
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
```

Operator kopiuje powyzszy SQL do Supabase SQL Editor (jednorazowo), potem `npm run migrate` planuje migracje, operator aplikuje DDL z `migrations/NNN_*.sql`, na koniec `npm run migrate:mark NNN`. Fresh deployments dostaja `schema_migrations` od razu z `schema.sql`.

### C. Rezerwacje na kolejne ADR

- **ADR-0038 (proponowany)**: down/rollback migracji. Pierwsza migracja jest forward-only (CHECK mozna dropowac recznie `alter table ... drop constraint`). Pelny down-migration framework gdy bedziemy mieli pierwszy realnie wycofywalny refactor schema.
- **ADR-0039 (proponowany)**: CI gate na migration drift. GitHub Actions sprawdzajacy ze `schema.sql` zsynchronizowany z `migrations/*.sql` (suma migracji aplikowana na pusty Postgres daje rezultat rowny `schema.sql`). Wymusza dyscypline "kazda zmiana schema = migracja + update schema.sql".

### Zakres tego ADR
- Pierwsza migracja `001_audit_log_event_type_check.sql` (whitelist 7 prod).
- Governance-friendly runner `scripts/run-migrations.ts` (komendy `plan`/`mark`/`status`) + helper `lib/migrations.ts` (pure functions).
- Tabela `schema_migrations` w `schema.sql` (fresh setup dostaje od razu; existing deployment dostaje bootstrap SQL z ADR).
- Aktualizacja `schema.sql` (dodanie CHECK constraint + tabeli schema_migrations - synchronizacja fresh-setup z deploymentami).
- Aktualizacja komentarza konwencji w `lib/audit.ts` (sync z faktem: 7 prod + 3 rezerwacje).
- Union literal `EventType` w `lib/audit.ts` (typowanie compile-time, lustro CHECK constraintu w bazie).
- Eksport `EVENT_TYPES` array dla testow i runtime walidacji.
- Skrypty `migrate`, `migrate:mark`, `migrate:status` w `package.json`.
- Testy: 23 nowe testy w `migrations.test.ts` (pure functions: parseFilename 8 it / sort kolejnosciowy 3 it / sha256 checksum 4 it / selectPending 4 it / findDuplicateIds 4 it) - bez integracji z real DB.

### Czego NIE robimy w tym ADR (osobne ADR-y)
- **NIE robimy down/rollback** - rezerwacja ADR-0038.
- **NIE robimy CI gate na drift schema.sql** - rezerwacja ADR-0039.
- **NIE migrujemy istniejacych deployments automatycznie** - migracja idempotentna (CHECK ADD CONSTRAINT pattern przez `pg_constraint` lookup, wzorowane na L271-286 schema.sql). Operator kancelarii uruchamia `npm run migrate` (plan + wypisany SQL), kopiuje do Supabase SQL Editor, wykonuje recznie w windowie maintenance, potem `npm run migrate:mark 001`.
- **NIE bumpujemy hash format dla audit_log** - hash-chain liczony PRZED INSERT, CHECK dziala AT INSERT, hash zostaje identyczny.

---

## Kontekst

### Dlaczego CHECK constraint, a nie tylko TypeScript union

Argument: skoro `appendAuditEvent` przyjmuje `event_type: string`, wystarczy union literal w `AuditEventInput`.

Odpowiedz: dwie warstwy obrony.
- TypeScript chroni przed bledami DEWELOPERA (compile time).
- CHECK constraint chroni przed bledami RUNTIME (nieprzewidziana sciezka, np. raw SQL z migracji danych, nadpisanie supabase clientem z innego procesu, atak SQL injection przez nieoczyszczone pole `event_type`).

Patron jest produktem regulowanym - audytor patrzy na schemat bazy, nie na TypeScript. CHECK constraint to dowod dla audytora ze taksonomia zdarzen jest egzekwowana ON DISK, nie tylko w warstwie aplikacji.

### Dlaczego whitelist, a nie regex

Regex (`^[a-z]+(\.[a-z_]+)+$`) dopuszczalby kazdy semantycznie spojny string ("chat.message.foo", "tool.call.eval"). To podatne na:
- typo w nowym callsite ("rodo.delite" zamiast "rodo.delete") - typo przechodzi bo pasuje do wzorca.
- silent shift taksonomii (deweloper dodaje nowy event_type bez ADR, audytor widzi go dopiero w produkcji).

Whitelist wymusza twarda granice: nowy event_type = nowa migracja = wewnetrzny review tresci + commit z atrybucja. Koszt elastycznosci akceptowalny dla produktu regulowanego.

### Lokalizacja schema_migrations w publicznym schemacie

`public.schema_migrations` zamiast osobnego schema `_migrations`:
- Konsystencja z reszta tabel Patrona (wszystko w `public`).
- Supabase native nie potrzebuje grant na inne schemas.
- Audytor widzi w jednym miejscu: kazda migracja zaaplikowana z datą, checksumem i kto.

RLS: tylko service role pisze/czyta. Anon/authenticated zero dostepu (analogicznie do audit_log).

### Jak runner zachowuje sie przy pierwszym uruchomieniu

Scenariusz fresh deployment z `schema.sql`:
1. `schema.sql` zawiera juz `create table if not exists public.schema_migrations` (z CHECK formatowymi na id i checksum) i CHECK constraint na `audit_log.event_type`.
2. `npm run migrate:status` - operator widzi pliki w `backend/migrations/` jako PENDING (bo wpisow w `schema_migrations` brak).
3. `npm run migrate:mark 001` - oznacza migracje 001 jako zaaplikowana (CHECK juz jest z schema.sql, no-op faktyczny).

Scenariusz existing deployment (kancelaria z Patron < ADR-0035):
1. Operator wykonuje bootstrap SQL z sekcji "Bootstrap dla istniejacych deployments" w Supabase SQL Editor (jednorazowo, tworzy `schema_migrations` z 2 CHECK formatowymi).
2. `npm run migrate` (alias `migrate:plan`) - runner wypisuje SQL pending migracji 001 + instrukcje skopiowania.
3. Operator kopiuje SQL migracji 001 do Supabase SQL Editor i wykonuje.
4. Jezeli istniejacy audit_log ma rekord z event_type spoza whitelist - DDL FAIL z czytelnym bledem "violates check constraint audit_log_event_type_whitelist". Operator rozstrzyga (cleanup recznie albo update whitelist o brakujacy event_type przez kolejna migracje).
5. Po udanej aplikacji DDL operator wykonuje `npm run migrate:mark 001` - runner sprawdza checksum pliku i wpisuje rekord do `schema_migrations`.

---

## Alternatywy rozwazane

**A. TypeScript union bez CHECK constraint**
- Odrzucone. Patron jest produktem regulowanym - audytor patrzy na schemat bazy, nie na kod. Warstwa aplikacji moze byc obejscona (raw SQL, inny client).

**B. CHECK z regex pattern**
- Odrzucone. Typo i silent shift taksonomii przechodzi przez regex. Whitelist wymusza review.

**C. Trigger PL/pgSQL zamiast CHECK**
- Odrzucone. CHECK constraint to standardowy mechanizm Postgres, audytowalny przez `\d audit_log`. Trigger ukrywa logike i wymaga grant EXECUTE.

**D. Framework migracji (node-pg-migrate, knex, sqitch, supabase CLI)**
- Odrzucone. Zaleznosc npm, learning curve, dependency surface dla audytu. Custom runner (~210 LoC) daje pelna kontrole.

**E. Wlasny CHECK + governance-friendly runner (przyjete)** - **przyjete**
- Dwie warstwy obrony (TS + DB). Zero nowych zaleznosci npm. Audytor widzi taksonomie ON DISK. Operator kancelarii widzi pelny SQL przed aplikacja (output `migrate:plan` w terminalu, potem Supabase SQL Editor); wykonany DDL zostawia slad w Supabase Audit Logs.

---

## Konsekwencje

### Pozytywne
- Taksonomia zdarzen audit_log egzekwowana ON DISK - audytor (UODO, rewident) widzi katalog typow zdarzen w `\d audit_log` bez czytania kodu.
- TypeScript union literal `EventType` w `lib/audit.ts` - compile-time safety dla deweloperow.
- `EVENT_TYPES` jako eksportowany array - jeden punkt prawdy dla testow, migracji i dokumentacji.
- Custom TS runner - zero dodatkowych zaleznosci npm, wzorzec ktory rozumie kazdy deweloper TypeScript.
- Pierwsza migracja jako wzorzec - kolejne migracje (rezerwacje 0038/0039) maja gotowy szablon i runner.
- `schema_migrations` tabela - audytor widzi historie wszystkich zmian schema z datą i checksumem (kandydat do propagacji do audit_log w przyszlym ADR).

### Negatywne / kosztowe
- +1 plik scripts (~210 LoC `run-migrations.ts`), +1 plik lib (~85 LoC `migrations.ts`), +1 plik test (~175 LoC `migrations.test.ts`), +1 plik migration (~50 LoC `001_audit_log_event_type_check.sql`), +update audit.ts (~30 LoC: EVENT_TYPES array + EventType union + isEventType + komentarz), +update schema.sql (~30 LoC: CHECK na audit_log + tabela schema_migrations z RLS).
- Existing deployments wymagaja `npm run migrate` - dokumentacja w CHANGELOG + komunikat dla operatorow kancelarii.
- Hipotetyczna kolizja: jezeli ktokolwiek wstawil event_type spoza whitelist w istniejacy audit_log (np. testy integracyjne ktore omylkowo trafily do produkcyjnej bazy) - migracja FAIL. Manualna interwencja. Akceptowalne (to wlasciwie wlasciwa odpowiedz).
- Bariera dla nowych event_type: deweloper musi napisac migracje + ADR. Cel - to feature, nie bug.

### Bramki PO wpieciu (potwierdzone w tej sesji)
- Testy backend: **482/487 pass** (+23 nowych vs baseline 459/464 z ADR-0026).
- TSC clean.
- Internal QA review (min. 2 rundy) - zalatwione przed commitem.

---

## Atrybucja

Custom runner i pattern schema_migrations - bez bezposredniej atrybucji do konkretnego frameworka. Inspiracja konceptualna z mike/willchen96 forka (komentarz w schema.sql L3 wskazuje na historyczne `backend/migrations/*.sql files` ktore nie istnieja w obecnym repo - prawdopodobnie z ery przed fork point). Wzorzec idempotent CHECK przez `pg_constraint` lookup zaadaptowany z schema.sql L271-286 (ten sam plik, dla foreign key constraintu).

Whitelist event_type jako twarda granica - wlasna decyzja dla produktu regulowanego, zgodna z AI Act art. 12 (record-keeping wymaga deterministycznej taksonomii zdarzen high-risk AI). Brak bezposredniego cherry-pick.

Pelna atrybucja zaleznosci backendu: [THIRD_PARTY_INSPIRATIONS.md](../../THIRD_PARTY_INSPIRATIONS.md).
