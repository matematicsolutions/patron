# ADR-0042: UI banner MCP Security Gateway dla operatora kancelarii

**Status**: PROPONOWANY (2026-05-27). Realizacja rezerwacji z ADR-0034 sekcja "ADR-0042 (rezerwowane) - UI banner mcp-security". Atomowy scope-down: ADR-0034 byl pierwotnie planowany jako "admin RBAC + UI banner mcp-security", rozbity na 0034 (backend RBAC) i ten ADR (frontend banner).

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.7 -> v1.2.8):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - operator kancelarii widzi stan gateway'a w panelu admin: ile decyzji `audit`/`human_review`/`denied` zostalo zarejestrowanych w ostatnich 24h. Banner to pasywny sygnal stanu kontroli (read-only widget, nie alert).
- **Art. 6 - Granica bledu** (human in the loop) - banner pokazuje admin czy gateway aktywny i w jakim trybie (enforce / audit-only / off). Operator zna stan kontroli bez zagladania w logi.
- **Art. 4 - Neutralnosc wobec dostawcow** - banner czyta wylacznie audit_log + env (`MCP_SECURITY_GATEWAY_MODE`). Zero zaleznosci od zewnetrznych monitoringow.

**Powiazane ADR**:
- **ADR-0025** + **ADR-0028** + **ADR-0033** - rodzice (MCP Security Gateway runtime + wpiecie w startup + propagacja decyzji do audit). Ten ADR daje UI fasade dla wynikow gateway'a.
- **ADR-0034** - blocker. Banner widoczny TYLKO dla admin (whitelist email env). Endpoint chroniony `requireAdmin`.
- **ADR-0040 (rezerwowane)** - UI viewer audytora. Ten ADR daje wzorzec UI komponentow (hook + komponent + endpoint) dla viewera. ADR-0040 zbuduje na tym fundamencie.
- **ADR-0043 (rezerwowane)** - audit_log dla admin actions (event_type `admin.access`). Logowanie wejsc admin na banner do audit_log = rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist event_type).

---

## Problem

Po ADR-0025/0028/0033 MCP Security Gateway dziala w runtime i propaguje decyzje do `audit_log` (event_type `mcp_security.gateway`). Operator kancelarii nie ma jednak zadnego UI sygnalu:

- Czy gateway w ogole jest aktywny w aktualnym deploymencie? (env `MCP_SECURITY_GATEWAY_MODE` moze byc nieustawione = no-op)
- W jakim trybie pracuje? (`enforce` blokuje toole, `audit` loguje ale przepuszcza, `off` no-op)
- Ile decyzji innych niz `allowed-clean` zostalo zarejestrowanych w ostatnich 24h?
- Czy w ostatnim skanie startup-time wystapilo `human_review` lub `denied`?

Bez tego sygnalu operator kancelarii odkrywa incydenty MCP Security dopiero podczas okresowego audytu (compliance officer wchodzi w audit_log). Banner zamyka petle obserwowalnosci w panelu admin.

---

## Decyzja

### A. Endpoint backend `GET /api/security/mcp-status`

Nowy router `backend/src/routes/security.ts`. Endpoint zwraca samowystarczalny stan gateway'a:

```json
{
  "gateway": {
    "mode": "enforce" | "audit" | "off",
    "active": true | false,
    "last_startup_scan": {
      "timestamp": "2026-05-27T15:43:00Z",
      "overall_action": "allowed" | "audit" | "human_review" | "denied",
      "servers_scanned": 6,
      "findings_count": 0
    } | null
  },
  "audit_summary_24h": {
    "decisions_total": 14,
    "by_action": {
      "audit": 12,
      "human_review": 2,
      "denied": 0
    }
  }
}
```

Autoryzacja: `requireAuth` + `requireAdmin` (per ADR-0034). Endpoint zwraca 403 dla non-admin (banner pokazany TYLKO admin).

Implementacja:
- `gateway.mode` - czytane z env `MCP_SECURITY_GATEWAY_MODE` (NOWA zmienna env wprowadzana w tym ADR, patrz sekcja E). Wartosci: `"enforce"` / `"audit"` / `"off"`. Brak env = `"off"` (fail-safe: gdy admin nie ustawil explicite, banner pokazuje wylaczony zamiast falszywie sugerowac aktywnosc). Nie zmienia to runtime behavior gateway'a wpietego przez ADR-0028 - sam gateway jest w stalym kontrakcie startup-time.
- `gateway.active` - `mode !== "off"`.
- `gateway.last_startup_scan` - czytane z `audit_log` ostatni event `event_type = "mcp_security.gateway.startup"` (nowy podtyp event_type w ADR-0043 lub fallback do najstarszego `mcp_security.gateway` z payload `phase: "startup"`).
- `audit_summary_24h` - agregacja `audit_log` gdzie `event_type = "mcp_security.gateway"` i `created_at >= NOW() - INTERVAL '24 hours'`.

Status codes:
- 200 - JSON jak wyzej
- 401 - brak/niepoprawny JWT
- 403 - non-admin
- 500 - blad DB

### B. Hook frontend `useMcpSecurityStatus()`

Plik `frontend/src/hooks/useMcpSecurityStatus.ts`. Polling co 60s przez natywny `useEffect` + `setInterval` + `fetch`. Zero nowych zaleznosci npm (TanStack Query nie jest w aktualnym stosie frontendowym; dodawanie biblioteki tylko dla jednego polling endpointu narusza Konstytucja Art. 4 - neutralnosc wobec dostawcow).

Strategia error handling:
- 403 (non-admin) -> hook zwraca `{ visible: false }`, banner sie nie renderuje
- 5xx / network -> hook zwraca `{ visible: false, error: ... }`, banner sie nie renderuje (fail-closed, zero szumu)
- 200 ale `gateway.active === false` -> banner sie renderuje w kolorze szarym z komunikatem "MCP Security Gateway: WYLACZONY"

### C. Komponent `<McpSecurityBanner />` w `frontend/src/components/mcp-security-banner.tsx`

Banner tailwind + shadcn (lucide ShieldCheck / ShieldAlert / ShieldOff). Kolor zalezny od stanu:

| Stan gateway | Kolor | Ikona | Tekst |
|---|---|---|---|
| `mode: "enforce"` + `audit_summary_24h.by_action.denied === 0` | zielony (bg-emerald-50 border-emerald-200) | ShieldCheck | "MCP Security: aktywny (enforce). Ostatnie 24h: {audit}, {human_review}." |
| `mode: "enforce"` + `denied > 0` | czerwony (bg-red-50 border-red-200) | ShieldAlert | "MCP Security: ZABLOKOWANO {denied} toolow w 24h. Sprawdz audit_log." |
| `mode: "audit"` | zolty (bg-amber-50 border-amber-200) | ShieldAlert | "MCP Security: audit-only. Toole NIE sa blokowane, tylko logowane." |
| `mode: "off"` | szary (bg-gray-50 border-gray-200) | ShieldOff | "MCP Security: WYLACZONY. Zalecane wlaczenie w env." |

Wpiecie: `frontend/src/app/layout.tsx` lub `frontend/src/app/(pages)/admin/layout.tsx` (preferowane - banner widoczny TYLKO w panelu admin, nie zaskoczy zwyklego prawnika).

Dostepnosc (praktyczne wymagania):
- Banner ma `role="status"` z `aria-live="polite"` (nie alert, banner to pasywny sygnal)
- Banner ma `aria-label` z pelnym opisem stanu (czytniki ekranu)
- Para tekst+tlo: tekst w `text-emerald-900` / `text-red-900` / `text-amber-900` / `text-gray-900` na tle `bg-emerald-50` / `bg-red-50` / `bg-amber-50` / `bg-gray-50` - oba zestawy w tej samej rodzinie shadcn co reszta UI Patrona

### D. Nowa zmienna env `MCP_SECURITY_GATEWAY_MODE`

Nowy wpis w `.env.docker.example` + `.env.local.example`:

```
# ADR-0042 - tryb pracy MCP Security Gateway dla UI banneru w panelu admin
# Wartosci: "enforce" (blokuje toole) / "audit" (loguje, nie blokuje) / "off" (no-op)
# Brak zmiennej = traktowane jako "off" (fail-safe). Restart kontenera = nowa wartosc.
MCP_SECURITY_GATEWAY_MODE=off
```

Zmienna jest CZYTANA przez endpoint `/api/security/mcp-status` (decyzja A). Sam gateway runtime (ADR-0028) NIE zmienia zachowania w tej iteracji - egzekucja decyzji `enforce` vs `audit` na poziomie wpiecia toolow = rezerwacja ADR-0045 (mode-aware enforcement). W ADR-0042 zmienna sluzy wylacznie jako deklaracja operatora widoczna w UI: "mam swiadomy wybor trybu" (Art. 6 granica bledu - explicit operator intent zamiast magic default).

### E. Konstytucja v1.2.7 -> v1.2.8 PATCH bump

Bump PATCH (nie MINOR) - ADR-0042 nie wprowadza nowej zasady ani roli, tylko UI fasade nad istniejacymi decyzjami architektonicznymi (ADR-0025/0028/0033). Sekcja CHANGELOG konstytucji: "v1.2.8 (2026-05-27): ADR-0042 UI banner MCP Security Gateway dla operatora kancelarii (panel admin, requireAdmin per ADR-0034)."

---

## Alternatywy odrzucone

1. **Banner widoczny dla wszystkich uzytkownikow (nie tylko admin)**. Odrzucone: zwykly prawnik nie powinien widziec ze "ostatnio 2 toole MCP zostaly zablokowane" - to disclosure incydentow bezpieczenstwa poza krag osob uprawnionych. Tylko admin (whitelist emaili per ADR-0034).
2. **Real-time WebSocket zamiast polling 60s**. Odrzucone: decyzje MCP Security generowane sa w dwoch miejscach - startup-time (skan przy starcie backendu, ADR-0028) oraz przy `loadConfig` reload (rzadkie, manualne). To zdarzenia dyskretne, nie strumien danych. Polling 60s daje aktualnosc dla operatora wchodzacego do panelu admin bez dodawania WebSocket do stosu (Konstytucja Art. 4 neutralnosc).
3. **Banner widoczny w globalnym layout.tsx zamiast admin layout**. Odrzucone z tego samego powodu co alternatywa #1.
4. **Wpiecie banneru w existing notification system (toast/snackbar)**. Odrzucone: notyfikacje sa ephemeral, banner ma byc persistent (operator widzi stan przy kazdym wejsciu do panelu admin).
5. **Endpoint zwracajacy pelne `findings[]` z ostatnich decyzji**. Odrzucone: payload findings moze zawierac samples z opisow toolow (potencjalne PII jezeli MCP server byl skompromitowany). Banner pokazuje tylko liczby + akcje, szczegoly w viewer ADR-0040.

---

## Bramki PRZED merge (wynik faktyczny)

- **11 testow backend pass** (vs target 4): 5x `readGatewayMode` (enforce/audit/off/brak env/case insensitive), 3x `countAuditActions` (pusta lista/mix/ignorowanie nieznanych), 3x `buildStatusPayload` (mode off active false/enforce active true/audit active true). Pure functions, zero mockow Supabase, deterministyczne.
- **TSC clean** backend i frontend (`npx tsc --noEmit` zero bledow w obu).
- **Vitest backend pass**: 535/540 (+11 nowych testow vs baseline 524/529), 5 todo bez zmian, zero fail.
- **LoC dodanych**: 580 (vs target ~250 - przekroczone gornym pulapem). Backend route+test 276, frontend hook+banner 155, ADR 150.
- **2 rundy review tekstu ADR** zakonczone werdyktem przecietne -> przecietne+ z 4 fixami (Art. 7 ref, "okazjonalne", "z briefingu", shadcn presetki kontrast).
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero personae Marko, zero internal slugi MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione (a/e/l/o/s/n/c/z).

**Errata**: frontend integration testy bannerova (3 scenariusze render) NIE zostaly dodane w tej iteracji - PATRON frontend nie ma jeszcze ustawionego Vitest + React Testing Library (brak `vitest.config` w `frontend/`). Rezerwacja **ADR-0044** (vitest frontend setup + testy MCP Security Banner + ADR-0040 viewer + buduje fundament dla kolejnych komponentow).

---

## Co NIE jest w ADR-0042 (rezerwacje)

- **UI viewer pelnych decyzji MCP Security** -> rezerwacja **ADR-0040** (frontend admin panel: filtrowanie audit_log, drill-down per decyzja, eksport CSV).
- **Konfiguracja gateway przez UI** (zmiana mode z UI bez restartu kontenera) -> NIE planowane. Per Konstytucja Art. 1 lokalnosc + Art. 6 granica bledu - admin pool kancelarii ma dostep do `.env` i restartu kontenera, zero "soft config" admin paneli zmieniajacych zachowanie security gateway w runtime.
- **Notyfikacje email/Slack** gdy `denied > N` w ostatniej godzinie -> rezerwacja **ADR-0044** (notification policy). Banner to passive sygnal w UI, active notyfikacje to osobna decyzja architektoniczna.
- **Logowanie wejsc admin na banner do audit_log** (`event_type: "admin.access.security_banner"`) -> rezerwacja ADR-0043 (admin.access generalnie + migracja 002 ALTER CHECK).
- **Mode-aware enforcement w gateway runtime** (rzeczywista zmiana zachowania gateway na podstawie env `MCP_SECURITY_GATEWAY_MODE`) -> rezerwacja **ADR-0045**. W ADR-0042 zmienna sluzy wylacznie do deklaracji w UI - sam gateway zachowuje sie jak w ADR-0028 (skanuje startup, propaguje do audit przez ADR-0033).
