# AGENTS.md - Patron

Plik standardu [agents.md](https://agents.md) (Linux Foundation / Agentic AI Foundation) - kanoniczne instrukcje dla agentow AI pracujacych z tym repozytorium. Czytany natywnie przez Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf (Cognition), Aider, Amp, Factory, GitHub Copilot i kolejne narzedzia z [oficjalnej listy](https://agents.md/#supported-tools).

> **Dla agenta:** jezeli zmieniasz cokolwiek w tym repo, zacznij od przeczytania trzech plikow w kolejnosci: ten plik (AGENTS.md), [governance/CONSTITUTION.md](./governance/CONSTITUTION.md), [README.md](./README.md). To nie jest formalnosc - Patron jest produktem governance, nie zwyklym kodem.

## Cel projektu

Patron to **lokalny RODO-safe agent AI dla polskiej kancelarii prawnej**. Aplikacja desktop (Electron) zero-cloud, single-user: domyslnie lokalny SQLite ([ADR-0053](./governance/adr/0053-sqlite-single-user-zero-cloud.md)) + 6 konektorow MCP polskiego i unijnego prawa, audit trail z hash-chain (AI Act art. 12), bring-your-own-model (Gemini / Claude / Ollama lokalny / OpenRouter). Tryb serwerowy (Postgres + MinIO + Supabase) pozostaje jako alternatywa. Forka [willchen96/mike](https://github.com/willchen96/mike) (MIT) na powloce AGPL-3.0 - patrz [ADR-0002](./governance/adr/0002-dual-license-agpl-shell-mit-connectors.md).

## Kontekst MateMatic (TWARDE OGRANICZENIA)

Repo prowadzi [MateMatic Solutions](https://matematicsolutions.com). Patron jest **produktem regulowanym** - dotyczy go:

- **Tajemnica zawodowa adwokacka / radcowska** (PoA art. 6, URP art. 3) - bezwzgledna. Patron nie wysyla aktow sprawy do chmury bez zgody Operatora ([Konstytucja](./governance/CONSTITUTION.md) Art. 2).
- **RODO art. 5/25/30/32** - minimalizacja, privacy by design, rejestr czynnosci, bezpieczenstwo. Schemat danych (lokalny SQLite w trybie desktop - ADR-0053; Postgres `backend/schema.sql` w trybie serwerowym) jest projektowany pod art. 30 i 32.
- **AI Act art. 6 (high-risk AI w prawie, od 2026-08-02)** + **art. 12 (record-keeping)** - kazda interakcja LLM jest logowana z hash-chainem (ADR-0001).
- **Neutralnosc wobec dostawcow** ([Konstytucja](./governance/CONSTITUTION.md) Art. 4) - Patron nie faworyzuje zadnego LLM ani providera. NIE wprowadzaj zaleznosci od jednego providera w kodzie powloki.

## Build i test

```bash
# Backend (Node 20+, TypeScript)
cd backend && npm install && npm run build && npm test

# Frontend (Next.js)
cd frontend && npm install && npm run build && npm test

# Bundle 6 konektorow MCP do obrazu backendu (tryb SERWEROWY / docker)
node scripts/bundle-mcp.cjs

# Bundle 6 konektorow MCP + model embeddera do instalatora DESKTOP (Electron)
# odbywa sie w prepare-resources.cjs (stageMcpConnectors + stageEmbedModel),
# wymaga 6 zbudowanych repo mcp-* obok patron/ (MCP_REPOS_DIR, default `..`).
# Patrz ADR-0100. Dodajac konektor, zsynchronizuj jego nazwe w TRZECH miejscach:
# backend/src/lib/mcp-security/pipeline.ts (APPROVED_PATRON_CONNECTORS),
# desktop/scripts/prepare-resources.cjs (MCP_SERVERS) i mcp-servers.example.json -
# rozjazd nazw = bramka typosquat + ring-policy blokuja WLASNY konektor (ADR-0027/0028).
cd desktop && npm run build

# Pelny stack (Docker, wymaga Supabase + MinIO osobno)
cp .env.docker.example .env.docker
# (uzupelnij sekrety)
docker compose --env-file .env.docker up -d
```

Testy: 1265/1270 pass (5 todo, 0 fail) na 2026-06-14. TSC clean (backend + frontend). **Nie commituj jezeli testy fail** - bramka jakosci z [Konstytucja](./governance/CONSTITUTION.md) Art. 7.

## Zasady kodu

- **TypeScript strict**. Bez `any` w nowym kodzie, bez `// @ts-ignore` bez komentarza dlaczego.
- **Audit-first** - kazda nowa interakcja z LLM przechodzi przez `backend/src/lib/audit/` (hash-chain). Bypass = blad krytyczny.
- **Pseudonim/anonimizacja** - dane wrazliwe (PESEL/imie/nazwisko/adres) przechodza przez `backend/src/lib/pl-entities/` PRZED wyslaniem do LLM. Patrz [ADR-0003](./governance/adr/0003-hey-jude-pseudonim-pipeline.md).
- **Input security** - dokumenty wejsciowe (PDF/DOCX/TXT) przechodza przez `backend/src/lib/input-security/` (prompt-injection / steganografia / homoglify / evasion) PRZED indeksacja RAG. Oba szwy uploadu (single-document i projektowy) dziela JEDNA funkcje `backend/src/lib/documentIngest.ts` - nie kopiuj logiki ingestu, importuj ja. Patrz [ADR-0019](./governance/adr/0019-input-document-security-pipeline-pl.md) + [ADR-0020](./governance/adr/0020-wpiecie-input-security-w-ingest.md) + [ADR-0055](./governance/adr/0055-parytet-skanu-input-security-sciezka-projektowa.md).
- **MCP security gateway** - definicje konektorow MCP przechodza przez `backend/src/lib/mcp-security/` (typosquat / drift / hidden-instructions / tool-poisoning) PRZED registracja toolow w runtime. Decyzja `denied`/`human_review` blokuje wpiecie. Decyzje inne niz `allowed-clean` propaguja sie do audit hash-chain (`event_type = "mcp_security.gateway"`) przez `backend/src/lib/mcp/audit-bridge.ts`. Patrz [ADR-0025](./governance/adr/0025-mcp-security-gateway-wdrazenie.md) + [ADR-0028](./governance/adr/0028-wpiecie-mcp-security-gateway-w-startup.md) + [ADR-0033](./governance/adr/0033-propagacja-mcp-security-do-audit-hash-chain.md).
- **Merkle audit chain** - nad istniejacym hash-chain (ADR-0001) zbudowane jest drzewo Merkle (RFC 6962). Audytor dostaje proof-of-inclusion w O(log n) zamiast O(n) lancucha. Tabela `audit_merkle_roots` (block_start, block_end, merkle_root, event_count). 3 moduly w `backend/src/lib/`: `audit-merkle.ts` (pure functions), `audit-merkle-roots.ts` (storage layer, nie modyfikuje audit_log), `audit-merkle-verifier.ts` (offline verifier dla audytora). Manualny trigger w tej iteracji (compute root przy administratorze kancelarii); automatyzacja + UI viewer = rezerwacja ADR-0036; RFC 3161 timestamping = rezerwacja ADR-0037. Patrz [ADR-0026](./governance/adr/0026-merkle-audit-chain-upgrade.md).
- **i18n** - tlumaczenia w `frontend/messages/`. Slownik PRZED komponenty.
- **Bez polskich znakow w commit messages** - konwencja organizacji (a -> a, e -> e, l -> l, o -> o, s -> s, n -> n, c -> c, z -> z).
- **ADR przed kazda nietrwialnaa decyzja architektoniczna** - `governance/adr/NNNN-slug.md`. wewnetrzny review tresci 2x runda PRZED merge.

## Czego NIE robic (twarde reguly)

- **NIE dodawaj LLM provider w core path bez ADR.** Patron jest vendor-neutral by design.
- **NIE wysylaj danych klienta kancelarii do US.** Transfer poza EOG wymaga DPA + DPF i decyzji Administratora (rola z [Konstytucja](./governance/CONSTITUTION.md)).
- **NIE wylaczaj audit trail** ani jego weryfikacji hash-chain. To jest jedyny dowod compliance.
- **NIE forkuj struktury polskich entities** (PESEL/NIP/REGON/sygnatury) - sa w `backend/src/lib/pl-entities/` jako shared library z testami.
- **NIE commituj** node_modules / dist / .env / dump bazy.

## Zrodla prawdy (kolejnosc czytania)

1. [README.md](./README.md) - opis dla ludzi
2. [governance/CONSTITUTION.md](./governance/CONSTITUTION.md) - 9 zasad, role, audyt (v1.6.1, podpisywana przez kancelarie)
3. [governance/IMPLEMENTATION_PLAYBOOK.md](./governance/IMPLEMENTATION_PLAYBOOK.md) - 6-8 tyg wdrozenia, RACI
4. [governance/adr/](./governance/adr/) - Architecture Decision Records (0001-0130)
5. [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md) - co cherry-pickowalismy i skad (Mike, Lavern, gbrain, isaacus/tabular-review, PII-Shield, earendil/pi, awesome-llm-apps)
6. [CHANGELOG.md](./CHANGELOG.md), [SECURITY.md](./SECURITY.md), [CONTRIBUTING.md](./CONTRIBUTING.md)

## Kompatybilnosc agentow

Ten plik (AGENTS.md) jest standardem [agents.md](https://agents.md) wspieranym przez **Linux Foundation / Agentic AI Foundation**. Czytany natywnie przez 20+ narzedzi.

Dla Claude Code dodatkowo istnieje plik [CLAUDE.md](./CLAUDE.md) ktory importuje ten dokument (`@AGENTS.md`).

Dla agentow uruchamianych w kontenerach: pelny `AGENTS.md` ma byc obecny w obrazie backendu (skopiuj w Dockerfile).

## Licencja i atrybucja

- **Powloka** (`backend/`, `frontend/`, `deploy/`, `governance/`, `scripts/`) - **AGPL-3.0**. Patrz [LICENSE](./LICENSE) i [NOTICE](./NOTICE).
- **6 konektorow MCP** (osobne repo `mcp-*`) - **MIT**.
- Cherry-pick i atrybucje: [THIRD_PARTY_INSPIRATIONS.md](./THIRD_PARTY_INSPIRATIONS.md).

Cytowanie: *MateMatic Solutions (2026), Patron - lokalny agent AI dla polskiej kancelarii, https://github.com/matematicsolutions/patron, AGPL-3.0.*
