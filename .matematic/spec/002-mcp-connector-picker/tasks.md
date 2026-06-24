# Tasks: Wybor konektorow MCP przez mecenasa + zestaw UE

**Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md) · **ADR:** 0133
Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (rozne pliki).

## Phase 1 — Setup
- [ ] T001 Branch `feat/mcp-connector-picker` off aktualnego `main`.
- [ ] T002 ADR-0133 -> przeglad 2x + akceptacja WM (jest jako Proponowany).
- [ ] T003 Rozstrzygnac Q1 (reload vs restart) i Q2 (gdzie picker w UI) — dopisac do plan.

## Phase 2 — Foundational (BLOKUJE US1/US2)
- [ ] T004 Zrodlo stanu `enabled`: config (`mcp-servers.json`) vs tabela (jak `installed_skills`). Decyzja + ewent. migracja SQLite.
- [ ] T005 Nowy `event_type` audytu `connector.toggle` + wpiecie w hash-chain (wzor: `mcp_security.gateway` przez `audit-bridge.ts`).
- [ ] T006 Mechanizm reloadu konektorow po zmianie (lub jawny komunikat "wymaga restartu").

## Phase 3 — US1 (P1, MVP): Picker UI nad obecnym zestawem
- [ ] T010 [US1] Backend: `GET /connectors` (lista z APPROVED + stan enabled + ring) i `POST /connectors/:name/toggle` (zapis + audit T005).
- [ ] T011 [US1] Backend: toggle tylko Ring 1; Ring 2 zwraca read-only/forbidden (respekt ring-policy).
- [ ] T012 [P] [US1] Frontend: panel/strona pickera (lista, toggle, stan).
- [ ] T013 [P] [US1] Frontend: `patronApi.ts` klient list/toggle.
- [ ] T014 [US1] Klucze i18n pickera w `pl.ts` + `en.ts` (en ⊆ pl wymuszone typem — ADR-0132).
- [ ] T015 [US1] Komunikat o wejsciu w zycie (restart/reload) wg T006.

**Checkpoint US1:** mecenas przelacza 6 zaufanych konektorow w UI; audyt zapisany; 3rd-party nieprzelaczalny.

## Phase 4 — US2 (P2): Rozszerzenie zaufanego zestawu o UE
- [ ] T020 [US2] Pilotaz (Q4): wybrac 1-2 kraje na start (rekom. DE keyless + FR z kluczem — oba profile).
- [ ] T021 [US2] Build wybranych repo UE (`~/Projects/<x>-eli-mcp`) + leak-scan.
- [ ] T022 [US2] **Gateway-scan kazdego** nowego konektora (allowed-clean) PRZED dopisaniem do APPROVED — twardy warunek.
- [ ] T023 [US2] Sync nazw w 3 miejscach: `pipeline.ts` APPROVED, `prepare-resources.cjs` MCP_SERVERS, `mcp-servers.example.json`.
- [ ] T024 [US2] Bundling (MCP_REPOS_DIR / kopiowanie repo UE do bundla).
- [ ] T025 [US2] Picker: grupowanie wg jurysdykcji (PL/DE/FR/...) + etykiety i18n.
- [ ] T026 [US2] Konektory z kluczem/korpusem (FR-PISTE, eu-compliance): stan "wymaga konfiguracji" (reuse wzorca kluczy API, Q5).
- [ ] T027 [US2] Startup-scan po dodaniu: oczekiwac allowed-clean dla wszystkich (test anty-typosquat-na-wlasnym).

**Checkpoint US2:** locale=DE + de-eli wlaczony -> agent cytuje prawo DE; gateway czysty.

## Phase 5 — US3 (P3): UX, reload, docs, audyt
- [ ] T030 [US3] Reload bez restartu (jesli wykonalne) lub czysty komunikat.
- [ ] T031 [P] [US3] AGENTS.md/README: procedura dodania konektora (3-sync + gateway).
- [ ] T032 [US3] tsc 0 (backend+frontend) + vitest backend bez regresji.
- [ ] T033 [US3] Audyt: weryfikacja propagacji `connector.toggle` do hash-chain.
- [ ] T034 [US3] `matematic-patron-pr-review-pl` na diffie (org scoping, authless, audit, ring) + bramka push WM.

## Parallel Opportunities
- T012 ‖ T013 (UI ‖ klient API).
- T021 ‖ (build repo UE niezalezne od UI).
- T031 ‖ T033 (docs ‖ audyt).

## Twarde nieusuwalne (z ADR-0133 / Constitution Check)
1. **Gateway dla KAZDEGO konektora UE** przed zaufaniem (T022) — picker nie moze obejsc skanu.
2. **Audyt kazdego toggla** (T005) — AI Act art.12.
3. **3rd-party = Ring 2 fail-closed**, Operator-only — nie udostepniac mecenasowi.
