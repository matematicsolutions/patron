-- Migration 011: tabela installed_skills (Biblioteka umiejetnosci, tryb serwerowy).
-- ADR-0094 (governance/adr/0094-kontrakt-paczki-skilla.md).
-- Format UP/DOWN per ADR-0038.
--
-- Lustro tabeli z SQLITE_SCHEMA (tryb desktop single-user). W trybie serwerowym
-- (Postgres) przechowuje stan zainstalowanych skilli-paczek na poziomie instancji
-- (jak zainstalowane wtyczki, nie dane per-user). Skille WBUDOWANE (etapy obrony)
-- NIE sa tu - loader trzyma je jako read-only deskryptory i scala z lista.
--
-- manifest jsonb = pelny manifest paczki (id/name/version/surface/prompt/egress/...).

-- UP

create table if not exists installed_skills (
  id           text primary key,
  name         text not null,
  version      text not null,
  surface      text not null,
  source       text not null default 'local-file',
  egress       text not null default 'no-egress',
  manifest     jsonb not null,
  enabled      boolean not null default true,
  installed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_installed_skills_enabled on installed_skills(enabled);

-- DOWN

drop table if exists installed_skills;
