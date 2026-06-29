-- Migration 016: rozszerzenie whitelist event_type o mutation.approval.decision.
-- ADR-0137 (governance/adr/0137-mutation-approval-cards-human-in-the-loop.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 014):
--   mutation.approval.decision   ADR-0137   routes/approvals.ts POST /:id/approve|reject
--
-- Use case: czlowiek (mecenas) zatwierdza/odrzuca karte zatwierdzenia mutacji
-- agenta (human-in-the-loop write staging). Akt nadzoru nad zapisem agenta ->
-- musi byc audytowany (kto/kiedy/typ narzedzia/decyzja/id karty, bez pelnego
-- payloadu). AI Act art. 14 (nadzor) + art. 12 (record-keeping).
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

  -- ADD constraint z rozszerzona whitelist (19 starych + 1 nowa = 20)
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

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 014 (19 wartosci).
-- UWAGA: po rollback wstawienia z event_type mutation.approval.decision dostana
-- ERROR z CHECK. Uruchom tylko w windowie maintenance z redeployem.

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
      'connector.toggle'
    ));
end;
$$;
