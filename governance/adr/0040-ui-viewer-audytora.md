# ADR-0040: UI viewer audytora - panel przegladu audit_log z weryfikacja Merkle

**Status**: PROPONOWANY - faza 1 (2026-05-27). Realizacja rezerwacji z ADR-0034 (RBAC admin) + ADR-0036 (REST endpoint verify) + ADR-0042 (wzorzec UI komponentow).

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.8 -> v1.2.9 PATCH dla fazy 1; MINOR bump v1.3.0 zarezerwowany dla fazy 2 gdy frontend page LIVE):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - KLUCZOWA zasada. Endpoint listy audit_log z paginacja i filtrowaniem to backend warstwa pod UI fasade nad obowiazkiem record-keepingu z AI Act art. 12. Audytor zewnetrzny (radca compliance, biegly sadowy, organ kontrolny) bedzie mial w fazie 2 UI - faza 1 udostepnia API dla tego UI plus dla offline audit pack eksport (faza 3).
- **Art. 5 - Tajemnica zawodowa** (PoA art. 6, URP art. 3) - GRANICA. Endpoint **maskuje PII** w payload (PESEL/NIP/imie/nazwisko/adres) przed serializacja do JSON. Maskowanie jest server-side w handler - JSON response zawiera juz zamaskowane wartosci, klient nie ma dostepu do raw.
- **Art. 6 - Granica bledu** (human in the loop) - endpoint **read-only** (GET, brak POST/PUT/DELETE). Audytor nie moze edytowac, kasowac, anulowac eventow audit_log. Append-only z poziomu service role pozostaje (RLS z schema.sql).

**Powiazane ADR**:
- **ADR-0001** - rodzic. Hash-chain audit_log to fundament; viewer go renderuje.
- **ADR-0026** + **ADR-0036** - rodzice. Merkle tree + REST verify endpoint. Viewer wpiety w one-click "Verify proof" dla pojedynczego eventu.
- **ADR-0034** - blocker (LIVE). RBAC admin = whitelist email env. Wszystkie endpointy viewer chronione `requireAuth` + `requireAdmin`. Audytor = uzytkownik z emailem na liscie `PATRON_ADMIN_EMAILS`.
- **ADR-0042** - blocker (LIVE 2026-05-27). UI banner mcp-security dal wzorzec UI komponentow (hook polling + admin-only chowanie + shadcn styling). Ten ADR uzywa tego samego wzorca dla wiekszego widgetu.
- **ADR-0043 (rezerwowane)** - audit_log eventu `admin.access.audit_viewer` (kto kiedy ogladal audit_log audytora). Lustro do wzajemnego nadzoru.

---

## Problem

Patron loguje kazde zdarzenie LLM/MCP/security/RODO do `audit_log` z hash-chain (ADR-0001) i Merkle tree (ADR-0026). Schema ma 7 event_type w whitelist (ADR-0035): `chat.message.user`, `chat.message.assistant`, `input_security_scan`, `mcp_security.gateway`, `ring_policy.decision`, `rodo.delete`, `rodo.export`. Endpoint `GET /api/audit/merkle/verify/:eventId` (ADR-0036) zwraca samowystarczalny ProofBundle.

Brakuje UI do:
1. **Wylistowania eventow z filtrowaniem** - audytor chce widziec wszystkie `mcp_security.gateway` z ostatnich 30 dni dla konkretnego usera.
2. **Drill-down per event** - audytor klika event i widzi pelny payload (po maskowaniu PII), hash, prev_hash, Merkle proof.
3. **One-click weryfikacja proof** - audytor klika "Verify" i widzi czy Merkle proof faktycznie matchuje root z `audit_merkle_roots`.
4. **Eksport audit pack** - audytor zabiera PDF (czyttelny) + JSON (do offline verifier) jako artefakt.

Bez UI viewer kancelaria nie moze pokazac compliance audytorowi - tylko techniczny dev moze zapytac DB. Niedopuszczalne dla AI Act art. 12.

---

## Decyzja - faza 1 (atomowa, ta iteracja)

### A. Backend endpoint listy `GET /api/audit/log`

Nowy handler w `backend/src/routes/audit.ts` (rozszerzenie istniejacego routera, zero nowych mount points). Paginacja, filtrowanie, maskowanie PII server-side.

Query params:
- `event_type` (optional) - jeden z 7 whitelist values lub `all`
- `actor_user_id` (optional) - UUID usera
- `since` (optional) - ISO timestamp, default = 30 dni wstecz
- `until` (optional) - ISO timestamp, default = now
- `limit` (optional, default 50, max 200) - ile eventow per strona
- `cursor` (optional) - opaque cursor dla nastepnej strony (event_id ostatniego)

Response:
```json
{
  "events": [
    {
      "id": 12345,
      "event_type": "mcp_security.gateway",
      "actor_user_id": "uuid-or-null",
      "chat_id": "uuid-or-null",
      "document_id": "uuid-or-null",
      "ts": "2026-05-27T14:30:00Z",
      "hash": "0123...64chars",
      "prev_hash": "abcd...64chars",
      "payload_masked": { ... },
      "merkle_root_id": 7 or null
    }
  ],
  "next_cursor": 12300 or null,
  "total_estimate": 1500
}
```

Maskowanie PII (`maskPayload` w nowym module `backend/src/lib/audit-pii-mask.ts`):
- PESEL (11 cyfr): zachowuje 4 pierwsze + 4 ostatnie, srodkowe 3 cyfry na gwiazdki -> `1234***5678` (11 znakow razem)
- NIP (10 cyfr): zachowuje 3 pierwsze + 3 ostatnie, srodkowe 4 na gwiazdki -> `123****890` (10 znakow razem)
- REGON (9 cyfr): zachowuje 3 pierwsze + 3 ostatnie, srodkowe 3 na gwiazdki -> `123***890` (9 znakow razem)
- REGON (14 cyfr): zachowuje 3 pierwsze + 3 ostatnie, srodkowe 8 na gwiazdki -> `123********890` (14 znakow razem)
- Pure helper `maskFixedNumber(s, head, tail)` skleja te 4 przypadki przez konfiguracje (input length - head - tail = liczba gwiazdek), inwariant: dlugosc output = dlugosc input
- Imiona/nazwiska z `pl-entities`: `Jan ***`
- Email: pierwsze 3 znaki + `***@domena.pl`
- Tekst w `payload.content` jezeli dlugosc > 200 znakow: pierwsze 100 + `[...]` + ostatnie 100 (audytor widzi kontekst, nie pelne dane sprawy)

Status codes: 200 / 401 / 403 / 400 (invalid filter) / 500.

### B. Pure functions w `backend/src/lib/audit-pii-mask.ts`

```ts
export function maskPesel(s: string): string;        // "12345*****90"
export function maskNipRegon(s: string): string;     // "123***890"
export function maskEmail(s: string): string;        // "abc***@x.pl"
export function maskTextWindow(s: string, head: number, tail: number): string;
export function maskPayload(payload: unknown): unknown;  // recursive walk + apply
```

Pure functions, deterministyczne, testowalne. Zero IO. Per Konstytucja Art. 5.

### C. Test backend (`audit-pii-mask.test.ts`)

Co najmniej 8 testow:
- maskPesel (poprawny / za krotki / null / non-digit)
- maskNipRegon (poprawny / za krotki)
- maskEmail (poprawny / bez @ / pusty)
- maskTextWindow (krotki tekst pomijany / dlugi tekst maskowany / boundary cases)
- maskPayload (recursive walk - obiekt zagniezdony, array, mix typow)

---

## Alternatywy odrzucone

1. **Direct DB access dla audytora przez Supabase Studio**. Odrzucone z trzech powodow rownoleglych: (a) Supabase Studio domyslnie loguje z rola service role z write access do audit_log, RLS read-only dla audytora wymaga osobnej konfiguracji Supabase Auth + custom claim ktorej Patron unika (Konstytucja Art. 4 vendor-neutral); (b) brak server-side maskowania PII - audytor widzi raw payload z danymi klienta; (c) brak audit trail wejsc audytora (rezerwacja ADR-0043 wpina sie wlasnie tutaj).
2. **Maskowanie PII client-side** (server zwraca raw, JS maskuje przed render). Odrzucone: dev tools omijaja, response trafia do logow browser/CDN. Maskowanie MUSI byc server-side.
3. **Eksport tylko PDF bez JSON**. Odrzucone: audytor moze chciec uruchomic offline verifier (ADR-0026). JSON jest format audit-grade.
4. **Brak paginacji (zwroc cale audit_log)**. Odrzucone: audit_log Patrona w stable deployment to setki-tysiace eventow miesiecznie, response > 10MB blokuje UI. Cursor-based pagination z indeksem `idx_audit_log_event_type` (juz istnieje).

---

## Bramki PRZED merge fazy 1 (wynik faktyczny)

- **27 testow `audit-pii-mask.test.ts` pass** (vs target 8): 4x maskFixedNumber (happy/empty/non-digit/boundary), 3x maskPesel (poprawny/za krotki/pusty), 2x maskNip, 3x maskRegon (9 cyfr / 14 cyfr / nieprawidlowa dlugosc), 4x maskEmail (poprawny/bez @/local <=3/pusty), 3x maskTextWindow (krotki/dlugi/default args), 8x maskPayload (null/undefined/number/boolean/string PESEL/NIP/email/obiekt zagniezdony/tablica/krotki string).
- **17 testow `audit-log-query.test.ts` pass** (vs target 4): 10x parseAuditLogQuery (default/all/valid/invalid event_type/UUID actor/non-UUID/limit max/limit valid/cursor valid/cursor invalid/since-until), 3x buildResponseEvents (mask injection/hash zachowanie/pusta lista), 3x computeNextCursor (< limit / === limit / pusta lista).
- **TSC clean backend** (`npx tsc --noEmit` zero bledow).
- **Vitest backend pass**: 579/584 (+44 nowych testow vs baseline 535/540), 5 todo bez zmian, zero fail.
- **LoC dodanych**: ~770 (handler 80 + audit-pii-mask 130 + audit-pii-mask.test 160 + audit-log-query 175 + audit-log-query.test 175 + ADR 150).
- **1 runda review tekstu ADR** zakonczona werdyktem slabe -> 7 fixow + pominieta r2 (faktyczne bledy zaadresowane, drobiazgi atomic do fazy 2).
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero personae Marko, zero internal slugi MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione.

## Co NIE jest w fazie 1

- Frontend page `/admin/audit` -> faza 2 (ADR-0046)
- Eksport PDF/JSON -> faza 3 (ADR-0047)
- Logowanie wejsc audytora do audit_log -> rezerwacja ADR-0043 (wymaga migracji ALTER CHECK whitelist event_type)
- Real-time updates (banner z liczba nowych eventow) -> NIE planowane (audytor nie potrzebuje live feed)

## Sekwencja wdrozenia (timing)

| Faza | ADR | Zakres | Dependencja |
|---|---|---|---|
| 1 | 0040 | Backend endpoint listy + maskPayload + testy | brak (LIVE 0034, 0036, 0042) |
| 2 | 0046 (rezerwacja) | Frontend page + komponenty UI + drill-down + Merkle verify button | faza 1 |
| 3 | 0047 (rezerwacja) | Eksport audit pack PDF + JSON do offline verifier | faza 1 |
| 4 | 0043 (rezerwacja) | Audit log dla wejsc audytora (event_type `admin.access.audit_viewer`) | migracja ALTER CHECK whitelist event_type |

Faza 1 atomowa - daje fundament backend dla wszystkich kolejnych faz. Estymacja czasowa per faza po dokladniejszym briefingu kolejnego ADR (timing fazy 1 = patrz "Bramki PRZED merge" - faktyczne LoC + testy po implementacji).
