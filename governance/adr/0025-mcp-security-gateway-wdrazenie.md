# ADR-0025: MCP Security Gateway - skan definicji konektorow przed wpieciem w kontrakt

> **Uwaga numeracja**: ostatni zajety ADR to 0024 (cherry-pick wzorcow MS AGT). Sprawdzono `Get-ChildItem governance/adr/` 2026-05-24 - 0025 wolne.

**Status**: WDROZONY (skeleton, 2026-05-24). Skeleton `backend/src/lib/mcp-security/` LIVE, testy vitest LIVE. NIE wpiety w startup backendu - wpiecie w kontrakt MCP to osobna decyzja (przyszly ADR-0028, analogicznie do relacji ADR-0019 -> ADR-0020 dla input-security).

**Data**: 2026-05-24

**Powiazane zasady** (Konstytucja Patrona v1.2.1, zweryfikowane grepem - [[feedback_grep_constitution_pre_cite]]):
- **Art. 8 - Stalosc kontraktow** - GLOWNA zasada tego ADR. MCP Security Gateway dziala PRZED zaladowaniem konektora do kontraktu MCP (`mcp-servers.json` -> backend startup). Wzmacnia stalosc kontraktow nie zmieniajac ich, bo blokuje wpiecie konektora ktory zmienia kontrakt (typosquat istniejacej nazwy, drift opisu, zywione instrukcje).
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - kazda decyzja Gateway'a (allowed / audit / human_review / denied) trafia do audit log Patrona przez istniejacy hash-chain.
- **Art. 6 - Granica bledu** (human in the loop) - decyzja `human_review` kieruje konektor do recznego zatwierdzenia Operatora kancelarii. Pelny `denied` zarezerwowany dla sygnalow jednoznacznych (typosquat dokladny, hidden-instruction critical).
- **Art. 4 - Neutralnosc wobec dostawcow** - Gateway dziala lokalnie, bez wywolan zewnetrznych. Nie faworyzuje zadnego konektora. Wzor cherry-pick z Microsoft AGT (ADR-0024), ale pisany od zera w naszym TS.

**Powiazane ADR**:
- **ADR-0024** - rodzic. Cherry-pick 3 patternow z microsoft/agent-governance-toolkit, ten ADR realizuje pierwszy z nich (MCP Security Gateway).
- **ADR-0019/0020** - rownoleglosc architektoniczna. Input-security skanuje DOKUMENTY wchodzace; MCP Security skanuje DEFINICJE NARZEDZI wchodzace. Ta sama 5-fazowa orchestracja, te same 4 stany akcji.
- **ADR-0001** - hash-chain audit. Decyzje Gateway'a dziedzicza istniejacy audit path.

---

## Decyzja

Patron dostaje warstwe `backend/src/lib/mcp-security/` - lokalny, deterministyczny, zero-LLM, zero-cloud skan definicji konektorow MCP przed ich zaladowaniem do kontraktu.

### Architektura (5-fazowa, wzorzec ADR-0019)

1. **Wejscie**: lista `McpServerDefinition` (z `mcp-servers.json` + listy `tools/list` zwroconej przez konektor przy initialize)
2. **Detektory** (4): typosquat, drift, hidden-instructions, tool-poisoning
3. **Scoring**: sumuje findings -> risk score per konektor
4. **Decyzja**: allowed / audit / human_review / denied
5. **Report**: raport agregujacy + dedykowany payload audytu (przez istniejacy hash-chain)

### Detektory (cztery)

**1. Typosquat** (`detectors/typosquat.ts`)
- Lista 6 zatwierdzonych nazw konektorow Patrona: saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia (na 2026-05-24)
- Levenshtein distance vs zatwierdzona nazwa:
  - dist = 0: czysty (allowed, znany konektor)
  - 0 < dist <= 2: typosquat critical (`saos` vs `sao5`, `s4os`) -> denied
  - 2 < dist <= 4: typosquat suspect (`saos` vs `sao-database`) -> human_review
  - dist > 4: nieznany konektor 3rd-party -> human_review (decyzja Operatora)

**2. Drift** (`detectors/drift.ts`)
- Hash SHA256 (description konektora + opisow narzedzi) porownywany z baseline w `~/.patron/mcp-drift-baseline.json`
- Pierwszy load nieznanej nazwy: baseline = obecny hash, finding `informational` (allowed)
- Drift od baseline: finding `high` (human_review)
- Brak baseline pliku: traktowane jak pierwszy load (zero-state safe)

**3. Hidden instructions** (`detectors/hidden-instructions.ts`)
- Regex case-insensitive w opisach narzedzi (`description` z `tools/list`):
  - "ignore previous", "disregard above", "act as", "you are now", "system prompt"
  - "<system>", "</system>", "you must always", "you must never"
  - Polskie: "zignoruj", "udawaj ze", "od teraz", "nowy system prompt"
- Jedno trafienie krytyczne -> denied
- Slabsze (np. "jak gdyby") -> high -> human_review

**4. Tool poisoning** (`detectors/tool-poisoning.ts`)
- Regex w `description` szukajacy zaden o uprawnienia spoza schemy:
  - "additionally requires", "also reads", "include path to", "send to", "upload to"
  - "writes to /etc", "modifies", "deletes"
  - PL: "dodatkowo wymaga", "wysyla do", "rowniez czyta"
- Mismatch miedzy `inputSchema` a opisem (opis prosi o pole ktorego nie ma w schemie): finding `high`

### Stany akcji (cztery, wzorzec ADR-0019)

- `allowed`: konektor moze byc wpiety
- `audit`: konektor moze byc wpiety, ale finding zapisany do audit log
- `human_review`: konektor NIE wpinany automatycznie, Operator dostaje raport i decyduje
- `denied`: konektor odrzucony, blokada wpiecia (Operator widzi powod)

### Co robimy w tym ADR
- Skeleton kodu w `backend/src/lib/mcp-security/` (11 plikow: types, pipeline, scorer, report, index, README + 4 detektory + 1 plik testow)
- Testy vitest dla kazdego detektora i pipeline'u
- THIRD_PARTY_INSPIRATIONS.md - sekcja microsoft/agent-governance-toolkit z atrybucja wzorca

### Czego NIE robimy (granica, osobny ADR-0028)
- **NIE wpinamy w startup backendu** - skeleton jest bezstanowa funkcja, gotowy do integracji. Wpiecie w `scripts/bundle-mcp.cjs` lub `backend/src/index.ts` to ADR-0028.
- **NIE czytamy/nie modyfikujemy `mcp-servers.json`** - skeleton operuje na argumentach przekazanych przez wywolujacego.
- **NIE blokujemy startu serwera** automatycznie - decyzja `denied` zwraca raport, ale to wywolujacy (przyszly ADR-0028) decyduje co zrobic.
- **NIE adoptujemy 12-vector PromptDefense z Microsoft AGT** - to inna domena (analiza promptow, nie definicji narzedzi). Mozliwy osobny ADR jako uzupelnienie `adversarial-detector` istniejacego w input-security.

---

## Kontekst

### Zagrozenie ktore Gateway adresuje

Patron ma 6 konektorow MCP (saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia). Kancelaria moze:
1. Dodac 7-my konektor 3rd-party (np. ze sklepu MCP, z github, z npm)
2. Update konektora (npm update) ktory zmienia opis narzedzia
3. Zainstalowac konektor o nazwie myljacej z naszych (typosquat: `sa0s` zamiast `saos`)

Bez Gateway'a kancelaria laduje takie definicje na slepo. Modyfikacja opisu narzedzia moze zmienic zachowanie LLM (LLM czyta opis i moze byc instruowany przez ukryte instrukcje w opisie - to znane atak vector dla MCP).

### Wzorzec cherry-pick

Z [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, snapshot 2026-05-24, audyt RODO `agent-governance-claude-code` v3.6.0 = 🟢 ZIELONY, patrz `audit_agent_governance_claude_code_2026-05-24.md`):

**Co bierzemy (wzorzec)**:
- Cztery klasy detektorow (typosquat, drift, hidden-instructions, tool-poisoning) - taksonomia z MCP Security Gateway spec
- Pojecie "scan przed zaladowaniem do kontraktu"
- Decyzja allow/deny w runtime z fail-closed semantics

**Co NIE bierzemy (granica)**:
- Kod Microsoft AGT (Python/TS SDK) - piszemy od zera w naszym TS strict
- `MCP-SECURITY-GATEWAY-1.0.md` spec ich struktury raportu - nasz format dziedziczy po wlasnym `input-security` (zachowanie spojnosci wewnetrznej Patrona)
- Integracja z Microsoft Azure / OpenSSF - lokalne pliki + audit hash-chain (Art. 1)

---

## Alternatywy rozwazane

**A. Nie robic nic, polegac na zaufaniu do autorow konektorow**
- Odrzucone - 6 naszych konektorow MIT, ale kancelaria moze dodac 7-my z internetu. Brak Gateway'a = wektor ataku.

**B. Robic Gateway tylko dla 3rd-party (nie skanowac naszych 6)**
- Odrzucone - npm update naszych konektorow rowniez moze wprowadzic drift opisu narzedzia, bez Gateway'a niezauwazalny.

**C. Robic full Microsoft AGT (Ed25519 + ML-DSA-65 trust scoring + 4 privilege rings + Lightning)**
- Odrzucone w ADR-0024 jako przeskalowane. Tu skupiamy sie na samym Gateway, bez identity / trust scoring.

**D. Skeleton + 4 detektory + testy + ADR (wybrane)** - **przyjete**
- Maly krok, zgodny z wzorcem ADR-0019 (input-security skeleton bez wpiecia). Wpiecie w kontrakt to osobny ADR po review.

---

## Konsekwencje

### Pozytywne
- 4 detektory pokrywaja 4 znane vectory ataku MCP (typosquat, drift, hidden-inst, poisoning)
- Architektura spojna z istniejacym `input-security` - latwa do utrzymania
- Zero dependencies dodanych do `package.json` (tylko node:crypto z biblioteki standardowej)
- Mozliwosc cherry-pick patternu do innych projektow MateMatic (skill `legal-ai-plugin-governance` moze uzywac tych detektorow)

### Negatywne / kosztowe
- +~800-1200 LoC TypeScript w `backend/src/lib/mcp-security/`
- Powierzchnia do utrzymania: 4 detektory + scorer + pipeline + testy
- Decyzja `human_review` wymaga UI dla Operatora kancelarii - dorobic w osobnym ADR (przyszly ADR-0028 wpiecia w startup + UI)
- Baseline drift w `~/.patron/mcp-drift-baseline.json` - nowy plik stanu poza repo, do dokumentacji w deploy

### Bramki przed wpieciem (ADR-0028)
- Testy PATRON musza zostac zielone (vitest run); baseline po wdrozeniu ADR-0025 = 389/394 pass
- TSC clean (`npm run build`)
- 2x runda marko-pl review ([[feedback_marko_2x_runda_pattern]])
- Wpis w `THIRD_PARTY_INSPIRATIONS.md` LIVE (zalatwione w tym ADR)

---

## Atrybucja

Pattern (MCP Security Gateway - taksonomia 4 detektorow, scan przed zaladowaniem do kontraktu) cherry-picked z [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, Microsoft Corporation, snapshot pushedAt `2026-05-24T17:02:19Z`, 1904 star). Skeleton 5-fazowy + 4 stany akcji wziete z naszego wlasnego `input-security` (ADR-0019, wzorzec cherry-picked z `jdai-ca/atticus` Apache-2.0).

Kod TypeScript napisany od zera pod Node 20+ / vitest / TS strict, zero zaleznosci od Microsoft AGT npm.

Pelna atrybucja: [THIRD_PARTY_INSPIRATIONS.md sekcja microsoft/agent-governance-toolkit](../../THIRD_PARTY_INSPIRATIONS.md).
