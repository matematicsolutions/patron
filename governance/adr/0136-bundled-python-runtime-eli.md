# ADR-0136: Bundled Python runtime dla konektorow UE (Opcja C)

**Status:** Przyjety
**Data:** 2026-06-26
**Kontekst spec:** `.matematic/spec/003-en-release-eu-connectors-freeze/`
**Powiazane:** ADR-0091 (staging instalatora), ADR-0100 (bundle konektorow),
ADR-0133 (picker jurysdykcji), ADR-0134 (poliglot runtime node|python),
ADR-0132 (locale per instalacja)

## Problem

9 krajowych konektorow UE (de/at/es/fi/ie/nl/se/fr/lu-eli) to Python (fastmcp),
zaufanych (APPROVED_PATRON_CONNECTORS) i obecnych w `mcp-servers.example.json`
(dev: `uv run`). Do instalatora desktop nie wchodzily - `stageMcpConnectors()`
zaklada Node (`dist/index.js`). Skutek: build EN mial 6 konektorow Node, zero
krajowych UE. Trzeba dostarczyc 9 Python do turnkey .exe, **offline** (Art. cel:
zero-cloud, RODO, brak systemowego Pythona u prawnika).

## Rozwazane opcje

| Opcja | Mechanizm | Wynik |
|---|---|---|
| B1 | 9x PyInstaller freeze (osobny exe per konektor) | Odrzucone: ~270 MB (runtime x9), 9 specow build |
| B2 | `uvx` runtime fetch z PyPI (jak Boutique) | Odrzucone dla desktopa: wymaga sieci u prawnika; wersja runtime != skanowana przez MCP Security Gateway |
| **C** | **1 bundlowany standalone CPython + `uv pip install` 9 do jego site-packages przy buildzie** | **Wybrane** |

## Decyzja

Opcja C. W `desktop/scripts/prepare-resources.cjs`:

1. `stageBundledPython()` kopiuje managed **python-build-standalone** (z `uv python
   dir`, relokowalny, self-contained) do `dist-resources/backend/py-runtime/`,
   usuwa marker `Lib/EXTERNALLY-MANAGED` (to nasza kopia) i instaluje 9 lokalnych
   repo eli przez `uv pip install --python py-runtime/python.exe` (jedno polecenie,
   wspolne deps raz; zrodlo = repo = to co na PyPI).
2. `writeMcpManifest()` laczy konektory Node + Python, ustala `enabled` i kolejnosc
   wg `LOCALE` (UE-first largest-first dla EN, PL-first dla PL).
3. Spawn (resolveStdioSpawn, ADR-0134, bez zmian w backendzie):
   `command: "py-runtime/python.exe"` (wzgledny -> rozwiazany do BACKEND_ROOT),
   `args: ["-s", "-E", "-c", "from <modul>.server import main; main()"]`.

`-s -E` jest **konieczne**: bez nich standalone CPython dociaga user-site
(`%APPDATA%\Python\...\site-packages`), gdzie moze siedziec starsza wersja `mcp`,
co lamie `fastmcp` (konflikt `Icon`). Z `-s -E` izolacja jest pelna.

## Konsekwencje

**Plus:**
- Offline + deterministyczne: Gateway skanuje te bajty, ktore jada w paczce (brak
  runtime-fetch -> brak okna na drift/typosquat-po-skanie).
- ~139 MB (runtime + 9 + deps), instalacja 9 w ~9 s przy buildzie. Lzejsze niz B1.
- Jedna linia produkcyjna wspolna z Boutique (te same paczki PyPI), `uvx` zostaje
  dla trybu serwerowego i Boutique.
- Zero zmian w backendzie - poliglot resolveStdioSpawn (ADR-0134) juz obsluguje
  wzgledny `command` z separatorem.

**Minus / dlug:**
- Instalator wiekszy o ~139 MB (takze build PL, bo bundel jest wspolny; escape
  hatch: `SKIP_PYTHON_CONNECTORS=1`).
- Wersje konektorow instalowane z lokalnych repo; pelny lockfile/constraints =
  refinement (spec 003 Q3) dla 100% reprodukowalnosci.
- Windows-x64 (Windows-first). Inne platformy = osobny standalone (nietkniete).
- FR-eli wymaga klucza PISTE do wywolan (listTools dziala bez) -> domyslnie OFF.

## Weryfikacja (2026-06-26)

Smoke przed buildem na scratch-runtime (kopia standalone + 9 konektorow):
- **9/9** odpowiada przez stdio MCP (`initialize` + `tools/list`).
- Live: `de_search` przez bundlowany runtime odpytal NeuRIS i zwrocil realne dane
  (total_items 2420).
- Izolacja `-s -E` potwierdzona (brak user-site leak).
