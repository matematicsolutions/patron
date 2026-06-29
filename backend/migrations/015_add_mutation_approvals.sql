-- Migration 015: tabela mutation_approvals (karty zatwierdzenia mutacji, tryb serwerowy).
-- ADR-0137 (governance/adr/0137-mutation-approval-cards-human-in-the-loop.md).
-- Format UP/DOWN per ADR-0038.
--
-- Lustro tabeli z SQLITE_SCHEMA (tryb desktop single-user). Kolejka akcji agenta
-- o skutkach ubocznych (edit/generate/comments/export) stage'owanych za bramka
-- czlowieka (AI Act art. 14). Stany pending -> approved | rejected; po approved
-- wykonanie i znacznik executed_at / execution_error. tool_payload = argumenty
-- narzedzia do wykonania PO zatwierdzeniu (bez pelnych tresci dokumentu - RODO
-- minimalizacja). Scoping user_id (jak projects).
--
-- Whitelist event_type audit_log rozszerza osobna migracja 016 (precedens
-- 014: tabela i CHECK rozdzielone na dwie migracje).

-- UP

create table if not exists public.mutation_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  chat_id uuid references public.chats(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  tool_name text not null,
  tool_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  staged_at timestamptz not null default now(),
  staged_by text not null,
  approved_at timestamptz,
  approved_by text,
  rejection_reason text,
  executed_at timestamptz,
  execution_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mutation_approvals_user_status
  on public.mutation_approvals(user_id, status);
create index if not exists idx_mutation_approvals_chat
  on public.mutation_approvals(chat_id);
create index if not exists idx_mutation_approvals_document
  on public.mutation_approvals(document_id);

-- DOWN

drop table if exists public.mutation_approvals;
