-- Migration 010: rozszerzenie whitelist event_type o cost_cap.
-- ADR-0093 (governance/adr/0093-cost-caps-per-sprawa.md). US5 pilotaz-readiness.
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 009):
--   cost_cap   ADR-0093   lib/chat/stream.ts (PRZED guardEgress) + lib/routing/budget.ts
--
-- Use case: twardy cost-cap per sprawa (prog PATRON_CASE_COST_CAP_USD). Po
-- przekroczeniu progu wywolanie LLM jest blokowane, chyba ze operator swiadomie
-- nadpisze. Kazda decyzja (block/override) - sprawa, model, koszt skumulowany,
-- prog - to niezmienny slad w hash-chain (AI Act art. 12, dowod kontroli kosztu).
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
      'admin.access.security_banner',
      'admin.access.metrics',
      'migrate.rollback',
      'admin.access.audit_export',
      'admin.access.merkle_compute_now',
      'llm_route',
      'defense.pipeline.run',
      'document.edit_resolved',
      'tabular.grounding',
      'cost_cap'
    ));
end;
$$;

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 009 (17 wartosci).
-- UWAGA: po rollback nowe wstawienia z event_type cost_cap dostana ERROR z CHECK
-- constraint. Cost-cap loguje to przy bloku/override - audit append zwroci blad
-- (nie blokuje sciezki produktowej, ale audyt bedzie niepelny). Uruchom tylko
-- w windowie maintenance z redeployem.

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
      'document.edit_resolved',
      'tabular.grounding'
    ));
end;
$$;
