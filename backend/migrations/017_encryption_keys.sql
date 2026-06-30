-- Migration 017: tabela encryption_keys (field-level encryption, tryb serwerowy).
-- ADR-0138 (governance/adr/0138-field-level-encryption-per-tenant-dek.md).
-- Format UP/DOWN per ADR-0038.
--
-- Lustro tabeli z SQLITE_SCHEMA (tryb desktop single-user). Envelope encryption:
-- DEK (data-encryption-key) owiniety przez KEK (key-encryption-key) i przechowywany
-- TYLKO jako `wrapped_dek` (fc1:iv:ct:tag) - sam material DEK nigdy nie leży w
-- bazie plaintext. Per-tenant (serwer: DEK per organization/user; desktop: 1 wiersz
-- LOCAL_USER_ID). `kek_version` do re-wrap przy rotacji KEK (US3).
--
-- Numeracja: 015/016 zarezerwowane przez spec 004 (mutation approval cards) na
-- branchu feat/mutation-approval-cards; 017 unika kolizji przy przyszlym merge.

-- UP

create table if not exists public.encryption_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  wrapped_dek text not null,
  kek_version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists idx_encryption_keys_tenant
  on public.encryption_keys(tenant_id);

-- DOWN

drop table if exists public.encryption_keys;
