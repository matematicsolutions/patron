-- Migration 013: projects.cloud_consent (zgoda na model chmurowy per-sprawa).
-- ADR-0117 (governance/adr/0117-zgoda-chmura-per-sprawa-audyt.md), audyt P2 #6.
-- Format UP/DOWN per ADR-0038.
--
-- Swiadoma, audytowana zgoda Operatora na model chmurowy DLA TEJ SPRAWY,
-- niezaleznie od globalnego PATRON_ALLOW_PRIVILEGED_CLOUD. Brama egress
-- (lib/routing/guard.ts) OR-uje to z globalna zgoda. Default false (fail-closed):
-- istniejace sprawy pozostaja bez zgody na chmure.

-- UP

alter table public.projects
  add column if not exists cloud_consent boolean not null default false;

-- DOWN

alter table public.projects
  drop column if exists cloud_consent;
