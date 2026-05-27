# ADR-0014: Multi-provider abstraction layer dla LLM (operacjonalizacja Art. 4)

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady** (Konstytucja Patrona v1.1.1, zweryfikowane wzgledem `governance/CONSTITUTION.md`):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - abstrakcja pozwala wybrac Ollama lokalnie bez zmian kontraktu wywolania; brak hardcoded providera = brak ryzyka wycieku do chmury domyslnie
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - kazdy provider zwraca jednolite metadane (model, tokens, koszt, latency) ladowane do hash-chain audit log (ADR-0001)
- **Art. 4 - Neutralnosc wobec dostawcow** (zasada przewidywalnosci) - **operacjonalizacja** zasady, ktora dotad byla deklaratywna. Konstytucja wymaga "wymiany Gemini ↔ Claude ↔ Ollama jako zmiany 1 wartosci w `.env`"; ten ADR dostarcza warstwe ktora to realizuje
- **Art. 5 - Tajemnica zawodowa** (Pr.Adw. art. 6, Pr.RP art. 3) - capability flags per provider pozwalaja oznaczyc "no-egress" (Ollama) vs "cloud" (Anthropic/Gemini), router odmawia wywolania cloud providera dla danych z flagi `attorney_client_privileged`

**Powiazane ADR**:
- ADR-0001 (hash-chain audit trail) - audit log entry per wywolanie LLM dostaje `provider_id` + `model_id` jako pole obowiazkowe
- ADR-0002 (dual-license powloka) - warstwa abstrakcji siedzi w `backend/src/lib/llm/` na licencji AGPL-3.0 powloki
- ADR-0003 (pseudonimizacja PII pre-LLM) - warstwa pseudonim siedzi **przed** multi-provider router (kazdy provider dostaje juz zanonimizowane wejscie). **Warunek wstepny ADR-0014**: ADR-0003 dzisiaj jest skeleton niewpiety produkcyjnie (`backend/src/lib/pseudonim/`, 24/24 testy, plan T1-T6 ADR-0003 § Plan). T5 tego ADR (refactor call-sites) zaklada wpiecie ADR-0003 jako zalezenie wstepne; jezeli ADR-0003 jeszcze niewpiety w momencie startu T5, plan przesuwa sie o jego wpiecie
- ADR-0006 (audit bundle AI Act art. 12) - bundle zawiera per-call provider metadata (kto, jaki model, ile tokenow, ile kosztowalo)
- ADR-0010 (contract review module) - extraction worker juz wymaga "konfigurowalnego LLM, nie Gemini hardcoded"; ten ADR to wdraza systemowo

**Inspiracja cherry-pick**: [earendil-works/pi](https://github.com/earendil-works/pi) (MIT, 52.3k gwiazdek, v0.75.4 z 20.05.2026, organizacja earendil-works, monorepo 4 pakietow, pakiet `@earendil-works/pi-ai`) - pattern abstrakcji providera. Drugie zrodlo dla **adaptera tool-calling**: [AnttiHero/lavern](https://github.com/AnttiHero/lavern) (Apache 2.0), plik `src/providers/tool-converter.ts` - pattern budowy provider-agnostycznego rejestru narzedzi z definicji MCP z odpornym fallbackiem per narzedzie. **NIE forkujemy** zadnego - cherry-pick patternow architektonicznych. Caly kod TypeScript Patrona napisany od zera w `backend/src/lib/llm/`.

## Decyzja

Patron dostaje warstwe `backend/src/lib/llm/` realizujaca **interface `LLMProvider`** z 4 implementacjami (Anthropic, Gemini, Ollama, OpenAI opt-in). Wybor providera = wartosc `LLM_PROVIDER` w `.env`. Failover sekwencja `LLM_FALLBACK_CHAIN`.

Interfejs:

```ts
// backend/src/lib/llm/types.ts (schemat poglada, nie finalna sygnatura)
interface LLMProvider {
  readonly id: 'anthropic' | 'gemini' | 'ollama' | 'openai';
  readonly capabilities: {
    egress: 'no-egress' | 'eu-only' | 'us-with-dpa';
    toolCalling: boolean;
    vision: boolean;
    contextWindow: number;
    structuredOutput: boolean;
  };
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<ChatChunk>;
  estimateCost(req: ChatRequest): CostEstimate;
}
```

Router (`LLMRouter`) wybiera providera na podstawie:
1. `req.dataClassification` (np. `attorney_client_privileged` ⇒ tylko `egress: 'no-egress'`)
2. `req.requiredCapabilities` (np. `toolCalling: true` ⇒ filtr providerow)
3. `LLM_PROVIDER` z `.env` (primary)
4. `LLM_FALLBACK_CHAIN` (fallback gdy primary down lub odmawia ze wzgledu na classification)

## Kontekst

Konstytucja Patrona v1.1.1 deklaruje w Art. 4: *"Patron nie zamyka kancelarii w jednym dostawcy modelu. Wymiana Gemini ↔ Claude ↔ Ollama to zmiana 1 wartosci w `.env`, bez przepisywania danych."*

**Stan dzisiaj** (2026-05-21):
- Backend forka willchen96/mike (ADR-0002) ma `lib/llm/` z 2 providerami (Gemini + OpenAI).
- ADR-0010 (contract review) wymaga "konfigurowalnego LLM, nie Gemini hardcoded" - zarezerwowano, ale brak implementacji.
- ADR-0003 (pseudonim) zaklada ze warstwa siedzi PRZED LLM - dzialaja gdy LLM jest jeden; gdy beda 4, kazdy wymaga osobnej integracji ze warstwa pseudonim.
- Brak audytu kosztu per provider (ADR-0006 audit bundle ma `tokens_used`, ale nie `provider_id`).

**Problem operacyjny**:
- Single-provider lock-in to ryzyko ciaglosci dzialania kancelarii - kazdy provider ma okresowe outages i rate limits, brak fallback = przestoj.
- AI Act art. 6 (high-risk AI w prawie, kategoria z aneksu III, wymogi obowiazuja od 2026-08-02 - 24 m-ce po wejsciu rozporzadzenia w zycie) + art. 12 (record-keeping) - audit log MUSI zawierac informacje o uzywanym modelu i providerze (`model_id`, `provider_id`), inaczej brak compliance.
- Kancelaria moze chciec **rozne providery dla roznych klientow** (klient A → Ollama lokalnie / klient B → Anthropic / klient C → Gemini z DPA EU). Dzisiaj wymagaloby to 3 instancji Patrona.

**Pi pokazuje, ze to da sie zrobic w jednej abstrakcji** (`@earendil-works/pi-ai`). Architektura jest czysta: jeden interfejs, N providerow, capability flags na providera, router wybiera. 52.3k gwiazdek, 4227 commitow na main, v0.75.4 (20.05.2026) - skala adopcji i kadencja release'ow swiadcza o utrzymywalnosci wzorca.

Decyzja: **cherry-pick patternu abstrakcji, caly kod Patrona pisze od zera** pod polskie wymogi (data classification w sygnaturze, no-egress flag, audit hash-chain integration, pseudonim layer obligatoryjna przed kazdym providerem).

## Co bierzemy z pi (cherry-pick)

1. **Pattern interfejsu `LLMProvider`** - jedna sygnatura, N implementacji. Wybor przez `.env`, nie przez `if/else` w kodzie aplikacji.
2. **Capability flags per provider** - struktura `capabilities: { toolCalling, vision, contextWindow, structuredOutput, ... }`. Router odmawia wywolania providera ktory nie wspiera wymaganej capability zamiast crash w runtime.
3. **Provider-agnostic message format** - jeden wewnetrzny typ `Message[]`, kazdy provider robi tlumaczenie na swoj natywny format (Anthropic content blocks vs Gemini parts vs OpenAI messages vs Ollama prompt).
4. **Failover/retry chain** - `LLM_FALLBACK_CHAIN=anthropic,gemini,ollama`. Gdy primary down lub odmawia (np. rate limit, classification mismatch), router probuje nastepny w lancuchu.
5. **Cost estimation per call** - method `estimateCost(req)` zwraca przewidywany koszt PRZED wywolaniem. Pozwala kancelarii ustawic limity i alert na drogie calle.
6. **Adapter tool-calling: provider-agnostyczny `ToolRegistry`** (z Lavern `tool-converter.ts`) - jedna lista definicji narzedzi MCP, kazdy provider buduje z niej swoj natywny format function-calling (Anthropic tool blocks vs OpenAI functions vs natywne narzedzia Gemini). Kluczowy szczegol patternu: **odporny fallback per narzedzie** - jezeli pojedyncze `inputSchema` jest zlamane, narzedzie zostaje wywolywalne bez typowanych parametrow (`{ type: 'object', additionalProperties: true }`) zamiast wywalic caly rejestr. To domyka flage `capabilities.toolCalling` realna implementacja, nie tylko deklaracja.

## Czego NIE bierzemy

- **Caly pakiet `@earendil-works/pi-ai` jako dependency** - dolozenie zaleznosci runtime na kluczowej warstwie = ryzyko (zmiana licencji, security supply chain). Reimplementacja w `backend/src/lib/llm/` daje **niezaleznosc ewolucyjna** ([zasada 4 cherry-pick MateMatic](../../THIRD_PARTY_INSPIRATIONS.md)).
- **Pelny zestaw 8+ providerow pi** (DeepSeek, Groq, Bedrock, Azure, Mistral, ...). MVP Patrona: 4 providery (Anthropic, Gemini, Ollama, OpenAI opt-in). Wiecej dodajemy gdy pojawi sie konkretna potrzeba kancelarii - nie spekulatywnie.
- **Session sharing pi** ("encourages session sharing for OSS improvement") - **RODO red flag dla Patrona**. Sesje kancelaryjne nie wychodza poza serwer. Funkcjonalnosc eksportu sesji do HTML (osobny ADR-0015) ma inny cel - artefakt zgodnosci, nie content do udostepnienia w OSS.
- **Brand "earendil"** - amerykanski projekt, my robimy polski legal product. Atrybucja w `THIRD_PARTY_INSPIRATIONS.md`, brak brand-association w UI Patrona.
- **Kod pi-tui** (terminal UI) - Patron ma frontend Next.js, nie terminal UI.

## Konsekwencje

**Pozytywne**:
- Art. 4 Konstytucji z deklaracji staje sie **mierzalnym kontraktem** (interfejs `LLMProvider`, capability flags, router decision log).
- Outage providera nie zatrzymuje kancelarii (fallback chain).
- Audit log dostaje `provider_id` per call - **AI Act art. 12 compliance** pelne, nie czesciowe.
- Kancelaria moze miec rozne providery per klient / per sprawa / per type danych - bez 3 instancji Patrona.
- Estymacja kosztu PRZED wywolaniem - kancelaria moze ustawic limity i unikac zaskakujacych rachunkow.

**Negatywne / koszty**:
- Refactor istniejacego `lib/llm/` (2 providery → 4 providery + abstrakcja) - **3-4 tygodnie dev**.
- Testy regresji dla istniejacych use-cases (Chat / Contract Review ADR-0010 / Hybrid Retrieval ADR-0007) - kazdy musi dzialac na kazdym providerze (4 × 3 = 12 kombinacji integracyjnych).
- Latency overhead routera (~5-15 ms per call na decyzje routing) - akceptowalny, bo wywolania LLM same maja latency 500-5000 ms.

**Ryzyka**:
- Capability flags mozna pomylic - np. oznaczyc Gemini jako `egress: 'eu-only'` gdy tak naprawde ruch idzie do US-region. **Mitigation**: per provider testowane przez sniffer ruchu w testach integracyjnych + dokumentacja per provider w `docs/llm-providers.md`.
- Failover do drogiego providera moze byc kosztowny - np. Anthropic down → fallback na OpenAI GPT-4 5x drozszy. **Mitigation**: per provider `maxCostPerCall` flag, router odmawia gdy estymacja > limit.

## Plan implementacji

| Faza | Zakres | Czas |
|---|---|---|
| **T1** | Interface `LLMProvider` + typy `ChatRequest/Response/Chunk` w `backend/src/lib/llm/types.ts`. Schema walidacji `zod`. Tests dla schema. | 1 tydzien |
| **T2** | 4 implementacje providerow (`AnthropicProvider`, `GeminiProvider`, `OllamaProvider`, `OpenAIProvider`). Kazda dziedziczy z `BaseProvider` z capability flags. **Per provider obligatoryjne**: rate limiter (token bucket per API key), `requestTimeoutMs` z `.env`, retry-with-backoff (3 proby, exp backoff 1s/4s/16s, retry tylko na 429/503/timeout), circuit breaker (po 5 kolejnych fail przez 60s provider oznaczony `down`, router pomija). Integration testy per provider (mock + 1 live happy path + 1 chaos test wymuszony 429/timeout). | 2.5 tygodnia |
| **T2b** | `ToolRegistry` adapter (wzor Lavern `tool-converter.ts`) - mapuje definicje narzedzi MCP konektorow (mcp-saos / mcp-isap / mcp-nsa / mcp-krs / mcp-eu-sparql / mcp-eu-compliance) na natywny format function-calling kazdego providera. Odporny fallback per narzedzie (zlamane `inputSchema` -> narzedzie wywolywalne bez typow, nie crash rejestru). Test: rejestr zbudowany z 6 konektorow dziala na Anthropic i OpenAI; jedno celowo zlamane schema nie kladzie pozostalych. | 4 dni |
| **T3** | `LLMRouter` z logika decyzji (classification → capabilities → primary → fallback chain). Tests dla decision matrix. | 3 dni |
| **T4** | Integration z `lib/audit/` (ADR-0001) - kazda response zawiera `audit_event_id`. Update `audit_log` schema o `provider_id`, `model_id`, `cost_estimate_pln`. Migration. | 3 dni |
| **T5** | Refactor istniejacych call-sites (chat, contract review ADR-0010, hybrid retrieval ADR-0007) na nowy interfejs. Tests regresji. | 1 tydzien |
| **T6** | `docs/llm-providers.md` - tabela providerow z capability flags, egress flags, kosztami per 1M tokens, instrukcja `.env` setup. Update USER_GUIDE. | 2 dni |

**Lacznie**: ~5.5 tygodnia dev (T2b adapter tool-calling +4 dni; moze isc rownolegle z T3 routerem). Najlepsze okno: po zamknieciu T1 ADR-0013 (PII-Shield patterns) - obie zmiany dotykaja `lib/`, nie wchodzimy sobie w paradne.

**Bumpa Konstytucji**: NIE. Ten ADR **operacjonalizuje** Art. 4 ktory juz jest w v1.1.1, nie zmienia tresci zasady. Po implementacji T1-T6 (+ T2b) dopisujemy w `governance/CONSTITUTION.md` § "Implementacja Art. 4" wskaznik do ADR-0014 - to PATCH v1.1.2 (zgodnie z regula sesji rownoleglych).

## Scope review (przed merge)

ADR-0014 dostaje **2x runda wewnetrznego review** (regula wewnetrzny review tresci). Zakres review:

1. Czy interfejs `LLMProvider` faktycznie pokrywa wszystkie use-cases (chat, tool calling przez `ToolRegistry`/T2b, streaming, structured output, vision)? Dziury w sygnaturze.
2. Czy capability flags pokrywaja wszystkie wymogi RODO/AI Act (egress + region + retention provider-side)?
3. Czy nie ma kolizji z ADR-0003 (warstwa pseudonim) - kto wola kogo, jaka kolejnosc?
4. Czy plan T1-T6 (+ T2b) nie ma luk w testach regresji?
5. Czy "operacjonalizacja Art. 4" jest faktycznie operacjonalizacja, czy ukryta zmiana zasady (wymaga bumpa MINOR, nie PATCH)?

## Zalaczniki

- [pi-ai docs](https://github.com/earendil-works/pi/tree/main/packages/ai) (do walidacji w T1)
- [Konstytucja v1.1.1 Art. 4](../CONSTITUTION.md) - tekst zasady
- [ADR-0010 § "Co bierzemy"](./0010-contract-review-module-tabular.md) - juz wymaga konfigurowalnego LLM
