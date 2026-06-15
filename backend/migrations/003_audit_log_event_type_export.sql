-- Migration 003: rozszerzenie whitelist event_type o admin.access.audit_export.
-- ADR-0047 (governance/adr/0047-audit-pack-export.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 002):
--   admin.access.audit_export   ADR-0047  routes/audit.ts GET /export/:eventId
--
-- Audytor pobiera samowystarczalny audit pack (event + Merkle proof + SHA256
-- integrity). Endpoint loguje meta-event do audit_log per ADR-0043
-- (kto kiedy wynosil dowod compliance) - dlatego wymagana whitelist.
--
-- PostgreSQL nie obsluguje ALTER CONSTRAINT ... CHECK - wymagana strategia
-- DROP + ADD w jednej transakcji. Idempotent: sprawdzenie pg_constraint
-- przed kazda operacja.

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

  -- ADD constraint z rozszerzona whitelist (11 starych + 1 nowa = 12)
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
      -- nowa w migracji 003 (ADR-0047)
      'admin.access.audit_export'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 002 (11 wartosci).
-- UWAGA: po rollback wszystkie nowe wstawienia z event_type
-- admin.access.audit_export dostana ERROR z CHECK constraint. Endpoint
-- GET /api/audit/export/:eventId moze rzucac 500 - uruchom tylko w windowie
-- maintenance z jednoczesnym redeployem starszej wersji backendu.

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
      'migrate.rollback'
    ));
end;
$$;
