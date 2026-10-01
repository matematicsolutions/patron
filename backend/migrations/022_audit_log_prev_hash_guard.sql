-- Migration 022: straznik lancucha audytu na poziomie bazy (ADR-0161).
-- Format UP/DOWN per ADR-0038.
--
-- Problem: dwa zapisy czytajace ten sam ostatni hash daja dwa ogniwa o wspolnym
-- poprzedniku (rozwidlenie lancucha). `hash unique` tego nie lapie - hash obejmuje
-- `ts` i payload, wiec ogniwa maja rozne hashe. Kolejka w `appendAuditEvent`
-- porzadkuje zapisy JEDNEGO procesu; tryb serwerowy moze miec ich kilka.
--
-- Straznik: unikalny `prev_hash`. Przegrany wyscig konczy sie bledem 23505,
-- a `appendAuditEvent` czyta swiezy poprzednik i ponawia zapis.
--
-- Indeks CZESCIOWY (`where id > N`, N = max(id) w chwili migracji): baza moze juz
-- miec rozwidlenia z czasu przed kolejka - pelny unikalny indeks by sie na nich
-- nie zbudowal, a historii audytu nie przepisujemy. Na pustej tabeli N = 0, czyli
-- straznik obejmuje caly lancuch. Weryfikator lancucha traktuje rozwidlenie
-- powyzej N jako BLOKADE (przy zywym strazniku jest niemozliwe).
--
-- Lustra straznika: ta migracja, schema.sql (ten sam blok), SQLite
-- `ensureAuditChainGuard` w src/lib/db/migrate.sqlite.ts. Pilnuje ich test
-- src/lib/db/audit-chain-guard.test.ts.
--
-- Idempotentna: nic nie robi, gdy indeks juz istnieje (prog zostaje pierwotny).

-- UP

do $$
declare
  watermark bigint;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'audit_log_prev_hash_unique'
  ) then
    -- Blokada zapisow na czas odczytu progu i budowy indeksu: wpis dopisany
    -- miedzy max(id) a create index wypadlby spod straznika.
    lock table public.audit_log in share row exclusive mode;
    select coalesce(max(id), 0) into watermark from public.audit_log;
    execute format(
      'create unique index audit_log_prev_hash_unique on public.audit_log (prev_hash) where id > %s',
      watermark
    );
  end if;
end;
$$;

-- DOWN

drop index if exists public.audit_log_prev_hash_unique;
