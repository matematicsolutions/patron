# ADR-0034: RBAC admin oparty na whitelist emaili w env

> **Uwaga numeracja**: ADR-0034 zarezerwowany w komunikacji projektowej jako "admin RBAC + UI banner mcp-security". Ten ADR realizuje rezerwacje **w wezszym zakresie** - tylko backend RBAC (whitelist emaili + middleware `requireAdmin`). UI banner mcp-security = rezerwacja ADR-0042 (frontend Next.js, wymaga osobnego nakladu). Atomowy scope-down.

**Status**: WDROZONY (2026-05-27). Middleware `requireAdmin` LIVE w `backend/src/middleware/auth.ts` (rozszerzenie istniejacego pliku). Wpiecie na endpoincie `GET /api/audit/merkle/verify/:eventId` (zaostrzenie autoryzacji z "kazdy zalogowany" do "admin only"). Whitelist emaili w env `PATRON_ADMIN_EMAILS` (CSV).

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.5 -> v1.2.6):
- **Art. 6 - Granica bledu** (human in the loop) - GLOWNA zasada. Admin pool kancelarii to 1-3 osoby fizyczne (operator/wspolnik/IT). Whitelist emaili = explicite "kto moze podpisac admin action". Zero domyslnego eskalowania uprawnien.
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - kazdy dostep admin loguje sie przez `console.warn` ze structured tag `[ADMIN]` (gateway dla audytora). Pelne audit_log entry dla zdarzen admin = rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK).
- **Art. 1 - Lokalnosc danych** - lista adminow w `.env`, restart kontenera = nowa lista. Zero zewnetrznego IdP / OAuth / cloud auth provider. Patron pozostaje self-host.
- **Art. 4 - Neutralnosc wobec dostawcow** - zero nowych zaleznosci npm. Whitelist parsowanie z env to natywny JavaScript `split` + lowercase trim.

**Powiazane ADR**:
- **ADR-0025** + **ADR-0033** - rodzice (MCP Security Gateway, propagacja decyzji do audit). Ten ADR otwiera droge do UI banner mcp-security (ADR-0042) ktore pokaze admin decyzje gateway'a w UI.
- **ADR-0036** - bezposredni klient. Endpoint `/api/audit/merkle/verify/:eventId` byl chroniony `requireAuth` (kazdy zalogowany); od tego ADR jest chroniony `requireAdmin` (admin only). ADR-0036 explicite mowi w sekcji "Autoryzacja": "Po wpieciu ADR-0034 endpoint zostanie ograniczony do roli `admin` przez dodatkowy middleware `requireAdmin` przed `requireAuth`."
- **ADR-0040 (rezerwowane)** - UI viewer dla audytora (frontend Next.js). Blocked-by ten ADR.
- **ADR-0042 (rezerwowane)** - UI banner mcp-security. Scope-down z briefingu - UI wymaga frontend nakladu, osobny ADR.
- **ADR-0043 (rezerwowane)** - audit_log dla admin actions. Wymaga migracji 002 ALTER CHECK constraint event_type whitelist o `admin.access`.

---

## Decyzja

### A. Admin = whitelist emaili w env `PATRON_ADMIN_EMAILS`

```
PATRON_ADMIN_EMAILS=admin@kancelaria.pl,wspolnik@kancelaria.pl,it@kancelaria.pl
```

Format: CSV, lowercase, trim spacji. Pusty / brak env = brak adminow (kazde wywolanie `requireAdmin` zwroci 403). Operator kancelarii edytuje `.env`, restart kontenera, nowa lista aktywna.

Dlaczego whitelist emaili a nie kolumna `is_admin` w `user_profiles`:
- **Zero schema change** - brak migracji 002.
- **MVP simplicity** - 1-3 adminow per kancelaria, lista w env = audytowalne przez git history `.env.example`.
- **Bezpieczenstwo** - admin nadanie wymaga dostepu do serwera kancelarii (`.env` + restart kontenera), nie da sie eskalowac z UI.
- **Disclosure operator** - kancelaria wie kto jest admin bo lista jest w `.env` ktorego pilnuje IT.

Alternatywy odrzucone:
- **Kolumna `is_admin` w `user_profiles`** - schema change, audit log dla CRUD admin (wymaga migracji), wieksza powierzchnia ataku (admin moze nadawac admina z UI Supabase).
- **Tabela `admin_users(user_id PK)`** - to samo plus dedykowana tabela.
- **Supabase Auth custom claim** - wymaga setup Supabase Auth Hooks (cloud-specific), dodaje zaleznosc od jednego dostawcy w warstwie auth (Konstytucja Art. 4).
- **OAuth + role provider (Okta/Keycloak)** - overengineering dla kancelarii z 5-20 prawnikami.

### B. Middleware `requireAdmin` po `requireAuth`

```ts
export function requireAdmin(
  req: Request, res: Response, next: NextFunction
): void {
  // requireAuth musi byc wczesniej w lancuchu - userEmail z res.locals
  const userEmail = (res.locals.userEmail as string | undefined) ?? "";
  if (!userEmail || !isAdminEmail(userEmail)) {
    console.warn(`[ADMIN] denied: ${userEmail || "(no email)"} -> ${req.method} ${req.path}`);
    res.status(403).json({ detail: "Admin role required" });
    return;
  }
  console.warn(`[ADMIN] grant: ${userEmail} -> ${req.method} ${req.path}`);
  next();
}
```

Sygnatura sync (`void`, bez `async`) - middleware czyta `res.locals.userEmail` i wywoluje `next()` lub `res.status()`. Brak IO, nie potrzeba Promise.

Kontrakt: ZAWSZE po `requireAuth` (potrzebuje `res.locals.userEmail`). Helper `isAdminEmail` to pure function nad parsowana lista z env.

Strukturyzowane logi `[ADMIN]` (grant + denied) na stdout - operator kancelarii widzi w `docker logs` kto i kiedy korzystal z admin powers. Brak audit_log w tym ADR - rezerwacja ADR-0043.

### C. Wpiecie na endpoincie ADR-0036 (zaostrzenie autoryzacji)

```ts
auditRouter.get(
  "/merkle/verify/:eventId",
  requireAuth,
  requireAdmin,  // <- NEW from ADR-0034
  async (req, res) => { ... }
);
```

Endpoint zwraca ProofBundle z hashami bloku - po wpieciu admin-only. Audytor (UODO, rewident kancelarii, biegly w postepowaniu) dostaje admin email od operatora przed wizyta. Pre-ADR-0034 endpoint byl "kazdy zalogowany" - tymczasowy kompromis ADR-0036 explicite mowiony w sekcji "Autoryzacja".

### D. Pure helper `isAdminEmail` + `parseAdminEmails`

```ts
export function parseAdminEmails(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set();
  return new Set(
    envValue.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  );
}

export function isAdminEmail(email: string, admins: Set<string> = ADMIN_EMAILS): boolean {
  return admins.has(email.trim().toLowerCase());
}
```

`ADMIN_EMAILS` cache na poziomie modulu (parse raz przy starcie). Pure functions testowalne bez DB / env.

### Zakres tego ADR
- Update `backend/src/middleware/auth.ts` - dodanie `parseAdminEmails`, `isAdminEmail`, `requireAdmin` (~50 LoC).
- Update `backend/src/routes/audit.ts` - dodanie `requireAdmin` w lancuchu middleware (~3 LoC).
- Update `backend/.env.example` - nowa env var `PATRON_ADMIN_EMAILS=` (pusta default + komentarz).
- Nowy plik testow `backend/src/middleware/auth.test.ts` (~100 LoC, 13 testow: 7 dla `parseAdminEmails` + 6 dla `isAdminEmail` - pure functions, zero IO).
- Update `governance/CONSTITUTION.md` v1.2.5 -> v1.2.6 PATCH (nowa sekcja 4.6 "Admin role" w rozdziale 4 Role governance).
- Update `CHANGELOG.md` entry [Unreleased].

### Czego NIE robimy w tym ADR (osobne ADR-y)
- **NIE robimy UI banner mcp-security** - rezerwacja ADR-0042 (frontend Next.js wymaga osobnego nakladu - nowa strona admin/, komponenty React, hooks).
- **NIE robimy UI viewer dla audytora** - rezerwacja ADR-0040 (blocked przez ten ADR + ADR-0042 RBAC w UI).
- **NIE robimy audit_log eventu `admin.access`** - rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist event_type). W tym ADR tylko `console.warn` ze structured tag `[ADMIN]`.
- **NIE robimy kolumny `is_admin` w user_profiles** - whitelist env wystarcza dla MVP (1-3 adminow per kancelaria).
- **NIE robimy CRUD admin przez API** - lista zarzadzana przez operatora kancelarii edycja `.env` + restart kontenera. Audyt admin pool = `git log .env.example` w repo deployment.

---

## Kontekst

### Dlaczego ADR-0036 zostawil RBAC jako blocker

ADR-0036 wprowadzil endpoint `/api/audit/merkle/verify/:eventId` chroniony tylko `requireAuth`. Sekcja "Autoryzacja" explicite mowi:
> KAZDY zalogowany user moze zapytac o proof bundle dla DOWOLNEGO eventId. To akceptowalny kompromis bo: ProofBundle nie zawiera tresci eventu (tylko hash + sasiednie hashe w drzewie Merkle). [...] Twarda RBAC (admin-only) = rezerwacja ADR-0034.

Ten ADR domyka rezerwacje przez `requireAdmin` middleware.

### Dlaczego whitelist email a nie role w DB

Patron jest produktem regulowanym dla kancelarii prawnej. Admin pool = osoby fizyczne (operator/wspolnik/IT). Lista jest stabilna (1-3 osoby, zmiany sporadyczne). Dynamiczne zarzadzanie przez UI dodaje:
- powierzchnie ataku (admin moze nadac admina z UI),
- audit log overhead (CRUD admin = nowe eventy),
- schema change (migracja 002, zmiana RLS).

Dla MVP whitelist w env = audytowalny przez `.env.example` w git, zmiana wymaga `git commit` + deploy, brak silent escalation.

Po przeskoczeniu MVP (np. kancelaria z 50+ prawnikami i 10+ adminow) - mozna przejsc na DB-backed role w przyszlym ADR. Wtedy `requireAdmin` zmieni implementacje z `isAdminEmail` na `isUserAdmin(userId)` bez zmiany kontraktu API (publiczne sygnatury middleware bez zmian).

### Dlaczego console.warn zamiast audit_log

Audit log eventu `admin.access` wymaga migracji 002 (ALTER CHECK constraint event_type whitelist dodajacy `admin.access`). Migracja = osobny ADR scope-down. Tymczasowo:
- `[ADMIN] grant: user@example.com -> GET /api/audit/merkle/verify/42` na stdout.
- Operator kancelarii widzi w `docker logs backend | grep '[ADMIN]'`.
- Dla audytu UODO ten zapis NIE jest hash-chained (wystarczy "to byly probne admin actions, beda w audit_log od ADR-0043").

Wzorzec analogiczny do ADR-0028 dla MCP Security (`[MCP-SECURITY]` console.warn -> propagacja do audit_log w ADR-0033).

### Dlaczego lowercase + trim

Email match musi byc case-insensitive (`Admin@kancelaria.pl` vs `admin@kancelaria.pl` to ten sam user). Trim spacji defensywnie - `PATRON_ADMIN_EMAILS="admin@k.pl , wspolnik@k.pl "` ma wiodace/koncowe spacje, parse robi `trim().toLowerCase()` na kazdym wpisie.

`requireAuth` juz lowercase'uje email z `data.user.email?.toLowerCase()` (sprawdzilem `auth.ts:89`) - kompatybilne.

---

## Alternatywy rozwazane

**A. Kolumna `is_admin` w `user_profiles`**
- Odrzucone. Schema change + audit log dla CRUD admin + UI do nadawania = overengineering dla 1-3 adminow.

**B. Tabela `admin_users(user_id PK)`**
- Odrzucone. To samo co A.

**C. Supabase Auth custom claim**
- Odrzucone. Wymaga Supabase Auth Hooks (cloud-specific), zaleznosc od jednego dostawcy auth.

**D. OAuth + role provider (Okta/Keycloak)**
- Odrzucone. Overengineering dla kancelarii, dodatkowy komponent infra do utrzymania.

**E. Whitelist emaili w env (przyjete)** - **przyjete**
- Zero schema change, audytowalne przez `.env.example` w git, MVP wystarczajacy dla 1-3 adminow.

---

## Konsekwencje

### Pozytywne
- Endpoint `/api/audit/merkle/verify/:eventId` zaostrzony do admin-only - audytor (UODO, rewident) dostaje proof bundle, casualowy zalogowany user dostaje 403.
- Pure helpers `parseAdminEmails` + `isAdminEmail` testowalne bez DB / env (zero mockow).
- Middleware `requireAdmin` reuse'owalny w kolejnych admin endpointach (ADR-0040 UI viewer, ADR-0042 UI banner mcp-security, przyszle).
- Strukturyzowane logi `[ADMIN]` - operator widzi w docker logs kazdy admin grant/deny.
- Zero nowych zaleznosci npm (Konstytucja Art. 4).
- Backward compatible - inne endpointy nadal pod `requireAuth` (kazdy zalogowany), nic sie nie zmienia poza `/api/audit/merkle/verify/:eventId`.

### Negatywne / kosztowe
- +update `auth.ts` (~50 LoC: 2 helpers + middleware + cache modulu), +update `audit.ts` (~3 LoC: middleware w lancuchu), +nowy test (~100 LoC, 13 it), +update `.env.example` (~3 LoC + komentarz).
- Lista adminow zmiana = restart kontenera. Akceptowalne (1-3 osoby, sporadyczne zmiany), ale operator musi planowac maintenance window.
- `console.warn` jako audit gateway = NIE jest hash-chained. Audyt UODO bedzie pelny dopiero po ADR-0043 (audit_log eventu `admin.access`).

### Bramki PO wpieciu (potwierdzone w tej sesji)
- Testy backend: **516/521 pass** (+13 nowych vs baseline 503/508 z ADR-0036).
- TSC clean.
- Internal QA review (min. 2 rundy) - zalatwione przed commitem.

---

## Atrybucja

Pattern "whitelist emaili w env" - standardowy dla MVP RBAC w aplikacjach Node/Express. Bez bezposredniego cherry-pick. Wzorzec lancucha middleware `requireAuth` -> `requireAdmin` zaadaptowany z istniejacego `requireAuth` w `backend/src/middleware/auth.ts` (rozszerzenie pliku, nie nowy modul).

Pelna atrybucja zaleznosci backendu: [THIRD_PARTY_INSPIRATIONS.md](../../THIRD_PARTY_INSPIRATIONS.md).
