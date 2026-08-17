# ADR-0098: resolveModel przepuszcza modele lokalne (ollama/*) + domkniecie egzekucji Ollamy w warstwie funkcyjnej LLM

**Status**: Wdrozony 2026-06-02 na branch `feat/tier-governance-envelope` (NIE scalony do main - czeka na akceptacje). Naprawia regresje, ktora lamala obietnice "no-egress lokalnie" (tajemnica zawodowa): wybor modelu lokalnego Ollama na `/draft/refine` (i w czacie) byl po cichu zamieniany na model chmurowy.

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych / Art. 2 - Tajemnica zawodowa**: model lokalny (`ollama/*`, `egress: no-egress`) jest jedynym dozwolonym kanalem dla danych objetych tajemnica. `resolveModel` odrzucal jednak `ollama/*` (brak w `ALL_MODELS`, brak `isOpenRouterModel`) i zwracal `DEFAULT_MAIN_MODEL` = `gemini-3-flash-preview` (chmura US). Efekt: uzytkownik wybieral Ollame, a system probowal egressowac do chmury - na `/draft/refine` straznik egress (ADR-0095) slusznie blokowal to 403, ale samo zachowanie bylo zlamaniem zamierzonej obietnicy (model lokalny mial dzialac, nie byc blokowany).
- **Art. 4 - Neutralnosc wobec dostawcow**: brak egzekucji Ollamy w warstwie funkcyjnej oznaczal faktyczne wykluczenie jedynego providera no-egress. Ten ADR przywraca parytet (lokalny dziala tak jak chmurowe).
- **Art. 7 - Minimalnosc**: zero nowej zaleznosci npm. Adapter funkcyjny reuzywa istniejaca klase `OllamaProvider` (ADR-0014 T2) - nie kopiuje logiki HTTP/retry/circuit, importuje ja.

**Powiazane ADR**:
- ADR-0014 (multi-provider abstraction, `OllamaProvider`/`BaseProvider`, rejestr `egressForModel`): klasa `OllamaProvider` byla w pelni zaimplementowana, ale NIGDY nie instancjonowana - rownolegly system typow (`ChatRequest`/`ChatChunk` z `provider.ts`) nie byl wpiety w funkcyjny `llm/index.ts` (`completeText`/`streamChatWithTools`). Ten ADR domyka to wpiecie.
- ADR-0059 (OpenRouter, `OPENROUTER_PREFIX`/`isOpenRouterModel`): wzorzec, ktory `resolveModel` stosowal dla OpenRoutera, ale nie dla Ollamy. Symetria przywrocona przez `isOllamaModel`.
- ADR-0095 (wspolny chokepoint egress): to ON ujawnil objaw (403 na `/draft/refine` z modelem lokalnym). Straznik dzialal poprawnie; bledny byl `resolveModel` PRZED nim.
- ADR-0058 (pipeline obrony) + ADR-0094/0096 (wbudowana trojka obrony + custom skille draft-stage): wszystkie ida przez `completeText`, wiec wszystkie byly dotkniete (nie tylko skille z paczek).

---

## Kontekst

Audyt podczas budowy Biblioteki umiejetnosci (ADR-0094/0096) ujawnil, ze `resolveModel(id, fallback)` przepuszczal tylko `id` z `ALL_MODELS` (Claude/Gemini/OpenAI) lub `isOpenRouterModel(id)`. Modele `ollama/*` przepadaly na `fallback`. Dwa skutki, oba ciche:

1. **`/draft/refine` (i kazda sciezka przez `resolveModel`)**: `ollama/llama3.2:3b` -> `gemini-3-flash-preview`. Straznik egress (ADR-0095) widzial model chmurowy i blokowal 403 `egress_blocked` - mimo ze uzytkownik wybral model lokalny, ktory `egressForModel` JUZ klasyfikuje jako `no-egress`.

2. **Glebsza luka - egzekucja**: nawet po przepuszczeniu `ollama/*` przez straznika, `completeText`/`streamChatWithTools` w `llm/index.ts` dispatchuja przez `providerForModel`, ktore dla `ollama/*` rzucalo `Unknown model id` (unia `Provider` w `types.ts` nie zawiera ollamy). Funkcyjna warstwa LLM nigdy nie uruchamiala Ollamy - klasa `OllamaProvider` istniala, ale byla orphaned (zero instancji w kodzie). Bug w `resolveModel` maskowal te luke: skoro `ollama/*` nigdy nie docieralo do `providerForModel` (zamieniane na gemini), nikt nie trafial na `Unknown model id`. `stream.ts:242` rowniez woła `resolveModel`, wiec czat z Ollama tez po cichu szedl na gemini (przeciek/blokada, zaleznie od `ALLOW_US_PROVIDERS`).

Naprawa samego `resolveModel` bez (2) zamienilaby 403 na 500 (`Unknown model id`). Dlatego ADR obejmuje oba.

## Decyzja

### 1. `resolveModel` przepuszcza `ollama/*` (`backend/src/lib/llm/models.ts`)
- Nowy `OLLAMA_PREFIX = "ollama/"` + `isOllamaModel(model)` jako JEDNO zrodlo prawdy (analogicznie do `OPENROUTER_PREFIX`). `routing/egress.ts` przestaje definiowac wlasny `OLLAMA_PREFIX` - re-eksportuje z `models.ts` (zachowuje importy `routing/index.ts` i `auditLlmRoute.ts`).
- `resolveModel` akceptuje `id`, gdy `ALL_MODELS.has(id) || isOpenRouterModel(id) || isOllamaModel(id)`.
- `providerForModel` celowo NADAL rzuca dla `ollama/*` (komentarz wyjasnia: ollama nie jest w unii `Provider`, jest dispatchowane wczesniej).

### 2. Funkcyjny adapter Ollamy (`backend/src/lib/llm/ollama.ts`)
- `completeOllamaText({model, systemPrompt?, user, maxTokens?})` i `streamOllama(params)` reuzywaja `OllamaProvider` (retry/backoff, circuit breaker, timeout, rate limit z `BaseProvider`), tlumaczac miedzy interfejsem funkcyjnym (`StreamChat*`, OpenAI-style) a `ChatRequest`/`ChatChunk`.
- Host z `OLLAMA_HOST` (default `localhost:11434`).
- Ollama (w tej implementacji) nie wspiera tool callingu (`capabilities.toolCalling=false`) - `tools`/`runTools` ignorowane; model lokalny odpowiada tekstem. Akceptowalna degradacja trybu no-egress.

### 3. Dispatch w `llm/index.ts`
- `completeText` i `streamChatWithTools` sprawdzaja `isOllamaModel(params.model)` PRZED `providerForModel` i kieruja do adaptera. To naprawia rownoczesnie `/draft/refine` (przez `completeText`) i czat (`streamChatWithTools`) - czat z Ollama dotad po cichu szedl na gemini przez `resolveModel`.

### Zmiana zachowania (swiadoma)
Czat i `/draft/refine` z modelem `ollama/*` faktycznie uruchamiaja lokalna inferencje (dotad: gemini lub 403/500). To naprawienie zamierzonego dzialania, nie nowy ficzer.

## Ewaluacja

`backend/src/lib/llm/models.test.ts` (4 testy): `isOllamaModel`; `resolveModel` przepuszcza `ollama/*` i NIE wraca `DEFAULT_MAIN_MODEL` (sedno regresji); przepuszczony model ma `egressForModel == no-egress` (straznik dopusci); `providerForModel` rzuca dla ollamy (kontrakt: dispatch wczesniej).

Weryfikacja E2E realnym curlem na dev-backendzie (`PORT=3099`, sqlite, zywa Ollama `llama3.2:3b`):
- `model: gemini-3-flash-preview` -> HTTP 403 `egress_blocked` (straznik aktywny, bez regresji).
- `model: ollama/llama3.2:3b` -> HTTP 200 z realnym wynikiem pipeline obrony (etap Recenzent), bez egress.

Bramki: `tsc` EXIT 0; pelny suite vitest 1082 pass / 0 fail / 5 todo.

## Alternatywy odrzucone
- **Dodanie `"ollama"` do unii `Provider` (`types.ts`) + galaz w dispatcherach**: odrzucone - kaskaduje na miejsca switchujace `Provider`, wiekszy blast radius. Guard `isOllamaModel` przed `providerForModel` jest minimalny i idiomatyczny (jak wczesniejsze wydzielenie OpenRoutera).
- **Wlasna implementacja HTTP do Ollamy w adapterze**: odrzucone - `OllamaProvider` (ADR-0014) ma juz retry/circuit/timeout/rate-limit. AGENTS.md: nie kopiuj logiki, importuj ja.
- **Naprawa tylko `resolveModel`**: odrzucone - dalaby 500 `Unknown model id` zamiast wyniku (egzekucja nigdy nie byla wpieta). Kryterium akceptacji to "produkuje wynik", nie "przechodzi straznika".

## Rezerwacje
- Tool calling dla Ollamy (modele wspierajace `tools` od nowszych wersji) - dzis `streamOllama` ignoruje `tools`. Wpiecie gdy pojawi sie realna potrzeba (np. lokalny RAG z toolami).
- `tabular.ts` woła `providerForModel` bezposrednio (capabilities) - tabular z Ollama nadal rzuci. Poza zakresem (tabular jest osobna powierzchnia); osobny ADR gdy bedzie potrzeba.
- Ujednolicenie dwoch systemow typow LLM (`types.ts` StreamChat* vs `provider.ts` ChatRequest) - dlug z ADR-0014 T5, niezmieniony tutaj.
