# ADR-0005: Mechaniczna weryfikacja cytatow (citation grounding)

**Status**: Czesciowo wdrozony 2026-05-29 (poziom 1 - dokumenty klienta - LIVE,
wpiety w chat/stream.ts; poziomy 2/3 - orzeczenia SAOS / przepisy ISAP-EUR-Lex -
rezerwacja). Konstytucja v1.3.3.
**Data**: 2026-05-20 (blueprint), 2026-05-29 (wdrozenie poziom 1)
**Powiązane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalność),
Art. 5 (tajemnica zawodowa - cytat z orzeczenia musi byc realnym
cytatem, nie wymyslonym przez LLM), Art. 7 (minimalnosc - jezeli LLM
wymysla cytat, prawnik szuka go w bazach i marnuje czas)
**Powiązane**: ADR-0004 (debate), ADR-0006 (audit bundle), wzorzec
architektoniczny [AnttiHero/lavern](https://github.com/AnttiHero/lavern)
(Apache 2.0)

> **Uwaga wdrozeniowa (2026-05-29):** cialo tego ADR (Wariant C, Plan
> migracji) opisuje 2 stopnie z progiem "match >= 0.95 similarity". Wdrozony
> modul `lib/citation/grounding.ts` realizuje to jako **3 stopnie** liczone od
> edit-ratio (znormalizowany Levenshtein roznicy / dlugosc, per segment cytatu):
> dopasowanie DOKLADNE (ratio 0) = ZWERYFIKOWANY (prog ostrzejszy niz 0.95 -
> wymaga zgodnosci co do znaku po normalizacji); ratio <= 0.15 = ZMODYFIKOWANY
> (odpowiednik "unverified, blisko" - literowka/uciecie); ratio > 0.15
> (~podobienstwo < 0.85) = NIEZWERYFIKOWANY (blocked - podmiana slowa, halucynacja).
> Cutoff blokady (0.85) jest luzniejszy niz pierwotne 0.95, ale "verified"
> wymaga dokladnosci - swiadomy kompromis: mniej falszywych blokad, zero
> falszywych "verified". Tuning po pilotazu - patrz Status weryfikacji.

## Decyzja

Patron wprowadza **mechaniczna warstwe weryfikacji cytatow** dzialajaca
**przed** zwroceniem odpowiedzi do prawnika. Kazdy cytat z orzeczenia,
przepisu albo dokumentu klienta zacytowany w odpowiedzi Patrona
przechodzi sprawdzenie:

```
[odpowiedz LLM zawiera cytat] -> [parser wyciaga cytat + zrodlo]
                              -> [string-match cytat vs parsed_doc]
                              -> jezeli match >= 0.95 (fuzzy):     OK, zatwierdz
                              -> jezeli match < 0.95:              FLAG "unverified"
                              -> jezeli zrodlo nie istnieje:       FAIL, blokuj odpowiedz
```

Trzy poziomy:

1. **Cytaty z orzeczen (SAOS / NSA / TK / SN / KIO)**: konektor MCP
   przed zwrotem odpowiedzi pobiera oryginal orzeczenia z SAOS API
   (mcp-saos), uruchamia fuzzy string-match cytatu LLM vs pelny tekst
   orzeczenia. Jezeli match < 0.95 - flaga "unverified", widoczna
   w UI obok cytatu

2. **Cytaty z przepisow (Sejm ELI / ISAP / EUR-Lex)**: ten sam pattern
   na konektorze prawa stanowionego. ISAP / EUR-Lex maja API dla
   pojedynczych artykulow. Cytat "art. 415 KC" rozwiniety do tresci
   art. 415 KC i porownany z LLM-cytowanym brzmieniem

3. **Cytaty z dokumentow klienta (PDF, DOCX w projekcie)**: parser
   dokumentu (juz wpiety w Patron przez `lib/docparse.ts`) ma pelny
   tekst. Cytat z dokumentu = direct string-match z indeksowanym
   tekstem. Match < 0.95 = ostrzezenie "LLM moze parafrazowac, nie
   cytowac doslownie - sprawdz w dokumencie"

System prompt Patrona dostaje hard-instructions:
- "Cytujesz orzeczenia z dokladnym sygnaturem (np. III CZP 11/13)"
- "Cytujesz przepisy z dokladnym brzmieniem artykulu (np. art. 415 KC:
  'kto z winy swej wyrzadzil drugiemu szkode...')"
- "Cytujesz dokumenty klienta z dokladnym fragmentem otoczonym
  cudzyslowem polskim („...")"
- "Nie wymyslasz cytatow. Lepiej powiedziec 'nie znam dokladnego
  brzmienia, sprawdz' niz zhalucynowac"

## Kontekst

Konstytucja Art. 2 (weryfikowalnosc) wymaga, ze **kazda teza Patrona
jest weryfikowalna w zrodle**. Konstytucja Art. 5 (tajemnica zawodowa)
zaklada, ze prawnik kancelarii ufa Patronowi - jezeli Patron raz
zhalucynuje cytat z orzeczenia ("Sad Najwyzszy w wyroku III CZP 99/99
orzekl, ze..."), trust trwa nadszarpniety.

Halucynacje cytatow to **typowy problem LLM** w domenie legal:
- ChatGPT (OpenAI, 2023) - sprawa New York adwokat zacytowal nieistniejace
  precedensy, trafil na dyscyplinarna
- Bing Chat (Microsoft) - halucynowal sygnatury orzeczen
- Claude 3 Opus - lepszy, ale nadal halucynuje, zwlaszcza dla rzadkich
  orzeczen polskich (training data underrepresentation)

Lavern pokazuje pattern **mechanical grounding verifier** - przed
zwrotem odpowiedzi do uzytkownika, deterministyczna warstwa
sprawdza, czy cytat jest realny (string-match z parsed_doc), nie
opiera sie na tym, ze LLM powiedzial "tak, na pewno cytuje doslownie".

Patron robi to samo, ale **w ekosystemie PL**:
- Konektor mcp-saos zwraca pelne brzmienie orzeczenia
- ISAP / EUR-Lex API zwraca pelne brzmienie artykulu
- Parsed PDF/DOCX w projekcie ma pelny indeks tekstu

NIE wymyslamy mechanizmu - cherry-pick **wzorca** Lavern (preflight
verifier przed zwrotem), polonizacja **zrodel** (SAOS, ISAP, EUR-Lex,
client docs).

## Rozwazane sciezki

### Wariant A - wierzymy LLM ("Cytat jest dokladny, bo LLM tak napisal")

Pomysl: trust the model. Nowsze LLM (Claude 4.x, Gemini 2.5 Pro)
maja mniejszy hallucination rate. Mozna polegac.

**Problemy**:
- Polski legal corpus ma **nizsza reprezentacje** w training data
  niz US/UK. Halucynacje sygnatury orzeczen polskich sa **czestsze**
  niz dla US case law. Anegdotyczne (czat z aplikantami pilotazu)
  i empiryczne (Lavern dokumentuje fail rate ~3-5% nawet dla US case)
- Pojedyncza halucynacja sygnatury moze kosztowac dyscyplinarne
  prawnikowi - Patron jako narzedzie kancelaryjne nie moze
  generowac takiego ryzyka
- Konstytucja Art. 2 nie pozwala na "trust the model" jako default

**Odrzucony**.

### Wariant B - human-review wszystkich cytatow (prawnik klika kazdy cytat manualnie)

Pomysl: Patron zwraca odpowiedz, prawnik w UI klika kazdy cytat,
otwiera zrodlo, sam weryfikuje.

**Problemy**:
- Cognitive load enormous. 50 cytatow w opinii = 50 klikniec
- Cel Patrona (oszczednosc czasu prawnika) ginie
- Konstytucja Art. 7 (minimalnosc danych) - cykl "Patron generuje +
  prawnik recznie weryfikuje kazdy cytat" mnozy przerob danych ponad
  konieczne minimum dla wynikow uzytkowych

**Odrzucony jako default**, ale **zachowany jako uzupelnienie** -
flaga "unverified" widoczna w UI to wlasnie zaproszenie do manualnej
weryfikacji (dla 5-10% cytatow, ktore nie przeszly fuzzy match).

### Wariant C - mechaniczna preflight weryfikacja przed zwrotem (WYBRANY)

Pomysl: Patron zwraca cytat dopiero po fuzzy string-match z zrodlem.
Jezeli match < 0.95 - flaga w UI. Jezeli zrodlo nie istnieje - blok.

**Plusy**:
- Deterministyczne (ta sama odpowiedz LLM weryfikowana jest zawsze
  tak samo)
- Niski koszt latency (~200-500 ms dla 5 cytatow w odpowiedzi)
- Konstytucja Art. 2 spelniona **technicznie**, nie tylko
  deklaratywnie
- UI prawnika dostaje **3-stopniowy signal**: zatwierdz / unverified
  / blok - prawnik wie, ktore cytaty wymagaja manualnej weryfikacji
- Audit bundle (ADR-0006) zawiera log weryfikacji - dowod
  w razie reklamacji

**Wybrany**.

## Konsekwencje

### Plusy

- Konstytucja Art. 2 spelniona technicznie
- Halucynacje sygnatury orzeczen wykrywane preflight, nie post-hoc
- Konektor mcp-saos staje sie **double-duty** - dostarcza cytat
  prawnikowi i jednoczesnie sluzy weryfikacji
- Pattern transparentny dla prawnika ("Patron zweryfikowal 8 z 10
  cytatow. 2 oznaczone jako 'unverified' - kliknij, by sprawdzic")
- Audit log moze trzymac dowod weryfikacji (cytat + match_score +
  zrodlo_url + timestamp)

### Minusy i ograniczenia

- **Latency +200-500 ms per response z cytatami** (fuzzy match 5
  cytatow * 100 ms = 500 ms). Akceptowalne (single-pass czat = 5-10s,
  weryfikacja to <10% narzutu)
- **Cache cytatow** wymagany - jezeli kazdy cytat pobiera orzeczenie
  z SAOS na nowo, to za drogo. Mitigation: Redis / Postgres cache
  parsed orzeczen, TTL 7 dni
- **Fuzzy threshold 0.95** to arbitralny wybor. Mitigation: pierwsze
  100 cases pilotazu zbiera dane "ktore matche byly poprawnie
  oznaczone unverified, ktore false-positive". Dostrajamy threshold
  po pilotazu
- **Cytaty parafrazowane intencjonalnie** (np. "Sad orzekl, ze X
  oznacza Y" - to nie doslowny cytat, to streszczenie) - parser musi
  rozrozniac. Wymaga prompt-discipline: LLM cytuje w cudzyslowie tylko
  doslownie. Jezeli streszcza - bez cudzyslowia. Match wykonujemy
  tylko dla tekstu w cudzyslowach
- **Cytaty z orzeczen, ktore nie sa w SAOS** (np. niepublikowane,
  z papierowych zbiorow, kserowka od klienta) - nie da sie zweryfikowac
  mechanicznie. Mitigation: flaga "unverified - zrodlo niedostepne",
  prawnik widzi powod (nie blad LLM, tylko luka w zrodlach)
- **Nowy single point of failure** - jezeli SAOS API jest down, Patron
  nie zwroci odpowiedzi z cytatami? Mitigation: cache-first +
  degradacja "Patron nie mogl zweryfikowac cytatow (SAOS unavailable).
  Wszystkie cytaty oznaczone unverified"

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump 1.1.0 -> 1.2.0** planowany
  PO wpieciu warstwy do produkcji (laczy sie z bumpem z ADR-0003 i
  ADR-0004). Tymczasowo Art. 2 dostaje w sekcji "Mechanizmy techniczne"
  punkt `(planowane Faza 5) mechaniczna weryfikacja cytatow preflight`
- **Schema SQL** - nowa tabela `citation_verification` z polami
  `citation_id`, `response_id`, `source_type` (saos / isap / eurlex /
  client_doc), `source_url`, `quoted_text`, `parsed_text`,
  `match_score`, `decision` (verified / unverified / blocked)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie.
  Verifier dziala na **strumieniu wyjsciowym** (gdy LLM emituje fragment
  z cytatem, verifier sprawdza inline) albo **post-stream** (caly
  output, potem weryfikacja per cytat)

## Plan migracji 6-tygodniowy

### Tydzien 1 - parser cytatow + cache

- [ ] `backend/src/lib/citation/parser.ts` - regex + LLM-assisted parser
      do wyciagania cytatow z odpowiedzi Patrona
- [ ] `backend/src/lib/citation/cache.ts` - cache parsed orzeczen
      (Redis lub Postgres, TTL 7 dni)
- [ ] Testy parsera: 20 cases (cytat z sygnatura, cytat doslowny,
      streszczenie bez cytatu, cytat z dokumentu klienta)

### Tydzien 2 - fuzzy matcher + integracja z mcp-saos

- [ ] `backend/src/lib/citation/verifier.ts` - fuzzy string-match
      (Levenshtein normalized, threshold 0.95)
- [ ] Integracja z mcp-saos: nowe wywolanie `fetchOrzeczeniePelne(sygnatura)`
- [ ] Audit log event_type `citation.verified`,
      `citation.unverified`, `citation.blocked`

### Tydzien 3 - integracja z ISAP / EUR-Lex

- [ ] mcp-isap nowy konektor (jezeli jeszcze nie istnieje)
- [ ] mcp-eurlex juz istnieje (skill eu-sparql-search) - wywolanie
      `fetchArtykul(eli_url)`
- [ ] Testy: cytaty z KC, KPC, KK + cytaty z dyrektyw UE

### Tydzien 4 - UI flagi unverified / blocked

- [x] `AssistantMessage` - badge per cytat: zielony (verified),
      bursztynowy (unverified, sprawdz zrodlo), czerwony (blocked,
      Patron nie potwierdzil cytatu) - zrealizowane w ADR-0065
- [x] Pierwszy widok 3-stopniowy signal w czacie - ADR-0065

### Tydzien 5 - cytaty z dokumentow klienta

- [ ] Integracja z `lib/docparse.ts` - parsed PDF/DOCX indeksowany
      w pamieci dla projektu
- [ ] Cytat z dokumentu = direct string-match z indeksem

### Tydzien 6 - pilotaz + threshold tuning

- [ ] Wlacz preflight verifier dla pierwszej kancelarii pilotazowej
- [ ] Zbieraj metryki: ile cytatow verified / unverified / blocked,
      ile false-positive (zglosza prawnicy)
- [ ] Po 100 cytatach: tune threshold 0.95 (moze podniesc do 0.97
      albo opuscic do 0.92)

## Status weryfikacji

Wdrozenie 2026-05-29 (poziom 1 - dokumenty klienta) ODBIEGA od planu 6-tyg
blueprintu i jest prostsze - wykorzystano istniejaca infrastrukture Patrona:

- [x] Modul `backend/src/lib/citation/grounding.ts` - czysty deterministyczny
      weryfikator (`verifyCitations` / `verifyOne` / `normalize`). Zamiast
      osobnego parser.ts: reuzyto istniejacy `chat/citations.ts parseCitations`
      (blok `<CITATIONS>` jest juz ustrukturyzowany - LLM-assisted parser zbedny)
- [x] Fuzzy matcher (Levenshtein znormalizowany). UWAGA: prog **0.15 edit-ratio**
      (segmenty cytatu), nie 0.95 similarity - rownowaznie, ale liczone od
      roznicy. Odroznia literowke (ZMODYFIKOWANY) od podmiany slowa (NIEZWERYFIKOWANY)
- [x] Warstwa wpiecia `backend/src/lib/chat/ground-citations.ts` - prefetch
      tekstu raz na doc_id + synchroniczny resolver na mapie
- [x] Cache: NIE potrzebny dla poziomu 1 - tekst dokumentu klienta czytany
      lokalnie przez `getDocumentTextForGrounding` (reuse read_document, offline).
      Cache parsed orzeczen wroci dla poziomu 2 (SAOS przez siec)
- [x] Wpiecie w `chat/stream.ts` - werdykt w evencie SSE `citations` (pole `grounding`)
- [x] 21 testow (15 verifier + 6 wiring) + eval harness LEDGAR (351 case),
      725/730 vitest pass, tsc clean
- [ ] Integracja z mcp-saos (poziom 2 - orzeczenia) - resolver dopinany analogicznie
- [ ] Integracja z mcp-isap / mcp-eurlex (poziom 3 - przepisy)
- [x] UI badge per cytat (verified / unverified / blocked) w `AssistantMessage.tsx`
      + i18n - **ADR-0065**
- [x] Persystencja werdyktu na reload (extractAnnotations -> citation_data) - **ADR-0065**
- [x] Audit: podsumowanie grounding w payloadzie `chat.message.assistant` (zamiast
      3 osobnych event_type - odstepstwo udokumentowane w **ADR-0065**)
- [x] Decyzja: cache - zbedny dla dokumentow klienta (offline), patrz wyzej
- [ ] Decyzja Wieslawa: czy `blocked` (NIEZWERYFIKOWANY/BRAK_ZRODLA) ma TWARDO
      blokowac render cytatu, czy tylko czerwona flaga. Obecnie: tylko sygnal
      w evencie, render decyduje UI (rekomendacja: flaga czerwona, nie blok -
      prawnik widzi ze Patron nie potwierdzil, sam decyduje)

## Licencja blueprintu

Lavern jest **Apache 2.0**. Cherry-pick **wzorca** (preflight
mechanical verifier z fuzzy match) nie jest derivative work. Patron
**implementuje od zera** w ekosystemie konektorow PL (SAOS / ISAP /
EUR-Lex), nie portuje kodu Lavern. Linkujemy w
`THIRD_PARTY_INSPIRATIONS.md` jako blueprint.
