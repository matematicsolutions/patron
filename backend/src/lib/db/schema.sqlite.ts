// PATRON SQLite schema (single-user, zero-cloud desktop).
//
// Translacja z backend/schema.sql (Postgres/Supabase). Mapowanie typow:
//   uuid         -> TEXT (UUID string, generowany w shimie przy insert)
//   jsonb        -> TEXT (JSON string; shim parsuje/serializuje per kolumna)
//   timestamptz  -> TEXT (ISO 8601; shim wypelnia created_at/updated_at)
//   bigserial    -> INTEGER PRIMARY KEY AUTOINCREMENT
//   boolean      -> INTEGER (0/1)
//
// Roznice swiadome (governance, ADR SQLite single-user):
//   - FK do auth.users(...) USUNIETE (brak GoTrue; single-user app_users).
//   - Regex CHECK (`~ '^[0-9a-f]{64}$'`) USUNIETE (SQLite nie ma operatora ~;
//     format hash/checksum gwarantuje kod: computeAuditHash = sha256 hex).
//   - `= any(array[...])` -> `in (...)`. event_type whitelist (IN) ZACHOWANA
//     - lustro CHECK z Postgresa, twarda bramka governance (ADR-0035).
//   - GIN index na jsonb (shared_with) USUNIETY (filtr po stronie aplikacji).
//   - Trigger handle_new_user USUNIETY (profil seedowany przy bootstrapie).
//   - documents.current_version_id = plain TEXT bez FK (cykl documents<->versions;
//     w Postgresie rozbity przez ALTER, tu zarzadzany przez aplikacje).
//   - `revoke ... from anon, authenticated` POMINIETE (brak rol Postgresa).

export const SQLITE_SCHEMA = `
-- Single-user identity (zastepuje auth.users z GoTrue). Jeden wiersz seedowany
-- przy bootstrapie. listUsers/getUserById/getUser czytaja z tej tabeli.
create table if not exists app_users (
  id          text primary key,
  email       text not null,
  display_name text,
  created_at  text not null
);

create table if not exists user_profiles (
  id text primary key,
  user_id text not null unique,
  display_name text,
  organisation text,
  tier text not null default 'Free',
  message_credits_used integer not null default 0,
  credits_reset_date text not null,
  tabular_model text not null default 'gemini-3-flash-preview',
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_user_profiles_user on user_profiles(user_id);

create table if not exists user_api_keys (
  id text primary key,
  user_id text not null,
  provider text not null check (provider in ('claude', 'gemini', 'openai', 'openrouter')),
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  created_at text not null,
  updated_at text not null,
  unique(user_id, provider)
);
create index if not exists idx_user_api_keys_user on user_api_keys(user_id);

create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  cm_number text,
  visibility text not null default 'private',
  shared_with text not null default '[]',
  -- ADR-0067: klasyfikacja danych sprawy (straznik data-residency).
  -- Default fail-closed: 'attorney_client_privileged' (tajemnica -> tylko model
  -- lokalny). Mecenas swiadomie obniza poziom, by uzyc modelu chmurowego.
  -- Lustro enum: lib/llm/provider.ts DataClassification + provider.schema.ts.
  classification text not null default 'attorney_client_privileged'
    check (classification in ('public','internal','client_general','attorney_client_privileged')),
  -- ADR-0117 (audyt P2 #6): swiadoma zgoda Operatora na model chmurowy DLA TEJ
  -- SPRAWY (per-sprawa, audytowana), niezaleznie od globalnego
  -- PATRON_ALLOW_PRIVILEGED_CLOUD. 0 = brak zgody (fail-closed). Brama egress
  -- (lib/routing/guard.ts) OR-uje to z globalna zgoda.
  cloud_consent integer not null default 0,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_projects_user on projects(user_id);

create table if not exists project_subfolders (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  name text not null,
  parent_folder_id text references project_subfolders(id) on delete cascade,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_project_subfolders_project on project_subfolders(project_id);

create table if not exists documents (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  user_id text not null,
  filename text not null,
  file_type text,
  size_bytes integer not null default 0,
  page_count integer,
  structure_tree text,
  status text not null default 'pending',
  folder_id text references project_subfolders(id) on delete set null,
  current_version_id text,
  security_status text not null default 'pending'
    check (security_status in ('pending', 'allowed', 'quarantined', 'human_review', 'blocked')),
  security_report_id text,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_documents_user_project on documents(user_id, project_id);
create index if not exists idx_documents_project_folder on documents(project_id, folder_id);

create table if not exists document_versions (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  storage_path text not null,
  pdf_storage_path text,
  source text not null default 'upload'
    check (source in ('upload','user_upload','assistant_edit','user_accept','user_reject','generated')),
  version_number integer,
  display_name text,
  created_at text not null
);
create index if not exists document_versions_document_id_idx on document_versions(document_id, created_at desc);
create index if not exists document_versions_doc_vnum_idx on document_versions(document_id, version_number);

create table if not exists chats (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  user_id text not null,
  title text,
  created_at text not null
);
create index if not exists idx_chats_user on chats(user_id);
create index if not exists idx_chats_project on chats(project_id);

create table if not exists chat_messages (
  id text primary key,
  chat_id text not null references chats(id) on delete cascade,
  role text not null,
  content text,
  files text,
  annotations text,
  created_at text not null
);
create index if not exists idx_chat_messages_chat on chat_messages(chat_id);

create table if not exists document_edits (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  chat_message_id text references chat_messages(id) on delete set null,
  version_id text not null references document_versions(id) on delete cascade,
  change_id text not null,
  del_w_id text,
  ins_w_id text,
  deleted_text text not null default '',
  inserted_text text not null default '',
  context_before text,
  context_after text,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  created_at text not null,
  resolved_at text
);
create index if not exists document_edits_document_id_idx on document_edits(document_id, created_at desc);
create index if not exists document_edits_message_id_idx on document_edits(chat_message_id);
create index if not exists document_edits_version_id_idx on document_edits(version_id);

create table if not exists workflows (
  id text primary key,
  user_id text,
  title text not null,
  type text not null,
  prompt_md text,
  columns_config text,
  practice text,
  is_system integer not null default 0,
  created_at text not null
);
create index if not exists idx_workflows_user on workflows(user_id);

create table if not exists hidden_workflows (
  id text primary key,
  user_id text not null,
  workflow_id text not null,
  created_at text not null,
  unique(user_id, workflow_id)
);
create index if not exists idx_hidden_workflows_user on hidden_workflows(user_id);

create table if not exists workflow_shares (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  shared_by_user_id text not null,
  shared_with_email text not null,
  allow_edit integer not null default 0,
  created_at text not null,
  unique(workflow_id, shared_with_email)
);
create index if not exists workflow_shares_workflow_id_idx on workflow_shares(workflow_id);
create index if not exists workflow_shares_email_idx on workflow_shares(shared_with_email);

create table if not exists tabular_reviews (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  user_id text not null,
  title text,
  columns_config text,
  document_ids text,
  workflow_id text references workflows(id) on delete set null,
  practice text,
  shared_with text not null default '[]',
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_tabular_reviews_user on tabular_reviews(user_id);
create index if not exists idx_tabular_reviews_project on tabular_reviews(project_id);

create table if not exists tabular_cells (
  id text primary key,
  review_id text not null references tabular_reviews(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  column_index integer not null,
  content text,
  citations text,
  status text not null default 'pending',
  created_at text not null
);
create index if not exists idx_tabular_cells_review on tabular_cells(review_id, document_id, column_index);

create table if not exists tabular_review_chats (
  id text primary key,
  review_id text not null references tabular_reviews(id) on delete cascade,
  user_id text not null,
  title text,
  created_at text not null,
  updated_at text not null
);
create index if not exists tabular_review_chats_review_idx on tabular_review_chats(review_id, updated_at desc);
create index if not exists tabular_review_chats_user_idx on tabular_review_chats(user_id);

create table if not exists tabular_review_chat_messages (
  id text primary key,
  chat_id text not null references tabular_review_chats(id) on delete cascade,
  role text not null,
  content text,
  annotations text,
  created_at text not null
);
create index if not exists tabular_review_chat_messages_chat_idx on tabular_review_chat_messages(chat_id, created_at);

-- Audit trail hash-chain (AI Act art. 12 + RODO art. 32). Append-only.
-- id = INTEGER AUTOINCREMENT (zastepuje bigserial). event_type whitelist (IN)
-- jest lustrem CHECK z Postgresa - twarda bramka governance (ADR-0035).
create table if not exists audit_log (
  id integer primary key autoincrement,
  ts text not null,
  actor_user_id text,
  event_type text not null check (event_type in (
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
  )),
  chat_id text,
  document_id text,
  payload text not null,
  prev_hash text not null,
  hash text not null unique
);
create index if not exists idx_audit_log_chat on audit_log(chat_id, ts);
create index if not exists idx_audit_log_actor on audit_log(actor_user_id, ts);
create index if not exists idx_audit_log_event_type on audit_log(event_type, ts);

create table if not exists audit_merkle_roots (
  id integer primary key autoincrement,
  chain_block_start integer not null,
  chain_block_end integer not null,
  merkle_root text not null,
  event_count integer not null,
  computed_at text not null,
  computed_by text not null,
  check (chain_block_start <= chain_block_end),
  check (event_count > 0 and event_count = chain_block_end - chain_block_start + 1)
);
create index if not exists idx_audit_merkle_roots_block on audit_merkle_roots(chain_block_start, chain_block_end);
create index if not exists idx_audit_merkle_roots_computed_at on audit_merkle_roots(computed_at);

create table if not exists schema_migrations (
  id text primary key,
  name text not null,
  applied_at text not null,
  checksum text not null
);

-- ---------------------------------------------------------------------------
-- Hybrid retrieval RAG + graf cytowan (ADR-0007 + ADR-0008, adaptacja na
-- SQLite w ADR-0054). Wektor = vec0 (sqlite-vec), BM25 = FTS5 - obie virtual
-- tables tworzone w kodzie (sqlite-connection) po load extension. Ponizej
-- tabele relacyjne.
-- ---------------------------------------------------------------------------

-- Fragmenty dokumentu do retrievalu. id = rowid w vec0/FTS5 (1:1).
create table if not exists doc_chunks (
  id integer primary key autoincrement,
  document_id text not null,
  chunk_index integer not null,
  content text not null,
  embedding_model text,
  -- Proweniencja strony zrodla (audyt P2 #10). Wypelniane gdy tekst niesie
  -- markery [Page N] (ekstrakcja PDF, lib/chat/pdf.ts); null dla zrodel bez
  -- stron (docx/plain). Pozwala cytowac "str. N".
  page_no integer,
  -- ADR-0124 (Route B): surowy span chunka w tekscie zrodlowym (UTF-16, end
  -- exclusive) do exact lokatora search-time. Nullable - stare chunki maja
  -- NULL do re-indeksu (feed robi fallback best-effort).
  source_offset_start integer,
  source_offset_end integer,
  created_at text not null
);
create index if not exists idx_doc_chunks_document on doc_chunks(document_id);

-- Metadane warstwy retrievalu (audyt P2 #8). Klucz->wartosc; trzymamy model i
-- wymiar embeddera, ktorym zbudowano vec_chunks. Niezgodnosc przy starcie =
-- wykrycie zamiast cichej korupcji wektorow (mismatch wymiaru / modelu).
create table if not exists retrieval_meta (
  key   text primary key,
  value text not null
);

-- Encje wykryte deterministycznie (ADR-0008, extractEntitiesAndEdges).
-- Osobny cykl retencji RODO art. 17 (PII typy: PESEL/NIP/REGON/KRS/EMAIL/PHONE).
create table if not exists extracted_entities (
  id text primary key,
  document_id text not null,
  entity_type text not null,
  value text not null,
  value_normalized text not null,
  confidence real not null,
  source_offset_start integer,
  source_offset_end integer,
  rule_id text,
  metadata text,
  source text not null default 'auto'
    check (source in ('auto', 'manual', 'pseudonim')),
  created_at text not null
);
create index if not exists idx_extracted_entities_doc on extracted_entities(document_id);
create index if not exists idx_extracted_entities_norm on extracted_entities(value_normalized, entity_type);

-- Graf cytowan (ADR-0007). Krawedzie dokument -> dokument/encja. Backlink
-- count (ile dokumentow wskazuje cel) zasila boost rankingu retrievalu.
create table if not exists citation_graph (
  id text primary key,
  from_doc_id text not null,
  to_doc_id text,
  to_entity_id text,
  relation text not null,
  confidence real not null,
  source_entity_id text,
  -- ADR-0125 (T2.1 KGLF): governance krawedzi. Auto-ekstrakcja (ADR-0008) wpisuje
  -- 'proposed'/'analysis'/run_id=null (propozycja globalna, widoczna, nieratyfikowana).
  -- Ratyfikacja (akt ludzki) ustawia 'ratified' + ratified_by/at. DEFAULT 'proposed'
  -- /'analysis' -> istniejace auto-krawedzie po migracji pozostaja widoczne (run_id null).
  status text not null default 'proposed',
  origin text not null default 'analysis',
  run_id text,
  ratified_by text,
  ratified_at text,
  extracted_at text not null
);
create index if not exists idx_citation_graph_from on citation_graph(from_doc_id);
create index if not exists idx_citation_graph_to_entity on citation_graph(to_entity_id);
create index if not exists idx_citation_graph_to_doc on citation_graph(to_doc_id);
create index if not exists idx_citation_graph_relation on citation_graph(relation);

-- ---------------------------------------------------------------------------
-- Event-centric KG (ADR-0089, Faza C). Zdarzenia jako wezly (ramki rol) +
-- krawedzie typowane rolami (strona/czyn/data/kwota/podstawa). Pochodna encji
-- (ADR-0008) + bliskosci w tekscie, deterministyczna, zero LLM. Zyja w tym
-- samym pliku SQLite objetym at-rest (ADR-0072). create-if-not-exists =
-- automatyczny upgrade istniejacych baz (db.exec(SQLITE_SCHEMA) przy starcie,
-- desktop bez runnera migracji).
-- ---------------------------------------------------------------------------

-- Wezel zdarzenia = jedna ramka rol wspolwystepujacych w obrebie okna tekstu.
create table if not exists events (
  id integer primary key autoincrement,
  document_id text not null,
  frame_index integer not null,
  span_start integer not null,
  span_end integer not null,
  created_at text not null
);
create index if not exists idx_events_document on events(document_id);

-- Krawedzie typowane rolami: rola (strona/czyn/data/kwota/podstawa) -> wartosc.
create table if not exists event_roles (
  id integer primary key autoincrement,
  event_id integer not null,
  role text not null,
  value_normalized text not null,
  created_at text not null,
  foreign key (event_id) references events(id) on delete cascade
);
create index if not exists idx_event_roles_event on event_roles(event_id);
create index if not exists idx_event_roles_value on event_roles(value_normalized);

-- Biblioteka umiejetnosci (ADR-0094). Stan zainstalowanych skilli-paczek
-- (manifest = JSON tekst). Skille WBUDOWANE (etapy obrony) NIE sa tu - loader
-- trzyma je jako read-only deskryptory i scala z lista zainstalowanych.
create table if not exists installed_skills (
  id           text primary key,
  name         text not null,
  version      text not null,
  surface      text not null,
  source       text not null default 'local-file',
  egress       text not null default 'no-egress',
  manifest     text not null,
  enabled      integer not null default 1,
  installed_at text not null,
  updated_at   text not null
);
create index if not exists idx_installed_skills_enabled on installed_skills(enabled);
`;
