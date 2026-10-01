-- Migration 023: nowy event_type `audit.chain.fork_acknowledged` (ADR-0161, wariant B).
-- Format UP/DOWN per ADR-0038. Pelna lista, nie "ostatnia dodana" - tak jak 019/020.
--
-- Po co: rozwidlenia lancucha audytu sprzed straznika (migracja 022) maja ogniwa
-- boczne, ktore sa liscmi - ich usuniecia nie wykryje zaden kolejny wpis. Operator
-- potwierdza je raz (`npm run audit:acknowledge-forks`): zdarzenie na glownej
-- sciezce niesie id i hashe tych ogniw, wiec ich usuniecie po potwierdzeniu
-- weryfikator widzi jako BLOKADE. Bez tresci zdarzen.
--
-- Whitelist ma PIEC luster (AGENTS.md): audit.ts, schema.sql, schema.sqlite.ts,
-- najnowsza migracja Postgres (ta), najnowszy rebuild SQLite (v7).
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

  -- ADD constraint z pelna whitelist (23 wartosci = lustro audit.ts)
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
      'deliverable.bundle_export',
      'audit.chain.fork_acknowledged'
    ));
end;
$$;

-- DOWN
-- Rollback = lista z migracji 020 (22 wartosci, bez audit.chain.fork_acknowledged).
-- UWAGA: zdarzenia tego typu juz zapisane nie przejda walidacji ADD CONSTRAINT -
-- rollback mozliwy tylko na bazie, w ktorej nikt jeszcze nie potwierdzil rozwidlen.

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
      'cost_cap',
      'deliverable.bundle_export'
    ));
end;
$$;

