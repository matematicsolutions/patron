# ADR-0058: Pipeline obrony (Invisible AI) - Recenzent / Adwokat diabla / Pisz po ludzku

**Status**: PROPONOWANY (2026-05-28). Wprowadza wieloetapowy lancuch doskonalenia draftu pisma. Backend dziala (orkiestrator + endpoint), niewpiety jeszcze w UI.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 4 - Neutralnosc dostawcow** - kazdy etap uzywa `completeText` z warstwy llm (claude/gemini/openai per model usera). Pipeline nie zaklada konkretnego providera.
- **Art. 3 - Audytowalnosc** - wynik zawiera output kazdego etapu (`stages[]`), wiec da sie pokazac przez co przeszedl draft. Buildery promptow sa czyste i wersjonowane w kodzie (przewidywalne).
- **Art. 6 - Granica bledu** - pipeline NIE wymysla faktow: prompt kazdego etapu zakazuje zmiany faktow/dat/kwot/sygnatur i dodawania danych osobowych. Pusta odpowiedz etapu nie kasuje draftu (zachowuje poprzedni).

**Powiazane ADR**: ADR-0057 (Bibliotekarz - styl mecenasa z brain moze pozniej zasilac etap Pisz po ludzku), ADR-0014 (multi-provider abstraction - completeText), ADR-0054 (wzorzec narzedzi - tu jednak swiadomie NIE narzedzie, patrz Alternatywy).

---

## Kontekst

Roadmapa: prawnik widzi jeden guzik "Draft odpowiedzi" i progress; pod spodem draft przechodzi przez kilka wyspecjalizowanych przebiegow LLM, ktore go wzmacniaja. Idea "Invisible AI": zlozonosc ukryta, efekt widoczny.

Lancuch (kazdy etap zwraca POPRAWIONA wersje, output -> wejscie nastepnego):
1. **Recenzent** - konstruktywny senior radca: wzmacnia slabe argumenty, struktura, jezyk.
2. **Adwokat diabla** - adversarial, 3 tryby: strona przeciwna (default) / sad / prokurator (karne). Uprzedza kontrargumenty i uodparnia wywod.
3. **Pisz po ludzku** - usuwa AI-slop, naturalny jezyk prawniczy, zachowuje precyzje i terminy.

## Decyzja

### 1. Czyste buildery promptow + orkiestrator (`backend/src/lib/pipeline/defense.ts`)
`buildRecenzentPrompt`, `buildAdwokatPrompt(mode)`, `buildPiszPoLudzkuPrompt` zwracaja `{system, user}` - pure, testowalne, wersjonowane w kodzie (prompty to IP). Wspolna regula BASE_RULES: nie zmieniaj faktow, zwroc wylacznie poprawiona wersje bez metaopisu.

`runDefensePipeline(draft, config, llm = completeText)` lancuchuje etapy; `llm` wstrzykiwany (test = fake). Konfigurowalne `stages` (podzbior/kolejnosc) i `adwokatMode`. Zwraca `{ final, stages: [{stage, mode, output}] }`.

### 2. Endpoint `POST /draft/refine`
`{ text, stages?, adwokat_mode?, model?, context? }` -> getUserApiKeys + resolveModel -> runDefensePipeline. requireAuth. Limiter jak chat (3 wywolania LLM). Walidacja stages/mode wzgledem whitelisty.

---

## Alternatywy odrzucone

1. **Narzedzie agentowe zamiast osobnego pipeline'u** (jak search_corpus/remember). Odrzucone: to celowy, deterministyczny lancuch wielu przebiegow o ustalonych rolach, nie pojedyncza akcja, ktora model wybiera. Stale prompty per etap daja powtarzalna jakosc; pozostawienie tego modelowi rozmylo by efekt.
2. **Jeden mega-prompt "popraw, zaatakuj, uczlowiecz"**. Odrzucone: laczenie sprzecznych rol w jednym przebiegu daje plytki wynik. Rozdzielone etapy, kazdy z czysta rola, daja glebsza obrobke (output jednego = material drugiego).
3. **Recenzent: osobny przebieg krytyki + osobny przebieg regeneracji**. Odrzucone w v1: dwa wywolania LLM per etap (koszt x2). Jeden przebieg "zrecenzuj i zwroc poprawiona wersje" wystarcza; rozdzielenie + ujawnienie krytyki = rezerwacja.
4. **Streaming etapow do UI**. Odrzucone w v1: endpoint zwraca komplet `stages[]` po zakonczeniu. Streaming progresu (np. SSE "etap 2/3") = rezerwacja frontowa.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 684 pass / 5 todo / 0 fail (z 675 przed ADR; +9 w `defense.test.ts` - buildery promptow per etap/tryb/kontekst + orkiestrator z fake-LLM: kolejnosc etapow, chaining output->wejscie, domyslny i jawny tryb adwokata, podzbior etapow, zachowanie draftu przy pustej odpowiedzi). Bez prawdziwych wywolan LLM.
- **LoC**: ~357 (defense.ts 184, defense.test.ts 104, draft.ts 66, index.ts +3 mount/limiter).
- **Zero nowych zaleznosci npm** (reuse completeText z lib/llm).
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0058

- **UI "Draft odpowiedzi" + progress** (jeden guzik, wskaznik etapu, wybor trybu adwokata) -> rezerwacja frontend.
- **Ujawnienie krytyki per etap** (co Recenzent/Adwokat znalazl, nie tylko poprawiony draft) -> rezerwacja (v1 zwraca poprawione wersje, nie liste zarzutow).
- **Zasilenie etapu Pisz po ludzku stylem mecenasa z brain** (ADR-0057) -> rezerwacja (personalizacja).
- **Streaming progresu** (SSE per etap) -> rezerwacja.
- **Audit event per przebieg pipeline'u** -> rezerwacja (wymaga whitelisty event_type, jak inne).
- **Generacja draftu v1** - poza zakresem; pipeline doskonali ISTNIEJACY draft (z czatu/generate_docx).
