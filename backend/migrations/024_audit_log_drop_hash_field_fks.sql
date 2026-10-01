-- Migration 024: zdjecie kluczy obcych z pol WCHODZACYCH DO HASHA audit_log.
-- ADR-0164. Format UP/DOWN per ADR-0038.
--
-- NUMER: na linii feat/design-system-2-0 ten plik nazywal sie 020, ale 020 na linii
-- publicznej (wydanej w 1.3.0) to deliverable_bundle_export. Runner sledzi migracje
-- po prefiksie id, wiec serwer z 1.3.0 uznalby 020 za zaaplikowana i NIGDY nie
-- zdjalby tych FK. Renumeracja przy scaleniu linii - ADR-0163. Tresc bez zmian,
-- idempotentna: serwer deweloperski, ktory zaaplikowal stara 020, przejdzie ja
-- ponownie bez skutku (petla po pg_constraint nic nie znajdzie).
--
-- Problem: `actor_user_id`, `chat_id` i `document_id` sa wejsciami
-- `computeAuditHash` (backend/src/lib/audit.ts), a jednoczesnie byly kolumnami FK
-- z `on delete set null`. Czyli BAZA byla drugim pisarzem pol hasha: zwykle
-- `DELETE /single-documents/:id` albo kasowanie czatow w `lib/rodo/forget.ts`
-- przepisywalo je na NULL w kazdym dotknietym wierszu audytu BEZ przeliczenia
-- hasha - i zrywalo lancuch. `scripts/verify-audit-chain.ts` raportuje takie
-- zerwanie slowo w slowo tak samo jak celowa modyfikacje wpisu, wiec dowod
-- z AI Act art. 12 stawal sie nieodroznialny od sladu ataku.
--
-- Dlaczego DROP, a nie `on delete no action`: `no action` zostawia FK, wiec
-- kasowanie dokumentu zaczeloby sie WYWALAC bledem integralnosci zamiast po
-- cichu psuc lancuch. Rejestr append-only nie jest dzieckiem czatu ani dokumentu;
-- te kolumny to zdenormalizowany slad historyczny i maja prawo wskazywac na
-- obiekt juz nieistniejacy. Warstwa SQLite (desktop) trzyma je jako gole `text`
-- od poczatku - ta migracja zrownuje Postgres z zachowaniem, ktore desktop ma juz
-- dzis, a nie odwrotnie.
--
-- ZAKRES NAPRAWY: migracja zapobiega PRZYSZLYM zerwaniom. Lancuchow zerwanych
-- wczesniej w trybie serwerowym NIE naprawia i naprawic sie nie da - hash liczy
-- sie z wartosci, ktorej juz nie ma. Audytor musi o tym oknie wiedziec; jest
-- opisane w CHANGELOG.md i w ADR-0164.
--
-- Nazwy constraintow nie sa zakladane z gory (inline `references` generuje
-- `<tabela>_<kolumna>_fkey`, ale reczna migracja moze nazwac inaczej) - DROP
-- idzie po `pg_constraint` dla kolumn, ktore nas obchodza. Idempotentna.

-- UP

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'public.audit_log'::regclass
      and c.contype = 'f'
      and a.attname in ('actor_user_id', 'chat_id', 'document_id')
    group by c.conname
  loop
    execute format('alter table public.audit_log drop constraint %I', con.conname);
  end loop;
end;
$$;

-- DOWN
-- Rollback PRZYWRACA defekt opisany wyzej (baza znow jest drugim pisarzem pol
-- hasha). Stosowac wylacznie w oknie maintenance i tylko po to, zeby odtworzyc
-- stan sprzed 020 - nie jako "bezpieczny powrot".
--
-- Uwaga: ADD CONSTRAINT waliduje istniejace wiersze, wiec rollback PADNIE, jesli
-- w audit_log sa juz wskazania na usuniete czaty/dokumenty (a po 020 to stan
-- normalny). Wtedy najpierw wyzeruj te kolumny - co samo w sobie zerwie lancuch.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_log_actor_user_id_fkey'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint audit_log_actor_user_id_fkey
      foreign key (actor_user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_log_chat_id_fkey'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint audit_log_chat_id_fkey
      foreign key (chat_id) references public.chats(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_log_document_id_fkey'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint audit_log_document_id_fkey
      foreign key (document_id) references public.documents(id) on delete set null;
  end if;
end;
$$;
