# Plan: Wydanie EN "15/15" - konektory UE offline (Opcja C)

**Spec:** [spec.md](./spec.md)
**Project Type:** `desktop-app` / `agent-product`
**Konstytucja:** [.matematic/konstytucja.md](../../konstytucja.md) v1.0.0 (publikacja PATRON)

## Technical Context

- **Language/Version:** TypeScript 5.x (backend Node 20+, frontend Next.js), Python 3.13 (konektory eli, fastmcp), Electron (desktop). Build orchestracja: Node (`prepare-resources.cjs`).
- **Primary Dependencies:** electron-builder (NSIS), better-sqlite3 (native rebuild), `uv` (build-time package resolver), python-build-standalone (osadzony runtime), fastmcp (konektory).
- **Storage:** lokalny SQLite (ADR-0053). Konektory = stdio MCP, bez stanu.
- **Testing:** vitest (backend), tsc (oba), manualny smoke na czystej VM (offline) dla US1.
- **Target Platform:** Windows-first x64 (instalator NSIS, locale en-US/1033 dla EN).
- **Performance Goals:** spawn konektora < 2 s zimno; rozmiar instalatora EN < 900 MB (cel), twardy limit 2 GB (GitHub Release asset).
- **Constraints:** **offline-capable** (zero sieci w runtime dla konektorow), **RODO-safe** (zero danych klienta w bundlu), **deterministyczne** (pinned, lockfile - Gateway skanuje te bajty co jada).
- **Scale/Scope:** 9 konektorow UE + 6 Node (lacznie 15), 1 wspolny Python runtime, single-user desktop.

## Constitution Check - GATE (vs konstytucja publikacji v1.0.0)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | ✅ PASS | Konektory UE = ekspansja standardu groundingu na prawo UE; wprost Mission ("PL/UE") |
| Article I - sekrety | ✅ PASS | Bundlowane paczki eli = publiczne (PyPI), zero kluczy. FR-PISTE klucz = env w runtime, NIE w bundlu. Lockfile bez sekretow. |
| Article I - dane klienta | ✅ PASS | py-connectors = czysty kod open-source, zero PII/akt. AC4.5: leak-scan bundla przed snapshotem. |
| Article II - 100% open | ✅ PASS | Konektory juz publiczne (github.com/matematicsolutions/*-eli-mcp) |
| Article III - licencja | 🟡 NOTE | Powloka AGPL-3.0 bez zmian. 9 eli = **Apache-2.0** (nie MIT jak 6 Node). Apache-2.0 kompatybilna z AGPL-3.0 (jednokierunkowo, OK do dystrybucji w instalatorze). Brak naruszenia; wymaga atrybucji -> Article IV. |
| Article IV - proweniencja | 🟡 TODO | AC4.1: dopisac Apache-2.0 NOTICE dla 9 eli + wpis THIRD_PARTY_INSPIRATIONS. Bundlowany Python (PSF license) + deps - takze do NOTICE. |
| Article VII - human-gated | ✅ PASS | Build+podpis+publikacja+ogloszenie = WM. Agent przygotowuje (kod, scaffold, draft), nie wykonuje aktow zewnetrznych. |
| Bramka jakosci | ✅ PASS (cel) | AC4.6: tsc 0 + vitest bez regresji + build EN przechodzi. Smoke offline na VM dla US1. |
| Bramka ToS / anty-OS | ✅ PASS | PyPI ToS pozwala redystrybucje paczek open-source; python-build-standalone (MIT/PSF) bundlowalne. |
| Bramka strategii | ✅ PASS | Domyka ekspansje EU (memory: "aplauz mecenasow=konektory"), jedna linia produkcyjna z Boutique. |

**Werdykt GATE:** PASS z dwoma zoltymi do domkniecia w trakcie (Article III/IV = atrybucja
Apache-2.0; nie blokuje startu, blokuje publikacje). Article I czysty - bundlujemy publiczny
kod, nie dane. Zaden snapshot/Release przed AC4.5 (leak-scan) i zgoda WM (2x review).

## Project Structure (dotkniete sciezki)

```
PATRON-Desktop/
├── desktop/
│   ├── scripts/prepare-resources.cjs    # + stageBundledPython(), MCP_SERVERS_PYTHON (gap 3-sync); stageDocs() locale-aware
│   ├── package.json                     # win.sign scaffold (eSigner SSL.com EV, nieaktywny)
│   └── (dist-resources/backend/py-runtime/ + py-connectors/  -- generowane przy buildzie)
├── backend/
│   ├── src/lib/mcp/
│   │   ├── index.ts                     # resolveStdioSpawn - juz obsluguje runtime:"python" (ADR-0134); weryfikacja sciezek wzglednych do bundla
│   │   └── connectors.ts                # getConnectorList: + ordering locale-aware (US2) lub w frontendzie
│   └── src/lib/mcp-security/pipeline.ts  # APPROVED_PATRON_CONNECTORS - juz ma 9 (bez zmian)
├── frontend/src/i18n/{pl,en}.ts          # etykiety pickera (juz z 002); badge "wymaga klucza" FR
├── frontend/ (picker UI)                 # ordering UE-first dla locale EN (US2)
├── docs/
│   ├── SAMOUCZEK.md                      # zrodlo (PL)
│   └── SAMOUCZEK_EN.md                   # NOWY (US3)
├── governance/adr/0136-*.md              # NOWY ADR: bundled Python runtime (Opcja C)
├── NOTICE / THIRD_PARTY_INSPIRATIONS.md  # + Apache-2.0 x9 + Python (US4)
└── mcp-servers.example.json              # juz ma 9 runtime:python (dev uv run) - bez zmian
```

## Research notes

- **Opcja C vs B1/B2:** rozstrzygniete w spec.md (tabela). C = build-time bundled Python, te same paczki PyPI co Boutique, offline + deterministyczne.
- **python-build-standalone (astral-sh/uv ekosystem):** relokowalny CPython, Windows-x64, ~25-40 MB. `uv python install` potrafi go pobrac przy buildzie; do osadzenia kopiujemy do py-runtime/. Q1 do potwierdzenia.
- **Relokowalnosc:** spawn `py-runtime/python.exe -m <modul>` z `PYTHONPATH=py-connectors` unika absolutnych sciezek venv (Q2). `uv pip install --target py-connectors <9 pakietow>` daje plaski, relokowalny site-packages.
- **resolveStdioSpawn (ADR-0134):** poliglot runtime juz w kodzie z 002 - `runtime:"python"` jest obslugiwany; integracja = nakarmic go `command` na bundlowany python + sciezki wzgledne. To skraca US1 (szyna gotowa).
- **Determinizm/Gateway:** pinned wersje + lockfile/constraints => bajty w bundlu == bajty skanowane przez MCP Security Gateway przy starcie. Brak runtime fetch = brak okna na drift/typosquat-after-scan.
- **FR-PISTE:** listTools dziala bez kluczy (example.json `_comment_fr`), wiec gateway-scan + bundle OK; wywolania wymagaja OAuth -> stan "wymaga klucza", nie auto-on (US2 AC2.3).
- **Rozmiar:** 1 runtime + 9 czysto-pythonowych deps ~40-90 MB vs B1 ~135-270 MB. Q4: zsumowac realnie, sprawdzic < limit Release.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Bundlowanie calego Python runtime do Electron (Node) app | Konektory UE sa Python/fastmcp; offline desktop nie ma Pythona | B2 (uvx runtime) odrzucone: lamie offline + drift vs Gateway. B1 (9x freeze) odrzucone: 3x wiekszy, 9 specow. C = najmniejszy offline-deterministyczny. |
| 9 eli na Apache-2.0 obok 6 MIT | Konektory powstaly jako linia eu-legal-mcp (Apache) | Relicensing na MIT = zbedne; Apache-2.0 kompatybilna z AGPL dystrybucja. Koszt = wpis atrybucji (Article IV). |
