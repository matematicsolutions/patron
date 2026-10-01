-- Migration 025: SUMA obu linii po scaleniu, +1 event_type `audit.chain.legal_break`
-- (ADR-0164; numeracja ADR-0163). Format UP/DOWN per ADR-0038.
--
-- Powod: RODO art. 17 kaze zanonimizowac aktora (scripts/rodo-delete.ts zeruje
-- `actor_user_id`), a to pole WCHODZI DO HASHA - wiec wykonanie obowiazku
-- prawnego nieuchronnie zrywa lancuch. Bez nazwanego zdarzenia weryfikator
-- raportuje ten skutek dokladnie tak samo jak sabotaz. To zdarzenie nazywa
-- zerwanie: powod, pole, zakres id i licznik, bez danych osobowych.
--
-- Migracja 024 (zdjecie FK) usuwa przyczyne kaskadowa, ale NIE te - anonimizacja
-- jest jawnym UPDATE-em i ma zostac. Dlatego obie migracje ida razem.
--
-- NUMER I LISTA: na linii feat/design-system-2-0 byla to migracja 021 z lista BEZ
-- `deliverable.bundle_export` (typ linii publicznej, migracja 020 w 1.3.0). Puszczona
-- po 020 zdjelaby ten typ z CHECK, a eksport pakietu dowodowego (fail-closed na
-- zapisie audytu) przestalby dzialac. Dlatego tu jest PELNA suma obu linii
-- (24 wartosci = lustro EVENT_TYPES w backend/src/lib/audit.ts po scaleniu), a DOWN
-- wraca do listy z 023 (fork_acknowledged, ADR-0161), nie z 019. Idempotentna (DROP + ADD w jednej transakcji).
-- Kolejny nowy event_type = NOWA migracja z PELNA lista.

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

  -- ADD constraint z pelna whitelist (24 wartosci = lustro schema.sql)
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
      'audit.chain.fork_acknowledged',
      'audit.chain.legal_break'
    ));
end;
$$;

-- DOWN
-- Rollback = lista z migracji 023 (23 wartosci, bez audit.chain.legal_break).
-- UWAGA: po rollbacku zapis zdarzenia o przerwaniu lancucha z mocy prawa dostanie
-- ERROR z CHECK, wiec anonimizacja RODO znow bedzie zrywac lancuch BEZ SLADU -
-- czyli wroci dokladnie ten stan, ktory ADR-0164 nazywa defektem. Tylko w oknie
-- maintenance.

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
      'deliverable.bundle_export',
      'audit.chain.fork_acknowledged'
    ));
end;
$$;
