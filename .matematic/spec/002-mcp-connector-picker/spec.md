# Feature: Wybor konektorow MCP przez mecenasa (jurysdykcja) + zestaw UE

**Branch:** `feat/mcp-connector-picker` (off aktualnego `main`)
**Date:** 2026-06-24
**Status:** Draft
**Project Type:** `agent-product` / `desktop-app`

## Problem statement

Ekspansja EU. i18n UI (spec 001 / ADR-0132) daje angielski interfejs, ale nie daje
**prawa wlasciwej jurysdykcji**. W PATRONie wybor konektora MCP = wybor prawa
(SAOS/ISAP = PL, de-eli = DE...). Dzis mecenas nie ma jak wybrac — konektory sa w
pliku `mcp-servers.json` (`enabled`), edytowanym recznie / generowanym w instalatorze.
Brak UI. Zestaw zaufany = 6 (PL + UE-zbiorcze), bez krajowych konektorow UE.

Cel: mecenas wybiera w UI, ktore konektory (= jurysdykcje) sa aktywne — z
**zaufanego, zweryfikowanego zestawu** rozszerzonego o konektory krajowe UE.

## Granica (twarda — bezpieczenstwo MCP)

| Co | Decyzja |
|---|---|
| Wybor z zaufanego zestawu (Ring 1) | ✅ mecenas, przez UI |
| Rozszerzenie zestawu o UE (de/at/es/fi/ie/nl/se/fr/lu-eli) | ✅ — kazdy przez MCP Security Gateway + sync 3 miejsc |
| Dowolny 3rd-party MCP z internetu | ❌ NIE dla mecenasa — Ring 2 fail-closed, tylko Operator (`operatorApproved`) |
| Omijanie gateway / ring-policy / zmiana trustLevel | ❌ poza zakresem pickera |

Patrz ADR-0133. Architektura bazowa (gateway ADR-0025/0028, ring-policy ADR-0027)
**niezmieniona** — picker dziala NAD nia.

## User Stories

### US1 (P1, MVP) — Picker UI nad obecnym zaufanym zestawem
**Jako** mecenas **chce** wlaczac/wylaczac konektory w UI **zeby** nie edytowac plikow.

**Acceptance Criteria:**
- [ ] AC1.1: Strona/panel pokazuje konektory z `APPROVED_PATRON_CONNECTORS` ze stanem `enabled`.
- [ ] AC1.2: Toggle zapisuje `enabled` (trwale) i jest **audytowany** (nowy `event_type`, np. `connector.toggle`) w hash-chain.
- [ ] AC1.3: Tylko Ring 1 jest przelaczalny; 3rd-party/Ring 2 nieobecne lub widoczne jako "tylko Operator" (read-only).
- [ ] AC1.4: Etykiety pickera w `pl.ts` + `en.ts` (synergia z ADR-0132).
- [ ] AC1.5: Wejscie w zycie zmiany jasno zakomunikowane (jesli wymaga restartu/reloadu — komunikat).

**Independent Test:** wlacz/wylacz konektor w UI -> stan trwaly + wpis audytu zweryfikowany hash-chainem; konektor 3rd-party nieprzelaczalny.

### US2 (P2) — Rozszerzenie zaufanego zestawu o konektory UE
**Jako** kancelaria DE/AT/... **chce** wybrac konektory swojego kraju **zeby** PATRON gruntowal w prawie mojej jurysdykcji.

**Acceptance Criteria:**
- [ ] AC2.1: Konektory UE (de/at/es/fi/ie/nl/se/fr/lu-eli) dodane do `APPROVED_PATRON_CONNECTORS`, **kazdy po przejsciu MCP Security Gateway** (allowed-clean).
- [ ] AC2.2: Nazwy zsynchronizowane w 3 miejscach (pipeline.ts / prepare-resources.cjs `MCP_SERVERS` / mcp-servers.example.json) — inaczej bramka typosquat blokuje.
- [ ] AC2.3: Konektory zbundlowane do instalatora (repo z `~/Projects/*-eli-mcp`, MCP_REPOS_DIR).
- [ ] AC2.4: Picker grupuje konektory wg **jurysdykcji** (PL / DE / AT / ...).
- [ ] AC2.5: Konektory wymagajace klucza/korpusu (FR-PISTE, eu-compliance) pokazane ze stanem "wymaga konfiguracji" (reuse wzorca kluczy API).

**Independent Test:** kancelaria z locale=DE wlacza de-eli -> agent cytuje prawo DE; gateway przepuscil de-eli jako allowed-clean.

### US3 (P3) — UX jurysdykcji, reload, docs
- [ ] AC3.1: Reload konektorow bez pelnego restartu (jesli wykonalne) albo czysty komunikat "wymaga restartu".
- [ ] AC3.2: AGENTS.md / README: jak dodac konektor do zaufanego zestawu (3-sync + gateway).
- [ ] AC3.3: `tsc` 0 (backend+frontend) + vitest backend bez regresji.
- [ ] AC3.4: Audyt: weryfikacja, ze toggle propaguje do hash-chain (jak `mcp_security.gateway`).

## Non-Goals (anti-scope)
- ❌ Dodawanie dowolnego MCP z internetu przez mecenasa (Ring 2 zostaje Operator-gated).
- ❌ Zmiana gateway / ring-policy / modelu zaufania.
- ❌ Marketplace konektorow / instalacja z URL w runtime.
- ❌ Per-sprawa rozne zestawy konektorow (ewentualnie pozniej; teraz per-instalacja).

## Open Questions / NEEDS CLARIFICATION
- [ ] Q1: Czy zmiana `enabled` moze przeladowac konektory dynamicznie (z ponownym gateway), czy MVP = restart aplikacji? (`mcp/index.ts` czyta przy starcie.)
- [ ] Q2: Gdzie picker w UI — Konto, czy dedykowana strona "Konektory / Jurysdykcje"?
- [ ] Q3: Logistyka bundla — repo UE sa w `~/Projects`, nie obok PATRONa; MCP_REPOS_DIR / kopiowanie do bundla.
- [ ] Q4: Czy zestaw UE wlaczamy hurtem, czy pilotaz 1-2 kraje (np. DE+FR) najpierw? (ROI vs powierzchnia zaufania.)
- [ ] Q5: Konektory z kluczem (FR-PISTE OAuth) — jak mecenas podaje klucz (reuse ekranu kluczy API?).
