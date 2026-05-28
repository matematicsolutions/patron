# ADR-0059: Provider OpenRouter - jeden klucz, wiele modeli

**Status**: PROPONOWANY (2026-05-28). Dodaje OpenRouter jako czwartego dostawce LLM. Klucz przez env (per-user w DB = rezerwacja). Backend dziala, niewpiety jeszcze w UI wyboru modelu.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 4 - Neutralnosc dostawcow** (zasada glowna). OpenRouter to brama do wielu modeli (Claude / GPT / Gemini / Bielik / Llama / Mistral / DeepSeek) przez jeden klucz i jeden interfejs. Nie faworyzuje zadnego - rozszerza wybor. Dodany jako rownorzedny provider obok claude/gemini/openai, nie jako domyslny.
- **Art. 2 - Tajemnica zawodowa** - OpenRouter to usluga chmurowa (USA). Uzycie modeli przez OpenRouter to transfer tresci poza maszyne; decyzja Operatora, jak kazdy provider chmurowy. Bielik przez OpenRouter to nadal chmura - lokalny RODO-safe pozostaje przez Ollama (osobna sciezka). To opt-in: domyslny model bez zmian (gemini-3-flash-preview), OpenRouter tylko gdy user wybierze model "openrouter/...".

**Powiazane ADR**: ADR-0014 (multi-provider abstraction - ten ADR dokłada czwartego), ADR-0058 (pipeline obrony - moze teraz dzialac na dowolnym modelu OpenRoutera, w tym Bielik), ADR-0053 (tryb desktop).

---

## Kontekst

Roadmapa (Dzien 10): zamiast trzech osobnych kluczy (Anthropic/Google/OpenAI) jeden klucz OpenRouter daje dostep do wszystkich modeli, w tym polskiego Bielika. Setup dla mecenasa prostszy: jeden klucz, jeden rachunek, zmiana modelu per pytanie.

Pulapka techniczna: nasz istniejacy provider OpenAI uzywa **Responses API** (`/v1/responses`). OpenRouter jest **Chat Completions-compatible** (`/v1/chat/completions`) - inny ksztalt zadania i odpowiedzi. Nie da sie podszyc OpenRoutera pod openai.ts samym baseURL; potrzebny osobny adapter.

## Decyzja

### 1. Osobny adapter `backend/src/lib/llm/openrouter.ts` (Chat Completions)
`streamOpenRouter` (streaming SSE + petla narzedzi z akumulacja tool_calls po index) i `completeOpenRouterText` (non-stream). Czyste, testowalne helpery: `buildMessages`, `buildChatBody`, `accumulateToolCallDeltas`. Tools przekazywane wprost (StreamChatParams uzywa juz formatu OpenAI function - zgodny z Chat Completions).

### 2. Routing przez prefiks `openrouter/`
`providerForModel` rozpoznaje prefiks `openrouter/` (modele OpenRoutera maja id `vendor/model` ze slashem - jednoznacznie odrozniajacym je od kanonicznych modeli natywnych). `openRouterModelId` zdejmuje prefiks do natywnego id. `resolveModel` przepuszcza modele `openrouter/` (poza zamknieta lista ALL_MODELS).

### 3. Klucz przez env (v1)
`OPENROUTER_API_KEY` (env), opcjonalnie `apiKeys.openrouter`. `getUserApiKeys` czyta klucz z env. Per-user klucz w tabeli `user_api_keys` wymaga rozszerzenia enuma `provider` (CHECK) - rezerwacja, zeby nie ruszac schematu w tym ADR. Opcjonalne naglowki rankingowe OpenRoutera (`OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`, default X-Title "PATRON").

---

## Alternatywy odrzucone

1. **Podszyc OpenRouter pod openai.ts (sam baseURL)**. Odrzucone: openai.ts uzywa Responses API, OpenRouter mowi Chat Completions. Rozne ksztalty (input/instructions/output_text vs messages/choices). Wspolny adapter byłby pelen rozgalezien if/else - osobny plik jest czystszy.
2. **Zastapic 3 providerow OpenRouterem**. Odrzucone: tracimy bezposrednie sciezki (Anthropic/Google natywnie) i lokalny Ollama. OpenRouter to dodatkowa opcja, nie zamiennik. Neutralnosc = wiecej drog, nie jedna narzucona.
3. **Domyslny model = OpenRouter**. Odrzucone: OpenRouter to chmura (USA, Art. 2). Domyslny zostaje gemini-3-flash-preview; OpenRouter to swiadomy wybor usera per model.
4. **Per-user klucz OpenRouter w DB od razu**. Odrzucone w v1: wymaga migracji enuma provider (sqlite IN-check + Postgres) + bumpu PROVIDERS + walidacji. Env-key wystarcza dla desktopu; DB-key = rezerwacja.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 694 pass / 5 todo / 0 fail (z 684 przed ADR; +10 w `openrouter.test.ts` - routing prefiksu + brak regresji natywnych, resolveModel passthrough, buildMessages/buildChatBody pure, accumulateToolCallDeltas sklejanie po index). Bez prawdziwych wywolan sieciowych.
- **LoC**: ~440 (openrouter.ts 277, openrouter.test.ts 120, models.ts +~25, types.ts +2, llm/index.ts +6, userApiKeys.ts +5, env.example +9).
- **Zero nowych zaleznosci npm** (native fetch + SSE parsing wlasny, jak w openai.ts).
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0059

- **UI wyboru modelu OpenRouter** (lista modeli, oznaczenie chmura vs lokalny, ostrzezenie transfer poza EOG) -> rezerwacja frontend.
- **Per-user klucz OpenRouter w DB** (szyfrowany, jak inne) -> rezerwacja (migracja enuma provider).
- **Mapowanie tierow** (main/mid/low) na modele OpenRoutera dla tabular/title -> rezerwacja; v1 dziala dla glownego czatu, completeText i pipeline obrony.
- **Dynamiczna lista modeli z API OpenRoutera** (`/models`) + cache -> rezerwacja; v1 user podaje pelne id.
- **Ostrzezenie RODO przy wyborze modelu chmurowego** w runtime -> rezerwacja (decyzja Operatora, jak kazdy provider chmurowy).
