# ADR-0036: Auto-trigger Merkle audit root + REST endpoint dla audytora

> **Uwaga numeracja**: ADR-0036 zarezerwowany explicite w `backend/src/lib/audit-merkle-roots.ts:5` ("Manualny trigger w ADR-0026. Automatyzacja (hook on N events) = ADR-0036.") oraz w CHANGELOG.md przy ADR-0026 ("automatyzacja ... + UI viewer dla audytora = rezerwacja ADR-0036"). Ten ADR realizuje rezerwacje w wezszym zakresie - **bez UI viewer** (rezerwacja ADR-0040, blocked-by ADR-0034 RBAC).

**Status**: WDROZONY (2026-05-27). Pure helpers `audit-merkle-scheduler.ts` LIVE (decyzja shouldCompute pure function). `setInterval` bootstrap w `backend/src/index.ts`. REST endpoint `GET /api/audit/merkle/verify/:eventId` LIVE w nowym routerze `routes/audit.ts`. Manualny CLI fallback `npm run merkle:trigger`.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.4 -> v1.2.5, zweryfikowane grepem):
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - GLOWNA zasada. Manualny trigger z ADR-0026 wymagal swiadomej akcji administratora kancelarii. Po wielu miesiacach w produkcji audytor moglby zastac stan "wszystkie eventy w audit_log, ale tylko jeden Merkle root sprzed pol roku". Hybrid auto-trigger gwarantuje swiezosc bez polegania na pamieci administratora.
- **Art. 7 - Bramki jakosci** - idempotency check przed compute (zapytanie o ostatni root + sprawdzenie czy nowych eventow wystarczy do nowego bloku). Rozwiazuje TODO z ADR-0026 (`audit-merkle-roots.ts:64-67`).
- **Art. 4 - Neutralnosc wobec dostawcow** - zero nowych zaleznosci npm. `setInterval` z biblioteki standardowej Node, brak node-cron / Supabase Edge Functions / pg_cron. Patron pozostaje vendor-neutral w warstwie schedulera.
- **Art. 1 - Lokalnosc danych** - REST endpoint zwraca samowystarczalny `ProofBundle` (event_hash + proof + merkle_root). Audytor moze zweryfikowac offline (`audit-merkle-verifier.ts`) bez dalszego dostepu do bazy kancelarii.

**Powiazane ADR**:
- **ADR-0026** - rodzic. Merkle audit chain z manualnym trigger. Ten ADR realizuje rezerwacje automatyzacji.
- **ADR-0001** - dziadek. Hash-chain audit_log nad ktorym dziala Merkle. Ten ADR nie modyfikuje `audit_log`, tylko czyta i wpisuje do `audit_merkle_roots`.
- **ADR-0035** - sasiad. Whitelist event_type dziala PRZED appendAuditEvent; Merkle hashuje `audit_log.hash` ktore jest deterministyczne niezaleznie od taksonomii. Brak interakcji.
- **ADR-0034 (rezerwowane)** - blocker dla rezerwacji ADR-0040 (UI viewer dla audytora). Wprowadza role `admin` + middleware `requireAdmin`, ktore zaostrzy autoryzacje na endpoincie `/api/audit/merkle/verify/:eventId` z "kazdy zalogowany" na "admin only".

---

## Decyzja

### A. Hybrid trigger (count OR interval, manual fallback)

Auto-compute Merkle root nastepuje gdy spelniony JEDEN z dwoch warunkow:
- **Count threshold**: liczba nowych eventow od ostatniego roota >= 1000 (env-tunable `PATRON_MERKLE_AUTO_COUNT_THRESHOLD`).
- **Interval threshold**: ostatni root sprzed >= 24h (env-tunable `PATRON_MERKLE_AUTO_INTERVAL_HOURS`).

Idempotency check PRZED compute: zapytanie o `max(chain_block_end)` z `audit_merkle_roots` daje `lastCoveredEventId`. Jezeli `max(id) z audit_log == lastCoveredEventId`, skip (brak nowych eventow). Jezeli `max(id) - lastCoveredEventId < count_threshold` ORAZ `now - lastRoot.computed_at < interval_threshold`, skip (zbyt wczesnie). Inaczej compute dla bloku `[lastCoveredEventId + 1, max(id)]`.

Dlaczego hybrid:
- **Count-only** podatne na "starvation" w low-activity kancelarii (50 events/dzien = 20 dni oczekiwania na nowy root, audytor widzi staly stan).
- **Interval-only** podatne na "explosion" w high-activity kancelarii (10000 events/h = jeden ogromny blok do hashowania raz na dobe, dlugie compute, audytor czeka).
- **Hybrid** gwarantuje swiezosc dla low-activity (max 24h) i efektywnosc dla high-activity (max 1000 events per blok).

Manualny CLI fallback `npm run merkle:trigger`: administrator kancelarii moze wymusic compute przed audytem (np. dzien przed wizyta UODO). Skrypt uzywa tej samej funkcji `runAutoCompute` co setInterval, z `computedBy = "manual"`.

### B. REST endpoint GET /api/audit/merkle/verify/:eventId (bez UI w tym ADR)

Nowy router `backend/src/routes/audit.ts` z jednym endpointem:

```
GET /api/audit/merkle/verify/:eventId
  -> 200 ProofBundle (event_id, event_hash, proof, merkle_root_id, merkle_root, chain_block_start, chain_block_end)
  -> 404 jezeli event nie istnieje lub brak roota pokrywajacego event
  -> 500 jezeli blad DB
```

Endpoint wewnetrznie wola `fetchProofForEvent(db, eventId)` z `audit-merkle-roots.ts` (juz LIVE z ADR-0026). Zwraca samowystarczalny bundle - audytor uzywa `verifyMerkleProof` z `audit-merkle-verifier.ts` offline.

**Autoryzacja**: w tym ADR endpoint chroniony middleware `requireAuth` (`backend/src/middleware/auth.ts`) - ten sam wzorzec co inne routery Patrona (np. `workflows.ts`). Middleware ustawia `res.locals.userId` i rzuca 401 gdy brak/zly JWT. To znaczy ze KAZDY zalogowany user moze zapytac o proof bundle dla DOWOLNEGO eventId. Akceptowalny kompromis bo:
- ProofBundle nie zawiera tresci eventu (tylko hash + sasiednie hashe w drzewie Merkle).
- Hash jest deterministyczny i juz mocno zwiazany z user_id przez `payload.actor_user_id` (a wiec user widzac wlasne eventy i tak je hashuje).
- Twarda RBAC (admin-only) = rezerwacja ADR-0034.

Po wpieciu ADR-0034 endpoint zostanie ograniczony do roli `admin` przez dodatkowy middleware `requireAdmin` przed `requireAuth` (gate bez zmiany kontraktu API).

### C. UI viewer NIE w tym ADR

Frontend Next.js nie ma katalogu `admin/`. Dodanie UI viewer wymaga:
- Nowa strona w `frontend/app/admin/audit/[eventId]/page.tsx`.
- Komponenty React (proof tree visualization, verify button, copy-to-clipboard JSON).
- Auth check dla admin role - **NIE istnieje przed ADR-0034**.

UI viewer = rezerwacja **ADR-0040** (blocked-by ADR-0034 RBAC). Atomowy ADR - jedna decyzja na raz.

### D. setInterval w backend startup zamiast cron-job na hoscie

Patron jest self-host, jeden kontener backend per kancelaria (`docker-compose` z Dockerfile - jeden serwis `backend`). Multi-instance to scenariusz przyszly (np. failover kancelarii z 50+ prawnikami) - na ten moment poza scope.

`setInterval(runAutoCompute, intervalMs)` w `backend/src/index.ts` po `app.listen()`:
- Pierwsze uruchomienie po `intervalMs` (default 1h, `PATRON_MERKLE_CHECK_INTERVAL_MS=3600000`).
- W kazdym tiku: idempotency check + opcjonalny compute.
- Bez setImmediate przy starcie - unika race condition z migracjami przy fresh deploy.
- Graceful shutdown - `clearInterval` w handlerze SIGTERM (rezerwacja, nie krytyczne).

Komentarz w kodzie: `// TODO ADR-0041: distributed lock (Postgres advisory lock lub Supabase channel) gdy backend bedzie multi-instance.`

Alternatywy odrzucone:
- **node-cron** - dodaje 1 zaleznosc dla "co 1h tik". setInterval natywny wystarcza.
- **Postgres pg_cron extension** - wymaga superuser w Supabase, nie aktywne domyslnie.
- **Supabase Edge Functions cron** - cloud-only, Patron self-host (sprzecznosc z Art. 1).
- **External cron job na hoscie** (`crontab -e` + `tsx scripts/trigger-merkle.ts`) - dodatkowy krok deployment, latwo zapomniec, brak widocznosci w logach backendu.

### Zakres tego ADR
- Nowy modul `backend/src/lib/audit-merkle-scheduler.ts` (pure helpers - `shouldComputeNextRoot` decision function, `computeNextBlockRange`).
- Nowy plik testow `backend/src/lib/audit-merkle-scheduler.test.ts` (~10+ testow pure functions, zero DB mocks).
- Nowa funkcja `runAutoCompute(db, options)` w `audit-merkle-roots.ts` (storage layer wrapper - czyta stan, woła scheduler decision, woła `computeAndStoreRoot` jezeli OK). `options: { countThreshold, intervalMs, computedBy, now? }`.
- Nowy router `backend/src/routes/audit.ts` z `GET /api/audit/merkle/verify/:eventId`.
- Wpiecie routera w `backend/src/index.ts` + `setInterval` bootstrap.
- Nowy skrypt `backend/scripts/trigger-merkle.ts` (CLI fallback) + `npm run merkle:trigger` w package.json.
- Aktualizacja komentarza ADR-0036 w `audit-merkle-roots.ts:5` (manual -> hybrid auto-trigger LIVE).
- 3 env var w `.env.example`: `PATRON_MERKLE_AUTO_COUNT_THRESHOLD=1000`, `PATRON_MERKLE_AUTO_INTERVAL_HOURS=24`, `PATRON_MERKLE_CHECK_INTERVAL_MS=3600000`.
- Konstytucja v1.2.4 -> v1.2.5 PATCH (sekcja 5.2.1 update z manual na hybrid + nowy paragraf o REST endpoint).

### Czego NIE robimy w tym ADR (osobne ADR-y)
- **NIE robimy UI viewer dla audytora** - rezerwacja ADR-0040 (blocked-by ADR-0034 RBAC).
- **NIE robimy RBAC admin-only na endpoincie** - rezerwacja ADR-0034 (admin role + middleware gate).
- **NIE robimy distributed lock dla multi-instance backend** - rezerwacja ADR-0041 (Postgres advisory lock). Komentarz TODO w kodzie.
- **NIE robimy RFC 3161 timestampingu Merkle root** - rezerwacja ADR-0037 (zewnetrzny znacznik czasu).
- **NIE robimy graceful shutdown clearInterval** - poza zakresem, restart kontenera i tak resetuje setInterval.

---

## Kontekst

### Dlaczego ADR-0026 zostawil auto-trigger jako rezerwacja

ADR-0026 wprowadzil 3 moduly Merkle (pure functions, storage layer, offline verifier) + manualny trigger przez administratora. To bylo MVP - dawalo audytorowi proof-of-inclusion od razu, bez czekania na automatyzacje.

Manual trigger ma 3 problemy operacyjne (uzasadnienie automatyzacji):
- **Zapominanie**: administrator kancelarii ma 100 innych obowiazkow, "uruchom Merkle root" znika z radaru.
- **Brak deterministycznego cadance**: audytor nie wie kiedy spodziewac sie nowego roota. Audyt UODO za 2 tygodnie, ostatni root sprzed 3 miesiecy = problem.
- **Stale roots dla nowych eventow**: gdy administrator zapomina, nowe eventy wpadaja do audit_log bez pokrycia Merkle root. `fetchProofForEvent` zwraca 404 ("brak Merkle root pokrywajacego event X").

ADR-0036 rozwiazuje wszystkie trzy przez hybrid auto-trigger + manual fallback (administrator nadal moze wymusic compute przed audytem).

### Dlaczego idempotency check przed compute

ADR-0026 (`audit-merkle-roots.ts:61-67`) explicite mowi:
> brak ON CONFLICT: tabela `audit_merkle_roots` nie ma unique constraint na zakres bloku. Wywolanie dwa razy dla tego samego (blockStart, blockEnd) zapisze dwa wiersze z tym samym `merkle_root` (deterministyczny algorytm RFC 6962). To NIE jest idempotentne; **auto-trigger po N events (ADR-0036) bedzie musial sprawdzic przed compute czy root juz istnieje dla zakresu**.

Implementacja w `audit-merkle-scheduler.ts`:

```typescript
export function shouldComputeNextRoot(state: SchedulerState): SchedulerDecision {
    // state: { lastCoveredEventId, maxEventId, lastRootComputedAt, now, countThreshold, intervalMs }
    const newEvents = state.maxEventId - state.lastCoveredEventId;
    if (newEvents <= 0) return { compute: false, reason: "no_new_events" };
    const ageMs = state.now - state.lastRootComputedAt;
    if (newEvents >= state.countThreshold) return { compute: true, reason: "count_threshold" };
    if (ageMs >= state.intervalMs) return { compute: true, reason: "interval_threshold" };
    return { compute: false, reason: "below_thresholds" };
}
```

Decision pure function - zero IO. Test bez DB. Wrapper `runAutoCompute` w `audit-merkle-roots.ts` robi IO (czyta max id, ostatni root) i wywoluje shouldComputeNextRoot z prepared state.

### Dlaczego REST endpoint zamiast WebSocket/SSE

`/api/audit/merkle/verify/:eventId` to query-response (audytor pyta o jeden event, dostaje bundle). Brak strumieniowania, brak push-update. REST jest idealny dla tego use case (cache'owalny, idempotent GET, standardowy curl/Postman dla audytora).

WebSocket/SSE rozsadne gdyby audytor potrzebowal live updates "kiedy nowy root sie pojawi". To poza scope tego ADR (rezerwacja ADR-0040 jezeli UI viewer pokaze taka potrzebe).

### Dlaczego env-tunable thresholds

Defaults (1000 events, 24h) wytypowane dla typowej kancelarii (50-500 events/dzien). Duza kancelaria moze chciec niskiego count (100 events) zeby pokrycie bylo gestsze. Maly butik moze chciec dlugiego interval (72h) zeby oszczedzic compute.

Env var > config plik > hardcoded - zgodne z 12-factor app. Operator kancelarii edytuje `.env`, restart kontenera, nowe thresholds.

---

## Alternatywy rozwazane

**A. Count-only trigger (np. co 1000 events)**
- Odrzucone. Starvation dla low-activity (50 events/dzien = 20 dni oczekiwania).

**B. Interval-only trigger (np. co 24h)**
- Odrzucone. Explosion dla high-activity (10000 events/h = jeden ogromny blok = dlugie compute).

**C. Hybrid (count OR interval) z idempotency check (przyjete)** - **przyjete**
- Gwarantuje swiezosc dla low-activity + efektywnosc dla high-activity.

**D. Wpiac UI viewer w tym ADR**
- Odrzucone. Wymaga RBAC admin (ADR-0034) ktorego nie ma. Lepiej osobny ADR-0040 atomowy.

**E. Postgres trigger po INSERT na audit_log**
- Odrzucone. Trigger wymaga PL/pgSQL z grant EXECUTE. Compute Merkle w PL/pgSQL trudne (SHA-256 jest w pgcrypto, ale buildMerkleRoot rekurencja w PL/pgSQL ciezka). Latwiej w Node.

---

## Konsekwencje

### Pozytywne
- Audytor (UODO, rewident kancelarii, biegly w postepowaniu) ma gwarancje swiezosci Merkle root - max 24h luki.
- Idempotency check rozwiazuje TODO z ADR-0026 (`audit-merkle-roots.ts:64-67`).
- REST endpoint pozwala zewnetrznemu narzedziu audytora pobrac ProofBundle bez SSH na serwer Patrona (czysty HTTPS + JWT).
- Manualny CLI fallback - administrator kancelarii moze wymusic compute przed audytem (`npm run merkle:trigger` w windowie maintenance).
- Pure function `shouldComputeNextRoot` - decyzja testowalna bez bazy danych (zero mockow).
- Env-tunable thresholds - kancelaria dostraja gestosc compute do swojej skali.
- Zero nowych zaleznosci npm (Konstytucja Art. 4).

### Negatywne / kosztowe
- +1 plik scripts (~85 LoC `trigger-merkle.ts`), +1 plik lib (~95 LoC `audit-merkle-scheduler.ts`), +1 plik test (~175 LoC `audit-merkle-scheduler.test.ts`), +1 plik route (~80 LoC `routes/audit.ts`), +update `audit-merkle-roots.ts` (~85 LoC wrapper `runAutoCompute` z try/catch dla 2 fetch + pure decision wywolanie), +update `backend/src/index.ts` (~47 LoC: 6 importow + funkcja `startMerkleScheduler` ~40 lini + wywolanie po `app.listen`), +update `backend/.env.example` (3 nowe env var z komentarzem).
- `setInterval` w pojedynczym kontenerze - przy multi-instance backend race condition (dwie instancje moga policzyc root dla tego samego bloku, dwa wiersze identyczne w `audit_merkle_roots`). Akceptowalne (Patron self-host single-instance), TODO ADR-0041 dla multi-instance.
- Endpoint chroniony tym samym mechanizmem co reszta API (KAZDY zalogowany user, nie admin-only) - tymczasowy kompromis do ADR-0034 RBAC.
- Test integracyjny REST endpoint NIE jest w tym ADR (wymaga supertest + mock Express - planowane przy ADR-0042 framework testow integracyjnych backendu).

### Bramki PO wpieciu (potwierdzone w tej sesji)
- Testy backend: **503/508 pass** (+21 nowych vs baseline 482/487 z ADR-0035).
- TSC clean.
- Internal QA review (min. 2 rundy) - zalatwione przed commitem.

---

## Atrybucja

Wzorzec hybrid trigger (count OR interval) wlasny - dyktowany analiza two failure modes (starvation vs explosion). Brak bezposredniego cherry-pick.

`setInterval` bootstrap to standardowy pattern Node, bez atrybucji do konkretnego frameworka. Wzorzec idempotency check przed write opera sie na ADR-0026 storage layer (`fetchHashesInBlock` + brak ON CONFLICT) i `audit_merkle_roots` schema.

Pelna atrybucja zaleznosci backendu: [THIRD_PARTY_INSPIRATIONS.md](../../THIRD_PARTY_INSPIRATIONS.md).
