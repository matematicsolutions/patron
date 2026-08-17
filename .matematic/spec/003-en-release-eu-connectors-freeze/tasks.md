# Tasks: Wydanie EN "15/15" - konektory UE offline (Opcja C)

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)
Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (rozne pliki, bez zaleznosci).

## Phase 1 - Setup
- [ ] T001 Branch `feat/en-release-eu-connectors` off `release/v1.0.0-prep`; backup ewent.
- [ ] T002 [P] Research Q1: python-build-standalone vs `uv python install` - wybor relokowalnego Windows-x64 runtime, zmierz rozmiar. Zapisz w `research.md`.
- [ ] T003 [P] Research Q3: jeden wspolny constraints.txt vs 9 lockfili - rozwiaz konflikty deps (httpx/lxml/fastmcp wersje). Zapisz w `research.md`.

## Phase 2 - Foundational (BLOKUJE US1)
- [ ] T004 ADR-0136: "Bundled Python runtime dla konektorow UE (Opcja C)" - decyzja, alternatywy B1/B2 odrzucone, relokowalnosc, determinizm/Gateway. (wewnetrzny review 2x przed merge)
- [ ] T005 Skrypt build-time: pobranie + osadzenie standalone Pythona do `desktop/dist-resources/backend/py-runtime/` (idempotentne, cache jak stageEmbedModel).
- [ ] T006 Skrypt build-time: `uv pip install --target py-connectors` 9 konektorow **pinned z lockfile/constraints** (offline-installable w runtime). Weryfikacja: `python -m <modul>` startuje z `PYTHONPATH=py-connectors`.
- [ ] T007 Weryfikacja `resolveStdioSpawn` (backend/src/lib/mcp/index.ts) dla `runtime:"python"` + sciezka wzgledna do bundlowanego pythona; test jednostkowy spawn-spec (bez realnego procesu).

## Phase 3 - US1 (P1, MVP) - 9 konektorow UE offline w instalatorze
- [ ] T010 [US1] `stageBundledPython()` w `prepare-resources.cjs` - wpina T005+T006 do pipeline'u prepare:resources.
- [ ] T011 [US1] Sekcja `MCP_SERVERS_PYTHON` (9 wpisow) w `prepare-resources.cjs`: `command`=bundlowany python, `args`=`["-m","<modul>"]`, `runtime:"python"`, `enabled` per locale (placeholder, finalnie US2). Domyka 3-sync (AC1.4).
- [ ] T012 [US1] Usun/zastap TODO `prepare-resources.cjs:62-70` realna implementacja; mustExist check na py-runtime + py-connectors (jak better-sqlite3 build check).
- [ ] T013 [US1] Build EN lokalnie -> 9 konektorow w `dist-resources`; bramka typosquat/3-sync (pipeline.ts) przechodzi dla wszystkich 15.
- [ ] T014 [US1] **Smoke offline na czystej VM** (Windows bez Pythona, bez sieci): instalacja .exe -> de-eli spawnuje, `listTools` OK, agent cytuje prawo DE. (AC1.5 - Independent Test)

**Checkpoint US1:** 15 konektorow w turnkey .exe, offline, bez systemowego Pythona. To samo w sobie domyka glowna luke wydania EN.

## Phase 4 - US2 (P2) - Defaulty i kolejnosc UE-first dla locale EN
- [ ] T020 [US2] Mapa kolejnosci largest-first dla locale EN (DE>FR>ES>NL>SE>AT>FI>IE>LU>UE-zbiorcze>PL) - tabela danych, jedno zrodlo prawdy.
- [ ] T021 [US2] Build-time `enabled` per locale w `MCP_SERVERS_PYTHON` (T011): EN -> UE keyless on, PL off; PL build -> bez zmian (AC2.2/AC2.4).
- [ ] T022 [P] [US2] FR-PISTE: `enabled:false` + stan "wymaga klucza" (reuse wzorca kluczy API z 002 AC2.5); badge w `getConnectorList()`/froncie.
- [ ] T023 [US2] Frontend picker: ordering locale-aware wg T020 (EN UE-first; PL niezmienione). Etykiety juz w pl.ts/en.ts (002).
- [ ] T024 [US2] Test: build `NEXT_PUBLIC_PATRON_LOCALE=en` -> DE na gorze, PL na dole, FR badge "wymaga klucza"; build PL niezmieniony (Independent Test).

**Checkpoint US2:** odbiorca EN dostaje UE-first; "wersja EN z polskimi konektorami" naprawione.

## Phase 5 - US3 (P2) - Samouczek EN
- [ ] T030 [P] [US3] `docs/SAMOUCZEK_EN.md` - tlumaczenie `docs/SAMOUCZEK.md` (kroki 1-7).
- [ ] T031 [US3] Bramki tresci: `reviewer-en` (werdykt >= ok) + `humanizer-en` (0 AI-tells) na SAMOUCZEK_EN.md.
- [ ] T032 [US3] `stageDocs()` locale-aware: LOCALE=en pakuje SAMOUCZEK_EN.md, LOCALE=pl pakuje SAMOUCZEK.md (AC3.2).
- [ ] T033 [P] [US3] Odwolania do samouczka w UI -> wariant wg locale (jesli istnieja).

## Phase 6 - US4 (P3) - Proweniencja, podpis-scaffold, docs
- [ ] T040 [P] [US4] NOTICE + THIRD_PARTY_INSPIRATIONS: atrybucja Apache-2.0 x9 eli + Python (PSF) + deps (Article IV).
- [ ] T041 [P] [US4] AGENTS.md/README: jak dodac konektor Python do bundla (4-sync + lockfile).
- [ ] T042 [US4] Scaffold podpisu w `desktop/package.json`: `win.sign` + config eSigner SSL.com EV, **nieaktywny** (komentarz: aktywuje WM po zakupie certu).
- [ ] T043 [US4] **Leak-scan py-connectors + caly bundle** (publication_gate) = 0 trafien (Article I, AC4.5) - PRZED jakimkolwiek snapshotem.
- [ ] T044 [US4] `tsc` 0 (backend+frontend) + vitest backend bez regresji (AC4.6).

## Phase 7 - Polish / Handoff do WM
- [ ] T050 Oszacuj rozmiar instalatora EN (py-runtime + 9 deps); potwierdz < limit GitHub Release (Q4).
- [ ] T051 `/mspec-analyze` - cross-artifact consistency (AC <-> taski, Constitution re-check).
- [ ] T052 **HANDOFF WM** (granica governance): checklist do podpisu - (a) zakup SSL.com EV, (b) aktywacja win.sign + build EN podpisany, (c) upload assetu na Release, (d) ogloszenie. Agent NIE wykonuje (Article VII).

## Parallel Opportunities
- Phase 1: T002 || T003 (rozne pliki research).
- Phase 5+6 niezalezne od US1/US2 po Foundational: T030 (samouczek), T040 (NOTICE), T041 (docs) moga isc rownolegle z Phase 3/4.
- T022 (FR badge) || reszta US2.
- Sekwencyjne (wspolny plik `prepare-resources.cjs`): T010 -> T011 -> T012 -> T013 oraz T021, T032 (ten sam plik) - NIE rownolegle miedzy soba.

## Sciezka krytyczna (MVP)
T001 -> T004 -> T005 -> T006 -> T007 -> T010 -> T011 -> T012 -> T013 -> T014 (Checkpoint US1).
Wszystko inne (US2/3/4) wisi na Foundational, ale US1 jako pierwszy daje ratowalna wartosc:
15 konektorow offline w buildzie EN, nawet jesli reszta sie poslizgnie.
