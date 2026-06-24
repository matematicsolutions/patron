-- Migration 014: rozszerzenie whitelist event_type o connector.toggle.
-- ADR-0133 (governance/adr/0133-wybor-konektorow-mcp-przez-mecenasa-jurysdykcja.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 012):
--   connector.toggle   ADR-0133   routes/connectors.ts PATCH /:name
--
-- Use case: mecenas wlacza/wylacza konektor MCP przez picker (= wybor
-- jurysdykcji). Zmiana powierzchni narzedzi dostepnych agentowi -> musi byc
-- audytowana (kto/kiedy/ktory konektor/stan/ring, bez tresci). AI Act art. 12.
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

  -- ADD constraint z rozszerzona whitelist (18 starych + 1 nowa = 19)
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
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      'llm_route',
      'defense.pipeline.run',
      'document.edit_resolved',
      'tabular.grounding',
      'project.cloud_consent',
      'connector.toggle'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 012 (18 wartosci).
-- UWAGA: po rollback wstawienia z event_type connector.toggle dostana ERROR
-- z CHECK. Uruchom tylko w windowie maintenance z redeployem.

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
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      'llm_route',
      'defense.pipeline.run',
      'document.edit_resolved',
      'tabular.grounding',
      'project.cloud_consent'
    ));
end;
$$;
