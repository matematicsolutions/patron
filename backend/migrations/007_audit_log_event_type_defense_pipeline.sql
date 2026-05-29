-- Migration 007: rozszerzenie whitelist event_type o defense.pipeline.run.
-- ADR-0068 (governance/adr/0068-hardening-draft-refine-pipeline-obrony.md).
-- Format UP/DOWN per ADR-0038.
--
-- Nowa wartosc (do listy z migracji 005):
--   defense.pipeline.run   ADR-0068   routes/draft.ts POST /draft/refine
--
-- Use case: pipeline obrony (Recenzent / Adwokat diabla / Pisz po ludzku) robi
-- do 3 wywolan LLM na drogich modelach. Dotad bez sladu w audit_log. Teraz kazde
-- uruchomienie loguje kto/kiedy/etapy/model/klasyfikacja high-stakes/czas (bez
-- tresci draftu) - dowod nalezytej starannosci AI Act art. 12 + objecie pipeline
-- lancuchem Merkle.
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

  -- ADD constraint z rozszerzona whitelist (14 starych + 1 nowa = 15)
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

-- DOWN
-- Idempotent rollback - przywracamy whitelist z migracji 005 (14 wartosci).
-- UWAGA: po rollback nowe wstawienia z event_type defense.pipeline.run dostana
-- ERROR z CHECK constraint. Endpoint POST /draft/refine loguje to przy kazdym
-- uruchomieniu - audit append zwroci blad (nie blokuje sciezki produktowej, ale
-- audyt bedzie niepelny). Uruchom tylko w windowie maintenance z redeployem.

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
      'llm_route'
    ));
end;
$$;
