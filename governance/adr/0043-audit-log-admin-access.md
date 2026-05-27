# ADR-0043: audit_log dla wejsc admin (admin.access.*) - meta-audit dla AI Act art. 12

**Status**: PROPONOWANY (2026-05-27). Realizacja rezerwacji z ADR-0034 (RBAC admin), ADR-0040 (UI viewer audytora), ADR-0042 (UI banner mcp-security), ADR-0037 (metrics endpoint), ADR-0038 (migrate rollback). Wszystkie powyzsze rezerwowaly "audit_log eventu admin.access" jako osobny ADR z migracja ALTER CHECK.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.10 -> v1.2.11):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA zasada. AI Act art. 12 wymaga record-keepingu nie tylko eventow AI ale **wszystkich istotnych aktywnosci** w systemie wysokiego ryzyka, w tym dostepu do samego audit_log. Bez tego mamy dziure compliance: kto i kiedy patrzyl w audit_log audytora? Kto pobieral metryki? Ten ADR zamyka petle meta-audytu.
- **Art. 5 - Tajemnica zawodowa** - admin viewer audytora (ADR-0040) widzi (zamaskowane) dane spraw klientow. Logowanie wejsc admin jest standardem branzowym - audit-grade systems loguja `who-saw-what-when` dla wszystkich uprawnionych odczytow.
- **Art. 6 - Granica bledu** - admin pool kancelarii (whitelist emaili env per ADR-0034) jest **maly** (1-3 osoby). Kazde wejscie ma znaczenie. Audytor zewnetrzny moze zapytac: "Kiedy ostatnio admin X patrzyl w audit_log?". Bez wpisu w audit_log nie da sie odpowiedziec.

**Powiazane ADR**:
- **ADR-0001** + **ADR-0026** - rodzice. Wpisy admin.access.* lezą w hash-chain i sa kotwiczone przez Merkle.
- **ADR-0034** - blocker (LIVE). RBAC admin whitelist email env. Ten ADR loguje co admin robi po stronie API.
- **ADR-0035** - rodzic. Migracja 001 zalozyla CHECK constraint na event_type. Ten ADR daje migracje 002 (DROP + ADD z rozszerzona lista).
- **ADR-0038** - rodzic. Format UP/DOWN migracji + runner z `npm run migrate:rollback`.
- **ADR-0037** + **ADR-0040** + **ADR-0042** - dzieci (LIVE). Te ADR-y zarezerwowaly admin.access.metrics / admin.access.audit_viewer / admin.access.security_banner; ten ADR realizuje rezerwacje.
- **ADR-0038** - sasiad. Rezerwowal `migrate.rollback` event_type - dodajemy do whitelist w tej samej migracji.

---

## Problem

ADR-0034 wprowadzil rolę admin (whitelist email env). ADR-0040/0042/0037 wprowadzily endpointy dla admin (audit viewer, banner status, metrics scrape). Brak warstwy logujacej **kto i kiedy** uderzyl w te endpointy:

- Audytor zewnetrzny pyta "Pokaz mi wszystkie wejscia w audit log z ostatnich 30 dni" - kancelaria nie ma danych.
- Operator chce wiedziec "Czy ktos nie-admin probowal sie wlamac w viewer?" - 403 sa w docker logs, ale to nie audit-grade.
- AI Act art. 12 wymaga record-keepingu - dostep do logu zdarzen wysokiego ryzyka jest sam zdarzeniem do logu.

ADR-0035 migracja 001 zalozyla CHECK whitelist 7 event_type. Dodanie nowych wymaga migracji 002 ALTER CHECK + ADR (kanon, zakomentowany w `lib/audit.ts`).

---

## Decyzja

### A. Migracja 002 - rozszerzenie whitelist event_type o 4 wartosci admin.access.* + migrate.rollback

Plik `backend/migrations/002_audit_log_admin_access_event_types.sql` w formacie UP/DOWN (per ADR-0038). DROP starej constraint + ADD nowej z rozszerzona lista (PostgreSQL nie obsluguje `ALTER CONSTRAINT ... CHECK`).

Nowe wartosci:
- `admin.access.audit_viewer` - admin uderzyl w GET /api/audit/log (ADR-0040 faza 1)
- `admin.access.security_banner` - admin uderzyl w GET /api/security/mcp-status (ADR-0042)
- `admin.access.metrics` - whitelisted IP uderzyl w GET /metrics (ADR-0037)
- `migrate.rollback` - rezerwacja ADR-0038 dla DOWN aplikacji (osobny use case od admin.access, w tej samej migracji bo CHECK whitelist sklada sie w jednym constraint)

### B. Rozszerzenie EVENT_TYPES w `lib/audit.ts`

Dodanie 4 wartosci do tablicy + komentarz konwencji nazewnictwa "admin.access.<endpoint>" + "migrate.<action>".

### C. Helper `lib/audit-admin-access.ts` z funkcja `recordAdminAccess`

```ts
export async function recordAdminAccess(args: {
    db: SupabaseClient;
    event_type: "admin.access.audit_viewer"
              | "admin.access.security_banner"
              | "admin.access.metrics";
    actor_user_id: string | null;
    actor_email: string | null;
    method: string;
    path: string;
    query?: Record<string, unknown>;
}): Promise<void>
```

Async, graceful (catch wraz z logiem na stderr, NIGDY nie rzuca - audit_log fail nie blokuje endpointu, Konstytucja Art. 8 stalosc kontraktow). Payload: `{ method, path, query (jezeli != {}) }`. Pomija query gdy puste dla zwartosci payload.

### D. Integracja w 3 endpointach

`backend/src/routes/audit.ts` GET /api/audit/log -> wpiecie po `requireAdmin`, przed handler logiki:
```ts
auditRouter.get("/log", requireAuth, requireAdmin, async (req, res) => {
    await recordAdminAccess({
        db, event_type: "admin.access.audit_viewer",
        actor_user_id: res.locals.userId,
        actor_email: res.locals.userEmail,
        method: req.method, path: req.path, query: req.query
    }).catch(() => {/* graceful */});
    // ... reszta handlera
});
```

Analogicznie w `routes/security.ts` (event_type `admin.access.security_banner`) i `routes/metrics.ts` (event_type `admin.access.metrics`, ale tu actor to IP whitelist - actor_user_id null, actor_email null, payload zawiera `remote_ip`).

### E. Update schema.sql + Konstytucja v1.2.11

- `backend/schema.sql` aktualizacja CHECK z 7 -> 11 wartosci (dla nowych deployments bez migracji 002).
- Konstytucja PATCH bump - rozszerzenie zasady audytowalnosci o meta-audit, brak zmiany kontraktow API.

---

## Alternatywy odrzucone

1. **Tabela osobna `admin_access_log`**. Odrzucone: lamie Single Source of Truth z audit_log. Audytor musialby pytac dwa miejsca. Konstytucja Art. 3 implicytnie sugeruje jeden append-only log z hash-chain.
2. **Logowanie tylko gdy admin patrzy "wrazliwe" endpointy (viewer, nie metrics)**. Odrzucone: arbitralne. Metrics tez ujawnia dane operacyjne (rate decyzji, anchor timing). Lepiej logowac wszystkie 3 niz wybierac.
3. **Synchroniczne logowanie z bramka (fail blocking)**. Odrzucone: lamie Konstytucja Art. 8. Endpoint nie moze sie zalamac bo audit_log mial transient error. Graceful catch + stderr log dla operatora.

---

## Bramki PRZED merge

- 4+ testy `audit-admin-access.test.ts` (happy path / graceful no-db / payload bez query / payload z query)
- TSC clean backend
- Vitest backend pass (zero regresji vs baseline 599/604)
- Migracja 002 plan + plain SQL dla operatora kancelarii (operator wykonuje `do $$...$$` manualnie w SQL Editor per ADR-0035 governance-friendly runner)
- LoC docelowo ~400 dodanych (migracja + helper + test + 3 wpiec w endpointach + ADR + konstytucja + schema.sql update)
- 1 runda review tekstu ADR + ewentualne fixy
- Pre-public 6/6 grep clean

## Co NIE jest w ADR-0043

- **Logowanie dostepu do api/audit/merkle/verify/:eventId** (ADR-0036 verify endpoint) -> rezerwacja **ADR-0049** (Merkle verify per-event access logging gdy operator zglosi need; obecnie endpoint wymaga juz admin RBAC i zostawia trace w docker logs).
- **Alerting na suspicious patterns** (np. > 100 admin.access.audit_viewer w godzine = mozliwy data harvesting) -> rezerwacja **ADR-0044** (alerting policy).
- **Retencja audit_log** (po jakim czasie kasujemy stare wpisy admin.access) -> rezerwacja **ADR-0050** (audit retention policy). Obecnie audit_log rosnie bez ograniczen.
