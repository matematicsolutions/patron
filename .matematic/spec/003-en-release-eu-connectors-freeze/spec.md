# Feature: Wydanie EN "15/15" - konektory UE offline + samouczek EN + podpis

**Branch:** `feat/en-release-eu-connectors` (off `release/v1.0.0-prep`)
**Date:** 2026-06-26
**Status:** Draft
**Project Type:** `desktop-app` / `agent-product`

## Problem statement

Spakowany instalator EN (`PATRON-Setup-Windows-EN.exe`) wyszedl z **6 konektorami Node**
(saos/nsa/isap/krs = PL-only + eu-sparql/eu-compliance = UE-zbiorcze). Spec 002 dodal 9
krajowych konektorow UE (de/at/es/fi/ie/nl/se/fr/lu-eli) do warstwy domeny: sa w
`APPROVED_PATRON_CONNECTORS` (pipeline.ts), w mapie jurysdykcji (connectors.ts:33-50) i w
`mcp-servers.example.json` z `runtime:"python"` + `uv run` (tryb dev/serwer). **AC2.3 z
spec 002 - bundle do instalatora - pozostal otwarty**, bo te konektory to Python, a
`stageMcpConnectors()` zaklada Node (`command:"node"`, `dist/index.js`). TODO jest wprost
w `desktop/scripts/prepare-resources.cjs:62-70` ("logika freeze nie zaimplementowana").

Skutek: niemiecki/francuski/hiszpanski prawnik dostaje EN UI + EN agenta, ale **zero
konektorow swojej jurysdykcji** w turnkey .exe. Dodatkowo domyslny zestaw EN promuje
konektory PL, nie UE - odwrotnie niz powinno dla odbiorcy miedzynarodowego.

Cel: jedno wydanie EN, w ktorym **9 konektorow UE jedzie w instalatorze offline**, picker
dla locale EN prowadzi **UE-first** (largest-first), instalator niesie **samouczek EN**, a
calosc jest gotowa pod **jeden podpis** SSL.com EV (akt WM).

## Decyzja packagingu (Opcja C - build-time bundled Python)

Rozwazono trzy sciezki dostarczenia 9 konektorow Python do desktopa:

| Opcja | Mechanizm | Werdykt |
|---|---|---|
| B1 | 9x PyInstaller frozen exe (osobny runtime per konektor) | ODRZUCONE: +135-270 MB (duplikacja Pythona x9), 9 specow freeze |
| B2 | `uvx` runtime fetch z PyPI (jak Boutique) | ODRZUCONE dla desktopa: wymaga sieci u prawnika (lamie offline), wersja runtime != skanowana przez Gateway (regres governance) |
| **C** | **build-time: 1 bundlowany standalone Python + `uv pip install` 9 konektorow (pinned, lockfile) do wspolnego site-packages, spawn przez `runtime:"python"`** | **WYBRANE** |

Opcja C bierze **te same paczki PyPI co Boutique** (jedna linia produkcyjna), ale rozwiazuje
je **przy buildzie**, nie u prawnika: offline + deterministyczne (Gateway skanuje te bajty,
ktore jada w paczce) + mniejsze (~40-90 MB, wspolny runtime). `uvx`/Boutique zostaje dla
**trybu serwerowego** PATRONa i dla samego Boutique (audytorium developerskie).

## Granica (governance)

| Co | Kto |
|---|---|
| Spec/plan/tasks, kod freeze/bundling, defaulty EN, samouczek EN (draft), scaffold podpisu | Agent |
| Zakup certyfikatu SSL.com EV (~1000 PLN/rok, koszt) | **WM** |
| Finalny build + `electron-builder --sign` + publikacja Release + ogloszenie | **WM** (akty nieodwracalne/zewnetrzne, Article VII konstytucji publikacji) |

## User Stories

### US1 (P1, MVP) - 9 konektorow UE offline w instalatorze (Opcja C)
**Jako** prawnik DE/FR/ES/... **chce** miec konektory mojej jurysdykcji w turnkey .exe
**zeby** PATRON gruntowal w prawie mojego kraju bez instalowania Pythona ani internetu.

**Acceptance Criteria:**
- [ ] AC1.1: Build stage'uje 1 standalone Python (python-build-standalone) do `dist-resources/backend/py-runtime/`.
- [ ] AC1.2: Build instaluje 9 konektorow (de/at/es/fi/ie/nl/se/fr/lu-eli) **pinned z lockfile** do wspolnego `dist-resources/backend/py-connectors/` (`uv pip install --target`, bez sieci w runtime).
- [ ] AC1.3: `prepare-resources.cjs` dostaje `stageBundledPython()` + sekcje `MCP_SERVERS_PYTHON`; 9 wpisow z `command` = bundlowany python, `args` = `["-m", "<modul>"]` (lub console-script), `runtime:"python"`, sciezki wzgledne rozwiazywane przez `resolveStdioSpawn` (ADR-0134).
- [ ] AC1.4: Trzecia synchronizacja nazw domkniecta - 9 konektorow obecnych w `prepare-resources.cjs` (do dzis tylko APPROVED + example.json); bramka typosquat/3-sync przechodzi.
- [ ] AC1.5: W zbudowanym .exe konektor (np. de-eli) spawnuje sie pod Electronem, `listTools` zwraca narzedzia, **bez systemowego Pythona i bez sieci** (test na czystej maszynie/VM).

**Independent Test:** instalacja EN .exe na czystym Windows bez Pythona, offline -> de-eli aktywny -> agent cytuje prawo DE z grounding.

### US2 (P2) - Defaulty i kolejnosc UE-first dla locale EN
**Jako** odbiorca miedzynarodowy **chce** widziec i miec wlaczone konektory UE jako pierwsze
**zeby** nie grzebac w PL-centrycznym zestawie.

**Acceptance Criteria:**
- [ ] AC2.1: Dla `LOCALE=en` domyslna kolejnosc w pickerze: **largest-first** DE > FR > ES > NL > SE > AT > FI > IE > LU, potem UE-zbiorcze, PL na koncu (lustro reguly Boutique EN "Polska na koncu").
- [ ] AC2.2: Dla `LOCALE=en` domyslnie **wlaczone** = UE keyless (DE/AT/ES/FI/IE/NL/SE/LU + eu-sparql); PL konektory **obecne ale domyslnie wylaczone** (prawnik moze wlaczyc).
- [ ] AC2.3: **FR-PISTE** obecny ale **NIE auto-on** - stan "wymaga klucza" (reuse wzorca kluczy API, AC2.5 z spec 002).
- [ ] AC2.4: Dla `LOCALE=pl` zachowanie **bez zmian** (PL-first, dzisiejsze defaulty).
- [ ] AC2.5: Kolejnosc/defaulty sa funkcja locale (nie hardcode globalny); jeden build = jeden locale (spojne z ADR-0132).

**Independent Test:** build z `NEXT_PUBLIC_PATRON_LOCALE=en` -> picker pokazuje DE na gorze, PL na dole; FR ma badge "wymaga klucza"; build PL niezmieniony.

### US3 (P2) - Samouczek EN w instalatorze
**Jako** prawnik EN **chce** samouczek w swoim jezyku **zeby** wdrozyc sie bez polskiego.

**Acceptance Criteria:**
- [ ] AC3.1: Powstaje `docs/SAMOUCZEK_EN.md` - tlumaczenie `docs/SAMOUCZEK.md` (kroki 1-7), przez bramki `reviewer-en` + `humanizer-en`.
- [ ] AC3.2: `stageDocs()` przy `LOCALE=en` pakuje `SAMOUCZEK_EN.md` (zamiast/obok PL), przy `LOCALE=pl` bez zmian.
- [ ] AC3.3: Odwolania do samouczka w UI (jesli sa) wskazuja wariant zgodny z locale.

**Independent Test:** build EN -> `dist-resources/backend/docs/` zawiera SAMOUCZEK_EN.md; build PL -> SAMOUCZEK.md.

### US4 (P3) - Proweniencja, podpis-scaffold, docs
- [ ] AC4.1: NOTICE / THIRD_PARTY_INSPIRATIONS uzupelnione o atrybucje **Apache-2.0** dla 9 konektorow eli (Article IV konstytucji publikacji; uwaga: rozni sie od "6 MIT").
- [ ] AC4.2: Scaffold podpisu: `desktop/package.json` `win.sign` + config eSigner (SSL.com EV) przygotowany, ale nieaktywny do czasu certu WM (dzis `win.sign:null`).
- [ ] AC4.3: AGENTS.md / README: jak dodac konektor Python do bundla (4-sync: APPROVED + example.json + prepare-resources MCP_SERVERS_PYTHON + lockfile).
- [ ] AC4.4: ADR-0136 (lub nast. wolny) - "Bundled Python runtime dla konektorow UE (Opcja C)".
- [ ] AC4.5: Leak-scan bundlowanych paczek py-connectors = 0 trafien (Article I) przed jakimkolwiek snapshotem/Release.
- [ ] AC4.6: `tsc` 0 (backend+frontend), vitest bez regresji, build EN przechodzi lokalnie.

## Non-Goals (anti-scope)
- NIE `uvx` runtime na maszynie prawnika (B2 odrzucone dla desktopa; zostaje dla serwera/Boutique).
- NIE 9x PyInstaller (B1 odrzucone).
- NIE zmiana MCP Security Gateway / ring-policy / modelu zaufania (picker dziala NAD nimi - spec 002).
- NIE marketplace konektorow / instalacja z URL w runtime.
- NIE per-sprawa rozne zestawy konektorow.
- NIE zakup certu ani finalny podpis/publikacja - to WM (granica governance).
- NIE natywne locale DE/FR agenta (substancja PL zostaje; osobny tor, ADR-0135).

## Open Questions / NEEDS CLARIFICATION
- [ ] Q1: python-build-standalone vs `uv python install` do osadzenia runtime - ktory daje relokowalny, offline, Windows-x64 artefakt o najmniejszym rozmiarze? (research w plan.md)
- [ ] Q2: Spawn przez `-m <modul>` z `PYTHONPATH=py-connectors` czy przez zainstalowane console-scripts? (relokowalnosc venv - wybrac niezalezna od sciezek absolutnych)
- [ ] Q3: Czy lockfile per konektor (9 pyproject) czy jeden wspolny constraints.txt dla calego py-connectors? (determinizm vs konflikty wersji deps)
- [ ] Q4: Rozmiar koncowy instalatora EN (dzis ~565-592 MB) + py-runtime + 9 deps - czy miescimy sie w limicie GitHub Release asset (2 GB)? (oszacowac)
- [ ] Q5: Czy defaulty/kolejnosc EN robimy w `prepare-resources.cjs` (build-time enabled) czy w warstwie pickera (frontend ordering) - czy oba? (US2 - prawdopodobnie oba: enabled build-time, ordering frontend locale-aware)
