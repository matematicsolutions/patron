# ADR-0099: Domkniecie luk egress wykrytych w audycie - tabular review, generate-title, SSRF OLLAMA_HOST

**Status**: Wdrozony 2026-06-02 na branch `feat/tier-governance-envelope` (NIE scalony do main - czeka na akceptacje). Domyka trzy sciezki egresu, ktore omijaly wspolny straznik data-residency (ADR-0095) - tresc objeta tajemnica zawodowa mogla wyjsc do chmury z pominieciem kontroli.

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych / Art. 2 - Tajemnica zawodowa**: KAZDA sciezka wychodzaca do LLM z trescia akt sprawy musi przejsc przez `enforceEgressGuard` (ADR-0095). Audyt wielowymiarowy (2026-06-02) ujawnil trzy szwy, ktore tego NIE robily: przeglad tabelaryczny (generate / regenerate-cell / chat), generowanie tytulu czatu, oraz brak walidacji `OLLAMA_HOST` (SSRF).
- **Art. 7 - Minimalnosc / audit-first**: zero nowej zaleznosci npm. Reuzyty istniejacy `enforceEgressGuard` i `appendLlmRouteEvent` (AGENTS.md: "nie kopiuj logiki, importuj ja").

**Powiazane ADR**:
- ADR-0067 / ADR-0095 (wspolny chokepoint egress, data-residency): ten ADR rozszerza ich egzekucje na powierzchnie, ktore powstaly lub byly modyfikowane pozniej (tabular, generate-title) i nigdy nie zostaly wpiete w chokepoint.
- ADR-0098 (egzekucja Ollamy): jego sekcja Rezerwacje odnotowala, ze `tabular.ts` wola `providerForModel` bezposrednio - audyt potwierdzil, ze tabular byl tez poza egress guardem (inny, powazniejszy problem niz capabilities).
- ADR-0010/0080/0082 (tabular review + grounding + audit): tabular mial slad groundingu i audit grounding, ale NIE mial sladu/decyzji `llm_route` (data-residency). Ten ADR uzupelnia parytet.

---

## Kontekst

Audyt wielowymiarowy (workflow 93 agentow, 2026-06-02) - wymiar "granica governance" + rewizor adwersarialny - potwierdzil realnym odczytem kodu i sondowaniem zywego backendu trzy luki egresu:

1. **Tabular review bez straznika.** `backend/src/routes/tabular.ts` nie importowal `enforceEgress` (grep: 0 trafien). Endpointy `POST /:reviewId/generate` i `POST /:reviewId/regenerate-cell` wysylaly PELNA tresc dokumentow sprawy (do ~120 000 znakow markdown po ekstrakcji PDF/DOCX) do `streamChatWithTools`/`completeText` z modelem `tabular_model` - bez zadnej kontroli data-residency. Dla sprawy objetej tajemnica oznaczalo to bezposredni egress akt do chmury (gdy `tabular_model` byl chmurowy). To naruszenie rdzenia obietnicy produktu ("akta zostaja lokalnie") i RODO art. 5.

2. **Tabular chat z bledna klasyfikacja.** `POST /:reviewId/chat` woła `runLLMStream` (ktory ma egress guard), ale NIE przekazywal `projectId`. `enforceEgressGuard` klasyfikowal wiec rozmowe jako `internal` zamiast wg sprawy - dla sprawy `attorney_client_privileged` dane tabeli mogly wyjsc do chmury przez za niska klasyfikacje.

3. **generate-title bez straznika.** `backend/src/routes/chat.ts` `POST /:chatId/generate-title` wysylal pierwsze 500 znakow wiadomosci uzytkownika do `title_model` (domyslnie chmurowy) bez `enforceEgressGuard`.

4. **SSRF na `OLLAMA_HOST`.** `backend/src/lib/llm/ollama.ts` przyjmowal `OLLAMA_HOST` bez walidacji - przejecie env/konfiguracji pozwalaloby przekierowac wywolania LLM (z trescia pisma) na endpoint metadata chmury (169.254.169.254) i wykrasc kredencjale.

## Decyzja

### 1. Egress guard w tabular generate / regenerate-cell
Przed kazdym wywolaniem LLM endpoint pobiera `projectId = review.project_id` i woła `enforceEgressGuard({db, model: tabular_model, projectId, actorUserId})`. Przy `!allowed` zwraca `403 egress_blocked` (przed otwarciem SSE w `generate`). Po udanym przebiegu emituje `appendLlmRouteEvent(action: "allow")` - parytet sladu data-residency z czatem/draftem (AI Act art. 12).

### 2. projectId w tabular chat
`runLLMStream` w `POST /:reviewId/chat` dostaje `projectId: review.project_id` - egress guard klasyfikuje rozmowe wg sprawy, a nie domyslnie `internal`.

### 3. Egress guard w generate-title
`enforceEgressGuard` przed `completeText`. Przy blokadzie tytul NIE jest generowany w chmurze - fallback do skrotu wiadomosci (pierwsze 60 znakow), bez egresu.

### 4. Walidacja OLLAMA_HOST (SSRF, defense-in-depth)
`validateOllamaHost(raw)` (fail-loud): dozwolone tylko `http`/`https`; blokada hostow metadata chmury (169.254.169.254, 169.254.170.2, 100.100.100.200, metadata.google.internal) i calego zakresu link-local `169.254/16`. RFC1918/loopback PRZEPUSZCZONE celowo - zdalna Ollama w sieci LAN kancelarii to legalny scenariusz.

### 5. Bugfix przy okazji - mcp-status 500
`backend/src/routes/security.ts` odpytywal `audit_log` po kolumnie `created_at`, ktora w schemacie SQLite nazywa sie `ts` (schema.sqlite.ts:253) - kazde otwarcie banera MCP Security przez admina dawalo 500. Poprawione na `ts`. (Bugfix, nie decyzja architektoniczna - odnotowany dla kompletnosci.)

## Ewaluacja

- `backend/src/lib/llm/ollama.test.ts` (6 testow): `validateOllamaHost` przepuszcza localhost/RFC1918/host LAN, blokuje metadata + link-local + zle protokoly + nie-URL.
- Bramki: `tsc` EXIT 0; pelny suite vitest 1082 pass / 0 fail / 5 todo (przed zmianami), do re-runu po wpieciu testow tabular.
- Weryfikacja E2E na swiezym buildzie (po reinstalacji) - rezerwacja: sprawa privileged + `tabular_model` chmurowy => 403 `egress_blocked`.

## Alternatywy odrzucone
- **Globalny middleware egress dla wszystkich tras**: odrzucone - egress guard potrzebuje kontekstu (model per-ustawienie, projectId per-zasob), ktory zna dopiero handler. Wpiecie per-sciezka jest jawne i audytowalne.
- **Blokada calego RFC1918 w `validateOllamaHost`**: odrzucone - zlamaloby udokumentowany scenariusz zdalnej Ollamy w sieci kancelarii. Blokujemy tylko realny cel SSRF (metadata/link-local).

## Rezerwacje
- Testy integracyjne (supertest) dla `tabular.ts`/`draft.ts` egress - dlug z audytu (14/16 tras bez testow integracyjnych). Priorytet po tym ADR.
- `generateChatTitle` w `tabular.ts` (tytul czatu tabelarycznego) - analogiczna sciezka, do przegladu w nastepnej iteracji.
- Walidacja SSRF dla URL transportu MCP `http` - osobny szew (mcp-security), poza zakresem tego ADR.
