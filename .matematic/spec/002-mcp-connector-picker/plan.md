# Plan: Wybor konektorow MCP przez mecenasa + zestaw UE

**Spec:** [spec.md](./spec.md) · **ADR:** [0133](../../../governance/adr/0133-wybor-konektorow-mcp-przez-mecenasa-jurysdykcja.md)
**Project Type:** `agent-product` / `desktop-app`

## Technical Context
- **Language/Version:** TypeScript strict (frontend Next.js + backend Node 20+).
- **Warstwa bezpieczenstwa (nie modyfikujemy, dzialamy NAD):** `backend/src/lib/mcp-security/` (gateway, ADR-0025/0028), `backend/src/lib/mcp/ring-policy.ts` (ADR-0027), `backend/src/lib/mcp/audit-bridge.ts` (propagacja do hash-chain).
- **Config konektorow:** `backend/mcp-servers.json` (`enabled`), czytany przy starcie (`backend/src/lib/mcp/index.ts`). Allowlista: `APPROVED_PATRON_CONNECTORS` (pipeline.ts).
- **Bundling:** `desktop/scripts/prepare-resources.cjs` (`MCP_SERVERS`), `scripts/bundle-mcp.cjs`. Repo UE: `~/Projects/*-eli-mcp` (MIT).
- **Storage:** stan `enabled` — w `mcp-servers.json` (config) lub tabeli (jak `installed_skills` w SQLite). Do rozstrzygniecia w plan-detalu.
- **Testing:** vitest backend (nie regresowac); frontend = tsc/next build (brak runnera — patrz spec 001).
- **Constraints:** RODO / tajemnica / audit-first / vendor-neutral. Konektory UE wolaja zewnetrzne API **prawa publicznego** (zapytania, nie akta klienta); warstwa pseudonim/pl-entities chroni egress.

## Architektura (rdzen)

```
Picker UI (frontend)  --toggle-->  API (backend)
                                     |
                                     +--> zapis enabled (config / tabela)
                                     +--> audit hash-chain (event: connector.toggle)
                                     +--> reload konektorow (MVP: restart / reload + RE-GATEWAY)
APPROVED_PATRON_CONNECTORS  <-- rozszerzone o UE (kazdy przez gateway, 3-sync nazw)
Ring-policy (ADR-0027):  Ring 1 = zaufane (picker)  |  Ring 2 = 3rd-party = Operator-only
```

## Constitution Check (GATE — `governance/CONSTITUTION.md` + AGENTS.md + bramki MateMatic)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | ✅ PASS | Domyka ekspansje EU (jurysdykcja) bez utraty rdzenia |
| **Audit-first (AI Act art.12)** | 🟡 GATE | Toggle = zmiana powierzchni narzedzi agenta -> MUSI byc w hash-chain (AC1.2). Bypass = blad krytyczny |
| **MCP Security Gateway** | 🟡 GATE | KAZDY nowy konektor UE przez gateway (allowed-clean) przed dopisaniem do APPROVED (AC2.1). To rdzen bezpieczenstwa — nie dopisywac nazw "na sucho" |
| **Ring-policy nienaruszone** | ✅ PASS | 3rd-party zostaje Ring 2 fail-closed; picker tylko Ring 1 |
| Tajemnica / RODO / egress | ✅ N/A* | Konektory wolaja API prawa publicznego (zapytania); klient PII chroniony pl-entities. *Per-konektor profil egress udokumentowac |
| Neutralnosc providera | ✅ N/A | Bez zmian warstwy LLM |
| Bramka licencji | ✅ PASS | Konektory UE = MIT do powloki AGPL (ADR-0002) |
| Bramka jakosci | 🟡 GATE | tsc 0 + vitest bez regresji (AC3.3) |
| ADR | ✅ | ADR-0133 (Proponowany) |

**Werdykt GATE:** brak twardych FAIL. Twarde warunki: (1) audyt toggla; (2) gateway dla
KAZDEGO konektora UE przed zaufaniem. To sa nieusuwalne — picker nie moze stac sie
furtka do nieskanowanego konektora.

## Project Structure (dotykane sciezki — szkic)

```
frontend/src/app/(pages)/<account|connectors>/...   # NEW: picker UI
frontend/src/app/lib/patronApi.ts                   # MOD: API list/toggle konektorow
frontend/src/i18n/pl.ts + en.ts                     # MOD: klucze pickera (PL+EN)
backend/src/routes/<connectors>.ts                  # NEW: GET lista / POST toggle (+ audit)
backend/src/lib/mcp/index.ts                        # MOD: odczyt/zapis enabled, reload
backend/src/lib/mcp-security/pipeline.ts            # MOD (US2): APPROVED += UE
backend/mcp-servers.example.json                    # MOD (US2): wpisy UE
desktop/scripts/prepare-resources.cjs               # MOD (US2): MCP_SERVERS += UE
governance/adr/0133-...md                            # (jest)
```

## Research notes
- Picker to gl. UI+API+audyt NAD istniejaca architektura — nie przebudowa bezpieczenstwa.
- 3-sync nazw to znany koszt (komentarz w pipeline.ts): rozjazd = typosquat blokuje wlasny konektor. Test: po dodaniu UE uruchomic startup-scan, oczekiwac allowed-clean.
- Pilotaz UE (Q4): rozsadnie zaczac od 1-2 krajow (DE keyless + FR z kluczem) — pokrywa oba profile (keyless vs OAuth) zanim hurtem.

## Complexity Tracking

| Decyzja | Dlaczego | Odrzucona prostsza |
|---|---|---|
| Reload/restart konektorow po toggle | Konektory czytane przy starcie; dynamiczna re-rejestracja wymaga ponownego gateway | "Live bez restartu" odrzucone na MVP — wieksze ryzyko, gateway musialby biec w runtime |
| Stan enabled w configu vs tabela | Spojnosc z istniejacym `mcp-servers.json`; tabela jak `installed_skills` jako alternatywa | Decyzja w plan-detalu; nie przesadzac przedwczesnie |
