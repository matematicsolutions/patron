-- Migration 020: nowy event_type `deliverable.bundle_export` (ADR-0152).
-- Format UP/DOWN per ADR-0038. Pelna lista, nie "ostatnia dodana" - tak jak 019.
--
-- Po co nowy typ: eksport pakietu dowodowego dla deliverable (audit-bundle,
-- ADR-0066) wynosi z kancelarii TRESC dokumentu koncowego wraz z dowodem, jak
-- powstal. Istniejacy `admin.access.audit_export` opisuje co innego - admina
-- wynoszacego pojedyncze zdarzenie z dziennika (ADR-0047). Dwa rozne akty,
-- dwa rozne wpisy; sklejenie ich zatarloby slad w audycie.
--
-- Whitelist ma PIEC luster (AGENTS.md): audit.ts, schema.sql, schema.sqlite.ts,
-- najnowsza migracja Postgres (ta), najnowszy rebuild SQLite (v6).
-- Test db/event-type-parity.test.ts padnie przy kazdym rozjezdzie.
--
-- Idempotentna (DROP + ADD w jednej transakcji).

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

  -- ADD constraint z pelna whitelist (22 wartosci = lustro audit.ts)
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
      'connector.toggle',
      'mutation.approval.decision',
      'cost_cap',
      'deliverable.bundle_export'
    ));
end;
$$;

-- DOWN
-- Rollback = lista z migracji 019 (21 wartosci, bez deliverable.bundle_export).
-- UWAGA: po rollback eksport pakietu deliverable odbije sie od CHECK, a sama
-- funkcja zostanie w kodzie - okno maintenance albo rownolegly rollback aplikacji.

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
      'project.cloud_consent',
      'connector.toggle',
      'mutation.approval.decision',
      'cost_cap'
    ));
end;
$$;
