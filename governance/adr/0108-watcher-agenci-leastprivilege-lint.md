# ADR-0108 — Watcher-agenci PL + least-privilege orchestrator/leaf + statyczny lint zakresu narzędzi

- **Status:** Proponowany (czeka na ratyfikację WM + bramkę merge→main)
- **Data:** 2026-06-11
- **Gałąź:** `feat/watcher-d-lint` (worktree, off `feat/tier-governance-envelope`)
- **Mapuje na:** ADR-0095 (`enforceEgressGuard`, runtime egress), CLAUDE.md zasada 2 („parytet KOŃCZY się na granicy governance"), spec `patron-desktop-drafts/spec/claude-for-legal-adoption/D-*`
- **Inspiracja (clean-room):** `anthropics/claude-for-legal` (Apache-2.0) — managed-agent cookbooks, wzorzec orchestrator/leaf + `lint-tool-scope.py`. Atrybucja: `THIRD_PARTY_INSPIRATIONS.md` / `NOTICE-attribution.md`. Wzięty WZORZEC, nie kod.

## Kontekst

PATRON ma runtime'owy `enforceEgressGuard` (ADR-0095), który blokuje egress poza
granicą zgody. Brakuje **statycznego bliźniaka**: kontroli na poziomie *definicji*
agentów, że akt dotykający świata zewnętrznego (egress / write / wysyłka) nie wycieka
do orchestratora ani do read-only leafów. Dziś przeciek tego typu wykryłby się dopiero
w runtime (albo wcale). Dodatkowo: planowane watcher-agenty (terminy, rejestry, zmiany
regulacyjne) muszą z definicji być „flaguj, nie wykonuj" — inaczej naruszają granicę
governance z CLAUDE.md (akt nieodwracalny/na zewnątrz/human-in-the-loop zostaje
człowiekowi).

## Decyzja

### 1. Architektura least-privilege orchestrator/leaf

```
orchestrator (read + local, BEZ write / egress / cloud-MCP)
   └─ handoff_request ──► writer-leaf (JEDYNY z write/egress, ZA human-gate)
```

- Orchestrator: tylko odczyt + operacje lokalne. Bez `write`, bez egress, bez cloud-MCP.
- Akt zewnętrzny (write / egress / wysyłka) żyje na **jednym wyznaczonym writer-leaf**,
  osiągalnym wyłącznie przez `handoff_request`, za bramką człowieka.
- Read-only leaf (np. ekstraktor): `Read` + `grep`, `mcp_servers: []`, zamknięty
  `output_schema`.

### 2. Statyczny lint zakresu narzędzi

Skrypt (`scripts/lint-tool-scope.*`, do implementacji) mechanicznie egzekwuje na
definicjach agentów PATRONa:

1. brak narzędzi `write` na orchestratorze (poza writer-leaf),
2. brak narzędzi egress / cloud-MCP na orchestratorze,
3. brak narzędzi wysyłki (send / powiadomienia) poza writer-leaf — orchestrator emituje
   `handoff_request`, nie wysyła sam.

Cel: wykrycie przecieku uprawnień **przy code-review**, nie dopiero w runtime. To
kodyfikuje granicę z CLAUDE.md jako *test*, nie tylko zabezpieczenie runtime.

### 3. Backlog watcherów PL (human-in-the-loop, draft-nie-wykonuje)

| Watcher | Co flaguje | Kadencja | Granica governance |
|---|---|---|---|
| **termin-watcher** (#1) | terminy procesowe/zawite: apelacja 14 dni, zażalenie 7 dni, skarga kasacyjna 2 mies., przedawnienie | dzienny w sprawie aktywnej | flaguje → człowiek wnosi pismo |
| reg-change-monitor PL | Dz.U./MP, RODO/UODO, KNF, UOKiK, zmiany KPC/KPA | tygodniowy, filtr istotności | flaguje lukę → człowiek aktualizuje politykę |
| rejestr-watcher | KRS/CEIDG zmiany kontrahenta/UBO, conflict-check | przy nowym dok. / tygodniowy | flaguje rozjazd → człowiek ocenia konflikt |
| renewal-watcher | wygaśnięcia umów, pełnomocnictw, polis | tygodniowy | flaguje → człowiek przedłuża |
| IP-renewal (UPRP) | znaki/wzory/patenty — opłaty, terminy | tygodniowy | flaguje → człowiek wnosi |
| playbook-monitor | N odchyleń od pozycji klauzulowej | 5 odchyleń / 12 mies. (konfig.) | proponuje → człowiek zatwierdza |

**Zasada nadrzędna:** żaden watcher nie składa pisma / nie wysyła / nie podpisuje —
flaguje i wystawia draft. To wprost „tool przygotowuje draft, nie wykonuje"
(CLAUDE.md zasada 2).

### 4. Scheduling bez autonomii

Agenci nie self-schedulują (upstream Claude Code mówi to wprost). Kadencja przez
zewnętrzny trigger / cron operatora. Watcher = zadanie na żądanie + opcjonalny cron,
nigdy samowyzwalająca się autonomia. PHASE_GRANTS (rezerwa) tylko gdy operator
świadomie nada autonomię konkretnemu krokowi.

## Konsekwencje

- (+) Granica governance staje się testowalna statycznie, nie tylko runtime.
- (+) Watcher-agenty wartościowe prawniczo (terminy!) wchodzą bez ryzyka „agent zrobił
  coś nieodwracalnego" — z definicji draft-nie-wykonuje.
- (+) Spójność z `enforceEgressGuard`: lint = statyczny bliźniak runtime'u.
- (−) Koszt utrzymania konwencji definicji agentów (format + lint w CI).
- (−) Watchery wymagają źródeł danych PL (Dz.U., KRS, UPRP) — osobny backlog konektorów.

## Definition of done

- [ ] Statyczny lint zakresu narzędzi (orchestrator vs writer-leaf) + wpięcie w CI/review.
- [ ] Wzorzec `handoff_request` dla egress/write/send udokumentowany i wymuszony lintem.
- [ ] termin-watcher (#1) jako pierwsza definicja — draft-nie-wykonuje, flaga default OFF.
- [ ] Potwierdzenie: żaden watcher nie wykonuje aktu zewnętrznego sam.
- [ ] 2× review `matematic-patron-pr-review-pl` przed merge→main (bramka WM).

## Uwaga wdrożeniowa

Ten ADR to **decyzja kierunkowa**. Implementacja (skrypt lintu + definicja
termin-watchera) wymaga uprzedniego rozpoznania formatu definicji agentów w PATRONie
i jest świadomie odłożona do osobnego, skupionego przebiegu — nie piszemy kodu „w ciemno"
w repo produktowym. Flagi runtime watcherów: default OFF (zero zmiany zachowania do
ratyfikacji WM).
