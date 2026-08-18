-- Migration 019: PARYTET whitelist event_type - przywrocenie `cost_cap` (ADR-0093).
-- Plan 2.0.0 pkt 5 (pomiar 2026-08-18, test parytetu event-type-parity.test.ts).
-- Format UP/DOWN per ADR-0038.
--
-- Rozjazd: migracja 010 dodala 'cost_cap', ale kolejne migracje 012 / 014 / 016
-- (kazda = DROP + ADD pelnej listy) budowaly liste bez niej. Po zastosowaniu
-- 001..018 w kolejnosci Postgres ma 20 wartosci (bez cost_cap), swiezy schema.sql
-- ma 21. Wstawienie zdarzenia cost_cap na bazie migrowanej konczy sie ERROR z CHECK
-- (a migracje konczyly sie sukcesem - cicha niekompletnosc).
--
-- Ta migracja NIE dodaje nowego typu: doprowadza CHECK do pelnego lustra
-- EVENT_TYPES (backend/src/lib/audit.ts) = 21 wartosci na dzien 2026-08-18.
-- Idempotentna (DROP + ADD w jednej transakcji).
--
-- Kolejny nowy event_type = NOWA migracja z PELNA lista (skopiuj te i dopisz);
-- test parytetu porownuje najnowsza migracje z audit.ts / schema.sql /
-- schema.sqlite.ts / migrate.sqlite.ts i padnie przy kazdym rozjezdzie.

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

  -- ADD constraint z pelna whitelist (21 wartosci = lustro schema.sql)
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

-- DOWN
-- Rollback = lista z migracji 016 (20 wartosci, bez cost_cap). UWAGA: po rollback
-- zdarzenia cost_cap znow dostana ERROR z CHECK - tylko w oknie maintenance.

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
      'mutation.approval.decision'
    ));
end;
$$;
