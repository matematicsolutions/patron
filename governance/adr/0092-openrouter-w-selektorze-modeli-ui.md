# ADR-0092: OpenRouter w selektorze modeli (parytet UI) - dostepnosc env-keyed v1

**Status**: Wdrozony 2026-06-01. Konstytucja v1.5.0. Domyka asymetrie zostawiona przez ADR-0059 (OpenRouter jako provider backendu, ale nieobecny w UI).

## Kontekst

ADR-0059 dodal OpenRouter jako rownorzedny provider w backendzie (adapter Chat Completions, prefiks `openrouter/`, klucz env `OPENROUTER_API_KEY`). Backend akceptuje `openrouter/*` w `models.ts` (`isOpenRouterModel`, `providerForModel`, `resolveModel`), ale frontend tego nie wystawial: `ModelToggle.tsx` MODELS znal tylko Anthropic/Google/OpenAI, a `modelAvailability.ts` typ `ModelProvider` nie mial `openrouter`. Skutek: backend gotowy, uzytkownik nie mogl wybrac modelu OpenRouter z UI (asymetria zdiagnozowana 2026-06-01).

## Decyzja

Wystawiamy OpenRouter w selektorze modeli (`ModelToggle`) jako osobna grupe "OpenRouter". `ModelProvider` rozszerzony o `"openrouter"`.

**Dostepnosc (v1, env-keyed):** modele OpenRouter sa zawsze wybieralne w UI (`isProviderAvailable("openrouter")` zwraca `true`). Powod: klucz OpenRoutera jest w env backendu (`OPENROUTER_API_KEY`), a nie per-user w DB jak claude/gemini/openai (te gatowane sa przez `apiKeys[provider].configured`). Front nie zna stanu env backendu, wiec nie udajemy, ze wie - faktyczna autoryzacja egzekwuje backend. Brak klucza env -> czytelny blad po stronie serwera przy wywolaniu, nie ciche zablokowanie w UI.

**Data-residency (bez zmian, kluczowe):** wybor modelu OpenRouter w UI NIE omija governance. `decideRoute`/`guardEgress` klasyfikuja kazdy `openrouter/*` jako `us-with-dpa` (transfer do US infra OpenRoutera) i blokuja dane objete tajemnica (attorney_client_privileged) niezaleznie od wyboru w UI; wyjscie do US wymaga `ALLOW_US_PROVIDERS` + decyzji Administratora; zdarzenie `llm_route` z egress trafia do hash-chain. Rezydencja UE = wylacznie tryb lokalny (Ollama).

**Wystawione modele (zweryfikowane w katalogu OpenRouter 2026-06-01):**
- `openrouter/meta-llama/llama-3.3-70b-instruct` (Llama 3.3 70B)
- `openrouter/mistralai/mistral-large` (Mistral Large)

Dobor: modele NIEdostepne natywnie (open / spoza wielkiej trojki) - to jest realna wartosc OpenRoutera (brama do wielu modeli, ADR-0059 Art. 4 neutralnosc), a nie duplikat Claude/Gemini/GPT. UWAGA: Bielik NIE jest obecny w katalogu OpenRouter (sprawdzone 2026-06-01) - przyklad ze slownika w `models.ts` (`speakleash/bielik-11b`) jest martwy, dlatego go NIE wystawiamy (zly slug = 404 dla testera).

## Alternatywy odrzucone

1. **Pelne raportowanie stanu env klucza w UI** (rozszerzyc `/user/api-keys` + `ApiKeyState` o openrouter source=env). Czystsze UX (realna dostepnosc), ale wiecej kodu (route + typy + strona account) - **rezerwacja**, gdy bedzie potrzeba.
2. **Nie wystawiac w UI, backend i tak akceptuje.** Odrzucone: to status quo (asymetria), uzytkownik nie ma jak wybrac modelu, ktory backend obsluguje.
3. **Dynamiczna lista modeli z `/api/v1/models` OpenRoutera.** Odrzucone w v1: zaleznosc sieciowa w UI, cache, walidacja - **rezerwacja**. v1 = mala, recznie zweryfikowana lista.

## Rezerwacje

- Raportowanie stanu `OPENROUTER_API_KEY` (env) do UI -> realna ikona dostepnosci.
- Dynamiczna lista modeli OpenRouter z API katalogu.
- Tooltip w UI ostrzegajacy, ze model OpenRouter = egress do US (dzis egzekwuje to backend; UI moze to komunikowac wczesniej).

## Pliki

- `frontend/src/app/components/assistant/ModelToggle.tsx` - grupa "OpenRouter" + 2 modele + GROUP_ORDER.
- `frontend/src/app/lib/modelAvailability.ts` - `ModelProvider` += "openrouter"; `isProviderAvailable`/`providerLabel`/`modelGroupToProvider` obsluguja openrouter.

## Powiazania

ADR-0059 (OpenRouter provider), ADR-0067 (egress router / data-residency), ADR-0076 (panel kosztow - realny koszt z OpenRouter), Konstytucja Art. 4 (neutralnosc dostawcow).
