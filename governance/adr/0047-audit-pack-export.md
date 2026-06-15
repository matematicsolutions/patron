# ADR-0047: Eksport audit pack JSON (rozszerzenie viewera audytora)

**Status**: PROPONOWANY (2026-05-27). Realizacja rezerwacji z ADR-0046 (sekcja "Co NIE jest w ADR-0046"). Audytor dostaje samowystarczalny JSON do offline weryfikacji bez dostepu do bazy kancelarii.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.3.0 -> v1.3.1):

- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA. Audytor w UI viewera (ADR-0046) klika "Pobierz audit pack" i wynosi pakiet JSON zawierajacy event + Merkle proof bundle + SHA-256 integrity. Pack jest **samowystarczalny** - audytor weryfikuje go na izolowanej maszynie skryptem `npm run audit:verify-pack -- <plik.json>`, bez sieci.
- **Art. 5 - Tajemnica zawodowa** - payload eventu w pack-u jest zamaskowany server-side przez `maskPayload` (ten sam helper co `GET /api/audit/log` w ADR-0040 faza 1). Audytor wynosi metadana zdarzenia, nie dane sprawy.
- **Art. 6 - Granica bledu** - eksport jest read-only. Brak akcji `delete` / `edit`. Pack ma `integrity.canonical_sha256` policzony nad cialem pack-u (bez samego pola integrity) - kazda modyfikacja po wyniesieniu zostanie wykryta przez `verifyAuditPackIntegrity`.
- **Art. 4 - Neutralnosc i prostota stosu** - zero nowych zaleznosci npm. Backend uzywa `node:crypto` (Node 20+ wbudowane). Frontend uzywa native `fetch` + `Blob` + `URL.createObjectURL` + `<a download>`. PDF (wymaga puppeteer/pdfkit) odlozony do ADR-0048.

**Powiazane ADR**:

- **ADR-0046** (LIVE) - rodzic. UI viewer audytora. Ten ADR dodaje sekcje "Eksport audit pack" w `<AuditEventDetail />`.
- **ADR-0040** (LIVE) - rodzic. Maskowanie payload server-side (`maskPayload` z `audit-pii-mask.ts`) reuse w endpoint eksportu.
- **ADR-0036** (LIVE) - rodzic. `fetchProofForEvent` z `audit-merkle-roots.ts` reuse - ten sam ProofBundle co `/api/audit/merkle/verify/:eventId`.
- **ADR-0034** (LIVE) - blocker RBAC. Endpoint chroniony `requireAuth + requireAdmin` (whitelist email env `PATRON_ADMIN_EMAILS`).
- **ADR-0043** (LIVE) - rodzic meta-audit. Wpiecie loguje `admin.access.audit_export` przez `recordAdminAccess` (graceful, nie blokuje endpointu).
- **ADR-0035** (LIVE) - rodzic. Migracja 003 ALTER CHECK whitelist event_type (dodanie `admin.access.audit_export`). Format UP/DOWN per ADR-0038.
- **ADR-0026** (LIVE) - rodzic. `verifyMerkleProof` reuse w skrypcie offline `verify-audit-pack.ts`.
- **ADR-0048 (rezerwowane)** - eksport jako PDF (audit raport ludzki) i bulk export (wszystkie eventy z filtrowanego zakresu jako ZIP).

---

## Decyzja

### A. Endpoint `GET /api/audit/export/:eventId`

Nowy endpoint w `backend/src/routes/audit.ts`. Wzorzec kopiowany z `/merkle/verify/:eventId` (ADR-0036): `requireAuth + requireAdmin`, walidacja `eventId`, instancja Supabase, dwustopniowy fetch (event + Merkle proof), composition pack-u, response.

Response `200`:
- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-pack-event-{id}-{YYYYMMDD}.json"`
- Body: pretty-printed JSON pack-u (2 spacje wciecia, dla audytora czytajacego w edytorze)

Response error mapping:
- `400` - eventId nie jest liczba calkowita > 0
- `401` - brak JWT
- `403` - non-admin
- `404` - event nie istnieje LUB brak Merkle root pokrywajacego event (gdy audytor odwiedza kancelarie raz na kontrole UODO, czekanie na auto-trigger ADR-0036 do 24h jest blockerem - workaround: administrator kancelarii odpala `npm run merkle:trigger` przed wizyta. UI button "Wymus compute root" = rezerwacja **ADR-0048** zeby audytor nie musial prosic operatora.)
- `500` - blad DB

Logowanie `admin.access.audit_export` - `void recordAdminAccess(...)` PRZED fetchem eventu (audyt rejestruje samo zamiar wyniesienia dowodu, niezaleznie od sukcesu).

### B. Schema audit pack `{schema_version: "1.0", pack_kind: "audit_event_export"}`

```json
{
  "schema_version": "1.0",
  "pack_kind": "audit_event_export",
  "exported_at": "2026-05-27T18:00:00.000Z",
  "exporter": {
    "user_id": "uuid lub null",
    "email": "audytor@kancelaria.pl lub null"
  },
  "event": {
    "id": 12345,
    "event_type": "chat.message.user",
    "ts": "2026-05-27T17:45:00.000Z",
    "actor_user_id": "uuid lub null",
    "chat_id": "uuid lub null",
    "document_id": "uuid lub null",
    "hash": "<sha256 hex 64>",
    "prev_hash": "<sha256 hex 64>",
    "payload_masked": { ... }
  },
  "merkle_proof_bundle": {
    "event_id": 12345,
    "event_hash": "<sha256 hex 64>",
    "proof": [{ "position": "left", "hash": "<sha256 hex 64>" }, ...],
    "merkle_root_id": 7,
    "merkle_root": "<sha256 hex 64>",
    "chain_block_start": 12001,
    "chain_block_end": 13000
  },
  "verifier_instructions": {
    "offline_cli": "npx tsx scripts/verify-audit-pack.ts <plik.json>",
    "library": "verifyAuditPackIntegrity(pack) + verifyProofBundle(pack.merkle_proof_bundle)",
    "description": "Weryfikator dwustopniowy: (1) integrity SHA256, (2) Merkle proof bundle."
  },
  "integrity": {
    "algorithm": "SHA-256",
    "canonical_sha256": "<sha256 hex 64>"
  }
}
```

### C. Pure helper `backend/src/lib/audit-pack.ts`

5 eksportowanych funkcji + typy. Wszystkie pure (zero IO, deterministyczne, testowalne bez mockow):

- `buildAuditPack(args)` - sklada pack ze wstrzyknietych exporter/event/bundle/exportedAt + liczy integrity SHA256
- `canonicalJsonStringify(value)` - serializacja JSON z deterministycznym alfabetycznym porzadkiem kluczy (rekurencyjnie). Niezalezna od kolejnosci wstawiania kluczy w runtime.
- `canonicalSha256(value)` - SHA-256 z `canonicalJsonStringify`, hex lowercase 64 znaki.
- `verifyAuditPackIntegrity(pack)` - audytor offline. Wyciaga `integrity`, liczy SHA256 na pack-u bez tego pola, porownuje. Wykrywa modyfikacje contentu po wyniesieniu.
- `buildAuditPackFilename(eventId, exportedAt)` - `audit-pack-event-{id}-{YYYYMMDD}.json` dla Content-Disposition.

Test coverage: 24 testy w `audit-pack.test.ts` (canonicalJson 6, canonicalSha256 4, buildAuditPack 3, verifyAuditPackIntegrity 8, buildAuditPackFilename 3). Wszystkie zero-mock.

### D. Skrypt CLI `backend/scripts/verify-audit-pack.ts`

Standalone weryfikator dla audytora. `npx tsx scripts/verify-audit-pack.ts <plik.json>`. Sprawdza:

1. integrity SHA-256 (przez `verifyAuditPackIntegrity`)
2. Merkle proof bundle (przez `verifyProofBundle` z `audit-merkle-verifier.ts`, ADR-0026)

Exit code: `0` = oba checki pass, `1` = jeden fail, `2` = blad I/O / parse / brak argumentu.

Reuse ten sam `verifyProofBundle` co `scripts/verify-audit-chain.ts` (spojnosc - audytor uczy sie jednej semantyki weryfikacji).

Skrypt zarejestrowany jako `npm run audit:verify-pack -- <plik.json>` w `backend/package.json`.

### E. Migracja `backend/migrations/003_audit_log_event_type_export.sql`

ALTER CHECK whitelist event_type: dodanie `admin.access.audit_export` do 11 wartosci z migracji 002 (per ADR-0035 wzorzec).

Format UP/DOWN per ADR-0038. Idempotentne: `pg_constraint` check przed DROP/ADD. DOWN przywraca whitelist z migracji 002 (z ostrzezeniem ze nowe inserty z `admin.access.audit_export` rzuca CHECK constraint - rollback tylko w maintenance window z redeployem starszego backendu).

Lustrzane wpisy w 4 miejscach (per konwencja audit.ts comment "Whitelist event_type"):

- `backend/schema.sql` - constraint w `create table audit_log`
- `backend/migrations/003_*.sql` - ALTER CHECK UP/DOWN
- `backend/src/lib/audit.ts` - `EVENT_TYPES` literal union (uzywane przez `appendAuditEvent` runtime guard)
- `backend/src/lib/audit-admin-access.ts` - `AdminAccessEventType` union (uzywane przez `recordAdminAccess` typing, patrz sekcja G)

### F. Frontend `<AuditExportButton />` w `<AuditEventDetail />`

Nowy komponent `frontend/src/components/audit-export-button.tsx`. Zero nowych deps - shadcn `Button` + lucide `Download/Loader2/AlertCircle` istniejace.

Workflow:
1. Klik button -> `fetch("/api/audit/export/:eventId", { credentials: "include" })`
2. Parse `Content-Disposition` header dla filename (fallback `audit-pack-event-{id}.json`)
3. `await res.blob()` -> `URL.createObjectURL` -> `<a download={filename}>` -> programmatic click -> `URL.revokeObjectURL`
4. Stan idle/loading/failed

Wpiety w `audit-event-detail.tsx` jako nowa sekcja "Eksport audit pack (ADR-0047)" pod sekcja "Weryfikacja Merkle proof".

### G. Rozszerzenie typu `AdminAccessEventType`

`backend/src/lib/audit-admin-access.ts`: dodanie `"admin.access.audit_export"` do union obok 3 istniejacych (`audit_viewer`, `security_banner`, `metrics`). Lustrzane w `EVENT_TYPES` z `audit.ts`.

### H. Konstytucja v1.3.0 -> v1.3.1 PATCH

PATCH (nie MINOR) - **rozszerzenie istniejacej funkcjonalnosci** UI viewera audytora (ADR-0046) o przycisk eksportu. Nowy endpoint REST, ale nie zmienia kontraktu rol w Konstytucji (audytor mial juz pelny wglad przez UI z ADR-0046, ten ADR dodaje mu jedynie sposob wyniesienia danych do dalszej analizy). Nowy `admin.access.audit_export` event_type w whitelist - rozszerzenie meta-audit z ADR-0043.

---

## Alternatywy odrzucone

1. **POST `/api/audit/export` z body filtrowania (bulk export)**. Odrzucone w MVP: ADR-0046 obsluguje per-event detail, MVP audytora to "wynosze ten konkretny event z jego proof". Bulk export = osobne ADR-0048 (POST z range filter, ZIP z manifestem indeksu).
2. **PDF zamiast JSON jako primary format**. Odrzucone: PDF wymaga ciezkiej zaleznosci npm (puppeteer pobiera Chromium binary, pdfkit wymaga lokalnych fontow Type1 dla polskich znakow) - lamie Konstytucja Art. 4 "zero nowych deps". JSON jest portable, parsowalny, weryfikalny mechanicznie. PDF (audit raport ludzki) = rezerwacja ADR-0048 z ocena waga vs renderer server-side React.
3. **ZIP z plikiem JSON + osobnym SHA256 manifestem**. Odrzucone: jeden plik JSON z polem `integrity` w srodku jest prostszy dla audytora (otwiera w edytorze, widzi calosc). Manifest zewnetrzny wprowadza split-brain (co jezeli audytor straci manifest?).
4. **Integrity przez podpis RSA/Ed25519 zamiast SHA-256**. Odrzucone w MVP: SHA-256 wystarcza do wykrycia modyfikacji po wyniesieniu (Konstytucja Art. 6 granica bledu). Podpis kryptograficzny wymaga zarzadzania kluczem prywatnym kancelarii - rezerwacja ADR-0049 (RFC 3161 timestamping + podpis Ed25519 dla non-repudiation).
5. **Endpoint POST zamiast GET**. Odrzucone: eksport jest idempotentny (te same dane wejsciowe -> dwa pack-i roznia sie tylko `exported_at` + `integrity.canonical_sha256` z powodu czasu). REST-y wymagaja GET dla read operations. POST mialby sens dla bulk export z body filtrem (ADR-0048).
6. **shadcn Dialog dla loading state przy duzych pack-ach**. Odrzucone: shadcn Dialog wymaga radix-ui jako new dep. Inline button z `Loader2 animate-spin` wystarcza dla 1 eventu (typowy pack < 50KB).

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean backend** (`npx tsc --noEmit` w `backend/` - zero bledow).
- **TSC clean frontend** (`npx tsc --noEmit` w `frontend/` - zero bledow).
- **Vitest backend**: 630 pass / 5 todo / 0 fail (+24 nowe w `audit-pack.test.ts`, z 606 przed ADR).
- **0 nowych zaleznosci npm** w `backend/package.json` (uzywamy `node:crypto` wbudowany) ani w `frontend/package.json` (native fetch + Blob + lucide istniejacy).
- **LoC dodanych**: ~943 (audit-pack lib 227 + test 282 + CLI 108 + migration 89 + frontend button 111 + endpoint route ~110 + detail integration 12 + enum lines 2 + schema 2).
- **Whitelist event_type spojny w 4 miejscach** (schema.sql + migration 003 + `EVENT_TYPES` w audit.ts + `AdminAccessEventType` w audit-admin-access.ts) - manualnie zweryfikowane przed commitem.
- **Manual smoke test PENDING** - wymaga `npm run dev` w backend + frontend + admin auth + klik "Pobierz audit pack" w UI viewera + zapisanie pliku + `npm run audit:verify-pack -- <plik>` exit code 0. Rezerwacja w sesji manual QA.
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero personae internal MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione na ascii.

## Co NIE jest w ADR-0047

- **Bulk export** (wszystkie eventy z filtrowanego zakresu jako ZIP) -> rezerwacja **ADR-0048** (POST `/api/audit/export` z body filter + jszip dla ZIP).
- **Eksport jako PDF audit raport ludzki** (formatowany dokument z headerami, tabelami, podpisem strony) -> rezerwacja **ADR-0048** (wymaga oceny puppeteer vs pdfkit vs server-side React renderer pod katem Konstytucja Art. 4).
- **Podpis kryptograficzny pack-u** (Ed25519 + RFC 3161 timestamping dla non-repudiation) -> rezerwacja **ADR-0049**. SHA-256 integrity wystarcza w MVP do wykrycia modyfikacji, ale nie chroni przed zaprzeczeniem ze kancelaria wystawila pack.
- **UI history eksportow** (lista kto kiedy co eksportowal) -> juz jest w audit_log jako `admin.access.audit_export`, mozna filtrowac w istniejacym viewerze (ADR-0046 `<AuditFilterBar />`). Osobne UI = overengineering.
- **Frontend integration testy dla `<AuditExportButton />`** -> rezerwacja **ADR-0044** (vitest frontend setup, juz zarezerwowane w ADR-0046).
