-- Migration 018: human-review komorki tabular_cells (akt prawnika, art.12).
-- ADR-0126 (governance/adr/0126-tabular-cell-human-review.md).
-- Format UP/DOWN per ADR-0038.
--
-- Komorka tabular review dostaje warstwe ludzkiej weryfikacji (komplementarna
-- do `status` processing i `grounding` mechanicznego, ADR-0080): prawnik
-- akceptuje / odrzuca / poprawia WYNIK ekstrakcji (governance #2). Per-cell
-- kto/co/kiedy = record-keeping AI Act art. 12.
--   review_action     null = nieweryfikowana; 'approved'|'rejected'|'corrected'
--   reviewed_by       actorId odpowiedzialnego prawnika
--   reviewed_at       czas weryfikacji
--   corrected_content tresc poprawiona (tylko dla 'corrected')
-- Wszystkie nullable -> istniejace komorki pozostaja nieweryfikowane (bez regresji).
-- (Desktop SQLite: kolumny dokladane idempotentnie w lib/db/sqlite-connection.ts
--  ensureSchemaUpgrades - ten plik dotyczy sciezki Postgres/Supabase.)

-- UP

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tabular_cells'
      and column_name = 'review_action'
  ) then
    alter table public.tabular_cells add column review_action text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tabular_cells'
      and column_name = 'reviewed_by'
  ) then
    alter table public.tabular_cells add column reviewed_by text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tabular_cells'
      and column_name = 'reviewed_at'
  ) then
    alter table public.tabular_cells add column reviewed_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tabular_cells'
      and column_name = 'corrected_content'
  ) then
    alter table public.tabular_cells add column corrected_content text;
  end if;
end;
$$;

-- DOWN
-- Usuwa kolumny human-review. Bezpieczne: brak innych obiektow zaleznych
-- (kolumny czysto opisowe). Uruchom z redeployem starszej wersji backendu.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tabular_cells'
      and column_name = 'review_action'
  ) then
    alter table public.tabular_cells drop column review_action;
    alter table public.tabular_cells drop column reviewed_by;
    alter table public.tabular_cells drop column reviewed_at;
    alter table public.tabular_cells drop column corrected_content;
  end if;
end;
$$;
