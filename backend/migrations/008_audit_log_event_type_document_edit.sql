-- Migration 008: rozszerzenie whitelist event_type o document.edit_resolved.
-- ADR-0070 (governance/adr/0070-documents-hardening-skan-wersji-audit-edycji.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 007):
--   document.edit_resolved   ADR-0070   routes/documents.ts accept/reject tracked change
--
-- Use case: rozstrzygniecie tracked-change (accept/reject) nadpisuje bajty
-- dokumentu prawnego in-place (decyzja anty-churn - jeden row na edycje
-- asystenta, nie na klik). Dotad mutacja bez sladu w audit_log. Teraz kazde
-- rozstrzygniecie loguje kto/kiedy/ktora zmiana/tryb/wersja (bez tresci) ->
-- mutacja w hash-chain (AI Act art. 12).
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

  -- ADD constraint z rozszerzona whitelist (15 starych + 1 nowa = 16)
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
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'llm_route',
      'defense.pipeline.run',
      'document.edit_resolved'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 007 (15 wartosci).
-- UWAGA: po rollback nowe wstawienia z event_type document.edit_resolved dostana
-- ERROR z CHECK constraint. Accept/reject tracked-change loguje to przy kazdym
-- rozstrzygnieciu - audit append zwroci blad (nie blokuje sciezki produktowej,
-- ale audyt bedzie niepelny). Uruchom tylko w windowie maintenance z redeployem.

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
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'llm_route',
      'defense.pipeline.run'
    ));
end;
$$;
