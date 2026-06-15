-- Migration 002: rozszerzenie whitelist event_type o admin.access.* i migrate.rollback.
-- ADR-0043 (governance/adr/0043-audit-log-admin-access.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowe wartosci (do listy z migracji 001):
--   admin.access.audit_viewer    ADR-0040  routes/audit.ts GET /log
--   admin.access.security_banner ADR-0042  routes/security.ts GET /mcp-status
--   admin.access.metrics         ADR-0037  routes/metrics.ts GET / (whitelisted IP)
--   migrate.rollback             ADR-0038  scripts/migrate-rollback.ts (rezerwacja)
--
-- PostgreSQL nie obsluguje ALTER CONSTRAINT ... CHECK - wymagana strategia
-- DROP + ADD w jednej transakcji. Idempotent: sprawdzenie pg_constraint
-- przed kazda operacja.
--
-- Existing deployments z wpisami spoza nowej whitelist: ADD CONSTRAINT FAIL.
-- Patrz query diagnostyczna w komentarzu migracji 001.

-- UP

do $$
begin
  -- DROP istniejacy constraint (jezeli istnieje)
  if exists (
    select 1
    from pg_constraint
    where conname = 'audit_log_event_type_whitelist'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      drop constraint audit_log_event_type_whitelist;
  end if;

  -- ADD constraint z rozszerzona whitelist (7 starych + 4 nowe = 11)
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
      -- nowe w migracji 002 (ADR-0043)
      'admin.access.audit_viewer',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 001 (7 wartosci).
-- UWAGA: po rollback wszystkie nowe wstawienia z event_type admin.access.* /
-- migrate.rollback dostana ERROR z CHECK constraint. Aplikacja moze rzucac
-- 500 dla endpoints ktore te logi pisza - uruchom tylko w windowie maintenance
-- z jednoczesnym redeployem starszej wersji backendu.

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
      'rodo.export'
    ));
end;
$$;
