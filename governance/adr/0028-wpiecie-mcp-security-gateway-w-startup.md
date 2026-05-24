# ADR-0028: Wpiecie MCP Security Gateway w startup backendu - gate przed registracja toolow

> **Uwaga numeracja**: ADR-0028 zarezerwowany przez ADR-0024 (cherry-pick decision record dla MS AGT) i ADR-0025 (MCP Security Gateway skeleton). Wpiecie skeleton'a w istniejacy kontrakt MCP, analogicznie do relacji ADR-0019 -> ADR-0020 dla input-security.

**Status**: WDROZONY (2026-05-24). Wpiecie w `backend/src/lib/mcp/index.ts` LIVE. Pierwszy load tworzy baseline `~/.patron/mcp-drift-baseline.json` (override przez env `PATRON_MCP_BASELINE_PATH`). Decyzja `denied` / `human_review` blokuje registracje toolow danego konektora (warning na stdout przez `console.warn` ze strukturyzowanym tagiem `[MCP-SECURITY]`; propagacja do audit hash-chain ADR-0001 w przyszlym ADR).

**Data**: 2026-05-24

**Powiazane zasady** (Konstytucja Patrona v1.2.1, zweryfikowane grepem - [[feedback_grep_constitution_pre_cite]]):
- **Art. 8 - Stalosc kontraktow** - GLOWNA zasada tego ADR. Wpiecie Gateway'a w `getMcpTools()` wzmacnia stalosc kontraktu MCP, bo decyzja `denied` lub `human_review` blokuje registracje konektora ktorego definicja narzedzi wzbudza podejrzenia (typosquat, drift, hidden-instructions, tool-poisoning). Pre-existujace tool calls pozostaja nienaruszone - filter dziala TYLKO przy ladowaniu nowego/zmienionego konektora.
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - kazda decyzja Gateway'a (`allowed`/`audit`/`human_review`/`denied`) logowana przez `console.warn` ze strukturyzowanym tagiem `[MCP-SECURITY]`, kandydat do propagacji w audit hash-chain (ADR-0001) w przyszlosci.
- **Art. 6 - Granica bledu** (human in the loop) - decyzja `human_review` NIE rejestruje toolow automatycznie. Operator widzi w logach co zostalo zablokowane i moze swiadomie zatwierdzic (recznie ustawic `enabled: true` po review + dodac do `approvedNames` lub zmienic baseline po analizie diff'u).
- **Art. 1 - Lokalność danych** - skan dzieje sie lokalnie, zero wywolan zewnetrznych. Baseline file w lokalizacji uzytkownika.
- **Art. 4 - Neutralność wobec dostawców** - Gateway dziala jednolicie dla wszystkich konektorow MCP (saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia + ewentualne 3rd-party). Nie faworyzuje zadnego.

**Powiazane ADR**:
- **ADR-0024** - rodzic. Cherry-pick decision record dla Microsoft AGT, ten ADR realizuje wpiecie zaplanowane w ADR-0024.
- **ADR-0025** - skeleton `mcp-security/`. Ten ADR wpina skeleton w istniejacy kontrakt MCP.
- **ADR-0019/0020** - rownoleglosc architektoniczna. ADR-0019 = skeleton input-security, ADR-0020 = wpiecie w ingest. ADR-0025 + ADR-0028 = analogiczny duet dla MCP security.

---

## Decyzja

`getMcpTools()` w `backend/src/lib/mcp/index.ts` zostaje rozszerzony o **gate Gateway'a** przed registracja toolow w `_toolRegistry`. Refactor zachowuje API publiczne (`getMcpTools()`, `isMcpTool()`, `runMcpTool()`, `extractMcpCitations()`) - zmiana wewnetrzna.

### Architektura wpiecia

```
loadConfig() -> [McpServerConfig]
                       |
                       v
        connectServerCollect(cfg) -> { client, tools, ok }   (NIE rejestruje yet)
                       |
                       v
          buildScanContext(loadedBaseline) -> ScanContext
                       |
                       v
              scanMcpRegistry([defs]) -> McpScanReport
                       |
       +---------------+---------------+
       |               |               |
     allowed         audit         human_review/denied
       |               |               |
       v               v               v
 register tools  register tools     skip + log + close client
 update baseline update baseline
```

### Zmiany w kodzie

1. **Refactor `connectServer`** - rozdzielone na 2 fazy:
   - **`connectAndDiscover(cfg)`**: connect + listTools, zwraca `{ client, cfg, tools, ok }`. NIE modyfikuje `_toolRegistry`.
   - **`registerTools(client, cfgName, tools)`**: wlasciwa registracja w `_toolRegistry`. Wywolywana TYLKO po decyzji `allowed`/`audit`.

2. **Nowa funkcja `loadBaseline()`** - odczyt `~/.patron/mcp-drift-baseline.json` (lub override `PATRON_MCP_BASELINE_PATH`). Brak pliku = pusta mapa (pierwszy load wszystkich).

3. **Nowa funkcja `saveBaseline(baseline)`** - zapis baseline po skanie, tylko dla serwerow z decyzja `allowed` lub `audit`. Atomic write (write to tmp + rename).

4. **Gate w `getMcpTools()`**:
   ```ts
   // Faza 1: collect (bez registracji)
   const collected = await Promise.all(configs.map(connectAndDiscover));
   const ok = collected.filter(c => c.ok);
   
   // Faza 2: scan
   const definitions = ok.map(toMcpServerDefinition);
   const context = buildScanContext(loadBaseline());
   const report = scanMcpRegistry(definitions, context);
   
   // Faza 3: register / skip per server
   const newBaseline = new Map(context.driftBaseline);
   for (const c of ok) {
       const result = report.perServer.find(r => r.serverName === c.cfg.name);
       if (!result) continue;
       if (result.action === "allowed" || result.action === "audit") {
           registerTools(c.client, c.cfg.name, c.tools);
           newBaseline.set(c.cfg.name, result.currentHash);
           if (result.action === "audit") {
               console.warn(`[MCP-SECURITY] Audit findings for "${c.cfg.name}":`, result.findings);
           }
       } else {
           console.warn(`[MCP-SECURITY] Server "${c.cfg.name}" blocked (action=${result.action}, findings=${result.findings.length}). NOT registered.`);
           await c.client.close().catch(() => {});
       }
   }
   saveBaseline(newBaseline);
   ```

5. **Helper `toMcpServerDefinition(c)`** - mapuje wewn. `McpServerConfig + tools` na `McpServerDefinition` (typ z `lib/mcp-security/types.ts`).

### Co robimy w tym ADR
- Refactor `connectServer` na 2-fazowy (collect + register).
- Wpiecie `scanMcpRegistry` w `getMcpTools()` jako gate przed registracja.
- Lokalny baseline file `~/.patron/mcp-drift-baseline.json` z env override.
- Strukturyzowane logi `[MCP-SECURITY]` dla decyzji innych niz `allowed`.
- Testy: 7 nowych testow `baseline.test.ts` (loadBaseline pusta mapa gdy brak pliku / roundtrip save+load / atomic overwrite / niepoprawny JSON / tablica zamiast obiektu / tworzenie katalogu rodzicowskiego / env override) + zachowanie wszystkich istniejacych testow. Integracyjne testy gate'a (mock klienta MCP) zaplanowane w osobnym ADR po dorobieniu UI dla Operatora.

### Czego NIE robimy w tym ADR (osobne ADR-y)
- **NIE propagujemy decyzji Gateway'a do audit hash-chain (ADR-0001)** - na razie `console.warn`. Propagacja do `audit_events` z polem `event_type = "mcp_security.gateway"` w przyszlym ADR (gdy bedzie UI dla Operatora do zatwierdzania `human_review`).
- **NIE robimy UI dla Operatora** - decyzja `human_review` blokuje tools w obecnym wpieciu. UI do zatwierdzania (i konwersji do `audit`) w przyszlym ADR (rownoczesnie z propagacja do audit log).
- **NIE wykonujemy automatycznych retry / rekonfiguracji** - jezeli konektor pierwotnie `allowed` zmieni opis i przy nastepnym starcie dostanie `human_review` (drift detector), pozostaje zablokowany do recznego rozstrzygniecia. Atomic safe-default.
- **NIE blokujemy startu backendu** gdy KAZDY konektor zostanie zablokowany. Patron uruchamia sie bez MCP toolow - to dziala jak dotychczasowy no-op gdy `mcp-servers.json` nie istnieje. Operator widzi w logach co zostalo zablokowane.

---

## Kontekst

### Dlaczego refactor 2-fazowy

Obecny `connectServer` rejestruje tools natychmiast w `_toolRegistry` po `listTools()` (linie 132-135 starego `index.ts`). Gateway musi zdecydowac PRZED registracja, wiec musimy rozdzielic fazy:
- **collect**: connect + listTools (potrzebne by mial co skanowac)
- **register**: dopiero po decyzji Gateway'a

Alternatywa: registracja + post-hoc unregister gdy decyzja deny. Odrzucone - race condition, jezeli skan trwa dluzej niz N ms i jakas inna funkcja zdazy zawolac `isMcpTool()` na tool ktory za chwile bedzie usuniety. Faza-przed-rejestracja jest atomowa.

### Lokalizacja baseline file

Wybor: `~/.patron/mcp-drift-baseline.json` (Unix) lub `%USERPROFILE%\.patron\mcp-drift-baseline.json` (Windows). Override przez env `PATRON_MCP_BASELINE_PATH`.

Powody:
1. **Per uzytkownik operatora**, nie per projekt - to konfiguracja srodowiska dewelopera/Operatora, nie kod.
2. **Spojnosc z wzorcem Microsoft AGT** ktory adaptujemy (pakiet `agent-governance-claude-code` v3.6.0 uzywa lokalnego `~/.claude/agt/` na audit log + policy state) - patrz audyt RODO `audit_agent_governance_claude_code_2026-05-24.md`.
3. **Brak w gitignore** repo Patrona (plik poza repo z natury).
4. **Bezpieczenstwo deploy**: kontener Docker dostaje `PATRON_MCP_BASELINE_PATH=/data/patron/mcp-drift-baseline.json` (volume mount), Operator lokalny dostaje domyslnie `~/.patron/`.

### Co dzieje sie przy pierwszym uruchomieniu po wdrozeniu

1. Plik `~/.patron/mcp-drift-baseline.json` nie istnieje.
2. `loadBaseline()` zwraca pusta mape.
3. Dla kazdego konektora `driftDetector` zwraca finding `severity: low` "Pierwszy load... baseline ustalany" (zero impact dla decyzji - akcja `audit` lub `allowed` w zaleznosci od typosquat/hidden-instructions/tool-poisoning).
4. `saveBaseline()` zapisuje aktualne hashy dla wszystkich `allowed`/`audit` serwerow.
5. Kolejne uruchomienie: baseline istnieje, drift detector zwraca findings tylko gdy hash sie rozni.

---

## Alternatywy rozwazane

**A. Nie wpinac, zostawic skeleton bez integracji**
- Odrzucone. Skeleton bez wpiecia = niewykorzystany kod. ADR-0025 jasno deklarowal "wpiecie w osobnym ADR-0028" - to ten ADR.

**B. Wpiac jako osobny `validateMcpServers()` wywolywany RECZNIE przed `getMcpTools()`**
- Odrzucone. Wymagaloby dyscypliny w kazdym miejscu wywolujacym MCP. Lepsza atomowosc = wpiecie w samo `getMcpTools()`.

**C. Wpiac TYLKO logowanie (decyzja Gateway'a nigdy nie blokuje, tylko alarm)**
- Odrzucone. Zera ochrony przed typosquat / hidden-instructions z 3rd-party konektorow. Gateway ktory tylko loguje to brak Gateway'a.

**D. Wpiecie 2-fazowe z atomowa decyzja per konektor (przyjete)** - **przyjete**
- Pelna ochrona, zachowuje API publiczne, gracefully degraduje gdy wszystko zablokowane (zero MCP tools = istniejacy no-op).

---

## Konsekwencje

### Pozytywne
- Wpiecie ADR-0025 skeleton'a w produkcyjny kontrakt - skeleton zaczyna realnie chronic.
- 4 detektory (typosquat / drift / hidden-instructions / tool-poisoning) aktywne przy kazdym ladowaniu konektorow.
- Lokalny baseline = persisted drift detection, regresja opisu narzedzia nie umyka.
- Strukturyzowane logi `[MCP-SECURITY]` dla decyzji != allowed = bramka operacyjna.
- API publiczne `lib/mcp/index.ts` niezmienione - zero impact na inne moduly.

### Negatywne / kosztowe
- +~80-120 LoC w `lib/mcp/index.ts` (refactor + gate).
- Nowy plik state w lokalizacji uzytkownika (`~/.patron/mcp-drift-baseline.json`) - dokumentacja deploy.
- Latency wzrost: pierwszy load skanuje wszystkie konektory zanim cokolwiek rejestruje. Realny koszt: 4 detektory * 6 konektorow * <5ms/det = ~120ms dodatkowo przy starcie. Akceptowalne (start backendu i tak liczy sekundy).
- Mozliwy chwilowy `human_review` po npm update konektora (drift detector) - Operator musi recznie zatwierdzic. To **wlasciwe zachowanie** (pattern designu), ale wymaga komunikatu w changelogu Patrona.

### Bramki PO wpieciu (potwierdzone w tej sesji)
- Testy backend: **396/401 pass** (+7 nowych baseline tests vs baseline 389/394 z ADR-0025).
- TSC clean.
- 2x runda marko-pl - zalatwione przed commitem.

---

## Atrybucja

Wpiecie ADR-0025 (cherry-pick wzorca MCP Security Gateway z Microsoft AGT) w istniejacy kontrakt MCP Patrona. Wzorzec 2-fazowy (collect + register) wlasny - dyktowany konieczna atomowoscia decyzji. Lokalizacja baseline `~/.patron/mcp-drift-baseline.json` inspirowana wzorcem Microsoft AGT `~/.claude/agt/audit-log.json` (lokalny plik state per uzytkownik) - patrz audyt RODO w `audit_agent_governance_claude_code_2026-05-24.md`.

Pelna atrybucja: ADR-0024 + ADR-0025 + [THIRD_PARTY_INSPIRATIONS.md sekcja microsoft/agent-governance-toolkit](../../THIRD_PARTY_INSPIRATIONS.md).
