# Changelog

All notable changes to **Patron** are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Grounding cytatow z konektorow MCP (ADR-0146)** - cytaty z SAOS / NSA / ISAP / KRS /
  EUREKA / EUR-Lex przechodza teraz te sama kontrole, co cytaty z dokumentow kancelarii:
  spany, ktore model prezentuje jako DOSLOWNE (blockquote markdown, cudzyslowy), sa
  sprawdzane string-matchem wzgledem tekstu, ktory konektor faktycznie zwrocil w tej turze.
  Werdykt trojstanowy per cytat i per karta zrodla (green / yellow / red), baner pod
  odpowiedzia dla cytatow bez jednoznacznego przypisania, brak tekstu zrodla = yellow
  "nie zweryfikowano" (nigdy green), awaria groundingu = jawny sygnal w UI (nigdy cicho).
  Deterministycznie, offline, zero LLM, zero egressu. Powod: pomiar 2026-08-17 - model podal
  blockquote jako doslowny cytat interpretacji KIS (sygnatura i data PRAWDZIWE), a tekst nie
  wystepowal w zrodle (0/4 zdan), UI milczal. Nowy modul `backend/src/lib/citation/mcp-grounding.ts`
  (czysty, bez I/O), zdarzenie SSE `mcp_grounding`, trwalosc przez adnotacje (baner przetrwa
  reload), audyt `chat.message.assistant` dostaje same liczby (zero tresci cytatow, bez nowego
  `event_type`). Warstwa DORADCZA - nie blokuje odpowiedzi. Wydajnosc: kotwice + okna
  edit-distance zamiast przesuwania po calym orzeczeniu (teksty 100k+ znakow).
  backend 1460 pass / 0 fail (+16), frontend tsc czysto.
- **`smoke:surfaces`: szosty punkt - research + grounding cytatow MCP** - bramka pilnuje, ze
  werdykt DOCHODZI do klienta (zdarzenie, zrodla, werdykt na kazdej karcie), nie tylko ze
  konektor odpowiedzial. Zmierzone 2026-08-18 na SAOS: przy cytacie doslownym werdykt `red`
  (cytat nieobecny w 10 pobranych zrodlach), przy parafrazie `yellow/no_quote`.
- **Test parytetu whitelist `event_type` (5 luster) + bramka numeracji ADR/migracji w CI** -
  `backend/src/lib/db/event-type-parity.test.ts` porownuje `EVENT_TYPES` (audit.ts) z CHECK
  w `schema.sqlite.ts`, `schema.sql`, najnowsza migracja Postgres i najnowszym rebuildem
  SQLite; `scripts/adr_number_gate.py` (w `publication-gate.yml`) pada na duplikacie
  prefiksu numeru ADR/migracji albo nie podbitym rejestrze wolnych numerow.

### Security
- **Toolchain desktop: `electron-builder` 25 -> 26.15.3, `@electron/rebuild` 3 -> 4.2, `npm audit fix`
  runtime (`js-yaml` w `electron-updater`)** - `npm audit` w `desktop/`: 19 podatnosci (18 high,
  1 critical `tar` w lancuchu buildu) -> 2 high, obie = Electron 35 (bump do 43 = osobna decyzja,
  nie na tydzien przed demo); runtime (`--omit=dev`) = 0. `electron-updater` 6.8.9 juz uzywal
  `builder-util-runtime` 9.7.0 (naprawionego) - podatna 9.2.x siedziala tylko pod
  electron-builder 25 (build-time). Konfiguracja: `win.sign`/`signingHashAlgorithms` przeniesione
  pod `win.signtoolOptions` (schemat v26).
  **Regresja v26 zlapana przez e2e, nie przez build:** `electron-builder` 26 bezwarunkowo wycina
  katalog `node_modules` z korzenia kazdego matchera `extraResources` (v25 tego nie robil) -
  spakowany backend i frontend (Next standalone) traca zaleznosci, `build:dir` konczy sie
  sukcesem, apka pada na starcie (`Cannot find module 'dotenv/config'`). Obejscie: osobne wpisy
  `extraResources` dla `backend/node_modules` i `frontend/node_modules`; `e2e:smoke` dostal
  asercje kompletnosci paczki PRZED startem (pusty `resources/*/node_modules` = exit 2 z nazwa
  przyczyny, nie timeout).

### Fixed
- **`cost_cap` wypadal z whitelist `event_type` na bazach MIGROWANYCH** - test parytetu
  wykryl (audyt 25 wymiarow 2026-08-18 mial to jako *Suspected*): `cost_cap` (ADR-0093,
  migracja 010) byl w CREATE swiezych baz, ale nie w listach migracji Postgres 012/014/016
  ani w rebuildach SQLite v2/v3/v4 (kazdy sprawdzal obecnosc jednej wartosci i przepuszczal
  luke po srodku). Baza migrowana miala 20 wartosci zamiast 21 i odrzucala zdarzenie
  cost-cap - a kazda migracja konczyla sie sukcesem. Naprawa: krok SQLite v5 (rebuild do
  pelnej listy, samo-pomijalny tylko gdy CHECK ma WSZYSTKIE wartosci; hash-chain i indeksy
  zachowane) + migracja Postgres 019 (pelna lista, idempotentna). Test bojowy na bazie
  "po v4 bez cost_cap" w suite.

## [1.1.0] - 2026-08-17

Wydanie zbiorcze linii release/v2.0.0-prep + trzy edycje jurysdykcyjne, ktore
dotad zyly na osobnych galeziach. 9 edycji instalatora z jednej linii kodu:
PL, EN, IT, DE, ES, FR, BR (pt), GB, US. Instalatory nadal NIEPODPISANE
(SmartScreen) - code signing = osobna decyzja, nie zmiana wersji.

### Added
- **Edycje BR (pt-BR), GB i US w jednej linii kodu** - wmerge'owane galezie
  `feature/patron-br-edition` / `-gb-edition` / `-us-edition` (ADR-0139): konektory
  macierzyste `br-eli`, `gb-eli`, `us-eli` w `APPROVED_PATRON_CONNECTORS` (20 nazw),
  profile jurysdykcyjne w `prompts.ts`, `release:all` buduje 9 edycji, kanaly
  auto-update per edycja (`latest[-xx].yml`; dodany brakujacy kanal `pt` -> `latest-br.yml`
  i dialog aktualizacji pt-BR - dotad edycja BR dostawalaby polskie okienko).
- **Konektor `eureka` (siodmy konektor Node, Ring 1)** - EUREKA MF (`eureka.mf.gov.pl`):
  interpretacje podatkowe KIS, WIS, WIA, objasnienia; `mcp-eureka` 0.2.0 (MIT, osobne repo).
  Wpiety w czterech miejscach 3-sync (`APPROVED_PATRON_CONNECTORS`, `JURISDICTION_BY_CONNECTOR`
  = PL, `prepare-resources.cjs` MCP_SERVERS, `mcp-servers.example.json`) + `bundle-mcp.cjs`.
  Przebieg bojowy 2026-08-17: backend podlacza 7 konektorow, realne pytanie podatkowe (art. 10
  ust. 1 pkt 8 PIT, nabycie w spadku) przechodzi `eureka__search` -> `eureka__get_interpretation`,
  22 cytaty MCP z sygnatura/URL/data, teza poprawna. Zmierzona GRANICA (nie zalatana, wymaga
  ADR): `mcp_citations` NIE przechodza przez kaskade groundingu (`groundCitationsByRef` liczy
  tylko cytaty `<CITATIONS>` z dokumentow kancelarii) - blockquote podany przez model jako
  doslowny cytat organu (sygn. 0114-KDIP3-1.4011.844.2024.2.MS2) nie wystepuje w zrodle
  (0/4 zdan, string-match po normalizacji na pelnym dokumencie z API), a UI nie pokazuje
  ostrzezenia. Praktyka organow, nie zrodlo prawa (art. 14a-14s o.p.). backend 1441 pass / 0 fail.
- **`smoke:desktop`: bramka przestaje ukrywac przyczyne** - timeout bootu 20 s -> 120 s (zimny
  `npx tsx` na maszynie bez GPU przekraczal 20 s i bramka failowala, choc ten sam boot recznie
  odpowiadal `{"ok":true}`); wyjscie backendu buforowane i drukowane przy FAIL zamiast
  `stdio:"ignore"`, ktore zostawialo sam `ECONNREFUSED` bez slowa DLACZEGO.
- **Weryfikator w paczce eksportu audytowego (ADR-0142)** - `GET /api/audit/export/:eventId`
  zwraca archiwum ZIP zamiast samego JSON. Obok artefaktu jada dwa samodzielne weryfikatory:
  `SPRAWDZ-TEN-PLIK.html` (przegladarka, zero instalacji, wlasna implementacja SHA-256 zamiast
  `crypto.subtle`, ktorego dostepnosc przy `file://` zalezy od przegladarki) i `verify.py`
  (biblioteka standardowa Pythona 3.8+, kody wyjscia 0/1/2 do kontroli automatycznej), plus
  instrukcja `CZYTAJ-TO-NAJPIERW.txt`. Powod: dotad artefakt niosl instrukcje "uruchom
  z katalogu backend/", czyli odsylal odbiorce do repozytorium, ktorego sad, UODO ani klient
  nie posiadaja (pomiar: klon repo AGPL + 704 MB / 312 pakietow npm). Tresc weryfikatorow
  OSADZONA w `backend/src/lib/audit-verifier-assets.ts`, nie czytana z dysku - plik pominiety
  w pakowaniu Electron zniknalby po cichu, a eksport nadal konczylby sie sukcesem. Nowy modul
  `backend/src/lib/audit-export-archive.ts` (jszip, archiwum deterministyczne). Audit bundle
  (ADR-0066) dostal trzeci stopien weryfikacji - ciaglosc ogniw `prev_hash`->`hash` - wykrywajacy
  wpis usuniety ze srodka i wpisy przestawione TAKZE po przeliczeniu manifestu przez
  podmieniajacego. Zgodnosc trzech implementacji (TS/Python/JS) pilnowana wektorami z kodu
  produkcyjnego. Zero nowych zaleznosci npm, zero migracji. backend 1429 pass / 0 fail (+21).
- **Integralnosc skilla w audycie i egzekwowanie deklaracji egress (ADR-0143)** - dwie luki
  wykryte pomiarem kodu. (1) `defense.pipeline.run` zapisywal `custom_skills` jako same
  identyfikatory, a `importSkill` robi upsert po `id` przy niepodpisanym manifescie, wiec para
  `(id, version)` NIE identyfikuje tresci - reimport podmienial prompt bez zmiany zapisu
  w dzienniku. (2) Manifest deklaruje `egress` skilla (tresc promptu, rozlaczna od egressu danych
  klienta pokrytego maskowaniem PII), ale `CustomStageSpec` tego pola nie mial - prompt skilla
  `no-egress` jechal do modelu chmurowego. Nowy `backend/src/lib/skills/integrity.ts`:
  `skillPromptSha256` (suma liczona PRZY ODCZYCIE, na `canonicalSha256` z ADR-0142) oraz
  `partitionSkillsByEgress` (regula jednostronna: `no-egress` nie idzie do modelu opuszczajacego
  maszyne). Audyt zapisuje `custom_skills` jako rekordy z wersja, suma kontrolna, zrodlem
  i wydawca, oraz `skipped_skills` z powodem pominiecia. Zakres: `surface: draft-stage`.
  Bez nowej kolumny, migracji i `event_type`. backend 1440 pass / 0 fail (+13).
- **Wersje jezykowe rynkow UE: IT/DE/ES/FR (ADR-0139)** - locale rozszerzone z pary
  PL/EN do 6 rynkow. Slowniki UI `it/de/es/fr.ts` (po 614 kluczy, pelne pokrycie
  pl.ts; fallback lancuchowy locale -> EN -> PL w `i18n/index.ts`). Rejestr profili
  jurysdykcji w `prompts.ts` (`PROFILES`): dla rynkow substancja KRAJOWA w jezyku
  rynku (ustroj sadow, dyscyplina lokalnego konektora z jawnymi granicami pokrycia,
  konwencje cytowania, zasada draftu); PL/EN odtwarzaja dotychczasowy prompt bez
  zmian. Konektor `it-eli` (Normattiva + Corte Costituzionale) dolaczony do zestawu
  zaufanego (4-sync: pipeline.ts, prepare-resources.cjs, mcp-servers.example.json,
  connectors.ts); build IT bundluje indeks orzecznictwa Corte Cost (best-effort,
  `IT_ELI_CASELAW_DB`). **Lean market edition** (decyzja WM): krajowa wersja
  bundluje TYLKO konektor macierzysty (`stagedNodeConnectors`/`stagedPythonConnectors`
  w prepare-resources) - prawo UE (EUR-Lex, EU-Compliance) i inne jurysdykcje
  uzytkownik dobiera z Boutique, instalator zostaje chudy; prompty rynkow mowia to
  wprost i nie obiecuja konektora UE. PL/EN (wydane 1.0.0) bez zmian. Build per
  rynek jedna komenda: `npm run build:it` itd. (`desktop/scripts/build-locale.cjs` -
  locale + jezyk NSIS + kanoniczna nazwa artefaktu + SHA256 do `dist/CHECKSUMS.txt`).
  Slowniki i bloki substancji DE/ES/FR wymagaja recenzji prawnika-native przed
  wydaniem rynku (bramka z ADR-0139).
- **Fix: jezyk agenta w instalatorze nie-PL** - `prepare-resources.cjs` zapisuje
  `backend/patron-locale.json`, a `desktop/main.js` czyta go i ustawia `PATRON_LOCALE`
  dla backendu. Dotad zaden kod nie przekazywal locale backendowi w trybie desktop,
  wiec agent w instalatorze EN odpowiadal po polsku (default), mimo UI i samouczka EN.
- **Karty zatwierdzenia mutacji - human-in-the-loop write staging (ADR-0137)** - akcje
  agenta o skutkach ubocznych (`edit_document`, `generate_docx`) moga byc stage'owane
  jako karty `pending`; wykonuja sie dopiero po zatwierdzeniu przez czlowieka (`requireAuth`,
  fail-closed) - nadzor czlowieka nad zapisem wg **AI Act art. 14**. Nowa tabela
  `mutation_approvals` (dual SQLite+Postgres, scoping `user_id`), nowy `event_type`
  `mutation.approval.decision` w audit hash-chain (art. 12, payload bez tresci dokumentu).
  Bramka w `tool-dispatch.ts` nad sciezka narzedzi; inbox UI `account/approval-cards`
  (PL/EN). RODO art. 17/20: `mutation_approvals` objete `rodo-delete`/`rodo-export`.
  **Domyslnie OFF** (`PATRON_MUTATION_APPROVAL` = `off`|`all`|`high-stakes`; `true`=alias `all`)
  - flip na ON po review round 2 + eval. US3 (P3): bramka objela tez `add_comments` (komplet
  narzedzi agenta mutujacych tresc: edit/generate/comments) + polityka `shouldStageMutation`
  (off/all/high-stakes; high-stakes wpiety w `classifyHighStakes`/ADR-0092 FAIL-CLOSED - stage
  dopoki nie pewne, ze low-stakes). `resolve_tracked_change`/`export_document` to akcje czlowieka
  (trasy), nie narzedzia agenta - poza zakresem (resolve audytowane `document.edit_resolved`).
- **Jezyk agenta wg locale (US2, ADR-0135)** - `SYSTEM_PROMPT` skladany przez
  `buildSystemPrompt(locale)`; `PATRON_LOCALE=en` przelacza jezyk odpowiedzi, opis
  struktury sadow i przewodnik mozliwosci na EN (przez reviewer-en + humanizer-en).
  Substancja jurysdykcyjna - drafting pism PL, formuly grzecznosciowe, cytowanie prawa
  PL, dyscyplina SAOS - **zostaje PL w obu locale** (pismo do polskiego sadu jest po
  polsku). Default `pl` -> zero regresji. Konstrukcja promptu nadal w sciezce audit
  hash-chain (AI Act art. 12).
- **Picker konektorow MCP + 9 konektorow UE (US1/US2, ADR-0133/0134)** - mecenas wybiera
  konektory wg jurysdykcji (toggle Ring1, Ring2 = Operator-gated), audyt `connector.toggle`
  w hash-chain. Poliglotyczny runtime Node+Python (ADR-0134); 9 konektorow UE
  (de/at/es/fi/ie/nl/se/fr/lu) zaufanych po gateway-scan, dolaczone do
  `APPROVED_PATRON_CONNECTORS` (15). Bundle desktop (PyInstaller freeze) = TODO.
- **Dwujezyczne UI (PL/EN)** - cala warstwa interfejsu i format dat/liczb
  lokalizowane (ADR-0132). Jeden jezyk per instalacja, wybierany zmienna
  build-time `NEXT_PUBLIC_PATRON_LOCALE` (`pl` domyslnie | `en`); bez next-intl,
  bez locale w URL. `frontend/src/i18n/` (`pl.ts` zrodlo kluczy, `en.ts`
  deep-partial + fallback PL, `index.ts` = `t()` + helpery formatu locale-aware).
  Granica: UI/metoda -> EN; substancja prawna wg jurysdykcji, glebokie skille PL i
  pl-entities zostaja PL. Terminologia legal-EN: pierwsza warstwa (przeglad
  reviewer-en zalecany przed finalizacja).

## [1.0.0] - 2026-06-14

Pierwsze publiczne wydanie open source. Lokalny, zero-cloud agent AI dla polskiej
kancelarii: powloka **AGPL-3.0** + 6 konektorow MCP (**MIT**) polskiego i unijnego
prawa, mechaniczny grounding cytatow (istnienie/tresc/fragment), audit trail
hash-chain + Merkle (AI Act art. 12), pseudonimizacja PL (PESEL/NIP/REGON/osoby)
przed egressem, bring-your-own-model (Gemini / Claude / Ollama lokalny / OpenRouter).

**Najwazniejsze w 1.0.0**
- Audyt P1-P3: szczelne kasowanie spraw/dokumentow, runner migracji SQLite, zgoda
  na model chmurowy per-sprawa (ADR-0128), maskowanie nazwisk w egressie (ADR-0110),
  wezly PERSON w grafie cytowan (ADR-0127).
- Propozycje pod kancelarie: wbudowane workflow, "Zweryfikuj cytaty", preset eksportu
  .docx "styl kancelarii" (ADR-0130).
- Adopcja OpenContracts: trwaly lokator cytatu + re-anchoring, bounded document read,
  typed search feed, occurrence-aware highlight, Route B (surowe offsety chunkow),
  model governance krawedzi grafu KGLF (ADR-0116..0126).
- Fidelity na zadanie (ADR-0131): doskonalenie pisma (Recenzent / Adwokat diabla /
  Pisz po ludzku) jest WYBIERALNE per etap, domyslnie 1 szybki przebieg - koniec
  wymuszonego 3-etapowego pipeline'u (latencja). Pelne przyciski na odpowiedzi = v1.0.1.
- Szyfrowanie at-rest: **dostepne jako scaffold, do aktywacji** (ADR-0129) - domyslnie
  plaintext; aktywacja = natywny sterownik cipher + rebuild (runbook
  `docs/at-rest-activation.md`). Decyzja CTO: poza krytyczna sciezka 1.0.0 (first-mover).

> **Numeracja ADR:** przy scaleniu dwoch rownoleglych strumieni (adopcja OpenContracts
> oraz audyt/kancelaria) numery ADR uzgodniono - OC zajmuje **0116-0126**, strumien
> audyt/kancelaria **0127-0130**. Wczesniejsze szczegolowe wpisy ponizej moga wskazywac
> stare numery sprzed uzgodnienia.

Bramka jakosci 1.0.0: backend tsc 0, frontend tsc 0, **vitest 1265 pass / 0 fail / 5 todo**.

---

### Audyt PATRON P2 #6: zgoda na model chmurowy per-sprawa + audyt (ADR-0128)

**Added**
- Przelacznik "Model chmurowy" per-sprawa w UI (`ProjectPage`, owner-only) zamiast
  globalnej zmiennej srodowiskowej. `PATCH /projects/:id/cloud-consent` +
  `patronApi.setCloudConsent`.
- `projects.cloud_consent` (sqlite + `ensureSchemaUpgrades`; Postgres + migracja 013).
- Brama egress (`guard.ts` `resolveCloudConsent`) OR-uje zgode globalna (env) i
  per-sprawa -> `decideRoute`. Fail-closed (default brak zgody; tajemnica nadal
  wymaga swiadomej zgody).
- Audit: nowy `event_type = 'project.cloud_consent'` (AI Act art. 12, bez tresci).
  Whitelist: EVENT_TYPES + schema.sqlite.ts + schema.sql + **migracja sqlite v2**
  (runner ADR-0109 rebuilduje CHECK `audit_log` z zachowaniem wierszy/hash-chain)
  + Postgres migracja 012.

Defense-in-depth nietkniete: PII maskowane przed chmura (ADR-0110), kazdy call
egress audytowany (ADR-0067). backend tsc 0 + vitest 1180 pass / 0 fail / 5 todo
(+11). Frontend tsc 0. Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON UI: przycisk "przewin w dol" w czacie (frontend)

**Fixed**
- Przycisk scroll-to-bottom (ChatView) zawodzil "przy wyniku zadania" - uzywal
  `scrollIntoView` na zero-wysokosciowym markerze koncowym (cel liczony w momencie
  klikniecia, nie dobijal do dna gdy odpowiedz wciaz sie renderowala/rosla). Teraz
  `messagesContainerRef.scrollTo({ top: scrollHeight, behavior: "smooth" })` -
  deterministyczne dno niezaleznie od markera i strumieniowania. Frontend tsc 0.
  Weryfikacja: DocView/DocxView i czat projektowy uzywaja natywnego scrolla (brak
  wlasnego przycisku w dol - nic do naprawy). Manualna weryfikacja u pilota.

### Audyt PATRON P2 #11 (cz. 2): wezly PERSON w grafie cytowan (ADR-0116)

**Added**
- Regula `osoba-z-markerem` w `pl-entities` (`PL_EXTRACTION_RULES`) -
  `extractEntitiesAndEdges` tworzy z niej encje OSOBA + krawedzie `wspomina_osobe`
  (typ i mapowanie juz istnialy, brakowalo reguly). Odpowiada na "pokaz dokumenty
  wspominajace osobe X" (wspolny `value_normalized`).
- Detekcja deterministyczna, zakotwiczona na markerze (honoryfikator/rola
  procesowa) + nazwa z wielkiej; bez markera nie lapie (precyzja - nie maskuje
  "Sad Najwyzszy"). Pierwsza litera markera case-insensitive (rola na poczatku
  zdania). Lookbehind Unicode.

RODO: OSOBA to PII w `extracted_entities` - objete istniejaca purga
(`clearDocumentIndex` / `forgetCase`). Krawedz osoby celuje w encje, nie dokument
(`resolveToDocLinks` jej nie dotyka). Detekcja lokalna (graf/sqlite), zero egress;
osobno od maskowania PII przed chmura (ADR-0110) - konwergencja markerow = rezerwacja.
tsc 0, vitest 1174 pass / 0 fail / 5 todo (+5 `person-nodes.test.ts`).
Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON P3 #17 + #18: panel "Stan systemu" + czyszczenie komentarzy (ADR-0115)

**Added**
- P3 #17: endpoint `/api/status` (admin, READ-ONLY) - migawka stanu: wektor on/off,
  OCR on/off, model+wymiar embeddera, status kluczy API, zgody chmurowe,
  **saldo kredytow OpenRouter** (`getOpenRouterCredits`, endpoint /credits,
  best-effort) z flaga `depleted` (wczesny sygnal wyczerpania - realny incydent).
  Osobno od publicznego liveness `/health`. Fundament pod frontendowy Panel stanu.

**Fixed**
- P3 #18: nieaktualne komentarze "Wpiecie w retrieve() jest rezerwacja" w
  `dualSimilarity.ts`/`events.ts` - rerank JEST wpiety (ADR-0087/0089). Komentarze
  poprawione na stan faktyczny.

tsc 0, vitest 1168 pass / 0 fail / 5 todo (+9: health pure-fns + getOpenRouterCredits).
Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON hygiena retrievalu: embedder + overlap + prefix-PL (ADR-0114)

**Fixed**
- P2 #8: zmiana wymiaru/modelu embeddera psula po cichu warstwe wektorowa
  (`create if not exists` nie zmienia wymiaru `vec_chunks`). Tabela
  `retrieval_meta` + `reconcileEmbedderMeta`: mismatch wymiaru -> drop vec_chunks
  + sygnal re-indeksu + glosny log; zmiana modelu -> ostrzezenie. Koniec cichej
  korupcji.
- P3 #14: chunker bez zakladki rozcinal fakt na granicy chunka. `chunkText`
  dostal overlap (~120 znakow, ~13%) doklejany w ramach budzetu maxChars
  (kontrakt `chunk <= maxChars` zachowany).
- P3 #15: BM25 bez stemmingu gubil formy odmienione. `buildFtsMatch` daje
  prefix-match rdzenia (`rdzen*`) dla tokenow literowych >=7 znakow; sygnatury/
  liczby/krotkie zostaja exact.

tsc 0, vitest 1159 pass / 0 fail / 5 todo (+10 `hygiene.test.ts`).
Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON P2 #10: proweniencja strony w chunkach RAG (ADR-0113)

**Fixed**
- P2 #10: `doc_chunks` nie mial numeru strony -> RAG nie wskazywal "str. N"
  przy cytacie (styl "cytat + sygnatura + strona").
- Latentny bug: markery `[Page N]` trafialy do tresci chunkow (embeddingi/FTS)
  - teraz odrywane od tresci.

**Added**
- `doc_chunks.page_no` (schema + `ensureSchemaUpgrades` ADD COLUMN).
- `splitByPageMarkers` + chunking per strona w `indexDocument` (markery `[Page N]`
  z ekstrakcji PDF). Bez markerow (docx/plain) -> jeden segment, page_no null
  (zero regresji).
- `RetrievedChunk.pageNo` + `page` w wynikach `search_corpus` -> model cytuje "str. N".

Render "str. N" w UI cytatu = frontend (poza tym repo); backend dostarcza dane.
tsc 0, vitest 1149 pass / 0 fail / 5 todo (+5 `pageProvenance.test.ts`).
Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON P2 #11: graf - rozwiazanie krawedzi dokument->dokument (ADR-0112)

**Fixed**
- P2 #11: `citation_graph.to_doc_id` byl martwy (extractor zawsze `toDocId=null`)
  -> brak trwalej krawedzi "dokument X cytuje wyrok bedacy dokumentem Y".

**Added**
- `lib/graph/crossDocLinks.ts` - `resolveToDocLinks(db)`: deterministyczny
  post-pass liczacy `to_doc_id`. Krawedz cytowania sygnatury wskazuje dokument,
  ktory NIA JEST (inny dokument z ta sama `value_normalized`), TYLKO gdy taki jest
  dokladnie jeden (jednoznacznosc); inaczej null. Wpiety w `indexDocument`
  (przelicza korpus idempotentnie). Query-time centralnosc nietknieta.

**Changed**
- `clearDocumentIndex`: krawedzie INNYCH dokumentow rozwiazane na usuwany
  dokument sa null-owane (`to_doc_id = null`), nie kasowane - cytat zostaje, znika
  tylko rozwiazany cel (korekta ADR-0109 P3 #13 pod ozywiona kolumne).

Poza zakresem (follow-up): wezly PERSON w grafie (wymaga wpiecia detekcji osob
z warstwy pseudonim w sciezke grafu). tsc 0, vitest 1144 pass / 0 fail / 5 todo
(+4 `crossDocLinks.test.ts`). Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON P2 #5: RAG scope - domyslna izolacja spraw (ADR-0111)

**Fixed**
- P2 #5: `search_corpus` w czacie ogolnym (bez `projectId`) przeszukiwal CALY
  korpus usera -> fragmenty akt jednego klienta moglyby trafic do rozmowy o
  innym (tajemnica miedzy klientami). Teraz czat ogolny skopuje sie DOMYSLNIE do
  dokumentow bez przypisanej sprawy (standalone); akta sprawy sa osiagalne tylko
  z czatu w jej kontekscie.

**Added**
- `resolveSearchScope(db, projectId)` (eksport z `tool-dispatch.ts`) - decyzja
  scope RAG. Furtka `PATRON_RAG_CROSS_CASE=true` na swiadome wyszukiwanie
  przekrojowe (z flaga `cross_case` + ostrzezeniem) do czasu przelacznika UI (P2 #6).
- Proweniencja sprawy w kazdym trafieniu (`case` = nazwa sprawy / "bez sprawy")
  + ostrzezenie gdy wyniki przekraczaja granice jednej sprawy.
- Testy: `search-scope.test.ts` (+5). Fixture `retrieval.test.ts` uzupelniony o
  wiersze `documents` standalone (w produkcji tworzy je ingest).

tsc 0, vitest 1140 pass / 0 fail / 5 todo. Branch `fix/audyt-patron-p1-p3`.

### Audyt PATRON P1 #4: maskowanie nazwisk/podmiotow/adresow przed chmura (ADR-0110)

**Fixed**
- P1 #4: `wrapConversation` w egress (`lib/chat/stream.ts`) byl wolany BEZ
  detektora (`noopLlmDetector`) -> imiona, nazwiska, nazwy podmiotow i adresy
  wychodzily do modelu chmurowego otwartym tekstem (maskowane byly tylko
  identyfikatory regexowe). Domkniecie ADR-0067.

**Added**
- `lib/pseudonim/plDetector.ts` - deterministyczny, zero-cloud detektor
  PERSON/ORG/ADDRESS (`plEntityDetector`) wpiety w `wrapConversation`:
  - PERSON: zakotwiczone na honoryfikatorze/roli (Pan/Pani/adw./mec./swiadek/
    oskarzony/...) + tokeny z wielkiej litery; maskowana sama nazwa, nie marker;
    bez goych bigramow z wielkich liter (zeby nie maskowac "Sad Najwyzszy" itp.).
  - ORG: reuzycie regexu form prawnych z `pl-entities` (FIRMA), bez forka.
  - ADDRESS: kod pocztowy + ulica/aleja/plac z numerem.
  Maskowanie odwracane przez unwrap (nad-maskowanie nie psuje outputu); recall >
  precyzja. Aktywne wraz z `PATRON_PSEUDONIM_EGRESS` (bez nowej flagi).
- Testy: `plDetector.test.ts` (+12, regresja PL: PERSON/ORG/ADDRESS, round-trip).
  Bug zlapany: `\b` ASCII nie lapal markera od polskiej litery ("świadek") ->
  lookbehind Unicode `(?<![\p{L}\p{N}_])`.

tsc 0, vitest 1135 pass / 0 fail / 5 todo. Branch `fix/audyt-patron-p1-p3`;
przed merge do `main`: 2x review WM + decyzja Operatora. Pozostaje P1 #1 (at-rest
native swap) - osobny PR.

### Audyt PATRON: domkniecie usterek P1-P3 + runner migracji SQLite (ADR-0109)

**Fixed**
- P1 #2: szczelne kasowanie. `DELETE /projects/:id` wola `forgetCase` (pliki +
  RAG/wektory/FTS + graf + brain), `DELETE /single-documents/:id` wola
  `clearDocumentIndex` - koniec osieroconych chunkow/embeddingow/encji PII i
  plikow akt po "normalnym" usunieciu z UI (RODO art. 17 dla zwyklej sciezki).
- P1 #3: `openrouter` dodany do CHECK `user_api_keys` - wlasny klucz OpenRouter
  zapisuje sie z UI (migracja rebuildujaca + `schema.sqlite.ts`).
- P3 #12: `PRAGMA busy_timeout=5000` + `synchronous=NORMAL` pod WAL (anty
  `SQLITE_BUSY`).
- P3 #13: `clearDocumentIndex` czysci graf w obie strony (`to_doc_id` +
  krawedzie po encjach dokumentu), nie tylko `from_doc_id`.
- P3 #16: `getExtractor` nie cache'uje odrzuconego promise - nieudany load
  modelu nie zabija embeddera do restartu procesu.

**Added**
- P2 #7: wersjonowany runner migracji SQLite (`backend/src/lib/db/migrate.sqlite.ts`)
  na `PRAGMA user_version` - sciezka zmian CHECK/FK (rebuild tabeli) dla trybu
  desktop, obok `ensureSchemaUpgrades` (ADD COLUMN). Test: `migrate.sqlite.test.ts`.

Poza zakresem (osobne ADR): P1 #1 at-rest native swap (better-sqlite3-multiple-
ciphers + safeStorage), P1 #4 maskowanie nazwisk w egress (domkniecie ADR-0067).
tsc 0, vitest 1123 pass / 0 fail / 5 todo (+5 testow). Branch
`fix/audyt-patron-p1-p3`; przed merge do `main`: 2x review WM + decyzja Operatora.
### Grounding: sygnal WYMAGA OSADU - teza nieoceniona semantycznie (ADR-0103)

**Added**
- `requiresJudgment` (CascadeResult, `backend/src/lib/citation/cascade.ts`) - sygnal
  doradczy: cytat tekstowo ugruntowany i podpiera teze, ale substancja NIE zostala
  oceniona przez sedziego (etap 3 sie nie odpalil). Domyka cicha luke Stanford GDY
  judge jest fail-closed (tajemnica + model chmurowy -> `makeJudge`=null).
- `judgeUnavailable` (GroundOptions, `chat/ground-citations.ts`) - gdy sedzia byl
  ZADANY (`PATRON_CITATION_JUDGE` ON) lecz niedostepny, sciezka deterministyczna
  oznacza cytaty `verified` podpierajace teze jako `requiresJudgment`. `judge=off`
  swiadomie NIE jest flagowany.
- Licznik `requiresJudgment` w `groundingSummary` (AI Act art. 12) - ile tez przeszlo
  bez kontroli sensu. Zero PII (sama liczba).
- Frontend: pierscien amber + tooltip "tekstowo zgodny, ale tezy nie oceniono - sprawdz
  zrodlo" (`AssistantMessage.tsx`, i18n `citations.requiresJudgment`); pole w
  `PATRONCitationAnnotation` + mapowanie SSE (`useAssistantChat.ts`).

**Verified**: tsc 0 (backend + frontend), vitest 1125 pass / 0 fail (+12 testow),
zero regresji. Default-safe (pole tylko gdy judge ON + niedostepny). decision (blokada)
nietknieta. Inspiracja: gradient WYMAGA_OSADU ze skilla `citation-grounding-pl` (MateMatic).

### Grounding: tagi proweniencji + stan needs_review (ADR-0102)

**Added**
- A: tagi proweniencji cytatu (`backend/src/lib/citation/provenance.ts`) -
  deterministyczny tag POCHODZENIA (saos/isap/eurlex/uzytkownik/model), os
  ortogonalna do verdict (ADR-0097); default = model, pinpoint zawsze do
  weryfikacji. Za flaga `PATRON_PROVENANCE_TAGS` (default OFF).
- B: stan `needs_review` komorki tabular (`backend/src/lib/tabular/grounding.ts`)
  - cytat bez weryfikowalnego zrodla nie milczy (undefined), tylko oznacza do
  przegladu prawnika ("pusta komorka ukrywa informacje"); rozszerza model komorki
  ADR-0011 + reuzywa verifyOne (ADR-0005). Za flaga `PATRON_TABULAR_CELL_STATES`
  (default OFF).
- Liczniki proweniencji / needs_review w audit_log (`groundingSummary` +
  `tabular.grounding` ADR-0082) - opcjonalne, tylko liczby/enumy (AI Act art. 12).
- Frontend: tag proweniencji w tooltipie cytatu czatu + status `needs_review`
  komorki tabular (tylko enumy do UI, zero PII).

Konstytucja PATCH 1.6.1. decision (ADR-0005, blokada) nietknieta - warstwa
doradcza. tsc 0 (backend + frontend), vitest 1114 pass / 0 fail (+20 testow).
Wzorzec clean-room z anthropics/claude-for-legal (Apache-2.0). Branch
`feat/grounding-provenance-tabular`; przed merge do `main`: 2x review WM + eval
korpus PL przed flipem flag.

### Podsumowanie sprintu 2026-05-29 - 2026-06-02 (ADR-0053 .. 0099)

Zbiorczy wpis domykajacy luke rejestracji zmian (poszczegolne ADR maja pelny
opis w `governance/adr/`). Pogrupowane wg Keep a Changelog.

**Added**
- Tryb desktop zero-cloud: SQLite single-user (ADR-0053), graf hybrydowy na
  SQLite (ADR-0054), headless ingest folderu sprawy (ADR-0056), bibliotekarz/
  brain-store (ADR-0057), tryb local single-user we froncie (ADR-0062).
- Frontend: draft odpowiedzi przez pipeline obrony (ADR-0063), import folderu
  sprawy (ADR-0064), persystencja groundingu cytatow + audit (ADR-0065).
- Pipeline obrony (Recenzent/Adwokat/Humanizer "invisible AI", ADR-0058);
  provider OpenRouter (ADR-0059); roundtrip importu Word (ADR-0060).
- Sciezka retrievalu: clause-boundary chunking + parser wyroku (ADR-0083),
  copy-mechanism NER (ADR-0084), WuManber bootstrap PL-NER (ADR-0085),
  dual-similarity case ranking + wpiecie (ADR-0086/0087), ocena kwantyzacji
  vector store (ADR-0088), event-centric KG + wpiecie (ADR-0089/0090).
- Tabular review: grounding cytatow (ADR-0080), polskie presety kolumn
  (ADR-0081), grounding w audit hash-chain (ADR-0082).
- OCR wejscia (ADR-0074/0075); panel zuzycia kosztow AI (ADR-0076); emisja
  komentarzy DOCX recenzenta + warstwa serwisu + redline (ADR-0077/0078/0079).
- Pakowanie instalatora desktop - Electron bundled node + standalone front +
  electron-rebuild better-sqlite3 (ADR-0091).
- Biblioteka umiejetnosci: kontrakt paczki skilla (ADR-0094), wykonanie
  importowanych skilli na etapie draft (ADR-0096).
- Egzekucja modeli lokalnych Ollama w warstwie funkcyjnej LLM (ADR-0098).

**Fixed**
- `resolveModel` przepuszcza `ollama/*` - wybor modelu lokalnego nie spadal juz
  po cichu na chmure (ADR-0098).
- `GET /api/security/mcp-status` 500 "no such column: created_at" - audit_log
  uzywa kolumny `ts` (ADR-0099).

**Security**
- Hardening `/draft/refine` pipeline obrony (ADR-0068); security headers / CSP
  (ADR-0069); hardening dokumentow - skan wersji, audit edycji (ADR-0070);
  egress hardening openExternal / embeddings (ADR-0071); szyfrowanie at-rest
  SQLite via DPAPI (ADR-0072).
- Governance routingu LLM / data-residency - wspolny chokepoint egress
  (ADR-0067), tier-governance egress (ADR-0095).
- Grounding cascade z paraphrase-judge - wykrywanie falszywych zielonych
  werdyktow cytatu (ADR-0097).
- Domkniecie luk egress wykrytych w audycie 2026-06-02: egress guard w tabular
  review (generate/regenerate-cell/chat) i generate-title, walidacja SSRF
  `OLLAMA_HOST` (ADR-0099).
- RODO: pelna purga sprawy "zapomnij sprawe" (ADR-0061).

---
### Audyt PATRON P1 #1 (SCAFFOLD): aktywacja szyfrowania at-rest (ADR-0118)

**Changed**
- `backend/package.json`: alias sterownika ->
  `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^12.10.0"` (cipher-capable,
  drop-in API). Zero zmian importow.

**Docs**
- `docs/at-rest-activation.md` - runbook aktywacji (npm install forka +
  `@electron/rebuild` + odwrocenie 2 testow atrest + weryfikacja `cipher_version`
  + migracja plaintext + rollback). ADR-0118.

> SCAFFOLD: wymaga natywnej kompilacji + rebuild pod Electron (NIE wykonane w tym
> srodowisku). Backend fail-loud (ADR-0072) i Electron safeStorage (desktop/main.js)
> JUZ wpiete - brakowalo tylko sterownika. Aktywacje skoordynowac z pipeline desktop.
> Branch `feat/at-rest-native-cipher`, NIESCALONY.
### Audyt PATRON Propozycja #6: preset eksportu .docx "styl kancelarii" (ADR-0119)

**Added**
- Opcja `kancelaria` w `generateDocx` + param w narzedziu `generate_docx`: bez
  tabel (wiersze -> wyliczenia), srodtytuly pogrubione w osobnym wersie
  (HeadingLevel), numeracja stron w prawym-dolnym rogu (Footer + PageNumber).
  Default OFF (zero zmian zachowania). "Konkluzje podkreslane" / pelny "Doszlifuj"
  (justowanie/typografia) = rezerwacja. Przycisk UI = follow-up.

### Audyt PATRON Propozycja #8: "Zweryfikuj cytaty" jako akcja (ADR-0119)

**Added**
- `POST /api/citations/verify` (`routes/citations.ts`) - mechaniczna weryfikacja
  cytatow gotowego pisma wzgledem akt sprawy (ADR-0005, deterministyczna, zero LLM,
  READ-ONLY). Reuzywa `groundCitationsByRef` + `buildProjectDocContext`; kontrola
  dostepu do sprawy (`checkProjectAccess`, 404 dla cudzej). Werdykt per ref +
  summary + `blokada`. Klient `patronApi.verifyCitations`. Przycisk UI = follow-up.

### Audyt PATRON Propozycja #7: wbudowany workflow "Analiza akt" (ADR-0119)

**Added**
- `builtin-analiza-akt-karne` w `lib/builtinWorkflows.ts` - wbudowany obiektyw
  analityczny pod karnistyke (6-punktowy: zarzut -> dowody -> wyrok I -> apelacja
  -> wyrok II -> wskazania). Reuzywa silnik workflows (czyste dane, zero kodu).
  Dyscyplina cytatu (cytat + dokument + "str. N", proweniencja ADR-0113), obiektywy
  art. 201/7/410/424/5§2/438/249/258 k.p.k., anty-zmyslanie ("brak w aktach"),
  dostarczenie inline. Test `builtinWorkflows.test.ts`. Branch `feat/kancelaria-proposals`.

### Added

- **ADR-0048 - Endpoint "Wymus compute Merkle root" + UI fallback dla audytora**
  (2026-05-27). Realizacja rezerwacji z ADR-0047 (sekcja "Co NIE jest w
  ADR-0047" + odpowiedz `404` w endpoint `GET /api/audit/export/:eventId`).
  Zamyka UX dziure: audytor UODO klika "Pobierz audit pack", dostaje 404
  "brak Merkle root pokrywajacego event" bo event byl po ostatnim
  auto-trigger ADR-0036 (count >= 1000 LUB interval >= 24h). Frontend wykrywa
  tym 404 (heurystyka `detail.includes("brak Merkle root")` - dlug
  zarejestrowany do ADR-0050), pokazuje secondary button "Wymus compute root
  i ponow eksport", wywoluje nowy endpoint `POST /api/audit/merkle/compute-now`
  (requireAuth + requireAdmin per ADR-0034), po sukcesie auto-retry eksport.
  Backend reuse `runAutoCompute` z `audit-merkle-roots.ts` (ADR-0036) z
  thresholdami forsujacymi `countThreshold=1`, `intervalMs=0` - kazdy nowy
  event wymusza compute. Pure helper `backend/src/lib/audit-merkle-compute-now.ts`
  (118 LoC) z 3 eksportami: `FORCE_*` thresholds jako stale,
  `parseComputerByLabel(email, userId)` z anti-injection sanitizacja
  (`\r\n\t` + znaki kontrolne x00-x1f, trim do 100 znakow, fallback
  `manual-ui:unknown`), `buildComputeNowResponse(result)` mapuje 4 scenariusze
  `RunAutoComputeResult` na response endpointu. 16 testow zero-mock w
  `audit-merkle-compute-now.test.ts` (FORCE thresholds 2, parseComputerByLabel
  8 wlacznie z anti-injection cases, buildComputeNowResponse 6). Response
  endpointu **zawsze 200** z `{computed: bool, reason, root?, error?}` -
  `no_new_events` to legalny stan (kancelaria nie pracowala od ostatniego
  roota), nie 409 Conflict. Logowanie meta-audit
  `admin.access.merkle_compute_now` przez `recordAdminAccess` PRZED `runAutoCompute`
  (zamiar wymuszenia rejestrowany niezaleznie od sukcesu compute). Frontend
  `<AuditExportButton />` rozszerzony z 4 stanow do **5 stanow**
  (`idle | loading | needs-compute | computing | failed`) - amber alert box
  z secondary button wyjasnia powod: "Event nie jest jeszcze pokryty przez
  Merkle root. Wymus compute (auto-trigger uruchamia sie raz na 24h lub po
  1000 nowych eventow per ADR-0036)." Migracja 004 ALTER CHECK whitelist
  event_type (dodanie `admin.access.merkle_compute_now`, format UP/DOWN per
  ADR-0038, idempotent `pg_constraint` check). Lustrzane wpisy w 4 miejscach
  (schema.sql + migration 004 + `EVENT_TYPES` w audit.ts +
  `AdminAccessEventType` w audit-admin-access.ts). Zero nowych zaleznosci
  npm w obu package.json (reuse runAutoCompute + native React state +
  lucide `ShieldCheck` istniejacy). 646 vitest pass / 5 todo / 0 fail
  (+16 nowe vs 630 po ADR-0047). TSC clean backend + frontend. Bulk export
  ZIP = rezerwacja ADR-0050 (`jszip` juz jest w `backend/package.json` deps,
  ZIP nie wymaga nowej oceny); PDF audit raport ludzki = rezerwacja ADR-0051
  (rozdzielone bo wymaga oceny puppeteer vs pdfkit vs server-side React
  renderer); machine-readable error code `error: "merkle_root_missing"`
  zamiast string match = dlug zarejestrowany do ADR-0050. Konstytucja
  Patrona v1.3.1 -> v1.3.2 PATCH (UX safety net dla eksportu z ADR-0047,
  audytor mial juz capability przez prosbe do operatora
  `npm run merkle:trigger` - ten ADR daje mu to w UI; nie zmienia kontraktu
  rol w Konstytucji ani semantyki Merkle hash).

- **ADR-0047 - Eksport audit pack JSON** (2026-05-27). Realizacja rezerwacji
  z ADR-0046 (sekcja "Co NIE jest w ADR-0046"). Nowy endpoint
  `GET /api/audit/export/:eventId` (requireAuth + requireAdmin per ADR-0034)
  zwraca samowystarczalny pakiet JSON dla audytora zewnetrznego (UODO,
  rewident kancelarii, biegly w postepowaniu). Pack zawiera: event z
  `audit_log` (payload zamaskowany server-side przez `maskPayload` z
  ADR-0040 faza 1), Merkle proof bundle (reuse `fetchProofForEvent` z
  ADR-0036), SHA-256 integrity manifestu nad kanoniczna serializacja JSON z
  deterministycznym alfabetycznym porzadkiem kluczy. Pure helper
  `backend/src/lib/audit-pack.ts` z 5 funkcjami eksportowanymi
  (`buildAuditPack`, `canonicalJsonStringify`, `canonicalSha256`,
  `verifyAuditPackIntegrity`, `buildAuditPackFilename`) - wszystkie pure,
  testowalne bez mockow. 24 testy w `audit-pack.test.ts`
  (canonicalJson 6, canonicalSha256 4, buildAuditPack 3,
  verifyAuditPackIntegrity 8, buildAuditPackFilename 3). Skrypt CLI
  `backend/scripts/verify-audit-pack.ts` dwustopniowy
  (`npm run audit:verify-pack -- <plik.json>`) - integrity SHA-256 wykrywa
  modyfikacje pliku po wyniesieniu, Merkle proof bundle wykrywa modyfikacje
  eventu w bazie kancelarii. Audytor weryfikuje offline bez polaczenia z baza
  ani internetem. Frontend `<AuditExportButton />` (nowy komponent
  `frontend/src/components/audit-export-button.tsx`) wpiety w
  `<AuditEventDetail />` jako sekcja "Eksport audit pack (ADR-0047)". Native
  `fetch` + `Blob` + `URL.createObjectURL` + `<a download>`, parse filename
  z `Content-Disposition` header. Migracja 003 ALTER CHECK whitelist
  `event_type` w `audit_log` (dodanie `admin.access.audit_export`, format
  UP/DOWN per ADR-0038, idempotent `pg_constraint` check). Lustrzane wpisy
  w `EVENT_TYPES` (`lib/audit.ts`) + `AdminAccessEventType`
  (`lib/audit-admin-access.ts`) + `schema.sql`. Logowanie
  `admin.access.audit_export` przez `recordAdminAccess` per ADR-0043
  (graceful, nie blokuje endpointu). Zero nowych zaleznosci npm
  (Konstytucja Art. 4) - backend uzywa `node:crypto` wbudowany Node 20+,
  frontend native browser API. 630 vitest pass / 5 todo / 0 fail
  (+24 nowe w `audit-pack.test.ts`, z 606 przed ADR). TSC clean backend +
  frontend. PDF jako audit raport ludzki i bulk export ZIP = rezerwacja
  ADR-0048; podpis kryptograficzny Ed25519 + RFC 3161 timestamping =
  rezerwacja ADR-0049. Konstytucja Patrona v1.3.0 -> v1.3.1 PATCH
  (rozszerzenie istniejacej funkcjonalnosci UI viewera audytora o eksport,
  nie zmienia kontraktu rol - audytor mial juz pelny wglad przez UI z
  ADR-0046; nowy endpoint REST oraz nowy `event_type` w whitelist
  meta-audit).

- **ADR-0038 - Down/rollback dla infrastruktury migracji** (2026-05-27).
  Realizacja rezerwacji z ADR-0035 ("down/rollback migracji = ADR-0038
  proponowany"). Format `-- UP` / `-- DOWN` sekcji w jednym pliku migracji
  `backend/migrations/NNN_*.sql` (wzorzec sqitch/Flyway). Pure helper
  `extractUpDown` w `backend/src/lib/migrations.ts` (parser regex
  case-insensitive, back-compat dla migracji bez markerow). 2 nowe komendy
  runnera w `backend/scripts/run-migrations.ts`:
  `npm run migrate:rollback NNN` (wypisuje DOWN SQL + instrukcje
  skopiowania do Supabase SQL Editor) i `npm run migrate:rollback:mark NNN`
  (kasuje rekord z `schema_migrations` po manualnej aplikacji + console.warn
  ze structured tag `[MIGRATE-ROLLBACK]`). Operator wykonuje DOWN DDL
  manualnie w SQL Editor / psql / pgAdmin (governance-friendly, ten sam
  wzorzec co `migrate:plan` z ADR-0035). Migracja 001 zaktualizowana z
  idempotent `-- DOWN` sekcja (`DROP CONSTRAINT IF EXISTS audit_log_event_type_whitelist`)
  jako wzorzec dla kolejnych migracji. Zero nowych zaleznosci npm
  (Konstytucja Art. 4). +8 testow `extractUpDown` w
  `lib/migrations.test.ts` (pure functions, 0 mockow). 524/529 pass
  (+8 nowych vs baseline 516/521 z ADR-0034), TSC clean. Konstytucja
  Patrona v1.2.6 -> v1.2.7 PATCH (sekcja 5.2.2 zaktualizowana o down/rollback).
  Rezerwacje: ADR-0043 (audit_log eventu `migrate.rollback` + `admin.access`),
  ADR-0039 (CI gate na drift schema.sql vs migrations).
- **ADR-0034 - RBAC admin oparty na whitelist emaili w env** (2026-05-27).
  Realizacja rezerwacji "admin RBAC + UI banner mcp-security" w wezszym
  zakresie (scope-down) - tylko backend RBAC; UI banner mcp-security =
  rezerwacja ADR-0042, UI viewer dla audytora = rezerwacja ADR-0040.
  Admin pool zarzadzany przez env `PATRON_ADMIN_EMAILS` (CSV, lowercase,
  trim). Pusta wartosc = brak adminow (`requireAdmin` zwraca 403). Edycja
  wymaga restartu kontenera. Audyt zmian = git history `.env.example`.
  Pure helpers `parseAdminEmails` + `isAdminEmail` (testowalne bez DB/env)
  + middleware `requireAdmin` (zawsze po `requireAuth` w lancuchu) w
  `backend/src/middleware/auth.ts`. Strukturyzowane logi
  `[ADMIN] grant|denied` na stdout. Audit_log eventu `admin.access` =
  rezerwacja ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist
  event_type). Endpoint `GET /api/audit/merkle/verify/:eventId` (ADR-0036)
  zaostrzony z "kazdy zalogowany" do admin-only przez dodanie
  `requireAdmin` w lancuchu middleware. ADR-0036 explicite wzmiankowal ten
  scope-down w sekcji "Autoryzacja". Zero nowych zaleznosci npm (Konstytucja
  Art. 4). +13 testow w `middleware/auth.test.ts` (pure functions, 0 mockow).
  516/521 pass (+13 nowych vs baseline 503/508 z ADR-0036), TSC clean.
  Konstytucja v1.2.5 -> v1.2.6 PATCH (nowa rola 4.6 Admin). Rezerwacje:
  ADR-0040 (UI viewer dla audytora), ADR-0042 (UI banner mcp-security),
  ADR-0043 (audit_log eventu `admin.access`).
- **ADR-0036 - Auto-trigger Merkle audit root + REST endpoint dla audytora**
  (2026-05-27). Realizacja rezerwacji z ADR-0026 (manual trigger -> hybrid
  auto-trigger). Compute Merkle root nastepuje gdy nowych eventow >= 1000
  LUB ostatni root sprzed >= 24h, whichever first (env-tunable:
  `PATRON_MERKLE_AUTO_COUNT_THRESHOLD`, `PATRON_MERKLE_AUTO_INTERVAL_HOURS`,
  `PATRON_MERKLE_CHECK_INTERVAL_MS`). Idempotency check przed compute
  rozwiazuje TODO z `audit-merkle-roots.ts:64-67`. Pure decision function
  `shouldComputeNextRoot` w nowym module `lib/audit-merkle-scheduler.ts`
  (zero IO, testowalna bez DB). Wrapper IO `runAutoCompute` w
  `lib/audit-merkle-roots.ts` (storage layer, czyta max(id) z audit_log
  i ostatni root z audit_merkle_roots). setInterval bootstrap w
  `src/index.ts` (default tick co 1h). Manualny CLI fallback
  `npm run merkle:trigger` (`scripts/trigger-merkle.ts`) - administrator
  wymusza compute przed audytem (np. dzien przed wizyta UODO).
  Nowy router `routes/audit.ts` z endpointem
  `GET /api/audit/merkle/verify/:eventId` chronionym middleware `requireAuth`
  (twarda RBAC admin-only = rezerwacja ADR-0034). Endpoint zwraca
  samowystarczalny ProofBundle (event_hash + proof + merkle_root + zakres
  bloku). Audytor weryfikuje offline przez `audit-merkle-verifier.ts`
  bez dalszego dostepu do bazy kancelarii. Zero nowych zaleznosci npm
  (Konstytucja Art. 4) - setInterval z biblioteki standardowej Node.
  +21 testow w `audit-merkle-scheduler.test.ts` (pure functions, 0 mockow).
  503/508 testow pass (+21 nowych vs baseline 482/487 z ADR-0035), TSC clean.
  Konstytucja Patrona v1.2.4 -> v1.2.5 PATCH (sekcja 5.2.1 zaktualizowana
  o auto-trigger + REST endpoint). Rezerwacje: ADR-0040 (UI viewer dla
  audytora, blocked-by ADR-0034 RBAC), ADR-0041 (distributed lock dla
  multi-instance backend).
- **ADR-0035 - Infrastruktura migracji + CHECK constraint na audit_log.event_type**
  (2026-05-27). Domyka dlug techniczny ADR-0001 (kolumna `event_type` byla
  wolny text bez CHECK). Whitelist 7 produkcyjnych wartosci: `chat.message.user`,
  `chat.message.assistant`, `input_security_scan` (ADR-0020), `mcp_security.gateway`
  (ADR-0033), `ring_policy.decision` (ADR-0027), `rodo.delete`, `rodo.export`.
  Dodawanie nowego event_type wymaga osobnej migracji + ADR. Dwie warstwy
  obrony: TypeScript union literal `EventType` w `lib/audit.ts` (compile time)
  + CHECK constraint `audit_log_event_type_whitelist` w bazie (runtime).
  Nowa infrastruktura migracji: governance-friendly runner
  `backend/scripts/run-migrations.ts` (komendy `plan`/`mark`/`status`) +
  helper pure functions `backend/src/lib/migrations.ts` (parseFilename / sort
  leksykalny / sha256 checksum / dedup po id / selectPending). Operator
  kancelarii aplikuje DDL manualnie w Supabase SQL Editor / psql / pgAdmin,
  potem `npm run migrate:mark NNN` oznacza w rejestrze `public.schema_migrations`
  (id, name, applied_at, checksum). Audytowalne (DDL w Supabase Audit Logs),
  zero nowych zaleznosci npm (Konstytucja Art. 4). Pierwsza migracja
  `backend/migrations/001_audit_log_event_type_check.sql` (idempotent przez
  `pg_constraint` lookup). Nowe skrypty `migrate`, `migrate:mark`,
  `migrate:status` w `package.json`. Konstytucja Patrona v1.2.3 -> v1.2.4
  PATCH (rozszerzenie sekcji 5.1 o 5 event_type, nowa sekcja 5.2.2 o whitelist
  + infrastrukturze migracji + uzupelnienie brakujacych wpisow changelog 1.2.2
  i 1.2.3 z poprzednich iteracji). +23 testy w `migrations.test.ts` (pure
  functions, zero mockow). 482/487 testow pass (+23 nowych vs baseline 459/464),
  TSC clean. Rezerwacje: ADR-0038 (down/rollback migracji), ADR-0039 (CI gate
  na drift schema.sql vs migrations).
- **ADR-0026 - Merkle audit chain upgrade nad hash-chainem** (2026-05-27).
  Implementacja drugiego patternu z ADR-0024 (cherry-pick Microsoft AGT) -
  pattern 1 (MCP Security Gateway) zrobiony w ADR-0025/0028, pattern 3
  (Privilege Rings) w ADR-0027, teraz pattern 2 (Merkle audit chain).
  Warstwa NAD hash-chain (ADR-0001), nie zamiast niego. Daje audytorowi
  (UODO, rewident kancelarii, biegly w postepowaniu) proof-of-inclusion
  w O(log n) zamiast O(n) lancucha - dla kancelarii z 500k events to ~19
  hash'y do zweryfikowania zamiast 500k. Komplementarne z proof receipt
  (ADR-0031 PROPONOWANY) - rozne warstwy weryfikacji decyzji AI.
  Nowa tabela `audit_merkle_roots` w `backend/schema.sql` (chain_block_start,
  chain_block_end, merkle_root, event_count, computed_at, computed_by) z
  3 CHECK constraints (block order, event count consistency, hash format).
  3 nowe moduly w `backend/src/lib/`:
  `audit-merkle.ts` (pure functions `buildMerkleRoot` + `buildMerkleProof`
  + `verifyMerkleProof`, konwencja RFC 6962 - duplicate last leaf dla
  nieparzystej liczby, SHA-256 dla wezlow), `audit-merkle-roots.ts`
  (storage layer: `computeAndStoreRoot` + `fetchProofForEvent`, operacja
  read-only nad audit_log, brak ON CONFLICT - jednokrotnosc wywolania na
  zakres bloku jest odpowiedzialnoscia administratora w manual-trigger
  trybie), `audit-merkle-verifier.ts` (offline verifier `verifyProofBundle`
  dla audytora - zero zaleznosci od bazy, do uruchamiania standalone).
  Manualny trigger compute w tym ADR - automatyzacja (hook po N events
  z check-before-insert) + UI viewer dla audytora = rezerwacja ADR-0036.
  Zewnetrzny znacznik czasu (RFC 3161 / OpenTimestamps) =
  rezerwacja ADR-0037. +30 testow pure function w 2 plikach
  (`audit-merkle.test.ts` 20 testow w 4 sekcjach: buildMerkleRoot /
  round-trip proof / tamper detection / walidacja formatu;
  `audit-merkle-verifier.test.ts` 10 testow w 4 sekcjach: happy path /
  walidacja schematu / walidacja zakresu bloku / tamper detection), zero
  mockow. 459/464 testow pass (+5 todo, +30 nowych), TSC clean. Atrybucja:
  Microsoft AGT (MIT) + RFC 6962 Certificate Transparency
  (Laurie/Langley/Kasper, 2013) - pisane od zera w TypeScript, bez
  zaleznosci od @microsoft/agt.
- **ADR-0027 - Privilege rings dla wywolan narzedzi MCP** (2026-05-25).
  Implementacja trzeciego patternu z ADR-0024 (cherry-pick Microsoft AGT).
  Nowy modul `backend/src/lib/mcp/ring-policy.ts` (pure function
  `decideRing`) wpiety w `runMcpTool` jako gate w czasie wywolania PRZED
  faktycznym `client.callTool`. 3 ringi: Ring 0 (system, dokumentacyjnie
  zarezerwowany), Ring 1 (6 trusted konektorow Patrona z
  `APPROVED_PATRON_CONNECTORS`, allow + audit), Ring 2 (3rd-party,
  fail-closed default `deny`, explicit allow tylko gdy
  `operatorApproved=true` w `mcp-servers.json` + audit). Decyzje
  propagowane do `audit_log` z `event_type = "ring_policy.decision"`
  przez `recordRingPolicyEvent` w `audit-bridge.ts` (reuse modulu z
  ADR-0033). Komplementarne do MCP Security Gateway (ADR-0025/0028):
  Gateway = gate w czasie ladowania, ring-policy = gate w czasie
  wywolania. Defense-in-depth z dwoch perspektyw. +28 testow pure
  function `ring-policy.test.ts` w 5 sekcjach (Ring 1 trusted / Ring 2
  explicit allow / Ring 2 fail-closed / determinism + immutability /
  RingReason values), zero mockow. 429/434 testow pass (+5 todo, +28
  nowych), TSC clean.
- **ADR-0033 - Propagacja decyzji MCP Security Gateway do audit hash-chain**
  (2026-05-24). Decyzje Gateway'a inne niz `allowed-clean` (`audit`,
  `human_review`, `denied`) trafiaja teraz do tabeli `audit_log` z
  `event_type = "mcp_security.gateway"` przez nowy modul
  `backend/src/lib/mcp/audit-bridge.ts`. Realizuje pierwsza polowe zadania
  zostawionego przez ADR-0028 (druga polowa - UI banner dla Operatora +
  admin endpoint - rezerwacja ADR-0034 ze wzgledu na brak patternu RBAC
  w kodzie Patrona). Tryb wyslij-i-zapomnij: porazka audit_log NIE
  blokuje rejestracji toolow (Konstytucja Art. 8). Graceful no-op gdy
  `SUPABASE_*` env brak (analogicznie do `loadConfig`). Payload pomija
  pole `sample` z `McpFinding` (Konstytucja Art. 7 minimalnosc - sample
  moze zawierac fragment opisu 3rd-party konektora). +5 testow
  `audit-bridge.test.ts`. 401/406 testow pass, TSC clean.
- **ADR-0025 / ADR-0028 - MCP Security Gateway** w `backend/src/lib/mcp-security/`
  (2026-05-24). Lokalny, deterministyczny, zero-LLM, zero-cloud skan definicji
  konektorow MCP przed ich zaladowaniem do kontraktu. 4 detektory: typosquat
  (Levenshtein vs 6 zatwierdzonych nazw), drift (SHA256 hash vs baseline w
  `~/.patron/mcp-drift-baseline.json`), hidden-instructions (PL+EN regex
  jailbreak patterns w opisach narzedzi), tool-poisoning (permission expansion
  + schema mismatch). 4 stany akcji: `allowed` / `audit` / `human_review` /
  `denied`. ADR-0025 = skeleton (11 plikow, 25 testow vitest, +0 zaleznosci
  npm). ADR-0028 = wpiecie w `getMcpTools()` jako gate PRZED registracja
  toolow (refactor 2-fazowy: collect + register), baseline persist atomowo,
  +7 testow `baseline.test.ts`. Cherry-pick wzorca z
  [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
  (MIT). 396/401 testow pass, TSC clean.
- **ADR-0024 - cherry-pick decision record** dla Microsoft Agent Governance
  Toolkit (MIT, 1904 star, OWASP Agentic Top 10 10/10, 992 testow conformance).
  Trzy patterny do osobnych ADR-ow implementacyjnych (MCP Security Gateway =
  ADR-0025/0028 wdrozone; Merkle audit chain = ADR-0026 rezerwacja; privilege
  rings = ADR-0027 WDROZONE 2026-05-25). Audyt RODO pakietu `agent-governance-claude-code`
  v3.6.0 = ZIELONY.
- **ADR-0029 PROPONOWANY - Agent SRE Governance** dla wywolan LLM Patrona.
  4 SLI kancelarii-skali: TaskSuccessRate (>=80% w 7d), HallucinationRate
  (<=2% w 30d), CitationCoverage (>=70% pytan prawnych), McpSecurityIncidentRate
  (=0). 3-stanowy circuit breaker SYGNALOWY (NIE autonomiczne wylaczenie -
  zachowuje Art. 6 Konstytucji "human in the loop"). Implementacja w
  przyszlym ADR-0030.
- **ADR-0031 PROPONOWANY - deterministyczna walidacja decyzji z lokalnym
  proof receipt** (kontrpropozycja do ICME Preflight). Cherry-pick wzorca
  SMT-LIB compilation + proof receipt + offline verifier, NIE wpiecie
  zaleznosci HTTP (ICME `api.icme.io` to cloud-only US, lamie Art. 1 + Art. 5).
  3 patterny do osobnego ADR-0032 implementacyjnego (wybor solvera Z3 vs
  minizinc vs cvc5). 5 polityk-szablonow legal AI zaadoptowanych do skilla
  `matematic-konstytucja-ai` Appendix G.
- `THIRD_PARTY_INSPIRATIONS.md` rozszerzony o 3 sekcje
  (microsoft/agent-governance-toolkit, ICME Preflight,
  ICME-Lab/jolt-atlas WATCH LIST) z pelna atrybucja zgodna z kanonem
  cherry-pick MateMatic.

### Changed

- **Konstytucja AI v1.2.1 -> v1.2.2** (PATCH, 2026-05-24). Dodano Zalacznik C:
  mapping OWASP Agentic Top 10 (10 ryzyk ASI-01..ASI-10) na Artykuly Konstytucji
  Patrona + komponenty kodu. Pokrycie 10/10. Formalna deklaracja ze Patron jako
  produkt regulowany adresuje uznane branzowo ryzyka.

---

- ADR-0022 / ADR-0023 - 6. konektor MCP `mcp-eu-compliance` wpiety w
  Patrona (2026-05-22). Offline korpus prawa UE w lokalnym SQLite FTS5,
  verbatim (zero-LLM) - GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA.
  5 narzedzi: `eu_search`, `eu_article`, `eu_compare`, `eu_check_applicability`,
  `eu_evidence`. MIT. Komplementarny do `mcp-eu-sparql` (live SPARQL).
  Konektor jest publicznym repo (`matematicsolutions/mcp-eu-compliance`);
  bundle data via `npm run fetch-corpus` z Ansvar-Systems/EU_compliance_MCP
  (Apache-2.0). Bundler `scripts/bundle-mcp.cjs` i
  `backend/mcp-servers.example.json` zaktualizowane.
- Constitution AI v1.2.0 -> v1.2.1 (PATCH, 2026-05-24) - lista konektorow
  w Art. 9 rozszerzona z 5 do 6. Korpus zasady i model licencyjny bez zmian.
- ADR-0021 - Time-travel nowelizacji (deterministyczny diff przepisu w
  czasie). Decyzja przyjeta 2026-05-22, koncept z chrisryugj/korean-law-mcp
  (MIT) - patrz THIRD_PARTY_INSPIRATIONS.md. Implementacja jako narzedzie
  w `mcp-isap`, NIE zakodowana (T1-T5 w ADR). Bramka ELI zwalidowana.
- Phase 2.7 - Schema for law firm domain (`matter` / `client` / docs
  per matter).
- Phase 4.2 - additional event types in audit log (`doc.read`,
  `doc.export`) + RODO endpoint exposed via API (not only CLI).
- Phase 4.5 - PII pseudonymization layer (skeleton in
  `backend/src/lib/pseudonim/`, 24 Vitest cases green, not wired into
  `streamChatWithTools` yet - ADR-0003 pending Owner sign-off).
- Phase 6.1 - branding + landing page on matematic.co.

## [Unreleased - Constitution AI v1.1.1 - 2026-05-20]

Polish-only terminology patch for AI Constitution.

### Changed - Constitution AI v1.1.0 → v1.1.1 (PATCH, terminology)

- Art. 4 renamed from "Vendor neutrality" to "Neutralność wobec
  dostawców" (article body and contracts unchanged).
- Role 4.5 renamed from "Vendor (MateMatic)" to "Dostawca (MateMatic)".
- All cross-refs synced: `governance/adr/0002-*.md`, `README.md`,
  `deploy/USER_GUIDE.md`.
- Why: align the last English anglicism in Constitution with the rest
  of the PL client-grade documentation (internal redaction QA round 2).
  Article semantics, signatories, and external contracts (AI Act,
  GDPR mapping in App. A) unchanged - PATCH per § 6.1 of the
  Constitution. Version 1.2.0 reserved for the PII pseudonymization
  layer (ADR-0003) once it is wired into `streamChatWithTools`.

## [1.1.0] - 2026-05-20

Drafting extension + user-facing documentation.

### Added - Phase 2.2 (drafting pism PL)

- SYSTEM_PROMPT extended (`backend/src/lib/chat/prompts.ts`) with a
  Polish drafting section: structure of procedural filings (pozew /
  odpowiedź / apelacja / skarga kasacyjna / zażalenie), administrative
  complaints to WSA, appeals under KPA art. 127-141.
- Terminology guard - odwołanie vs skarga, pozew vs wniosek, wyrok vs
  postanowienie vs nakaz zapłaty, apelacja vs skarga kasacyjna.
- Citation conventions - Dz.U. + ELI for statutes, sygnatura akt +
  data + court for case law, CELEX for EU acts. Date format always
  `DD.MM.RRRR` in document text.
- Polite forms - Wysoki Sąd, Szanowny Organie.
- Drafting rule - never sign as the lawyer; output placeholder
  `[Podpis - imię, nazwisko, tytuł zawodowy, nr wpisu]` for the
  human to fill in.
- Added 7 unit tests for drafting section coverage
  (`prompts.test.ts`).

### Added - Phase 5.5 (user-facing documentation)

- `deploy/USER_GUIDE.md` - 9-section Polish manual for the lawyer
  end-user: first login, model selection, document workflow, chat
  best practices, 5 connectors, citation panel, audit transparency,
  FAQ, troubleshooting.

### Tests

- **76 / 76 passing** (up from 69 / 69 in v1.0.0).

---

## [1.0.0] - 2026-05-20

First public release as **Patron** (re-branded fork of
[Mike](https://github.com/willchen96/mike) under AGPL-3.0).

### Added - Phase 2 (polonization & quality)

- Refactor `chatTools.ts` from 3325 lines to 18 lines (thin facade)
  + 12 modules under `backend/src/lib/chat/` (types / prompts / tools
  / citations / messages / pdf / persistence / docx-generate /
  docx-edit / tool-dispatch / stream + barrel).
- Vitest test suite with **69 tests in 6 files** (citations 16,
  messages 10, prompts 7, mcp 12, persistence 6, audit 18).
- MCP citations contract: `McpCitation` type, `runMcpTool` returns
  `{text, citations}`, SSE event `mcp_citations`, persisted to
  `audit_log` with `type:"mcp_citation"` discriminator.
- Frontend `McpCitationsPanel` component under assistant message body,
  loader splits annotations into doc + MCP, labeled sections per
  server.
- SYSTEM_PROMPT extended with Polish jurisdiction and court structure.

### Added - Phase 3 (Polish legal MCP connectors)

5 separate MIT-licensed repositories, all wired by `mcp-servers.json`:
- [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos)
- [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa)
- [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap)
- [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs)
- [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)

### Added - Phase 4 (compliance)

- **Audit trail with SHA-256 hash-chain** for AI Act art. 12
  record-keeping. `audit_log` schema, `lib/audit.ts`, CLI verifier
  (`npm run audit:verify`), 18 attack scenario tests.
- **RODO endpoints as CLI**: `npm run rodo:export` (art. 20),
  `npm run rodo:delete` (art. 17 with audit log anonymization
  `actor_user_id := NULL`), `--confirm` safeguard.
- **Hardening**: `npm audit fix` (8 vulnerabilities → 1, anthropic
  SDK major bump pending), additional security headers
  (`Permissions-Policy` zeroed, `X-DNS-Prefetch-Control` off),
  `SECURITY.md`.
- **Constitution AI v1.1.0** - `governance/CONSTITUTION.md` (9 articles,
  boundaries, 5 roles, audit, evolution, mapping to AI Act + GDPR
  + Polish ethics codes).
- **Implementation Playbook** - `governance/IMPLEMENTATION_PLAYBOOK.md`
  (6-8 week deployment with RACI matrix).
- **ADR-0001** hash-chain audit trail decision record.
- **ADR-0002** dual-license decision record (AGPL shell + MIT connectors).

### Added - Phase 5 (deployment)

- `backend/Dockerfile` - multi-stage Node 20 + libreoffice + non-root
  + healthcheck on `/health`.
- `frontend/Dockerfile` - Next.js standalone, multi-stage, non-root.
- `docker-compose.yml` - backend + frontend, log rotation.
- `scripts/bundle-mcp.cjs` - cross-platform bundler that vendors
  the 5 MCP connectors into `backend/mcp-bundled/`.
- `.env.docker.example` template.
- `deploy/README.md` - 12-step deployment runbook with troubleshooting.
- `deploy/backup.sh` + `restore.sh` - encrypted backups via `age` +
  `pg_dump` + `mc mirror`, SHA-256 manifest, configurable retention.
- `deploy/BACKUP.md` - GDPR art. 32 backup guide.

### Changed

- **License**: AGPL-3.0-only (Patron shell, dziedziczone z AGPL-3.0-only
  Mike upstream jako dzieło zależne). Konektory MCP: MIT (osobne repo).
  See `NOTICE` for full attribution.
- README rewritten with Polish-first framing, connector table,
  governance pointers.
- `CONTRIBUTING.md` rewritten with dual-license table and DCO
  (no CLA required).

### Removed

- Polish parliamentary proceedings scope (out of MVP; covered by
  `mcp-isap` for legislation, no need for full Sejm proceedings yet).

### Security

- Resolved 7 of 8 npm audit advisories (anthropic SDK major
  bump tracked in `SECURITY.md` § "Known acceptable risks").

---

[Unreleased]: https://github.com/matematicsolutions/patron/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/matematicsolutions/patron/releases/tag/v1.0.0
