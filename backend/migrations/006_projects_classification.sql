-- Migration 006: kolumna projects.classification (straznik data-residency).
-- ADR-0067 (governance/adr/0067-governance-routingu-llm-data-residency.md).
-- Format UP/DOWN per ADR-0038.
--
-- Kazda sprawa dostaje poziom klasyfikacji danych (DataClassification, ADR-0014):
--   public / internal / client_general / attorney_client_privileged.
-- Straznik decideRoute (lib/routing/) blokuje wyjscie tresci sprawy do strefy
-- egress niedozwolonej dla tej klasyfikacji. attorney_client_privileged
-- (tajemnica zawodowa) -> tylko model lokalny no-egress.
--
-- FAIL-CLOSED: default 'attorney_client_privileged'. Istniejace sprawy backfill
-- na tajemnice - mecenas swiadomie obniza poziom, by uzyc modelu chmurowego.
-- (Desktop SQLite: kolumna dokladana idempotentnie w lib/db/sqlite-connection.ts
--  ensureSchemaUpgrades - ten plik dotyczy sciezki Postgres/Supabase.)

-- UP

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'classification'
  ) then
    alter table public.projects
      add column classification text not null
        default 'attorney_client_privileged'
        check (classification in (
          'public', 'internal', 'client_general', 'attorney_client_privileged'
        ));
  end if;
end;
$$;

-- DOWN
-- Usuwa kolumne classification. UWAGA: straznik data-residency (lib/routing)
-- czyta te kolumne - po rollbacku resolveClassification spadnie na default
-- fail-closed w kodzie. Uruchom tylko z redeployem starszej wersji backendu.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'classification'
  ) then
    alter table public.projects drop column classification;
  end if;
end;
$$;
