# ADR-0115: Panel "Stan systemu" (/api/status) + czyszczenie nieaktualnych komentarzy

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P3 #17 (cicha degradacja - wylaczony wektor / pominiety OCR / zablokowana chmura leca tylko do console.warn, UI nie sygnalizuje) + P3 #18 (nieaktualne komentarze "rezerwacja"). Pokrywa tez Propozycje #3 i Raport CTO sek. G ("Panel stanu").

## Decyzje

### P3 #17 - endpoint panelu stanu
Nowy `routes/health.ts` zamontowany na `/api/status` (osobno od publicznego liveness `/health`, ktory zostaje jako probe bez auth). `requireAuth + requireAdmin` (parytet z usage/audit; desktop single-user: operator = admin). READ-ONLY. Migawka:
- `vector.enabled` (isVecEnabled), `ocr.configured` (isOcrConfigured)
- `embedder.{model,dim}` z `retrieval_meta` (ADR-0114)
- `apiKeys` (getUserApiKeyStatus - provider + zrodlo)
- `consents` (privilegedCloud/usProviders przez gettery guard.ts = single source of truth z brama egress; pseudonimEgress ADR-0110; ragCrossCase ADR-0111)
- `openrouter.{configured,credits,depleted}` - saldo przez nowy `getOpenRouterCredits` (endpoint /credits, best-effort: null gdy brak klucza/blad/timeout, AbortController 4s). `depleted = balance <= 0` - wczesny sygnal realnego incydentu (ujemne saldo OpenRouter bez sygnalu).

Funkcje czyste wydzielone i przetestowane (`readConsents`, `buildStatusPayload`) - konwencja repo (jak security.ts); integration test Express = rezerwacja (brak supertest w stosie, Konstytucja Art. 4).

### P3 #18 - nieaktualne komentarze
`dualSimilarity.ts` i `events.ts` twierdzily "Wpiecie w retrieve() jest rezerwacja" - a `dualReRank`/`eventReRank` SA realnie wpiete w `retrieve()` (retrieval.ts, ADR-0087/0089). Komentarze poprawione na stan faktyczny (wpiete, domyslnie ON gdy >1 kandydat, wylaczane przez opts, waga przez PATRON_DUAL_ALPHA/PATRON_EVENT_ALPHA). Pozostale "rezerwacja" (US2 model uczony, wielohopowy walk) sa nadal aktualne - nietkniete.

## Konsekwencje

- (+) Koniec z "nie wiadomo, czemu nie dziala" - jeden ekran zdrowia: wektor/OCR/klucze/zgody/saldo. Saldo OpenRouter widoczne ZANIM zablokuje prace.
- (+) Fundament backendowy pod frontendowy "Panel stanu" (Raport CTO sek. G) i pod toggle chmury per-sprawa (P2 #6).
- (~) Saldo to jedyny egress w panelu (do dostawcy modelu, zero danych klienta) - zgodne z zero-cloud; best-effort, nie blokuje panelu.
- (-) Brak integration testu endpointu (rezerwacja supertest); pokryte testami czystych funkcji + getOpenRouterCredits (mock fetch).
- **Testy:** vitest 1168 pass / 0 fail / 5 todo (+9: readConsents, buildStatusPayload depleted true/false/null, getOpenRouterCredits brak-klucza/ok/!ok/throw).
