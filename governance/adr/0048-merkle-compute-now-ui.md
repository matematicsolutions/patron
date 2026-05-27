# ADR-0048: Endpoint "Wymus compute Merkle root" + UI fallback dla audytora

**Status**: PROPONOWANY (2026-05-27). Realizacja rezerwacji z ADR-0047 ("UI button 'Wymus compute root' = rezerwacja ADR-0048 zeby audytor nie musial prosic operatora"). Zamyka UX dziure 404 w eksporcie audit pack gdy event jest swiezszy niz ostatni Merkle root.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.3.1 -> v1.3.2):

- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA. Audytor UODO ktory przyjedzie raz na kontrole nie moze zatrzymac sie na 404 "brak Merkle root". Endpoint POST `/api/audit/merkle/compute-now` daje rolen Admin (audytor lub administrator kancelarii) mozliwosc wymuszenia compute next root bez czekania na auto-trigger ADR-0036 (count >= 1000 LUB interval >= 24h). UI z ADR-0047 wykrywa 404, pokazuje drugi button, wywoluje endpoint, auto-retry eksport.
- **Art. 6 - Granica bledu** - compute jest **idempotentny w sensie semantycznym**: dwa wywolania pod rzad gdy nic nie zaszlo w audit_log zwracaja `{computed: false, reason: "no_new_events"}` (brak duplikacji root). Pierwsze wywolanie po pojawieniu sie nowych eventow daje `{computed: true, root: ...}`. Patrz tez uwaga w `audit-merkle-roots.ts` o `UWAGA - brak ON CONFLICT` - manual trigger nadal moze stworzyc duplikat dla TEGO SAMEGO zakresu jezeli admin wywola sekwencyjnie w tej samej milisekundzie, ale `runAutoCompute` blokuje to przez idempotency check na `lastCoveredEventId`.
- **Art. 4 - Neutralnosc i prostota stosu** - zero nowych zaleznosci npm. Backend reuse `runAutoCompute` z ADR-0036 z thresholdami "forsujacymi" (`countThreshold=1`, `intervalMs=0`). Frontend native React state machine + lucide ikona `ShieldCheck` istniejaca.

**Powiazane ADR**:

- **ADR-0047** (LIVE) - rodzic. Eksport audit pack. Ten ADR usuwa 404 "brak Merkle root" jako UX blocker przed wizyta audytora.
- **ADR-0036** (LIVE) - rodzic. `runAutoCompute` z `audit-merkle-roots.ts` reuse - ten sam flow co auto-trigger, tylko thresholdy forsuja kazdy nowy event.
- **ADR-0034** (LIVE) - blocker RBAC. Endpoint chroniony `requireAuth + requireAdmin` (whitelist email env `PATRON_ADMIN_EMAILS`).
- **ADR-0043** (LIVE) - rodzic meta-audit. Wpiecie loguje `admin.access.merkle_compute_now` przez `recordAdminAccess` (graceful, nie blokuje compute).
- **ADR-0035** (LIVE) - rodzic. Migracja 004 ALTER CHECK whitelist event_type (dodanie `admin.access.merkle_compute_now`). Format UP/DOWN per ADR-0038.
- **ADR-0050 (rezerwowane)** - bulk export ZIP (per range filter z `<AuditFilterBar />`). Oddzielony od PDF bo `jszip` JUZ jest w `backend/package.json` deps, ZIP nie wymaga nowej oceny waga.
- **ADR-0051 (rezerwowane)** - PDF audit raport ludzki. Oddzielony od ZIP bo wymaga oceny puppeteer (Chromium pobrany przy npm install) vs pdfkit (lokalne fonty Type1 dla polskich znakow) vs server-side React renderer.
- **ADR-0052 (rezerwowane)** - machine-readable error codes w response 404 backend (`error: "merkle_root_missing"` zamiast polskiego string match w frontend). Oddzielony od ADR-0050 zeby zachowac scope-down atomic - refactor error contracts dotyka wszystkich endpointow `routes/audit.ts`, bulk export to dodanie nowego endpointu.

---

## Decyzja

### A. Endpoint `POST /api/audit/merkle/compute-now`

Nowy endpoint w `backend/src/routes/audit.ts`. POST (nie GET) bo zmienia stan bazy (`audit_merkle_roots` insert). `requireAuth + requireAdmin` (RBAC kopiowany z `/merkle/verify/:eventId` i `/export/:eventId`).

Request: brak body (admin tylko klika button, nie wybiera zakresu). Zakres bloku wyliczany automatycznie z runAutoCompute (`lastCoveredEventId + 1` do `maxEventId`).

Response `200` (zawsze 200 dla scenariuszy `no_new_events` - to nie blad, kancelaria po prostu nie ma nowych eventow):

```json
// Sukces - root policzony i zapisany
{
  "computed": true,
  "reason": "count_threshold" | "initial_root" | "interval_threshold",
  "root": {
    "id": 7,
    "chain_block_start": 12001,
    "chain_block_end": 13000,
    "merkle_root": "<sha256 hex 64>",
    "event_count": 1000,
    "computed_at": "2026-05-27T19:00:00.000Z",
    "computed_by": "manual-ui:admin@kancelaria.pl"
  }
}

// Skip - brak nowych eventow
{ "computed": false, "reason": "no_new_events" }

// Compute decyzja=true ale insert sie nie udal (degraded)
{ "computed": false, "reason": "count_threshold", "error": "insert failed: <detail>" }
```

Error mapping:
- `401` - brak/niepoprawny JWT
- `403` - non-admin
- `500` - Supabase unavailable

Logowanie `admin.access.merkle_compute_now` przez `recordAdminAccess` PRZED `runAutoCompute` - audit zawsze rejestruje samo zamiar wymuszenia, niezaleznie czy compute = true czy false.

### B. Pure helper `backend/src/lib/audit-merkle-compute-now.ts`

3 eksporty + typy. Wszystkie pure:

- `FORCE_COUNT_THRESHOLD = 1` - kazdy nowy event wymusza compute (vs default 1000 z ADR-0036).
- `FORCE_INTERVAL_MS = 0` - bypass wymogu wieku ostatniego roota (vs default 24h z ADR-0036).
- `parseComputerByLabel(actorEmail, actorUserId)` - sklada `manual-ui:<email_lub_user_id>` z anti-injection (usuwa `\r\n\t` i znaki kontrolne x00-x1f, trim do 100 znakow, fallback `manual-ui:unknown` gdy brak identyfikatora). Cel: czytelne `computed_by` w `audit_merkle_roots` ktore audytor odroznia od `auto-scheduler` z ADR-0036 i `manual` z CLI `npm run merkle:trigger`.
- `buildComputeNowResponse(result)` - pure transformacja `RunAutoComputeResult` z ADR-0036 na response endpointu. Zero IO. Mapuje 4 scenariusze: skip, success, compute failure, defensive (compute=true bez computeResult).

Test coverage: 16 testow w `audit-merkle-compute-now.test.ts` (FORCE thresholds 2, parseComputerByLabel 8 wlacznie z anti-injection, buildComputeNowResponse 6). Wszystkie zero-mock.

### C. Frontend - rozszerzenie `<AuditExportButton />` o state machine

`frontend/src/components/audit-export-button.tsx` rozszerzony z 4 stanow do **5 stanow**:

```
idle -> loading -> {ok=download / needs-compute=secondary-button / failed=red text}
                                       |
needs-compute -> computing -> {computed=true & auto-retry-export-ok / failed}
```

Heurystyka detekcji "brak Merkle root": `detail.includes("brak Merkle root")` w response 404. Brittle string match - dlug zarejestrowany do ADR-0050 (backend powinien zwracac machine-readable `error: "merkle_root_missing"`).

Secondary button "Wymus compute root i ponow eksport" w amber-tinted alert box. Po sukcesie compute auto-retry GET eksport. Jezeli compute udany ale event nadal poza zakresem (edge case bledny `lastCoveredEventId`) - failed z explicit error.

UX message dla audytora wyjasnia powod: "Event nie jest jeszcze pokryty przez Merkle root. Wymus compute (auto-trigger uruchamia sie raz na 24h lub po 1000 nowych eventow per ADR-0036)."

### D. Migracja `backend/migrations/004_audit_log_event_type_compute_now.sql`

ALTER CHECK whitelist event_type: dodanie `admin.access.merkle_compute_now` do 12 wartosci z migracji 003.

Format UP/DOWN per ADR-0038. Idempotent: `pg_constraint` check przed DROP/ADD. DOWN przywraca whitelist z migracji 003 (z ostrzezeniem ze nowe inserty z `admin.access.merkle_compute_now` rzuca CHECK constraint - rollback tylko w maintenance window z redeployem starszego backendu).

### E. Rozszerzenie typow w 4 miejscach (lustrzane wpisy)

Identyczny wzorzec jak ADR-0047 (4 miejsca whitelist event_type):

- `backend/schema.sql` - constraint w `create table audit_log`
- `backend/migrations/004_*.sql` - ALTER CHECK UP/DOWN
- `backend/src/lib/audit.ts` - `EVENT_TYPES` literal union (uzywane przez `appendAuditEvent` runtime guard)
- `backend/src/lib/audit-admin-access.ts` - `AdminAccessEventType` union (uzywane przez `recordAdminAccess` typing)

### F. Konstytucja v1.3.1 -> v1.3.2 PATCH

PATCH (nie MINOR) - **UX safety net** dla istniejacej funkcjonalnosci eksportu audit pack (ADR-0047). Audytor mial juz capability wymuszenia compute przez prosbe do operatora (`npm run merkle:trigger`) - ten ADR daje mu to w UI bez koniecznosci kontaktu z administratorem. Nie zmienia kontraktu rol w Konstytucji ani semantyki Merkle hash.

---

## Alternatywy odrzucone

1. **GET zamiast POST**. Odrzucone: compute zmienia stan bazy (insert do `audit_merkle_roots`). REST wymaga POST/PUT dla state-changing operations - GET musi byc safe i idempotent (cache, prefetch, retry middleware).
2. **Endpoint z body filtrowania zakresu (block_start, block_end)**. Odrzucone w MVP: audytor nie zna i nie powinien znac strukturze bloku - klika button, dostaje root pokrywajacy wszystkie nowe eventy. Bulk compute dla konkretnego eventId historycznego (np. compute brakujacych srodkowych rootow) = rezerwacja przyszla, MVP UODO ma jeden case: "moj event nie ma proof, wymus".
3. **Wywoluj bezposrednio `computeAndStoreRoot(blockStart, blockEnd)` zamiast `runAutoCompute`**. Odrzucone: `runAutoCompute` ma juz pure decyzje `shouldComputeNextRoot` z idempotency check (`lastCoveredEventId` vs `maxEventId`), obsluga `no_new_events`. Bezposrednie `computeAndStoreRoot` wymagaloby duplikowania tej logiki w endpoint - kopiuje sie bug surface.
4. **Dodaj button w stronie admin osobno (nie w retry-fallback AuditExportButton)**. Odrzucone: kontekstowe odsloniecie wymaga konkretnego eventu ktory nie ma proof. Globalny button "Compute teraz" w panel admin = osobny use case (administrator robi to przed audytem prewencyjnie, niezaleznie od pojedynczego eventu) - rezerwacja w panel admin Patrona jezeli pojawi sie taki use case z pilota.
5. **Backend zwraca 409 Conflict zamiast 200 z computed=false dla `no_new_events`**. Odrzucone: brak nowych eventow nie jest konfliktem, to legalny stan systemu (kancelaria nie pracowala od ostatniego roota); 409 zmusilby frontend do `try/catch` zamiast czytelnego if/else nad `body.computed`. Argument "200 dla operacji idempotentnej z dwustanowym wynikiem" patrz sekcja A.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean backend** (`npx tsc --noEmit` w `backend/` - zero bledow).
- **TSC clean frontend** (`npx tsc --noEmit` w `frontend/` - zero bledow).
- **Vitest backend**: 646 pass / 5 todo / 0 fail (+16 nowe w `audit-merkle-compute-now.test.ts`, z 630 po ADR-0047).
- **0 nowych zaleznosci npm** w `backend/package.json` ani `frontend/package.json` (reuse runAutoCompute + native React state + lucide istniejacy).
- **LoC dodanych**: 560 (compute-now lib 118 + test 156 + migration 90 + frontend rozszerzenie 122 nowych linii z 111 do 233 + endpoint route ~72 + lustrzane enum 2).
- **Whitelist event_type spojny w 4 miejscach** (schema.sql + migration 004 + `EVENT_TYPES` w audit.ts + `AdminAccessEventType` w audit-admin-access.ts) - manualnie zweryfikowane przed commitem.
- **Manual smoke test PENDING** - wymaga `npm run dev` w backend + frontend + admin auth + scenariusze: (1) eksport z istniejacym Merkle root -> sukces, (2) eksport bez Merkle root -> needs-compute -> klik secondary -> compute -> auto-retry -> sukces, (3) eksport bez Merkle root + brak nowych eventow -> needs-compute -> klik -> failed z "Brak nowych eventow". Rezerwacja w sesji manual QA.
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero personae internal MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione na ascii.

## Co NIE jest w ADR-0048

- **Bulk export ZIP** (eventy z filtrowanego zakresu `<AuditFilterBar />` -> ZIP z manifest indeksem) -> rezerwacja **ADR-0050** (`jszip` juz jest w backend deps, nie wymaga nowej oceny waga).
- **PDF audit raport ludzki** (formatowany dokument z headerami, tabelami, podpisem strony) -> rezerwacja **ADR-0051** (wymaga oceny puppeteer vs pdfkit vs server-side React renderer pod katem Konstytucja Art. 4).
- **Podpis kryptograficzny pack-u** (Ed25519 + RFC 3161 timestamping) -> rezerwacja **ADR-0049** (z ADR-0047).
- **Machine-readable error code** w response 404 backend `/api/audit/export/:eventId` (`error: "merkle_root_missing"` zamiast polskiego string match) -> dlug, rezerwacja **ADR-0052** (refactor error contracts wszystkich endpointow `routes/audit.ts`, scope-down osobny od bulk export ADR-0050).
- **Globalny button "Compute Merkle root" w panel admin** (poza kontekstem konkretnego eventId) -> nie planowane, rezerwacja gdy pojawi sie use case z pilota.
- **Frontend integration testy dla state machine** -> rezerwacja **ADR-0044** (vitest frontend setup, juz zarezerwowane w ADR-0046).
