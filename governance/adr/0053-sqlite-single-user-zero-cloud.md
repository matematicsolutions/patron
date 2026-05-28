# ADR-0053: SQLite single-user zero-cloud (adapter Supabase, auth bypass, storage FS)

**Status**: PROPONOWANY (2026-05-28). Patron Desktop dziala bez Dockera i bez Supabase - jeden portable proces, baza w pliku SQLite, dokumenty na lokalnym dysku. Sciezka chmurowa (Postgres + GoTrue + R2) zostaje za flaga dla przyszlego multi-tenant SaaS.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona v1.3.2 -> v1.4.0 MINOR):

- **Art. 2 - Tajemnica zawodowa / zero-cloud** (zasada glowna). SQLite + lokalny FS (`%APPDATA%/PATRON/`) wzmacnia zasade: akta sprawy nie opuszczaja maszyny kancelarii nawet do lokalnego kontenera. Domyslny tryb nie wymaga zadnej uslugi sieciowej.
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - bramka krytyczna. Hash-chain `audit_log` musi przezyc podmiane bazy. Adapter mapuje `SQLITE_CONSTRAINT_UNIQUE` na PostgreSQL code `"23505"`, dzieki czemu retry kolizji `hash unique` w `appendAuditEvent` (ADR-0001) dziala bez zmiany kodu. `canonicalJsonStringify` + `computeAuditHash` sa nietkniete - lancuch liczy sie identycznie.
- **Art. 4 - Neutralnosc i prostota stosu** - dual-mode `PATRON_DB_BACKEND=sqlite|supabase` zachowuje vendor-neutrality (sciezka Supabase nie jest usuwana). Netto stos sie upraszcza: 13 kontenerow Docker (Postgres/Kong/GoTrue/Storage/Realtime/Edge/...) znika z domyslnej sciezki. Koszt: jedna nowa zaleznosc `better-sqlite3` (patrz Alternatywy).
- **Art. 5 - Minimalizacja danych** - single-user nie ma rejestracji, emaili, SMTP, sesji JWT. Jeden lokalny user (staly UUID), opcjonalny PIN/Windows Hello = rezerwacja.
- **Art. 6 - Granica bledu** - adapter implementuje dokladnie ten podzbior API supabase-js, ktorego uzywa backend (zweryfikowany greplem), zamiast szerokiego mocka. Niewspierany operator rzuca jawny blad zamiast cichego zlego wyniku.

**Powiazane ADR**:

- **ADR-0001** (LIVE) - rodzic. Hash-chain `audit_log`. Adapter zachowuje semantyke retry (`23505`) i kolejnosc `order("id", desc).limit(1)` dla `getLastHash`.
- **ADR-0026 / 0036 / 0047 / 0048** (LIVE) - Merkle audit chain + auto-trigger + export. Tabela `audit_merkle_roots` przetlumaczona (`bigserial` -> `INTEGER AUTOINCREMENT`, arytmetyczne CHECK zachowane). Scheduler z `index.ts` dziala bez zmian (uzywa `createServerSupabase()`).
- **ADR-0034** (LIVE) - admin RBAC. W trybie sqlite lokalny user jest jednoczesnie Operatorem/Adminem (to jego maszyna i dane) - `requireAdmin` przepuszcza z logiem grantu. Tryb supabase zachowuje whitelist `PATRON_ADMIN_EMAILS`.
- **ADR-0035** (LIVE) - migration infra + whitelist event_type. Whitelist `event_type` (13 wartosci) jest lustrem jako CHECK `IN (...)` w schemacie SQLite - bramka governance zachowana w drugim silniku.

---

## Decyzja

### A. Dual-mode `PATRON_DB_BACKEND` (default `sqlite`)

`backend/src/lib/supabase.ts`: `isSqliteBackend()` czyta `PATRON_DB_BACKEND` (default `"sqlite"`; `"supabase"` przywraca oryginalny `createClient`). `createServerSupabase()` w trybie sqlite zwraca adapter rzutowany `as unknown as SupabaseClient`. Rzut zyje w jednym miejscu - dzieki temu ~30 plikow call-site (typowanych `ReturnType<typeof createServerSupabase>`) pozostaje bez zmian.

### B. Adapter `backend/src/lib/db/supabase-shim.ts` (719 LoC)

Mimikuje API `@supabase/supabase-js` na `better-sqlite3`. Klasa `Query` jest chainable + thenable (`await` wykonuje synchroniczne zapytanie better-sqlite3, zwraca `{ data, error, count? }`). Obslugiwany podzbior - dokladnie ten, ktorego uzywa backend:

- operacje: `select | insert | update | upsert | delete`
- filtry: `eq neq gt gte lt lte in is not like ilike or`
- modyfikatory: `order limit range single maybeSingle`
- select opts: `{ count: "exact", head: true }` (zwraca `count`)
- `.auth.getUser` / `.auth.admin.getUserById | listUsers | deleteUser`

Krytyczne mapowania:
- **jsonb** (8 kolumn, mapa `JSON_COLUMNS`) - serializacja przy zapisie, `JSON.parse` przy odczycie. Reszta kolumn bez zmian.
- **`23505`** - `SQLITE_CONSTRAINT_UNIQUE/_PRIMARYKEY` -> PostgreSQL code (retry hash-chain).
- **UUID** - PK typu TEXT bez wartosci -> `crypto.randomUUID()` (SQLite nie ma `gen_random_uuid()` w DEFAULT). `created_at/updated_at` puste -> ISO timestamp. `audit_log.id` (INTEGER AUTOINCREMENT) nie jest nadpisywany.
- **`.or()`** - parser formatu PostgREST `"col.eq.v,col.in.(a,b,c)"` z poszanowaniem nawiasow (przecinki w `in (...)` nie rozdzielaja tokenow).
- **bezpieczenstwo** - identyfikatory tabel/kolumn (z literalow w kodzie) walidowane regexem; ochrona przed path/SQL injection. Wartosci zawsze przez parametry `?`.

### C. Schema `backend/src/lib/db/schema.sqlite.ts` (294 LoC, embedded string)

Translacja `backend/schema.sql` (17 tabel + `app_users`). Embedded jako string TS (nie plik `.sql` ladowany sciezka) - odporne na pakowanie do `.exe`. Mapowanie typow: `uuid->TEXT, jsonb->TEXT, timestamptz->TEXT ISO, bigserial->INTEGER AUTOINCREMENT, boolean->INTEGER 0/1`. Roznice swiadome:
- FK do `auth.users(...)` usuniete (brak GoTrue; tozsamosc w `app_users`).
- Regex CHECK (`~ '^[0-9a-f]{64}$'`) usuniete (SQLite nie ma operatora `~`; format hash gwarantuje `computeAuditHash`).
- `= any(array[...])` -> `IN (...)`. Whitelist `event_type` (IN) zachowana.
- GIN na jsonb usuniety (filtr po stronie aplikacji), trigger `handle_new_user` usuniety (profil seedowany), cykl documents<->versions rozbity (`current_version_id` plain TEXT bez FK).

### D. Connection `backend/src/lib/db/sqlite-connection.ts` (108 LoC)

Singleton `better-sqlite3`. Sciezka: `PATRON_DB_PATH` lub `%APPDATA%/PATRON/patron.db` (Windows) / `~/.patron/patron.db`. `PRAGMA journal_mode=WAL`, `foreign_keys=ON`. Bootstrap schematu idempotentny. Seed jednego lokalnego usera (`LOCAL_USER_ID` staly UUID, override env) + `user_profiles`.

### E. Auth bypass `backend/src/middleware/auth.ts`

W trybie sqlite `requireAuth` ustawia `res.locals` na lokalnego usera i wola `next()` - zero JWT, zero wywolan sieciowych. `requireAdmin` przepuszcza (single-user = Operator) z logiem grantu. `getUserIdFromRequest` zwraca `LOCAL_USER_ID`. Tryb supabase = oryginalna weryfikacja GoTrue z cache tokenow.

### F. Storage FS `backend/src/lib/storage.ts`

`PATRON_STORAGE=fs|r2` (default `fs`, chyba ze skonfigurowano R2 lub wymuszono). Tryb fs: `uploadFile/downloadFile/deleteFile` na lokalnym FS pod `%APPDATA%/PATRON/sprawy/` (lub `PATRON_STORAGE_DIR`), ochrona przed path traversal. `getSignedUrl` zwraca wewnetrzny `/download/<HMAC-token>` (`buildDownloadUrl` z `downloadTokens.ts` - juz istnial) - route `/download/:token` streamuje przez `downloadFile`. Sygnatury eksportow stabilne: 30 call-site nie wie ktory backend dziala. Tryb r2 = oryginalna sciezka Cloudflare R2.

### G. Konstytucja v1.3.2 -> v1.4.0 MINOR

MINOR (nie PATCH) - nowy domyslny model wdrozenia (single-user desktop) jako rownoprawna sciezka obok self-host multi-tenant. Backward-compatible: istniejace deploymenty ustawiaja `PATRON_DB_BACKEND=supabase` + `PATRON_STORAGE=r2` i dzialaja jak dotad. Nie zmienia kontraktu rol ani audit trail.

---

## Alternatywy odrzucone

1. **Przepisanie 30+ call-site na bezposrednie SQL** zamiast adaptera. Odrzucone: ogromny diff w jednej sesji = wysokie ryzyko regresji, w tym na nienaruszalnym hash-chain (Art. 3). Adapter daje maly diff i izoluje ryzyko do jednego, testowalnego pliku. Migracja na natywne SQL moze nastapic przyrostowo pozniej.
2. **Twarde usuniecie Supabase** (`@supabase/supabase-js` + caly kod). Odrzucone: lamie vendor-neutrality (Art. 4) i kasuje sciezke multi-tenant SaaS (1000+ kancelarii). Dual-mode za flaga zachowuje obie sciezki przy zerowej utracie pracy.
3. **sql.js / node-sqlite3 (WASM / async)** zamiast better-sqlite3. Odrzucone: sql.js trzyma baze w RAM (utrata trwalosci, problem przy duzych korpusach), node-sqlite3 jest async + wolniejszy. better-sqlite3 jest synchroniczny (upraszcza adapter - brak race na hash-chain), najszybszy, ma prebuilt binaries na Windows (zero kompilatora przy instalacji), MIT.
4. **Migracja danych testowych z Supabase do SQLite**. Odrzucone w tej iteracji: dane to garstka rekordow testowych z sesji nocnej; swieza baza jest szybsza i nie ryzykuje niespojnosci hash-chain przy przepisaniu `bigserial`. Skrypt eksportu = rezerwacja (gdyby pojawila sie realna baza do przeniesienia).
5. **Plik `.sql` ladowany z dysku** zamiast embedded string. Odrzucone: rozwiazanie sciezek w `dist/` i w spakowanym `.exe` jest kruche. String w module TS jedzie z bundlem.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean backend** (`npm run build` - exit 0, zero bledow).
- **Vitest backend**: 655 pass / 5 todo / 0 fail (z 646 przed ADR; +9 nowych w `supabase-shim.test.ts`). Zero regresji.
- **Smoke shim** (17 asercji, swieza tymczasowa baza): CRUD, jsonb round-trip, `single()`-miss, count head, `.or()` z `in(parens)`, upsert onConflict, filtr boolean, hash-chain linkage (prev=hash) + order desc, auth getUser/listUsers/getUserById - all green.
- **Smoke boot end-to-end** (tryb sqlite, port testowy, zero Docker/Supabase): `/health` 200, `GET /workflows` 200, `GET /chat` 200, `POST /chat/create` -> insert + UUID + `user_id=LOCAL_USER_ID`, `GET /chat` -> zwrocony czat z ISO timestamp. Log boota czysty (scheduler Merkle wystartowal).
- **1 nowa zaleznosc npm**: `better-sqlite3` (+`@types/better-sqlite3` dev). Uzasadnienie w Alternatywy pkt 3 - netto stos sie upraszcza (-13 kontenerow Docker z domyslnej sciezki).
- **LoC dodanych**: 1353 (schema.sqlite.ts 294 + sqlite-connection.ts 108 + supabase-shim.ts 719 + supabase-shim.test.ts 122 + supabase.ts +23 + middleware/auth.ts +21 + storage.ts +66).
- **Whitelist event_type spojny**: 14 wartosci w `schema.sqlite.ts` IN-CHECK = lustro `EVENT_TYPES` w `audit.ts` (13 + zgodnosc z schema.sql).
- **Marko-PL review PENDING** (twarda reguła AGENTS.md: 2x runda przed merge tego ADR).

## Co NIE jest w ADR-0053

- **sqlite-vec + RAG embeddings** (pgvector -> embedded vector) -> Dzien 3 roadmapy, osobny ADR. Schemat nie ma jeszcze kolumny vector - sciezka RAG nietknieta.
- **PIN / Windows Hello** przy starcie (Art. 5 ochrona personal brain) -> rezerwacja. Obecnie auth bypass bez sekretu.
- **Migracje przyrostowe na SQLite** (`npm run migrate` zaklada Postgres DDL przez Operatora) -> rezerwacja. Fresh deployment dostaje pelny schemat z `schema.sqlite.ts`; przyrostowe ALTER dla SQLite = osobny runner.
- **Pakowanie native modules (`better-sqlite3`) do portable `.exe`** (electron-rebuild / prebuilds pod ABI backendu) -> Dzien 12 roadmapy (packaging), nie ten ADR.
- **Kuzu Graph + Bibliotekarz + Folder Sprawy + Word roundtrip** -> Dni 4-9 roadmapy, osobne ADR.
