# ADR-0076: Panel zuzycia i kosztow AI - reader nad llm_route (lokalny, zero-cloud)

**Status**: PROPONOWANY 2026-05-30. Konstytucja v1.4.6.

**Data**: 2026-05-30

**Powiazane zasady** (Konstytucja Patrona v1.4.6):
- **Art. 1 - Lokalnosc danych**: panel czyta wylacznie lokalny `audit_log` (SQLite, ADR-0053). Zero egress, zero telemetrii. Dane o koszcie nie opuszczaja maszyny kancelarii.
- **Art. 3 - Audytowalnosc (AI Act art. 12)**: czyni istniejacy zapis per-call (ADR-0067) czytelnym dla czlowieka - operator widzi co, ile i za ile model przetworzyl. Record-keeping przestaje byc tylko dla audytora, staje sie narzedziem operacyjnym.
- **Art. 7 - Minimalnosc danych**: panel agreguje metadane routingu (tokeny, koszt, model, sprawa), nie tresc. Nie wprowadza nowego zrodla danych - czyta to, co juz jest logowane.

**Powiazane ADR**: ADR-0067 (zdarzenie `llm_route` - zrodlo danych panelu), ADR-0059 (OpenRouter - realny koszt z `usage.cost`), ADR-0053 (SQLite zero-cloud - magazyn audit_log), ADR-0026 (Merkle - panel NIE narusza lancucha, czyta read-only), ADR-beta cost-caps (rezerwacja - ten panel to fundament: te same agregaty i tabela cen napedzaja pozniej egzekwowanie budzetu).

---

## Kontekst

ADR-0067 (B2, LIVE) loguje per-call zdarzenie `llm_route` do `audit_log` z kompletem metadanych: model, dostawca, strefa egress, klasyfikacja danych, decyzja routingu, sprawa_id, tokeny prompt/completion, realny koszt (`cost_usd` z OpenRouter), latencja. Dane sa zapisywane przy kazdym wywolaniu LLM i wpiete w hash-chain (ADR-0001) + Merkle (ADR-0026).

Problem: **nikt tego nie czyta**. Nie istnieje endpoint ani widok, ktory pokazalby kancelarii ile AI kosztuje - per sprawa, per model, w czasie. Record-keeping jest, ale martwy operacyjnie. Prawnik nie wie, czy konkretna sprawa generuje 5 zl czy 500 zl kosztu modelu; partner nie ma podstawy do rozliczenia klienta ani do decyzji o limitach.

Inspiracja zewnetrzna (ocena #82, `phuryn/claude-usage`): lokalny dashboard zuzycia czytajacy wlasne pliki, zero telemetrii, wykresy. Wzorzec (czytaj lokalne dane -> agreguj -> pokaz), nie kod - tamten parsuje transkrypty Claude Code, my czytamy wlasny `audit_log`.

Brakuje tez statycznej tabeli cen: ADR-0067 daje realny koszt tylko dla OpenRouter (`usage.cost`); dla Gemini/Claude/Ollama lokalny `cost_usd` jest `null`. Bez tabeli cen panel pokazalby koszt tylko czesci wywolan.

---

## Decyzja

### A. Reader `/api/usage` - agregacja read-only nad llm_route

Nowy router `backend/src/routes/usage.ts` (wzorzec jak istniejace routery, `requireAuth`). Czyta `audit_log WHERE event_type = 'llm_route'`, parsuje payload JSON, agreguje. Endpointy:
- `GET /api/usage/summary?from&to` - sumy globalne (tokeny in/out, koszt realny, koszt szacowany, liczba wywolan) w oknie czasu.
- `GET /api/usage/by-model` - rozbicie per model + dostawca.
- `GET /api/usage/by-case` - rozbicie per sprawa_id (kluczowe dla rozliczen).
- `GET /api/usage/timeseries?bucket=day` - szereg czasowy do wykresu.

Czytanie jest **wylacznie read-only** - panel nie dotyka `audit_log`, nie liczy Merkle, nie zapisuje nic. Dla single-user (ADR-0053) agregacja O(n) zdarzen w pamieci jest akceptowalna; przy duzym wolumenie - rezerwacja na materializowany widok (ANTY-ZAKRES).

### B. Statyczna tabela cen - estymacja kosztu gdy brak realnego

`backend/src/lib/llm/pricing.ts`: mapa `model -> { inputPerMtokUsd, outputPerMtokUsd, source, asOf }`. Realizuje czesc rezerwacji z ADR-0067 ("statyczna tabela cen"). Regula laczenia:
- `cost_usd` z eventu (OpenRouter) istnieje -> koszt REALNY.
- `cost_usd` jest `null` -> policz z tokenow i tabeli cen -> koszt SZACOWANY (`estimated: true`).
- Model spoza tabeli -> koszt `null`, flaga `unpriced` (pokazujemy same tokeny).

Kazda pozycja cennika ma `asOf` (data zrodla) i `source` (URL/nazwa) - cennik sie starzeje, wiec data jest jawna. Ollama lokalny = koszt 0 (brak egress, brak oplaty API).

### C. Panel frontend - lokalne wykresy zuzycia i kosztu

Widok w `frontend/` (sekcja konta/ustawien): karty sum (tokeny, koszt realny + szacowany), wykres szeregu czasowego, rozbicie per model i per sprawa. Wizualizacja lokalna (istniejacy stack wykresow frontu), zero zewnetrznych wywolan. Jawne oznaczenie "koszt szacowany" tam, gdzie pochodzi z tabeli cen, nie z API.

---

## Konsekwencje

Pozytywne:
- Transparentnosc kosztu AI per sprawa - podstawa rozliczenia klienta i decyzji operacyjnych.
- Ozywia martwy record-keeping ADR-0067 - zgodnosc AI Act art. 12 staje sie uzyteczna, nie tylko formalna.
- Fundament pod cost-caps (ADR-beta) - te same agregaty i cennik napedzaja egzekwowanie budzetu.
- Wyroznik dla kancelarii: koszt AI per sprawa widoczny lokalnie, bez wysylania czegokolwiek poza maszyne.
- Zero nowego zrodla danych i zero egress - czyta istniejacy lokalny audit_log.

Koszty i ryzyka:
- Tabela cen sie starzeje - mitygacja: jawne `asOf`/`source`, koszt szacowany wyraznie oznaczony jako szacunek.
- Koszt szacowany != realny dla nie-OpenRouter - akceptowalne, bo alternatywa to brak informacji.
- Agregacja O(n) zdarzen przy czytaniu - akceptowalne dla single-user; duzy wolumen -> rezerwacja materializowanego widoku.
- Panel pokazuje sprawa_id - musi respektowac te same uprawnienia co audit viewer (RBAC), zeby nie wyciekac listy spraw.

---

## Anty-zakres (NIE w tym ADR)

- Egzekwowanie budzetu / cost-caps / blokowanie wywolan po przekroczeniu limitu - osobny ADR-beta (zalezy od tego panelu jako fundamentu).
- Alerty/powiadomienia o przekroczeniu progu.
- Eksport faktur / integracja z rozliczeniami kancelarii.
- Materializowany widok / cache agregatow (optymalizacja pod duzy wolumen).
- Multi-tenant / podzial kosztu miedzy uzytkownikow (Patron Desktop jest single-user, ADR-0053).
- Automatyczna aktualizacja cennika z zewnetrznego zrodla (cennik jest recznie wersjonowany z `asOf`).

---

## Bramki PRZED merge

- [ ] TSC clean (backend + frontend).
- [ ] Testy: agregacja `/api/usage` (suma tokenow/kosztu, podzial per model/sprawa, okno czasu), regula realny-vs-szacowany, model spoza cennika.
- [ ] Reader udowodniony read-only: test, ze GET /api/usage NIE zapisuje do audit_log i NIE zmienia Merkle root.
- [ ] RBAC: /api/usage za `requireAuth`, parytet uprawnien z audit viewer (sprawa_id to dane wrazliwe).
- [ ] Tabela cen: kazda pozycja ma `source` + `asOf`.
- [ ] Marko-PL review tresci ADR (2 rundy) PRZED merge.
- [ ] Konsystencja: panel nie wprowadza nowego event_type (czyta istniejacy `llm_route`) - zero zmian w 4 lustrach enum.
