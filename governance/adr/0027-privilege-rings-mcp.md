# ADR-0027: Privilege rings dla wywolan narzedzi MCP

> **Uwaga zakres**: ADR-0027 realizuje trzeci pattern z ADR-0024 (cherry-pick microsoft/agent-governance-toolkit). Patterny 1 i 2 (MCP Security Gateway + Merkle audit chain) dostaly osobne ADR-y - 0025/0028 (Gateway wdrozony) i 0026 (Merkle rezerwacja). Ten ADR jest **gate w czasie wywolania** dla pojedynczego `runMcpTool` (decyzja per-call), w przeciwienstwie do Gateway'a ktory jest **gate w czasie ladowania** rejestracji konektora (decyzja per-konektor podczas startu). Oba zyja obok siebie, nie koliduja.

**Status**: WDROZONY (2026-05-24). Nowy modul `backend/src/lib/mcp/ring-policy.ts` LIVE. Wpiety w `runMcpTool` (`backend/src/lib/mcp/index.ts`) PRZED faktycznym `client.callTool(...)`. Decyzje propagowane do audit hash-chain z `event_type = "ring_policy.decision"` (wzorzec ADR-0033, reuse modulu `audit-bridge.ts`).

**Data**: 2026-05-24

**Powiazane zasady Konstytucji Patrona v1.2.2** (zweryfikowane grepem na pliku `governance/CONSTITUTION.md` przed osadzeniem powolan):
- **Art. 4 - Neutralnosc wobec dostawcow** - GLOWNA zasada. Ring 1 (6 konektorow Patrona) traktowane jednolicie - zaden faworyzowany. Ring 2 (3rd-party) tez traktowane jednolicie (default deny, niezaleznie od dostawcy).
- **Art. 6 - Granica bledu (human in the loop)** - Ring 2 wymaga **explicit allow przez Operatora** (pole `operatorApproved: true` + `approvedAt` + `approvedBy` w `mcp-servers.json`). Nigdy automatyczne dopuszczenie nieznanego konektora.
- **Art. 8 - Stalosc kontraktow** - `runMcpTool` API publiczne niezmienione. Ring 2 deny zwraca `McpToolResult` z `isError: true` + tekst error (konwencja istniejaca, `chat/stream.ts:378` ma analogiczne "Tool X is not available"). LLM widzi error i moze zareagowac.
- **Art. 3 - Audytowalnosc (AI Act art. 12, RODO art. 30)** - kazda decyzja ring-policy (allow + deny) trafia do `audit_log` z `event_type = "ring_policy.decision"`. Daje pelny rejestr **runtime** decyzji autoryzacyjnych (komplementarny do `mcp_security.gateway` dla decyzji **load-time**).

**Powiazane ADR**:
- **[ADR-0024](./0024-cherry-pick-microsoft-agt-mcp-security-merkle-rings.md)** - rodzic. Definiuje 3 ringi (system / trusted / untrusted) jako adaptacja 4-ring modelu Microsoft AGT do skali kancelarii.
- **[ADR-0025](./0025-mcp-security-gateway-wdrazenie.md)** + **[ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md)** - komplementarne. Gateway: load-time gate (czy konektor moze byc zarejestrowany). Ring-policy: runtime gate (czy konkretny call moze byc wykonany). Razem: defense-in-depth.
- **[ADR-0033](./0033-propagacja-mcp-security-do-audit-hash-chain.md)** - reuse modulu `audit-bridge.ts`. Drugi event_type `ring_policy.decision` obok `mcp_security.gateway`.
- **[ADR-0001](./0001-audit-trail-hash-chain.md)** - hash-chain dla audit_log.

---

## Decyzja

Dorzucamy:

1. **Nowy modul `backend/src/lib/mcp/ring-policy.ts`** (pure function, ~60 LoC):
   - `decideRing(serverName: string, config?: { trustLevel?: "trusted" | "untrusted"; operatorApproved?: boolean }): RingDecision`
   - Zwraca `{ ring: 0 | 1 | 2, action: "allow" | "deny", reason: string }`
   - Zero side effects, latwo testowalna w izolacji.

2. **Rozszerzenie `McpServerConfig`** w `lib/mcp/index.ts`:
   ```ts
   interface McpServerConfig {
       name: string;
       transport: "stdio" | "http";
       // ... istniejace pola
       // Nowe (ADR-0027):
       trustLevel?: "trusted" | "untrusted";    // default zalezy od APPROVED_PATRON_CONNECTORS
       operatorApproved?: boolean;              // wymagane dla Ring 2 allow
       approvedAt?: string;                     // ISO date string
       approvedBy?: string;                     // email/identyfikator Operatora
   }
   ```

3. **Storage map serverName -> McpServerConfig** populowana w fazie 3 `getMcpTools()` po przejsciu Gateway. `runMcpTool` wyciaga config z mapy i przekazuje do `decideRing`.

4. **Wpiecie w `runMcpTool`** (`lib/mcp/index.ts`) PRZED `entry.client.callTool(...)`:
   - Wylicza `decideRing(serverName, cfg)`.
   - Jezeli `action === "deny"`: zwraca `McpToolResult` z `text: JSON.stringify({error, ring, reason})`, `isError: true`, `citations: []`. Fire-and-forget audit.
   - Jezeli `action === "allow"`: zapis audit w trybie wyslij-i-zapomnij, normalna sciezka do `client.callTool`.

5. **Dorzucenie `recordRingPolicyEvent` do `audit-bridge.ts`** (reuse modulu z ADR-0033) - drugi eksport obok `recordMcpSecurityEvent`. Payload: `{ tool_name, server_name, ring, action, reason }`.

### Definicja ringow w Patronie

| Ring | Nazwa | Co tam | Default action |
|---|---|---|---|
| **0** | System | Skrypty wewnetrzne Patrona (audit, healthcheck) - **brak realnych call-sites w obecnym kodzie**, ring rezerwowany dokumentacyjnie | n/a (LLM nigdy nie wywoluje) |
| **1** | Trusted MCP | 6 konektorow zarejestrowanych w stalej `APPROVED_PATRON_CONNECTORS`: saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia. Konektor trafia do Ring 1 tylko jezeli jego nazwa znajduje sie na tej liscie. | allow + audit |
| **2** | Untrusted | Jakikolwiek konektor poza Ring 1 (3rd-party MCP dodany przez Operatora). Fail-closed dla nieznanej nazwy. | **deny** (chyba ze `operatorApproved === true`) |

### Logika `decideRing`

```ts
function decideRing(serverName, config) {
    // Ring 1: nazwa w canonical list 6 konektorow Patrona.
    if (APPROVED_PATRON_CONNECTORS.includes(serverName)) {
        return { ring: 1, action: "allow", reason: "trusted-patron-connector" };
    }

    // Ring 2 default: nieznany konektor (3rd-party).
    // Explicit allow tylko gdy Operator wpisal operatorApproved=true.
    if (config?.operatorApproved === true) {
        return { ring: 2, action: "allow", reason: "operator-approved-3rd-party" };
    }

    // Fail-closed: nieznany konektor bez operator approval.
    return { ring: 2, action: "deny", reason: "no-operator-approval" };
}
```

### Format mcp-servers.json dla Ring 2 explicit allow

```json
{
    "name": "my-3rd-party-tool",
    "transport": "stdio",
    "command": "node",
    "args": ["/path/to/3rd-party/dist/index.js"],
    "enabled": true,
    "trustLevel": "untrusted",
    "operatorApproved": true,
    "approvedAt": "2026-06-15",
    "approvedBy": "operator@kancelaria.pl"
}
```

Pola `approvedAt` / `approvedBy` sa **informacyjne dla audytora** (kto i kiedy dopuscil konektor) - `decideRing` ich nie czyta, ale zostaja w `audit_log` (jako fragment payloadu `ring_policy.decision`) i w pliku konfiguracyjnym pod git review.

### Co JEST w payload audit (Konstytucja Art. 7 - minimalnosc)

```ts
{
    tool_name: string,        // pelna prefixowana nazwa (np. "my-3rd-party-tool__search")
    server_name: string,      // nazwa serwera MCP
    ring: 0 | 1 | 2,
    action: "allow" | "deny",
    reason: string,           // jeden z: "trusted-patron-connector" | "operator-approved-3rd-party" | "no-operator-approval"
}
```

### Co NIE jest w payload

- **Argumenty wywolania toola** - moga zawierac dane klienta kancelarii (Konstytucja Art. 5 tajemnica zawodowa, Art. 7 minimalnosc).
- **Wynik tool call** - to samo + ogromna ilosc danych (orzeczenia, dokumenty).
- **Pola `approvedAt` / `approvedBy`** z konfigu - audytor je widzi w samym `mcp-servers.json` pod git review, w audit_log byloby duplikacja.

### Propagacja audit bez blokowania glownego watku

Zapis `ring_policy.decision` do `audit_log` dziala w trybie wyslij-i-zapomnij (analogicznie do ADR-0033). Porazka zapisu NIE blokuje wywolania tool call (Art. 8 stalosc kontraktow). LLM dostaje normalna odpowiedz lub error (zaleznie od `decideRing`), ostrzezenie o nieudanym zapisie audit trafia do `console.warn`.

---

## Co robimy w tym ADR

- Nowy plik `backend/src/lib/mcp/ring-policy.ts` (~60 LoC, pure function).
- Rozszerzenie interface `McpServerConfig` w `lib/mcp/index.ts` o 4 pola (`trustLevel`, `operatorApproved`, `approvedAt`, `approvedBy`).
- Storage map `serverConfigByName` populowana w fazie 3 `getMcpTools()`, czytana w `runMcpTool`.
- Wpiecie `decideRing` w `runMcpTool` PRZED `client.callTool`. Ring 2 deny -> error result + audit. Ring 1 allow -> audit + normalna sciezka.
- Dorzucenie `recordRingPolicyEvent` jako drugi eksport `audit-bridge.ts` (reuse istniejacego modulu, NIE nowy plik).
- Aktualizacja komentarza `lib/audit.ts` - dodanie `"ring_policy.decision"` do listy UZYWANE.
- Aktualizacja `backend/mcp-servers.example.json` - przyklad konektora 3rd-party z `trustLevel`/`operatorApproved`.
- Testy: `ring-policy.test.ts` (28 testow pure function w 5 sekcjach: Ring 1 trusted / Ring 2 explicit allow / Ring 2 fail-closed default / determinism + immutability / RingReason values + defense-in-depth narrative) plus dorzucenie 3 testow do `audit-bridge.test.ts` dla `recordRingPolicyEvent`.
- AGENTS.md + CHANGELOG catchup.

## Czego NIE robimy w tym ADR (rezerwacje / poza scope)

- **Ring 0 implementacja** - rezerwacja dokumentowana. Obecnie brak call-sites w kodzie ktore wywoluja MCP "wewnetrznie" (audit, healthcheck). Jezeli kiedys pojawia sie skrypty wewnetrzne ktore beda chcialy uzyc MCP, dorzucimy konkretna identyfikacje (np. `process.env.PATRON_INTERNAL_CALL === "true"`) w osobnym ADR. **Bez modyfikacji modulu** - `decideRing` juz zwraca Ring 2 deny dla wszystkiego co nie jest Ring 1, wiec system jest fail-closed.
- **UI bannera dla Operatora do zatwierdzania Ring 2** - rezerwacja **ADR-0034** (admin RBAC + UI banner dla mcp-security ORAZ ring-policy decisions). Obecnie Operator dodaje konektor recznie do `mcp-servers.json`.
- **Rate limiting per Ring** - poza scope. Mozliwe rozszerzenie w przyszlosci (np. Ring 2 allow tylko z budget X calls/h), ale wymaga `getMetrics()` infrastruktury (rezerwacja **ADR-0030** SRE Governance implementacja).
- **Capability scoping per tool** (nie tylko per server) - poza scope. ADR-0024 mowi o "tool capability scoping" jako enhancement w przyszlosci.
- **Migracja sygnalizujaca brak `trustLevel` w istniejacych `mcp-servers.json`** - poza scope. Wszystkie konektory bez pola dostaja automatyczna klasyfikacje na podstawie `APPROVED_PATRON_CONNECTORS`. To zachowanie backward-compatible.

---

## Kontekst

### Dlaczego runtime gate (per-call) skoro Gateway juz robi load-time gate (per-konektor)

Defense-in-depth z dwoch ortogonalnych perspektyw:

- **Gateway** (load-time) - "czy ten konektor PASUJE do moich standardow bezpieczenstwa?" (typosquat / drift / hidden-instructions / tool-poisoning). Skanuje **definicje**. Decyzja jednorazowa per startup.
- **Ring-policy** (runtime) - "czy ten konkretny call do tego konektora POWINIEN sie wydarzyc teraz?" Decyzja **per tool call**. Operator moze recznie podniesc trust level konektora bez restart backendu (edit `mcp-servers.json` + reload).

Gateway nie zna runtime kontekstu (np. ile razy konektor byl juz wywolany w tej sesji). Ring-policy nie zna definicji (np. czy opis tool zawiera jailbreak pattern). Razem - pelny obraz.

### Dlaczego adaptacja 3 ringi zamiast 4 (Microsoft AGT)

Microsoft AGT ma kernel / supervisor / user / untrusted (hardware-style). Adaptacja do Patrona:
- **Kernel** - brak analogii. Patron nie ma "kodu jadra" ktory wywoluje MCP. Skrypty audit/healthcheck moga byc na poziomie Ring 0, ale w obecnym kodzie zero call-sites. Pomijamy.
- **Supervisor** - brak analogii. Patron nie ma "agent supervisor" ktory by zarzadzal innymi agentami. Single-tenant per kancelaria.
- **User** - Ring 1 (Trusted MCP). 6 konektorow polskiego/EU prawa, dopuszczone przez Wieslawa MateMatic, audytowane.
- **Untrusted** - Ring 2. Identyczna semantyka jak AGT.

3 ringi (z czego Ring 0 rezerwowany dokumentacyjnie) sa wystarczajace dla skali kancelarii.

### Dlaczego canonical list 6 jest "hardcoded" w `APPROVED_PATRON_CONNECTORS`

To **canonical list utrzymywana przez MateMatic** - jak lista 6 konektorow zatwierdzonych w pakiecie Patrona. Operator NIE moze samodzielnie podniesc konektora do Ring 1 (musialby zmodyfikowac kod). Moze tylko dopuscic konektor do Ring 2 explicit allow. To zgodne z modelem governance Patrona - MateMatic odpowiada za trusted set (audyt i utrzymanie 6 konektorow). Kancelaria dopuszczajaca konektor 3rd-party do Ring 2 explicit allow przejmuje odpowiedzialnosc RODO art. 24 (rozliczalnosc Administratora) i AI Act art. 26 (obowiazki Deployera high-risk AI) za ten konektor - zapis `approvedBy` + `approvedAt` w `mcp-servers.json` daje audytorowi slad decyzji (Konstytucja Art. 4 neutralnosc + Art. 6 human in the loop).

### Dlaczego `decideRing` jest pure function

3 powody:

1. **Testowalnosc** - 100% pokrycia bez mockow (czysta data in -> data out).
2. **Bezpieczenstwo** - brak skutkow ubocznych = brak nieoczekiwanych zachowan przy decyzji autoryzacyjnej.
3. **Reuse w przyszlym UI** (ADR-0034) - panel Operatora moze wywolac `decideRing("name", config)` w trybie dry-run zeby pokazac "what if".

---

## Alternatywy rozwazane

**A. Env var allowlist `PATRON_RING2_ALLOWED="name1,name2"`**
- Odrzucone. Mniej audytowalne (brak git historii ze zmianami listy), latwiejsze do przeoczenia przy review, trudniejsze do uzasadnienia dla audytora ("kto i kiedy dopuscil?").

**B. Osobny plik state `~/.patron/ring-policy.json`**
- Odrzucone. Dziele konfig na 2 miejsca dla tej samej domeny (mcp-servers.json + ring-policy.json). Operator musi pamietac o dwoch miejscach.

**C. Pola `trustLevel`/`operatorApproved` w `mcp-servers.json` (przyjete)**
- Spojnosc: jeden plik konfiguracyjny per domena, git review widzi pelen kontekst (kto/kiedy/dlaczego).

**D. Implementacja Ring 0 z grobnym pattern `process.env.PATRON_INTERNAL_CALL`**
- Odrzucone na razie. Brak call-sites w obecnym kodzie. Implementacja teraz = premature design dla niewystepujacego problemu. Dokumentujemy rezerwacje.

**E. Filter `getMcpTools()` output (hidden Ring 2 deny)**
- Odrzucone. LLM nie widzi narzedzia ktorego potrzebuje = brak transparency. Lepiej daj LLM error z jasna informacja "Tool X requires operator approval - skip" zeby moglo poinformowac uzytkownika.

**F. Hybrid (hidden dla niewdrozonych, error dla wdrozonych ale runtime deny)**
- Odrzucone. Premature complexity. MVP single-rule logic (Ring 1 allow / Ring 2 conditional). Hybrid jest mozliwy w przyszlosci jak pojawi sie konkretny case.

---

## Konsekwencje

### Pozytywne

- Fail-closed model dla 3rd-party MCP - uzytkownik dodal narzedzie z internetu, nie zwoduje sie cisza ze "samo dziala", musi explicit zaakceptowac.
- Defense-in-depth z Gateway: load-time skan definicji + runtime kontrola per-call.
- Konfig w `mcp-servers.json` = git audyt trail (kto / kiedy / dlaczego dopuscil).
- Pure function `decideRing` = testy bez mockow, latwy reuse w UI.
- Audit propagation dla **kazdej** decyzji ring-policy = pelen rejestr runtime autoryzacji (komplementarny do `mcp_security.gateway` z 0033).

### Negatywne / kosztowe

- Nowy plik `ring-policy.ts` + rozszerzenie `McpServerConfig` + storage map serverConfigByName + edit `runMcpTool` + dorzucenie audit-bridge eksportu = ~150-200 LoC powiekszenia kodu.
- 1 row audit_log na **kazdy** tool call (vs ~1 row per konektor per startup dla `mcp_security.gateway`). Dla aktywnego dnia kancelarii to moze byc kilkaset rows audit_log z `ring_policy.decision` tylko. Akceptowalne (rok dzialania = setki tysiecy rows, hash-chain dziala, Merkle upgrade ADR-0026 daje efektywna weryfikacje).
- Pole `operatorApproved` w pliku konfiguracyjnym mozliwe do nadpisania - jezeli atakujacy ma write access do `mcp-servers.json`, moze samodzielnie sobie zatwierdzic. To **akceptowalne** zalozenie modelu zagrozen: Patron zaklada lokalny RODO-safe deployment z Operatorem kontrolujacym pliki konfiguracyjne (Konstytucja Art. 4.2 rola Operatora).

### Bramki PO wpieciu (potwierdzone w tej sesji)

- Testy backend: **429/434 pass** (+5 todo, +28 nowych testow w `ring-policy.test.ts`).
- TSC clean.
- 2 rundy wewnetrznego review redakcyjnego dla treści ADR.
- Tajemnica zawodowa: zero realnych danych w testach/fixture/komentarzach.

---

## Atrybucja

Pattern 3-ring (z modelu 4-ring Microsoft AGT) wprost zaplanowany w ADR-0024. Implementacja w Patronie napisana od zera. Wzorzec "audit bez blokowania glownego watku" + pure function dla decyzji autoryzacyjnej - wlasny styl Patrona. Reuse modulu `audit-bridge.ts` z ADR-0033.

Pelna atrybucja: [ADR-0024](./0024-cherry-pick-microsoft-agt-mcp-security-merkle-rings.md) + [THIRD_PARTY_INSPIRATIONS.md sekcja microsoft/agent-governance-toolkit](../../THIRD_PARTY_INSPIRATIONS.md).
