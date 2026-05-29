-- Migration 005: rozszerzenie whitelist event_type o llm_route.
-- ADR-0067 (governance/adr/0067-governance-routingu-llm-data-residency.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 004):
--   llm_route   ADR-0067   lib/chat/stream.ts -> lib/routing/auditLlmRoute.ts
--
-- Use case: kazde wywolanie LLM przechodzi przez straznika data-residency
-- (lib/routing/decideRoute). Decyzja (allow/block), wybrany model, strefa
-- egress, klasyfikacja danych sprawy, realny koszt i latencja sa logowane
-- jako zdarzenie audit_log "llm_route" - dowod nalezytej starannosci
-- (AI Act art. 12) i egzekwowanie tajemnicy zawodowej (Pr.Adw. art. 6).
--
-- PostgreSQL nie obsluguje ALTER CONSTRAINT ... CHECK - strategia DROP + ADD
-- w jednej transakcji. Idempotent: sprawdzenie pg_constraint przed operacja.

-- UP

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'audit_log_event_type_whitelist'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      drop constraint audit_log_event_type_whitelist;
  end if;

  -- ADD constraint z rozszerzona whitelist (13 starych + 1 nowa = 14)
  alter table public.audit_log
    add constraint audit_log_event_type_whitelist
    check (event_type in (
      -- z migracji 001 (ADR-0035)
      'chat.message.user',
      'chat.message.assistant',
      'input_security_scan',
      'mcp_security.gateway',
      'ring_policy.decision',
      'rodo.delete',
      'rodo.export',
      -- z migracji 002 (ADR-0043)
      'admin.access.audit_viewer',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      -- z migracji 003 (ADR-0047)
      'admin.access.audit_export',
      -- z migracji 004 (ADR-0048)
      'admin.access.merkle_compute_now',
      -- nowa w migracji 005 (ADR-0067)
      'llm_route'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 004 (13 wartosci).
-- UWAGA: po rollback wszystkie nowe wstawienia z event_type llm_route dostana
-- ERROR z CHECK constraint. Sciezka czatu (lib/chat/stream.ts) loguje to
-- zdarzenie przy kazdym wywolaniu - po rollbacku audit append zwroci blad
-- (zdarzenie nie blokuje sciezki produktowej, ale audyt bedzie niepelny).
-- Uruchom tylko w windowie maintenance z redeployem starszej wersji backendu.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'audit_log_event_type_whitelist'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      drop constraint audit_log_event_type_whitelist;
  end if;

  alter table public.audit_log
    add constraint audit_log_event_type_whitelist
    check (event_type in (
      'chat.message.user',
      'chat.message.assistant',
      'input_security_scan',
      'mcp_security.gateway',
      'ring_policy.decision',
      'rodo.delete',
      'rodo.export',
      'admin.access.audit_viewer',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      'admin.access.audit_export',
      'admin.access.merkle_compute_now'
    ));
end;
$$;
