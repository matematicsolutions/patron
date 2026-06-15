-- Migration 012: rozszerzenie whitelist event_type o project.cloud_consent.
-- ADR-0128 (governance/adr/0128-zgoda-chmura-per-sprawa-audyt.md), audyt P2 #6.
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 009):
--   project.cloud_consent   ADR-0128   routes/projects.ts PATCH /:id/cloud-consent
--
-- Use case: Operator wlacza/wylacza swiadoma zgode na model chmurowy DLA TEJ
-- SPRAWY (per-sprawa, niezaleznie od globalnego PATRON_ALLOW_PRIVILEGED_CLOUD).
-- Decyzja zmienia brame egress (lib/routing/guard.ts) -> musi byc audytowana
-- (kto/kiedy/ktora sprawa/stan, bez tresci). AI Act art. 12.
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

  -- ADD constraint z rozszerzona whitelist (17 starych + 1 nowa = 18)
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

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 009 (17 wartosci).
-- UWAGA: po rollback wstawienia z event_type project.cloud_consent dostana ERROR
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
      'tabular.grounding'
    ));
end;
$$;
