# ADR-0134: Poliglotyczny runtime konektorow MCP (Node + Python) - bundling konektorow nie-Node

**Status**: Proponowany (2026-06-24) — wymaga 2x wewnetrznego review + akceptacji WM. Dotyka bundlingu desktop + warstwy MCP.

## Kontekst

ADR-0133 (picker konektorow) zaklada rozszerzenie zaufanego zestawu o konektory UE.
Recon 2026-06-24 wykryl twardy blocker: **9 konektorow UE (`~/Projects/*-eli-mcp`)
to czysty Python** (fastmcp, `requires-python >=3.11`, console-script), a desktop
PATRONa bundluje **tylko Node**:
- `desktop/scripts/prepare-resources.cjs` stage'uje `mcp-bundled/<name>/dist/index.js`,
- `lib/mcp/index.ts::resolveStdioSpawn` podmienia `command === "node"` na Electron
  `execPath` (na maszynie klienta nie ma zewnetrznego node),
- `mcp-servers.example.json` uzywa `command: "node"`, args `dist/index.js`.

W instalatorze Electron nie ma runtime'u Pythona. Wynik: konektor Python nie da sie
zbundlowac/uruchomic w desktopie. To blokuje cala oś jurysdykcji UE z ADR-0133.

## Decyzja

1. **Konfiguracja konektora staje sie poliglotyczna.** Pole `runtime?: "node" |
   "python"` (domyslnie `node` - back-compat dla 6 obecnych). Runtime opisuje, jak
   konektor jest bundlowany/uruchamiany; **NIE** zmienia kontraktu MCP ani trust.
2. **Spawn konektora jest generyczny.** `resolveStdioSpawn`:
   - dla bare `command === "node"` pod Electronem -> swap na `execPath` (jak dotad),
   - dla `command` bedacego **wzgledna sciezka** do artefaktu (zawiera separator) ->
     rozwiazanie wzgledem `BACKEND_ROOT` (dziala dla frozen-exe i innych artefaktow),
   - args `.js` oraz `.py` (wzgledne) rozwiazywane wzgledem `BACKEND_ROOT`.
3. **Desktop bundluje konektory Python jako samodzielne frozen-exe (PyInstaller).**
   Zero wspoldzielonego runtime'u Pythona, zero `uvx`, zero sieci -> **zero-cloud i
   offline zachowane**. Frozen-exe stage'owany w `mcp-bundled/<name>/`, `command`
   wskazuje na niego (wzgledna sciezka rozwiazywana jak w pkt 2).
4. **Trust jest runtime-agnostyczny.** KAZDY konektor (Node czy Python) musi przejsc
   **MCP Security Gateway** (typosquat/drift/hidden-instructions/tool-poisoning) zanim
   trafi do `APPROVED_PATRON_CONNECTORS`. Runtime != zaufanie. Dodanie nazwy do
   allowlisty bez gateway-scan jest zakazane (ADR-0133).
5. **Tryb serwerowy** uruchamia konektory Python natywnie (docker/proces) - bez
   freezowania. Frozen-exe dotyczy tylko bundla desktop.

## Konsekwencje

**Pozytywne:**
- Warstwa MCP przestaje byc Node-only - konektory UE staja sie bundlowalne bez
  przepisywania na Node (9 portow odpada).
- Zero-cloud/offline zachowane (frozen-exe lokalny, brak sieci/uvx).
- Picker (ADR-0133) juz grupuje wg jurysdykcji - konektory UE pojawia sie automatycznie
  po zbundlowaniu + gateway-scan + dodaniu do APPROVED.

**Koszt / pozostala praca (per konektor UE):**
1. Freeze PyInstaller -> samodzielny exe (build-pipeline; wymaga srodowiska Python).
2. **Gateway-scan** zywych definicji toolow (connect + listTools + scanMcpRegistry) -
   allowed-clean PRZED zaufaniem.
3. Sync nazwy w 3 miejscach (APPROVED_PATRON_CONNECTORS / prepare-resources.cjs
   MCP_SERVERS / mcp-servers.example.json).
4. Stage frozen-exe w prepare-resources.cjs (rozszerzenie o `runtime: "python"`).
5. Konektory z kluczem (FR-PISTE OAuth) - setup klucza (reuse wzorca kluczy API).

## Alternatywy odrzucone

| Alternatywa | Powod |
|---|---|
| `uvx`-at-runtime | Wymaga Pythona + `uv` + **sieci** na maszynie mecenasa -> lamie zero-cloud/offline (teza PATRONa). Off-principle. |
| Embed wspoldzielonego runtime Pythona | Ciezsze (wersjonowanie interpretera, wieksza powierzchnia), wspoldzielony stan miedzy konektorami. Frozen-exe per konektor jest czystsze i izolowane. |
| Port 9 konektorow UE na Node/TS | Najwiekszy koszt (9 przepisan), duplikacja dzialajacego kodu Python. Trzymane jako opcja awaryjna, nie domyslna. |

## Powiazania

- ADR-0133 (picker konektorow - oś jurysdykcji), ADR-0091 (bundling desktop),
  ADR-0027 (ring-policy), ADR-0028 (MCP Security Gateway).
- Spec: `.matematic/spec/002-mcp-connector-picker/` (US2).
- Wątek Tier-3 packaging (PyPI/uvx) dla konektorow Python.
