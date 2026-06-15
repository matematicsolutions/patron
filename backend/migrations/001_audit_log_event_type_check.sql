-- Migration 001: CHECK constraint na public.audit_log.event_type (whitelist).
-- ADR-0035 (governance/adr/0035-migration-infra-event-type-check.md).
-- Format UP/DOWN dodany w ADR-0038 (governance/adr/0038-migration-down-rollback.md).
--
-- Whitelist 7 produkcyjnych event_type. Dodawanie nowego event_type wymaga
-- osobnej migracji + ADR. Wartosci wytypowane przez grep `appendAuditEvent`
-- w `backend/src/` (poza testami) na 2026-05-28:
--
--   chat.message.user        ADR-0001  routes/chat.ts, routes/projectChat.ts
--   chat.message.assistant   ADR-0001  routes/chat.ts, routes/projectChat.ts
--   input_security_scan      ADR-0020  routes/documents.ts via lib/input-security/ingest.ts
--   mcp_security.gateway     ADR-0033  lib/mcp/audit-bridge.ts
--   ring_policy.decision     ADR-0027  lib/mcp/audit-bridge.ts (callsite z lib/mcp/index.ts)
--   rodo.delete              RODO 17   scripts/rodo-delete.ts
--   rodo.export              RODO 20   scripts/rodo-export.ts
--
-- Rezerwacje (chat.created, tool.call, entities.extracted) NIE sa w CHECK -
-- udokumentowane w komentarzu lib/audit.ts jako kandydaci do przyszlych migracji.
--
-- Idempotent: sprawdzenie pg_constraint przed ADD. Bezpieczne do powtornego
-- uruchomienia na deployment'cie ktory juz ma constraint.
--
-- Existing deployments z wpisami spoza whitelist: ADD CONSTRAINT FAIL z
-- czytelnym komunikatem. Operator kancelarii uruchamia query diagnostyczne
-- przed migracja: select distinct event_type from audit_log order by 1;

-- UP

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_log_event_type_whitelist'
      and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint audit_log_event_type_whitelist
      check (event_type in (
        'chat.message.user',
        'chat.message.assistant',
        'input_security_scan',
        'mcp_security.gateway',
        'ring_policy.decision',
        'rodo.delete',
        'rodo.export'
      ));
  end if;
end;
$$;

-- DOWN
-- Idempotent rollback - DROP CONSTRAINT IF EXISTS pozwala na re-run bez bledu.
-- UWAGA: po rollback wszystkie nowe wstawienia do audit_log dostana wolny text
-- bez walidacji whitelist; warstwa TypeScript (EventType union w lib/audit.ts)
-- nadal chroni przed bledami dewelopera, ale runtime bypass (raw SQL, mock
-- supabase) przejdzie. Uruchom tylko w windowie maintenance.

alter table public.audit_log
  drop constraint if exists audit_log_event_type_whitelist;
