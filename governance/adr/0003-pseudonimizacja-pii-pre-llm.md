# ADR-0003: Pseudonimizacja PII przed wywolaniem LLM

**Status**: Proponowany (skeleton zakodowany, niewpiety w stack produkcyjny)
**Data**: 2026-05-20
**Powiazane zasady**: Konstytucja AI Patrona Art. 1 (lokalnosc danych),
Art. 5 (tajemnica zawodowa), Art. 7 (minimalnosc - RODO art. 5 ust. 1 lit. c)
**Powiazane**: ADR-0001 (audit trail), ADR-0002 (dual-license), wzorzec
architektoniczny forku [sure-scale/hey-jude](https://github.com/sure-scale/hey-jude) (AGPL-3.0)

## Decyzja

Patron dostaje warstwe pseudonimizacji PII (Personally Identifiable
Information), ktora dziala **przed** wyslaniem promptu do dostawcy LLM
(Anthropic / Google / OpenAI) i odwraca podmiane **po** otrzymaniu
odpowiedzi. Warstwa wykrywa polskie identyfikatory (PESEL, NIP, REGON,
KRS) oraz imiona, nazwiska i nazwy podmiotow, zastepuje je tokenami
typu `[PERSON_1]`, `[PESEL_1]`, `[ORG_2]` i trzyma mape token -> oryginal
po stronie kancelarii (Postgres, ten sam stack co `audit_log`).

Wybor sciezki: **wariant C - cherry-pick logiki Hey Jude + polonizacja forku**.

- `patron/backend/src/lib/pseudonim/` - nowy modul TypeScript w powloce
  Patrona, AGPL-3.0 (dziedziczone po `patron`).
- `matematicsolutions/pseudonim-pl` - przyszly osobny fork (planowany,
  niezalezna licencja AGPL-3.0 dziedziczone po Hey Jude) z polskim
  promptem detekcji, regexami PESEL/NIP/REGON/KRS, obsluga polskiej
  fleksji oraz wsparciem qwen3.5/mistral-pl jako lokalnego klasyfikatora
  fallback.

W tej sesji budujemy wylacznie **skeleton modulu** w powloce Patrona
(stubowe testy, brak Redis, brak wpiecia do `streamChatWithTools`).
Decyzja architektoniczna (kolejnosc Redis vs Postgres, kompatybilnosc SSE,
koszt latency) wymaga osobnej zgody i osobnego ADR ewentualnej
zmiany sciezki - patrz **Status weryfikacji**.

## Kontekst

Konstytucja AI Patrona Art. 5 mowi wprost: **dane chronione tajemnica
zawodowa nie opuszczaja infrastruktury kancelarii bez swiadomej decyzji
osoby uprawnionej**. Mechanizmem dotychczas jest *bring-your-own-model*
plus tryb lokalny (Ollama + Qwen / Llama). Problem: wiekszosc kancelarii
ma juz aktywna subskrypcje chmurowego LLM (Anthropic / Google), bo
lokalna inference jest wolna, slabsza w polskim i wymaga GPU. Wybor
miedzy "produkt szybki ale wysyla PESEL na zewnatrz" a "produkt
RODO-szczelny ale powolny" jest falszywy.

Hey Jude (sure-scale, AGPL-3.0, 12 gwiazdek, mlode ale architektonicznie
zdrowe) rozwiazuje to wprost: **zanim** prompt wyjdzie z perymetru
kancelarii, PII zostaje podmienione na tokeny. Operator LLM dostaje
"prosze przygotuj pozew dla [PERSON_1] (PESEL [PESEL_1]) przeciwko
[ORG_2]". Po stronie kancelarii Patron przywraca oryginaly w odpowiedzi.
Mapa token -> oryginal nigdy nie opuszcza serwera.

Konsekwencje konstytucyjne:

- **Art. 1 (lokalnosc danych)**: PII nigdy nie laduje w prompt-payload
  wysylanym do Anthropic/Google/OpenAI. Wzmacniamy *technicznym mechanizmem*
  zasade, ktora dotychczas opieralismy tylko na "swiadomej decyzji" Art. 5.
- **Art. 5 (tajemnica zawodowa)**: prawnik moze bez obaw wkleic akta
  klienta - PESEL, imiona, nazwy spolek - bo wychodzi z perymetru
  juz spseudonimizowane.
- **Art. 7 (minimalnosc danych)**: do LLM idzie absolutne minimum
  informacji - tokeny zastepcze plus struktura zapytania. RODO art. 5
  ust. 1 lit. c (minimalnosc) przesuwamy z poziomu konfiguracyjnego
  (zmien model na lokalny) na poziom techniczny (warstwa
  pseudonimizacji default-on).

## Rozwazane sciezki

### Wariant A - Hey Jude jako 7. serwis docker-compose

Pomysl: hey-jude wstawiony jako kontener obok Patrona, providery LLM
patrza na `baseURL` Hey Jude zamiast na Anthropic/Google bezposrednio.
Hey Jude robi pseudonimizacje, woła wlasciwego dostawce, odwraca.

**Problemy**:

- `@google/genai` SDK Patrona nie wspiera `baseURL` override w sposob
  uzywalny dla Gemini-specyficznych funkcji (`thoughtSignature`,
  `serverStreaming`). Patrz `backend/src/lib/llm/gemini.ts`.
- `@anthropic-ai/sdk` ma `baseURL`, ale Patron uzywa natywnych typow
  SSE Anthropica (`message_start`, `content_block_delta`, `tool_use`).
  Proxy musialby byc 1:1 transparentny dla calego protokolu - to nie
  jest cel Hey Jude (Hey Jude celuje w OpenAI-compatible API).
- Trzy SDK Patrona (`claude.ts`, `gemini.ts`, `openai.ts`) musialyby
  zostac zastapione jednym, zgodnym z OpenAI - utrata `enableThinking`,
  `runTools` callback, reasoning delta. Zerwanie kontraktu LLM
  zdefiniowanego w `lib/llm/types.ts:32-37` (StreamCallbacks).

**Odrzucony**: blokuje funkcje, ktore Patron juz ma i ktorych nie
chcemy stracic dla pseudonimizacji.

### Wariant B - implementacja modulu TypeScript od zera

Pomysl: napisac wlasna warstwe `lib/pseudonim/` bez patrzenia na Hey Jude
(klean-room), tylko z polska kontrola.

**Problemy**:

- Marnujemy gotowy schemat (detect -> map -> wrap LLM -> unwrap)
  i nauke z 12 gwiazdkowego repo. Hey Jude pokazuje co dziala
  i co bolelo. Pisanie od zera = 2-3 tygodnie zamiast 4-6.
- Brak narracji "stoimy na barkach OSS" - Patron ma sentyment "uzywamy
  najlepszych klockow polonizujac je", a nie "wynajdujemy kolo".
- Drugi koszt: zerowy CI/CD, zero benchmarkow, zero issue trackera
  zewnetrznego. Wszystko trzymamy sami.

**Odrzucony**: koszt poznawczy + utrata wartosci spolecznosci.

### Wariant C - cherry-pick logiki Hey Jude + polonizacja forku (WYBRANY)

Pomysl dwuetapowy:

1. **Etap pierwszy (ta sesja)**: skeleton modulu `lib/pseudonim/`
   w **powloce Patrona** (AGPL-3.0). Detect / map / wrap z polskim
   promptem, testy stubowe. Brak Redis (Postgres z TTL), brak wpiecia
   w `streamChatWithTools` (osobny ADR + osobna sesja).
2. **Etap drugi (po decyzji infrastrukturalnej)**: fork hey-jude jako
   `matematicsolutions/pseudonim-pl` (AGPL-3.0 dziedziczone), polski
   prompt detekcji wewnatrz, regexy PESEL/NIP/REGON/KRS, polski LLM
   fallback (qwen3.5:4b / mistral-pl). Wartosc - wlasnosc intelektualna
   MateMatic (IP - Intellectual Property) w polskim ekosystemie
   legal-tech, kolejny element "Made by Poland".

**Wybrany** bo:

- Daje **kontrole** (wlasne typy, wlasna integracja z `lib/audit.ts`,
  wlasne testy Vitest spojne z `lib/audit.test.ts`).
- Daje **polski jezyk** od pierwszej linii (regexy, prompt, komunikaty
  bledow).
- Pozwala **odlozyc** decyzje infrastrukturalne (Redis vs Postgres,
  SSE compatibility, koszt latency) bez blokowania startu prac.
- Hey Jude **AGPL-3.0** jest kompatybilny z `patron` AGPL-3.0
  (oba network copyleft) - licencje sa kompatybilne.
- Pattern *cherry-pick wzoru zamiast adopcja narzedzia* jest
  juz utrwalony w MateMatic (claude-obsidian, codegraph, spec-kit,
  hermes - patrz `feedback_consolidation_pattern_2026-05-14`).

## Konsekwencje

### Plusy

- Konstytucja Art. 1 / 5 / 7 dostaja **techniczny mechanizm** zamiast
  konfiguracyjny.
- Hard-rozwiazanie problemu "prawnik wkleja PESEL do Claude API" bez
  zmuszania kancelarii do Ollamy.
- Skladnia tokenow (`[PERSON_1]`, `[PESEL_1]`) jest deterministyczna
  i czytelna dla czlowieka w logach (latwo audytowac).
- Mapa pseudonimow trafia do tej samej Postgresy co `audit_log`
  (zero nowych zaleznosci) - moze byc objeta backup szyfrowanym `age`
  i RODO art. 17 (kasowanie wniosku o bycie zapomnianym).
- Pattern *separable middleware* - jezeli kancelaria chce wylaczyc
  pseudonimizacje (bo np. uzywa wylacznie lokalnej Ollamy), flaga w
  `.env` i koniec; warstwa nie psuje istniejacych kontraktow LLM.

### Minusy i ograniczenia

- **Latency +200-400 ms per request** (detekcja LLM-based dla zlozonych
  imion + fleksji + map lookup). Akceptowalne dla czatu, problematyczne
  dla bulk-extraction. Mitigation: flaga per-request `skipPseudonim:
  true` dla zadan systemowych typu "wyciagnij metadata z PDF".
- **Nowy serwis i nowy schemat tabeli** (`pseudonim_map`). Minus
  utrzymaniowy. Mitigation: ta sama Postgres, ten sam migration system
  (`backend/schema.sql`).
- **Polski prompt detekcji to nie jest skonczona praca**. Fleksja
  ("Janowi Kowalskiemu" = "Jan Kowalski"), nazwy spolek z myslnikami,
  rodzajow form prawnych (sp. z o.o., S.A., sp. j., sp. k., sp. p.,
  Sp. z o.o. Sp. k.). Pierwsza wersja regexow + LLM fallback to MVP -
  pelne pokrycie to 4-6 tygodni iteracji na realnych dokumentach
  kancelarii pilotazowej.
- **Renormalizacja referencji** - jezeli LLM odpowie "Jan Kowalski
  jest reprezentowany przez Spolke ABC", a my mamy w mapie tylko
  `[PERSON_1]=Jan Kowalski` i `[ORG_2]=ABC Sp. z o.o.`, to LLM moze
  wymyslic warianty fleksyjne, ktore nie znajda sie w mapie. Mitigation
  na potem: LLM nie widzi imion w ogole, widzi tylko tokeny - jego
  output jest "Token [PERSON_1] jest reprezentowany przez [ORG_2]"
  i my robimy unwrap deterministycznie.
- **Nowe ryzyko: pomylka detekcji = wyciek PII**. Nieprzetestowany
  wariant fleksyjny imienia, niepokryty wariant NIP-u kraju trzeciego,
  blad LLM-fallback. Mitigation: warstwa NIE moze byc default-on dla
  produkcji bez (a) zestawu 100+ regression cases na realnych
  dokumentach PL i (b) shadow-mode (porownanie wyjscia z i bez
  pseudonimizacji) przez 2 tygodnie. Patrz Plan migracji nizej.
- **Pseudonimizacja to nie anonimizacja**. Posiadacz mapy moze odtworzyc
  oryginalne dane. Mapa = aktywo o tej samej wadze co `audit_log`.
  Backup szyfrowany `age` (deploy/BACKUP.md) i retencja zgodna z
  retencja czatu (5 lat lub kasowanie na zadanie RODO art. 17).

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump 1.1.0 -> 1.2.0** planowany
  PO wpieciu warstwy do produkcji (osobny ADR + osobna sesja).
  Tymczasowo Art. 1/5/7 dostaja w sekcji "Mechanizmy techniczne"
  punkt `(planowane Faza 4.5) pseudonimizacja PII pre-LLM`. To
  ADR-0003 traktujemy jako **wczesna deklaracje kierunku**, nie
  zmiane konstytucji.
- **Schema SQL** - dodanie tabeli `pseudonim_map` to czysty `CREATE TABLE`
  w schema.sql (brak naruszenia kontraktow API, brak MAJOR).
- **Kontrakty LLM** - sygnatury `streamChatWithTools` i `completeText`
  NIE zmieniaja sie. Pseudonimizacja owija je z zewnatrz przez
  `wrapPseudonim(streamChatWithTools, params)`.

## Plan migracji 6-tygodniowy

Pelny plan przejscia od "skeleton AGPL w repo" do "default-on
w produkcji kancelarii pilotazowej".

### Tydzien 1 - skeleton i regression set

- [x] Skeleton modulu `lib/pseudonim/` (ta sesja, ADR-0003 zatwierdzony)
- [ ] Pierwsze 20 regression cases na zanonimizowanych fragmentach
      dokumentow (pozwy, umowy, pisma procesowe) - input + oczekiwany
      output po wrap/unwrap
- [ ] Decyzja Wieslawa: Postgres (default ADR) vs Redis (jezeli benchmark
      pokaze blocker)

### Tydzien 2 - LLM fallback i polski regex hardening

- [ ] Integracja qwen3.5:4b albo mistral-pl jako Ollama LLM-fallback
      dla zlozonych przypadkow (fleksja, nietypowe nazwy)
- [ ] Polskie regexy PESEL/NIP/REGON/KRS z weryfikacja checksumy
- [ ] Polski regex form prawnych: `sp\. z o\.o\.`, `S\.A\.`, `sp\. j\.`,
      `sp\. k\.`, `sp\. p\.`, `Sp\. z o\.o\. Sp\. k\.`
- [ ] Regression set: 50 cases zielone

### Tydzien 3 - integracja z lib/llm jako optional wrapper

- [ ] `wrapPseudonim(streamChatWithTools, params)` - bez zmiany sygnatury
- [ ] Flaga `.env`: `PSEUDONIM_ENABLED=false` (domyslnie wylaczona)
- [ ] Flaga per-request: `params.skipPseudonim` dla zadan systemowych
- [ ] Audit log: nowy event_type `llm.pseudonimized` (BEZ pelnej tresci,
      tylko liczba tokenow zamienionych)

### Tydzien 4 - shadow mode dla pilotazu

- [ ] `PSEUDONIM_MODE=shadow` - rownolegle wywolanie z i bez warstwy,
      porownanie outputow, alert gdy outputy znaczaco rozne (cosine
      similarity < threshold)
- [ ] Regression set: 100 cases zielone
- [ ] Pierwsza kancelaria pilotazowa wlacza shadow

### Tydzien 5 - hardening i fork polonizacja

- [ ] `matematicsolutions/pseudonim-pl` - osobne repo z polskim
      promptem detekcji jako serwis (AGPL-3.0)
- [ ] Backup szyfrowany `age` obejmuje `pseudonim_map`
- [ ] RODO art. 17 endpoint: `npm run rodo:delete --user-id=...`
      kasuje rowniez `pseudonim_map` dla user-id
- [ ] Wewnetrzny test penetracyjny: probny atak "renormalizacja"
      (LLM zwraca rzeczywista nazwe spolki podana w innej formie)

### Tydzien 6 - wlaczenie default-on dla pilotazu + Konstytucja MINOR

- [ ] `PSEUDONIM_MODE=on` dla pierwszej kancelarii (z opcja awaryjna
      wylaczenia)
- [ ] **Konstytucja AI Patrona 1.1.0 -> 1.2.0** - Art. 1 i Art. 5
      dostaja punkt `pseudonimizacja PII pre-LLM` w sekcji "Mechanizmy
      techniczne"
- [ ] Aktualnosc matematic.co + post LI: opis warstwy pseudonimizacji
      PII pre-LLM jako default dla kancelarii pilotazowej (claim
      marketingowy do uzgodnienia z Wieslawem, ADR nie rozstrzyga)
- [ ] ADR-0003 status: `Proponowany` -> `Przyjety`

## Implementacja - skeleton (ta sesja)

Skeleton bez wpiecia produkcyjnego, gotowy do iteracji.

- `backend/src/lib/pseudonim/types.ts` - typy `PseudonimToken`,
  `PseudonimMap`, `WrapResult`, `DetectionRule`.
- `backend/src/lib/pseudonim/detect.ts` - detektor regex-based dla
  PESEL/NIP/REGON/KRS + interfejs `LlmDetector` dla LLM-fallback
  (na razie no-op).
- `backend/src/lib/pseudonim/map.ts` - in-memory `Map<token, original>`
  + interfejs `PseudonimStore` dla przyszlego adaptera Postgres.
- `backend/src/lib/pseudonim/wrap.ts` - orchestrator: detect -> map ->
  prompt mutation -> (TODO LLM call) -> unwrap.
- `backend/src/lib/pseudonim/prompts.pl.ts` - polski prompt detekcji
  imion, nazw firm, form prawnych (do zasilenia LlmDetector).
- `backend/src/lib/pseudonim/index.ts` - barrel exportu.
- `backend/src/lib/pseudonim/pseudonim.test.ts` - 1 happy-path test
  Vitest (PESEL + imie), 1 test idempotencji map, 1 test wrap+unwrap
  okragloscia.

**Brak**: Redis client, wpiecie w `streamChatWithTools`, migracja
SQL `pseudonim_map`, Ollama integracja, audit_log integration. To
osobne ADR-y i osobne sesje, planowane jak wyzej.

## Alternatywy odrzucone (synteza)

| Wariant | Powod odrzucenia |
|---|---|
| Wariant A - Hey Jude jako 7. serwis dockera | Lamie kontrakt SSE Patrona, blokuje thoughtSignature Gemini, wymusza OpenAI-compat (utrata reasoning/tools) |
| Wariant B - implementacja od zera bez Hey Jude | Marnotrawstwo gotowego schematu, 2-3 tygodnie zamiast 4-6, utrata narracji OSS-stoimy-na-barkach |
| Hey Jude bez polonizacji (uzywamy as-is w forku) | Polski prompt detekcji to nie kosmetyka - fleksja imion i formy prawne PESEL/NIP/REGON/KRS sa specyfika ktora nie istnieje w EN |
| Anonimizacja (nie pseudonimizacja, brak mapy zwrotnej) | LLM nie wraca z odpowiedzia w jezyku kancelarii (musi widziec tokeny zwrotne); brak unwrap = produkt mniej uzyteczny |
| Default-on od pierwszego commitu | Brak regression set, ryzyko pomylki detekcji = wyciek PII. Wlaczanie etapami: skeleton -> shadow -> opt-in -> default |

## Licencja skeleton

`backend/src/lib/pseudonim/` jest **AGPL-3.0-only**, dziedziczone po
`patron` (ADR-0002). Cherry-pick architektonicznych decyzji z Hey Jude
(struktura detect -> map -> wrap) NIE jest derivative work
(idea/wzorzec, nie kod). Linkujemy Hey Jude w `NOTICE` jako inspiracje.

Przyszly fork `matematicsolutions/pseudonim-pl` jako derivative work
Hey Jude pozostaje **AGPL-3.0** (network copyleft Hey Jude dziedziczone).
NIE konwertujemy na MIT - to byloby naruszenie licencji originalu.

## Discoveries from smoke test 2026-05-20

Smoke test integracyjny (`backend/scripts/smoke-pseudonim.mjs`) na realnym
fragmencie pozwu o zaplate wykryl jedno ZNANE OGRANICZENIE i jedno
ZAGADNIENIE ARCHITEKTONICZNE wymagajace decyzji przed T2 planu migracji.

### Discovery 1 - fleksja imion lamie symetrie wrap/unwrap (KRYTYCZNE)

Test pokazal: "Jan Kowalski" (mianownik) dostal token `[PERSON_1]`,
a "Jana Kowalskiego" (celownik, ta sama osoba) dostal **osobny token
`[PERSON_2]`**. Po unwrap output zawiera:

> "skontaktowac sie z **Jan Kowalski** pod adresem ..."

zamiast poprawnego fleksyjnie:

> "skontaktowac sie z **Janem Kowalskim** pod adresem ..."

LLM widzac dwa rozne tokeny dla tej samej osoby moze tez budowac
sprzeczne narracje ("powod [PERSON_1] reprezentuje [PERSON_2]")
co bedzie pomykac po unwrap ("powod Jan Kowalski reprezentuje
Jana Kowalskiego").

To **polski problem ktorego Hey Jude (EN) nie ma**. Trzy mozliwe
rozwiazania, decyzja na T2:

1. **LLM zwraca tokeny z sufiksem przypadka**: siedem polskich
   przypadkow gramatycznych - `.nom` (mianownik, kto/co), `.gen`
   (dopelniacz, kogo/czego), `.dat` (celownik, komu/czemu), `.acc`
   (biernik, kogo/co), `.inst` (narzednik, kim/czym), `.loc`
   (miejscownik, o kim/o czym), `.voc` (wolacz). Token wyglada wtedy
   tak: `[PERSON_1.nom]` dla "Jan Kowalski", `[PERSON_1.dat]` dla
   "Janowi Kowalskiemu", `[PERSON_1.inst]` dla "Janem Kowalskim".
   Polski prompt detekcji instruuje LLM, zeby wszystkie warianty
   fleksyjne tej samej osoby dostawaly ten sam indeks, rozne sufiksy.
   Wrap mapuje wariant fleksyjny -> token z sufiksem; unwrap odtwarza
   warianty.
2. **Slownik form per-osoba w mapie**: `PseudonimToken` rozszerzony
   o `forms: Map<Case, string>`. Detektor zbiera wszystkie warianty
   tej samej osoby do jednego tokenu. Wymaga morfologicznego
   reduktora "Janem Kowalskim" -> "Jan Kowalski" (Morfeusz / SpaCy PL).
3. **Lemma-aware unwrap**: tokeny same w sobie sa lematyczne (forma
   mianownikowa), ale unwrap analizuje kontekst syntaktyczny i odmienia
   przed wstawieniem. Najbardziej eleganckie, najdrozsze - wymaga
   morfologii przy unwrap.

Rekomendacja autora ADR: **wariant 1 (tokeny z sufiksem przypadka)**.
Dziala bez zewnetrznych zaleznosci morfologicznych, polski prompt
juz teraz wymaga od LLM zrozumienia przypadkow gramatycznych. Wymaga
hardeningu prompta (`prompts.pl.ts`) o instrukcje sufiksowania.
Discovery zostaje zadaniem T2 planu migracji.

### Discovery 2 - smoke test jako asset projektu

Skrypt `backend/scripts/smoke-pseudonim.mjs` powstal w tej sesji jako
weryfikacja integracyjna. Decyzja: **zachowac jako asset**:

- Regression seed dla T1 planu migracji (rozszerzyc do 20 cases).
- Demo dla kancelarii pilotazowej (T4 shadow mode).
- Sanity check po kazdym rebuilds przed wpieciem w `streamChatWithTools`.

Nie wpisujemy do `npm scripts` w pierwszej iteracji - to skrypt
demonstracyjny, nie test (testy sa w Vitest).

## Status weryfikacji

- [x] Skeleton modulu w `backend/src/lib/pseudonim/` (7 plikow)
- [x] Testy Vitest `pseudonim.test.ts` - 24/24 zielone (z deduplikacja, walidacja PESEL/NIP, wrap/unwrap okraglosc, InMemoryStore RODO art. 17, parser LLM)
- [x] Pelny suite Vitest - **100/100 zielone** (76 dotychczasowych + 24 nowych, zero regresji)
- [x] TypeScript build `npm run build` - czysty (zero typing warnings)
- [x] Smoke test integracyjny `scripts/smoke-pseudonim.mjs` - 10/10 walidacji bezpieczenstwa PASS na realnym fragmencie pozwu (PESEL, NIP, KRS, email, telefon, imie, ORG - wszystko podmienione w prompcie, odtworzone po unwrap)
- [x] Wpis do `roadmap.md` w FAZA 4 jako pozycja 4.5 z markerem `[~]`
- [x] Sekcja w `SECURITY.md` o warstwie pseudonimizacji
- [ ] Decyzja Wieslawa: Postgres (default ADR) vs Redis (benchmark blocker)
- [ ] Decyzja Wieslawa: wpiecie w `streamChatWithTools` jako opcjonalny
      wrapper - **wymaga osobnego ADR** (kontrakt SSE / streaming)
- [ ] Decyzja Wieslawa: fork `matematicsolutions/pseudonim-pl` jako
      osobne repo czy modul wewnatrz `patron`
- [ ] Decyzja Wieslawa: rozwiazanie fleksji (Discovery 1) - wariant 1/2/3
- [ ] Tydzien 1 planu migracji wystartowany (regression set 20 cases)
