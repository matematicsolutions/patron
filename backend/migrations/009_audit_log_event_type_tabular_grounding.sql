-- Migration 009: rozszerzenie whitelist event_type o tabular.grounding.
-- ADR-0082 (governance/adr/0082-grounding-tabular-audit-hash-chain.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 008):
--   tabular.grounding   ADR-0082   routes/tabular.ts generate + regenerate-cell
--
-- Use case: ekstrakcja tabular review weryfikuje cytaty inline komorek wzgledem
-- dokumentu (ADR-0080), ale werdykt zyl tylko na komorce (mutowalny). Teraz kazdy
-- przebieg generacji loguje rollup werdyktu (liczby: cytaty/zweryfikowane/
-- zmodyfikowane/niezweryfikowane, bez tresci cytatu) -> niezmienny slad w
-- hash-chain (AI Act art. 12, dowod nalezytej starannosci anty-halucynacja).
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

  -- ADD constraint z rozszerzona whitelist (16 starych + 1 nowa = 17)
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
      'document.edit_resolved',
      'tabular.grounding'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 008 (16 wartosci).
-- UWAGA: po rollback nowe wstawienia z event_type tabular.grounding dostana
-- ERROR z CHECK constraint. Generacja tabular loguje to przy kazdym przebiegu -
-- audit append zwroci blad (nie blokuje sciezki produktowej, ale audyt bedzie
-- niepelny). Uruchom tylko w windowie maintenance z redeployem.

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
      'defense.pipeline.run',
      'document.edit_resolved'
    ));
end;
$$;
