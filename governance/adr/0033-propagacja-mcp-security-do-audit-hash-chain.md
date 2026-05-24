# ADR-0033: Propagacja decyzji MCP Security Gateway do audit hash-chain

> **Uwaga zakres**: ADR-0033 realizuje **pierwsza polowe** zadania zostawionego przez ADR-0028 ("propagacja do audit hash-chain (ADR-0001) w przyszlym ADR"). Druga polowa - **UI banner dla Operatora i admin endpoint** - jest poza scope tego ADR, bo Patron nie ma jeszcze patternu RBAC w kodzie (`requireAuth` zwraca `userId` ale nie role). Admin role + UI banner dostana wlasny ADR (rezerwacja ADR-0034) zeby nie miesac trzech decyzji architektonicznych w jednym record.

**Status**: WDROZONY (2026-05-24). Wpiecie w `backend/src/lib/mcp/index.ts` LIVE. Decyzje Gateway'a inne niz `allowed` (czyli `audit`, `human_review`, `denied`) sa zapisywane do `audit_log` z `event_type = "mcp_security.gateway"` przez nowy modul `backend/src/lib/mcp/audit-bridge.ts`. Modul gracefully no-op gdy `SUPABASE_URL` / `SUPABASE_SECRET_KEY` env brak (analogicznie do `loadConfig` w `lib/mcp/index.ts` ktore no-op gdy `mcp-servers.json` nie istnieje).

**Data**: 2026-05-24

**Powiazane zasady Konstytucji Patrona v1.2.2** (zweryfikowane grepem - [[feedback_grep_constitution_pre_cite]]):
- **Art. 3 - Audytowalnosc (AI Act art. 12, RODO art. 30)** - GLOWNA zasada tego ADR. Decyzja MCP Security Gateway to artefakt governance pierwszego rzedu: blokada konektora MCP z powodu drift / typosquat / hidden-instructions / tool-poisoning wplywa na to, jakie narzedzia LLM moze uzyc. Bez sladu w audit hash-chain ten artefakt zyje tylko w `console.warn` (`lib/mcp/index.ts:284,297`) - ulotny, nieweryfikowalny, niewspolny dla rejestru AI Act art. 12.
- **Art. 6 - Granica bledu (human in the loop)** - decyzja `human_review` wymaga reakcji Operatora. Audit hash-chain to pierwszy krok ku UI ktore ten review umozliwi (ADR-0034). Nawet bez UI Operator moze recznie sprawdzic stan przez SQL/scripts/verify-audit-chain (zalozenie pesymistyczne).
- **Art. 8 - Stalosc kontraktow** - propagacja do audit nie zmienia API publicznego `lib/mcp/index.ts` (`getMcpTools()`, `isMcpTool()`, `runMcpTool()`, `extractMcpCitations()` bez zmian). Audit dziala fire-and-forget: porazka audit_log NIE blokuje rejestracji toolow (bo Konstytucja Art. 8 oczekuje stabilnego kontraktu MCP).
- **Art. 1 - Lokalnosc danych** - audit_log jest lokalna tabela Postgres w schemacie Patrona. Decyzje Gateway nigdzie nie wychodza poza ten lokalny chain.

**Powiazane ADR**:
- **[ADR-0001](./0001-audit-trail-hash-chain.md)** - definicja hash-chain. Ten ADR jest pierwszym konsumentem hash-chain spoza warstwy `chat.*` / `tool.call`.
- **[ADR-0025](./0025-mcp-security-gateway-wdrazenie.md)** - skeleton MCP Security Gateway (4 detektory, types). Bez 0025 ten ADR nie ma czego logowac.
- **[ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md)** - rodzic bezposredni. Wpiecie Gateway'a w `getMcpTools()` z propagacja `console.warn`. Ten ADR uzupelnia odlozone zadanie z sekcji "Czego NIE robimy" ADR-0028: propagacja decyzji Gateway'a z polem `event_type = "mcp_security.gateway"` do hash-chain audit, z dopiskiem ze pelna integracja czeka na UI dla Operatora do zatwierdzania `human_review`. (Errata: ADR-0028 odwoluje sie do tej tabeli jako "audit_events"; faktyczna nazwa to `audit_log` per [`backend/schema.sql:397`](../../backend/schema.sql), nazwa "audit_events" nigdzie indziej w repo nie wystepuje. PATCH dla ADR-0028 - poza scope tego ADR.)

---

## Decyzja

Dorzucamy maly modul `backend/src/lib/mcp/audit-bridge.ts` (84 linii z komentarzami JSDoc, jedna eksportowana funkcja `recordMcpSecurityEvent`) oraz dwie fire-and-forget wstawki w `backend/src/lib/mcp/index.ts` (faza 3 `getMcpTools()`). Modul `audit-bridge`:

1. Eksportuje `recordMcpSecurityEvent(args: { serverName, action, riskScore, findingsCount, findings })`.
2. Wewnatrz: probuje stworzyc `createServerSupabase()`. Gdy env brak (`SUPABASE_URL` / `SUPABASE_SECRET_KEY`), zwraca `{ ok: false, reason: "env_missing" }` bez throw - **graceful no-op**, analogicznie do `loadConfig` w `lib/mcp/index.ts`.
3. Gdy env jest: wywoluje `appendAuditEvent(db, { event_type: "mcp_security.gateway", payload })`. Payload to **wylacznie metadane skanu** - bez `sample`, bez argumentow toola, bez tresci konektorow.

### Schemat payloadu

```ts
{
  server_name: string,        // np. "saos-orzeczenia"
  action: "audit" | "human_review" | "denied",
  risk_score: number,         // 0-100
  findings_count: number,
  findings: [                 // truncated: tylko 3 pola na finding, bez `sample`
    { detector: string, severity: McpSeverity, message: string },
    ...
  ],
}
```

Pole `actor_user_id` jest `null` (event systemowy - skan dzieje sie przy ladowaniu konektorow MCP, czyli przy pierwszym wywolaniu `getMcpTools()` w procesie backendu; `getMcpTools()` jest cached, wiec dla pojedynczego procesu skan biegnie raz). Pole `chat_id`/`document_id` rowniez `null`.

### Co JEST w payload (i dlaczego):
- `server_name` - identyfikator skanowanego konektora (nasze 6 + ewentualne 3rd-party). Public-safe.
- `action` - decyzja Gateway. Wartosc enum, bezpieczna.
- `risk_score` - liczba 0-100. Numerical, bezpieczna.
- `findings_count` - liczba znalezisk. Numerical.
- `findings[].detector` - nazwa detektora (np. "typosquat-distance"). Statyczne.
- `findings[].severity` - enum.
- `findings[].message` - opis detektora po polsku bez diakrytyki (per komentarz `mcp-security/types.ts:43`). **Statyczny tekst detektora**, nie cytuje danych dynamicznych.

### Co NIE jest w payload (eksplicytna minimalizacja - Art. 7 Minimalnosc):
- `findings[].sample` - **POMINIETE**. Sample to "Surowy fragment wzbudzajacy podejrzenie - przyciety do 200 znakow" (per komentarz `mcp-security/types.ts:46`). Dla skanu opisu 3rd-party konektora MCP mogloby (teoretycznie) zawierac dane wprowadzone przez atakujacego. Operator widzi sample w `console.warn` (lokalny log), ale w audit_log (ktory moze byc backupowany dla AI Act art. 12 dluzej niz log konsoli) trzymamy tylko metadata.
- Argumenty toola, parametry inputSchema, transport endpoints - **POMINIETE**. Nie ma ich w `McpFinding`, ale na wszelki wypadek dokumentujemy ze nie sa dodawane do payload.

To zgodne z komentarzem `audit.ts:18-20`: *"UWAGA: payload trafia do bazy w pelnej formie - nie wkladaj tam pelnych tresci dokumentow ani osobowych danych klientow kancelarii. Domyslnie trzymaj sie skrotow"*.

### Fire-and-forget propagacja

Wywolanie `recordMcpSecurityEvent` w `getMcpTools()` jest fire-and-forget (`void`-ed Promise, error swallow do `console.warn`). Powod: Konstytucja Art. 8 (stalosc kontraktow). Porazka audit (np. tabela `audit_log` niedostepna, race condition) NIE moze blokowac rejestracji toolow MCP - Patron startuje z dotychczasowymi konektorami, audit zwraca warning. To samo zachowanie co istniejacy `appendAuditEvent` (komentarz `audit.ts:118`: *"Nigdy nie rzuca - bledy logowane do konsoli"*).

### Lista znanych event_types po tym ADR

Komentarz `audit.ts` zostaje uzupelniony o pelna liste znanych event_types Patrona:
- `chat.created` - rejestracja nowego czatu
- `chat.message.user` - wiadomosc uzytkownika
- `chat.message.assistant` - odpowiedz LLM
- `tool.call` - wywolanie narzedzia (MCP albo native)
- `mcp_security.gateway` - **NOWE** - decyzja MCP Security Gateway dla konektora

To nie jest CHECK constraint (kolumna `event_type` to wolny `text not null`), tylko **konwencja** dokumentowana w komentarzu. Wzmacnianie do CHECK constraint to osobna decyzja architektoniczna (infrastruktura migracji + whitelist) - rezerwacja ADR-0035.

---

## Co robimy w tym ADR
- Nowy plik `backend/src/lib/mcp/audit-bridge.ts` (~30 LoC).
- 2 fire-and-forget wywolania `recordMcpSecurityEvent` w fazie 3 `getMcpTools()` (po istniejacych `console.warn` dla path `audit` i path BLOCKED).
- Uzupelnienie komentarza `lib/audit.ts` o nowy event_type `mcp_security.gateway`.
- 5 testow w `backend/src/lib/mcp/audit-bridge.test.ts` (mock db, weryfikacja payloadu, no-op gdy env brak, swallow blędow audit, weryfikacja braku `sample` w payload, weryfikacja branchu allowed-no-findings ktory NIE emituje eventu).
- AGENTS.md + CHANGELOG.md catchup.

## Czego NIE robimy w tym ADR (osobne ADR-y)

- **NIE robimy UI bannera dla Operatora ani endpointu `/api/admin/mcp-security/recent`** - Patron nie ma admin RBAC w kodzie. Stworzenie patternu "kto jest admin" (Supabase user_metadata flag? env-based email allowlist? osobna tabela `admin_users`?) to wlasna decyzja architektoniczna. Rezerwacja **ADR-0034**.
- **NIE robimy infrastruktury migracji Postgres ani CHECK constraint na `event_type`** - Patron ma jeden plik `backend/schema.sql` jako baseline, bez systemu migracji incremental. Wybor narzedzia (Supabase migrations / node-pg-migrate / Drizzle / wlasny runner) + strategia rollback + dev/prod parity to wlasny ADR. Rezerwacja **ADR-0035**.
- **NIE zmieniamy API publicznego** `lib/mcp/index.ts` - `getMcpTools()`, `isMcpTool()`, `runMcpTool()`, `extractMcpCitations()` zachowane sygnatury.
- **NIE blokujemy registracji toolow przy porazce audit** - fire-and-forget. Audit jest dodatkiem, nie warunkiem dzialania MCP.

---

## Kontekst

### Dlaczego propagacja jest potrzebna

Po ADR-0028 decyzje Gateway lecialy do `console.warn` z tagiem `[MCP-SECURITY]`. To wystarczy do debug podczas developmentu, ale niewystarczajaco dla:

1. **AI Act art. 12 (record-keeping)** - logi konsoli sa ulotne (rotacja systemd journal, restart kontenera). Audit_log to **append-only z hash-chain** (ADR-0001). Decyzja governance pierwszego rzedu (blokada konektora) musi byc tam.
2. **Weryfikator hash-chain** (`scripts/verify-audit-chain.ts`) - obecnie nie widzi tych decyzji. Po tym ADR widzi.
3. **Pierwszy krok do UI** (ADR-0034) - bez sladu w bazie UI nie ma czego pokazac. Audit jest infrastruktura, UI jest jej konsumentem.

### Dlaczego osobny modul (audit-bridge.ts) zamiast inline w index.ts

Dwa powody:

1. **Testowalnosc** - `lib/mcp/index.ts` ma efekty uboczne (kreacja MCP klientow, plik baseline) ktore utrudniaja mockowanie samej propagacji audit. Wydzielony modul ma jedna funkcje z dependency injection seam (`SupabaseFactory`), latwo testowalna w izolacji.
2. **Czytelnosc** - `getMcpTools()` ma juz 3-fazowa logike (collect / scan / register). Inline `appendAuditEvent` w petli register zaszumia kod.

### Dlaczego `audit` propagujemy do audit_log mimo ze tools sa rejestrowane

Decyzja Gateway `audit` znaczy "rejestruj tools, ale jest finding wart sledzenia" (np. drift detector przy pierwszym ladowaniu konektora - finding `severity: low`). Trzymanie tego w hash-chain pomaga w forenzics ("kiedy hash konektora X sie zmienil?"). Koszt nominalny (~1 row Postgres na konektor na startup).

### Dlaczego `allowed` bez findings NIE propagujemy

Branch w `lib/mcp/index.ts:282` to `if (result.action === "audit" || result.findings.length > 0)`. Czyli `allowed` z `findings.length === 0` to "czyste przejscie" - **nie emitujemy event'u**. Powod: minimalizacja audit_log (Art. 7). Audit ma rejestrowac decyzje **inne** niz baseline. `allowed-clean` to baseline.

---

## Alternatywy rozwazane

**A. Inline `appendAuditEvent` w petli `for (const d of ok)` w `getMcpTools()`**
- Odrzucone. Mieszanie 3 obowiazkow w jednej funkcji (collect + register + audit). Trudniejsze do testow. Patrz "Czytelnosc" w Kontekst.

**B. Wstrzykiwanie `auditWriter?` jako parametr opcjonalny do `getMcpTools(options)`**
- Odrzucone. Dependency injection pattern wart rozwazania, ale rozszerza API publiczne `getMcpTools` ktore jest stabilne (Art. 8). Modul-level helper jest prostszy i nie zmienia API.

**C. Twarda failure gdy `appendAuditEvent` rzuca - blokada registracji**
- Odrzucone. Lamie Konstytucja Art. 8 (stalosc kontraktow) - audit infrastruktura nigdy nie blokowala dotad dzialania core path. ADR-0001 sam mowi *"Nigdy nie rzuca"*.

**D. Modul `audit-bridge.ts` + fire-and-forget (przyjete)**
- Atomowa zmiana, jasna granica, testowalna, nie lamie Art. 8.

**E. Pakowanie sample w payload dla pelniejszego forenzic**
- Odrzucone. Tajemnica zawodowa (Konstytucja Art. 5) - sample jest "surowy fragment" mogacy zawierac dane wprowadzone przez 3rd-party. Operator widzi sample w `console.warn` lokalnie; audit_log to dluzszy backup. Minimalizacja danych (Art. 7).

---

## Konsekwencje

### Pozytywne

- Decyzje MCP Security Gateway widoczne w hash-chain - **AI Act art. 12 (record-keeping) obejmuje teraz `mcp_security.gateway` obok dotychczas faktycznie logowanych** `chat.message.user` (handler w [`backend/src/routes/chat.ts:527`](../../backend/src/routes/chat.ts) + [`projectChat.ts:92`](../../backend/src/routes/projectChat.ts)) oraz `chat.message.assistant` ([`chat.ts:614`](../../backend/src/routes/chat.ts) + [`projectChat.ts:202`](../../backend/src/routes/projectChat.ts)). Pozostale wartosci z listy konwencji w komentarzu `lib/audit.ts` (`chat.created`, `tool.call`) sa zarezerwowane - uzywane obecnie wylacznie jako sample w `audit.test.ts`, brak wywolan w produkcyjnym kodzie. Po wpieciu ADR-0033: 3 faktycznie logowane `event_type` w produkcji, 2 zarezerwowane w konwencji.
- Weryfikator hash-chain (`scripts/verify-audit-chain.ts`) automatycznie obejmuje nowe eventy.
- Pierwszy krok ku UI (ADR-0034) - audit_log ma dane do pokazania.
- API publiczne `lib/mcp/index.ts` niezmienione (Art. 8).
- Modul `audit-bridge.ts` jest reuzywalny - jezeli kiedys pojawi sie kolejne miejsce wpinajace decyzje Gateway, ten sam helper.

### Negatywne / kosztowe

- Nowy plik `audit-bridge.ts` ma 84 linii (z komentarzami JSDoc); `lib/mcp/index.ts` ma diff +27 linii (2 wstawki fire-and-forget); plik testow `audit-bridge.test.ts` ma 183 linii (5 testow + helper `mockDb`). Niewielki przyrost powierzchni.
- ~1 row Postgres na konektor na startup dla `action != "allowed-clean"`. Przy 6 konektorach maks 6 rows na restart = nominalnie.
- Komentarz w `audit.ts` musi byc aktualizowany przy kolejnych dodaniach event_type (technical debt zmniejszany rozwiazaniem CHECK constraint w ADR-0035).

### Bramki PO wpieciu (potwierdzone w tej sesji)

- Testy backend: **396/401 pass + nowe 5 testow audit-bridge** = 401/406 pass (5 todo).
- TSC clean.
- 2x runda marko-pl (per [[feedback_marko_2x_runda_pattern]]).
- Tajemnica zawodowa: zaden test/fixture/komentarz nie zawiera danych z realnych spraw (per [[feedback_tajemnica_adwokacka_radcowska_NIGDY]]).

---

## Atrybucja

Propagacja decyzji MCP Security Gateway do audit hash-chain Patrona to wlasny pattern Patrona, zaprojektowany w ramach ADR-0001 (hash-chain) i ADR-0025 (Gateway). Modul `audit-bridge.ts` napisany od zera. Style "nigdy nie rzuca, bledy zwracane w polu rezultatu" zaczerpniety z `appendAuditEvent` (`lib/audit.ts:127`, komentarz "Nigdy nie rzuca - bledy logowane do konsoli"); style "graceful no-op gdy plik/env brak" zaczerpniety z `loadConfig` w `lib/mcp/index.ts:63` (no-op gdy `mcp-servers.json` nie istnieje).

ADR-0028 jest rodzicem bezposrednim - eksplicytnie zostawil "propagacja decyzji Gateway'a do audit hash-chain (ADR-0001) w przyszlym ADR (gdy bedzie UI dla Operatora do zatwierdzania human_review)". Ten ADR realizuje pierwsza polowe (propagacja); UI dostanie wlasny ADR-0034 zeby nie miesac decyzji audit z patternem RBAC.
