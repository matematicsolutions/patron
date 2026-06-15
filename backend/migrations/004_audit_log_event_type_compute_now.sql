-- Migration 004: rozszerzenie whitelist event_type o admin.access.merkle_compute_now.
-- ADR-0048 (governance/adr/0048-merkle-compute-now-ui.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 003):
--   admin.access.merkle_compute_now   ADR-0048  routes/audit.ts POST /merkle/compute-now
--
-- Use case: audytor UODO klika "Pobierz audit pack" -> 404 brak Merkle root
-- pokrywajacego event -> drugi button "Wymus compute root" -> POST endpoint
-- wywoluje runAutoCompute z thresholdami 1/0 (bypass auto-trigger ADR-0036).
-- Endpoint loguje meta-event do audit_log per ADR-0043 (kto kiedy wymusil
-- compute - dowod ze administrator/audytor swiadomie ominal trigger
-- automatyczny) - dlatego wymagana whitelist.

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

  -- ADD constraint z rozszerzona whitelist (12 starych + 1 nowa = 13)
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
      -- nowa w migracji 004 (ADR-0048)
      'admin.access.merkle_compute_now'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 003 (12 wartosci).
-- UWAGA: po rollback wszystkie nowe wstawienia z event_type
-- admin.access.merkle_compute_now dostana ERROR z CHECK constraint. Endpoint
-- POST /api/audit/merkle/compute-now moze rzucac 500 - uruchom tylko w
-- windowie maintenance z jednoczesnym redeployem starszej wersji backendu.

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
      'admin.access.audit_export'
    ));
end;
$$;
