# ADR-0093: Twarde cost-caps per sprawa (limit budzetu LLM) - US5 pilotaz-readiness

**Status**: Wdrozony 2026-06-01. Konstytucja v1.5.0. Domyka rezerwacje z ADR-0076 ("cost-caps / budget enforcement = rezerwacja"). Czesc paczki pilotaz-readiness (spec patron-desktop-drafts/spec/pilotaz-readiness).

## Kontekst

ADR-0076 wprowadzil panel kosztow (per-call audit llm_route z realnym kosztem, /api/usage, pricing.ts), ale jawnie zostawil egzekwowanie limitu jako rezerwacje: Patron koszt MIERZY i POKAZUJE, lecz NIE BLOKUJE po przekroczeniu. Dla pilotazu z ograniczonym budzetem (np. klucz testowy OpenRouter cap $2) brakowalo twardego limitu na sprawe.

## Decyzja

Twardy cost-cap per sprawa, egzekwowany PRZED guardEgress w `lib/chat/stream.ts`.

- **Prog**: env `PATRON_CASE_COST_CAP_USD`. Domyslnie NIEUSTAWIONY = cap wylaczony (brak zmiany zachowania; operator opt-in). Wartosc > 0 wlacza limit (USD na sprawe).
- **Spend**: skumulowany koszt sprawy liczony z istniejacych zdarzen `llm_route` (ADR-0067) filtrowanych po `case_id`, koszt rozstrzygany przez `pricing.ts` (realny z dostawcy albo szacowany). Read-only nad audit_log (`lib/routing/budget.ts`).
- **Przekroczenie (spent >= cap)**: wywolanie LLM zablokowane, SSE `{type:error, code:"budget_exceeded"}`, strumien zamkniety. Operator moze kontynuowac SWIADOMIE: pole `allow_budget_override` w body zadania (projectChat) -> wywolanie przechodzi.
- **Audyt**: kazda decyzja (block / override) -> dedykowany `event_type = "cost_cap"` w hash-chain (sprawa, model, koszt skumulowany, prog, decyzja; bez tresci). Dowod kontroli kosztu AI Act art. 12.
- **Czysta logika**: `evaluateBudget()` bez IO (testowalne); `getCaseSpentUsd()` to read-only reader.

Zachowanie zgodne z zasada produktu: MateMatic daje mechanizm (prog + override), operator USTAWIA prog, DECYDUJE o kontynuacji i PONOSI konsekwencje (patrz feedback "narzedzie / mecenas wybiera").

## Dlaczego dedykowany event_type (nie reuse llm_route)

Budzet to inna semantyka niz data-residency. `RouteReason` (decideRoute) jest oznaczony "nie zmieniaj bez ADR" i opisuje strefy egress, nie koszt. Dedykowany `cost_cap`:
- czysta semantyka w audycie (latwe filtrowanie w audit pack / panelu),
- nie zaśmieca slownika routingu,
- koszt: migracja 010 ALTER CHECK + lustro w schema.sql i schema.sqlite.ts (konwencja jak 005/007/008/009).

## Alternatywy odrzucone

1. **Reuse `llm_route` + nowy RouteReason budzetowy.** Odrzucone: zlewa budzet z residency, lamie stabilnosc RouteReason, gorsza czytelnosc audytu. Zysk (brak migracji) nie wart utraty semantyki.
2. **Twardy blok bez override.** Odrzucone: sprzeczne z zasada "operator decyduje i ponosi konsekwencje"; mecenas w toku pracy musi miec mozliwosc swiadomej kontynuacji (zapisanej w audycie), a nie utykac do zmiany env przez admina.
3. **Prog globalny zamiast per sprawa.** Czesciowo: prog jest dzis globalny (env), ale liczony i egzekwowany PER SPRAWA (spend per case_id). Prog rozny per sprawa w DB = rezerwacja.

## Pliki

- `backend/src/lib/routing/budget.ts` (nowy) - `caseCostCapUsd`, `evaluateBudget` (pure), `getCaseSpentUsd`.
- `backend/src/lib/routing/auditCostCap.ts` (nowy) - `buildCostCapEvent` (pure) + `appendCostCapEvent`.
- `backend/src/lib/routing/budget.test.ts` (nowy) - 8 testow (logika + builder).
- `backend/src/lib/chat/stream.ts` - check budzetu PRZED guardEgress + param `allowBudgetOverride`.
- `backend/src/routes/projectChat.ts` - przepiecie `allow_budget_override` z body.
- `backend/src/lib/audit.ts`, `schema.sqlite.ts`, `schema.sql`, `migrations/010_audit_log_event_type_cost_cap.sql` - whitelist event_type `cost_cap`.

## Rezerwacje

- Przycisk override w UI (front wysyla `allow_budget_override`) - dzis pole akceptowane przez backend, button to follow-up.
- Prog rozny per sprawa (kolumna w projects) zamiast jednego env.
- Miekkie ostrzezenie przy ~80% progu (przed twardym blokiem).
- Wyswietlenie biezacego spend/cap sprawy w UI (panel kosztow per sprawa).

## Powiazania

ADR-0076 (panel kosztow - rezerwacja cost-caps domknieta tutaj), ADR-0067 (llm_route - zrodlo kosztu), ADR-0035/0038 (konwencja whitelist event_type + migracje UP/DOWN), Konstytucja Art. 7 (jakosc/governance).
