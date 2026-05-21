# ADR-0008: Entity extraction przy zapisie, zero wywolan LLM

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona, Art. 1 (lokalnosc - ekstrakcja
encji nie wysyla danych do LLM zewnetrznego), Art. 3 (audytowalnosc - deterministyczna
ekstrakcja = przewidywalna, AI Act art. 12), Art. 7 (minimalnosc - encje znane,
nie generujemy ich), Art. 4 (neutralnosc dostawcow - ekstrakcja nie zalezy od
zadnego dostawcy LLM)
**Powiazane ADR**: ADR-0007 (hybrid retrieval - graf zasilany ekstrakcja),
ADR-0003 (pseudonimizacja - wykorzystuje te same regexy PESEL/NIP/KRS),
wzorzec architektoniczny [garrytan/gbrain](https://github.com/garrytan/gbrain)
(MIT)

## Decyzja

Patron przy **kazdym zapisie dokumentu** (PDF/DOCX klienta, notatka prawnika,
odpowiedz Patrona z cytatami) uruchamia **deterministyczna warstwe ekstrakcji
encji**, ktora:

1. **Wyciaga encje** typu: sygnatura orzeczenia, strona postepowania (imie/nazwa
   firmy), pelnomocnik, sad, data publikacji, sygnatura aktu prawnego, numer
   sprawy klienta, sygnatura wewnetrzna kancelarii.
2. **Tworzy typed links** (krawedzie grafu, ADR-0007 `citation_graph`):
   `cytuje_orzeczenie`, `strona_postepowania`, `reprezentuje`,
   `wzorzec_aneksowany`, `derywat_pisma`, `przed_sadem`.
3. **Zero wywolan LLM** - cala ekstrakcja przez regex + gazetteer + checksumy
   (PESEL algorytm wag 1-3-7-9 modulo 10, NIP modulo, REGON algorytm Pl, KRS format).

```
zapis_dokumentu -> [parser PDF/DOCX]
                -> [regex pass: sygnatury, ID, daty]
                -> [gazetteer pass: nazwy sadow, kancelarii, znanych firm KRS]
                -> [checksum walidacja: PESEL/NIP/REGON]
                -> [krawedzie do citation_graph]
                -> [audit log event: entities.extracted]
```

Encje "zmieckie" (czy ten ciag znakow to imie osoby? czy to nazwa kancelarii?)
**NIE** sa rozstrzygane przez LLM przy zapisie. **Mitigation**:
- Imiona i nazwiska osob sa juz wykrywane przez warstwe pseudonimizacji
  (ADR-0003, regex + opcjonalny LLM-fallback Ollama). Patron reuse'uje wynik
  warstwy pseudonim do grafu (jezeli pseudonimizacja zidentyfikowala
  `[PERSON_3] = "Jan Kowalski"`, graf dostaje `strona_postepowania:
  Jan Kowalski`).
- Encje budzace watpliwosc oznaczamy `confidence: low` w grafie, prawnik moze
  je potwierdzic lub odrzucic w UI.

## Kontekst

gbrain pokazuje pattern **entity extraction at write-time, zero LLM calls**
jako fundament dlaczego retrieval w gbrain jest **2.6x tanszy** niz OpenAI
(wg benchmark gbrain README). Argument: jezeli kazdy zapis musialby
wywolac LLM (NER, relation extraction), koszt eksploduje liniowo z
liczba dokumentow. Determinizm + regex + gazetteer rozwiazuje 80% przypadkow
za 0 tokenow.

Dla Patrona **ten sam argument dziala mocniej**:

- **Konstytucja Art. 1** - jezeli ekstrakcja encji wymaga LLM, to kazdy
  zapis dokumentu klienta to wywolanie poza lokalna granica RODO. Albo
  Ollama lokalny (wolny, 2-5s per dokument), albo chmura (RODO red flag).
  **Determinizm = zero takiego ryzyka**.

- **Konstytucja Art. 3** - audyt ekstrakcji deterministycznej jest
  reprodukowalny ("ten regex na tym tekscie zawsze zwraca te encje").
  Audyt ekstrakcji LLM jest **nieodtwarzalny** (temperature, seed, wersja
  modelu zmienia wyniki).

- **Domena PL legal ma idealny profil dla ekstrakcji deterministycznej**:
  - Sygnatury orzeczen maja **scisly format** ("III CZP 11/13",
    "II SA/Wa 1234/24", "K 12/19" - regex tryb)
  - PESEL/NIP/REGON/KRS - **checksumy matematyczne** (PESEL wagi
    1-3-7-9 mod 10, NIP wagi 6-5-7-2-3-4-5-6-7 mod 11, REGON wagi
    rozne dla 9 i 14 cyfr, KRS 10-znakowy format walidowany regexem),
    false-positive rate niska (**do walidacji T1** benchmarkiem na
    realnym korpusie)
  - Nazwy sadow - **zamknieta lista** (~150 sadow + KIO + KNF + UODO + ...)
  - Sygnatury aktow prawnych - CELEX (EU), ELI (PL Sejm) - **formaty
    publikowane**

Anglosaska semantyka legal (US/UK) ma o wiele mniej "wlocznych" wzorcow
(case names varianty - "Roe v. Wade" vs "Roe v Wade" vs "Roe vs. Wade"
vs "410 U.S. 113"). Polski legal jest **lepiej dopasowany** do ekstrakcji
deterministycznej niz US, ktory inspirowal gbrain.

## Rozwazane sciezki

### Wariant A - ekstrakcja przez LLM przy zapisie ("inteligentnie")

Pomysl: kazdy zapis -> Patron pyta LLM "wymien encje w tym dokumencie".

**Problemy**:
- **Koszt** - liniowy z liczba dokumentow. 100 PDFow po 50 stron = 100
  duzych prompt'ow = $$$, nawet na tanim modelu (Gemini Flash, Claude
  Haiku) to znaczacy fixed cost dla solo prawnika
- **Latency** - kazdy upload PDF = 5-30s czekania zanim Patron zapisze.
  UX gorszy niz dziesieciokrotnie
- **Konstytucja Art. 1** - albo Ollama lokalny (wolny) albo chmura
  (red flag RODO dla aktow klienta)
- **Konstytucja Art. 3** - LLM ekstrakcja nieodtwarzalna w audycie

**Odrzucony**.

### Wariant B - ekstrakcja deterministyczna + LLM tylko dla "zmieckich" przypadkow

Pomysl: regex/gazetteer dla 80% (sygnatury, ID, daty), LLM-fallback dla
20% (imiona osob bez kontekstu).

**Plusy**: kompromis koszt vs jakosc.

**Minusy**:
- Trudna granica decyzyjna "kiedy odpalamy LLM" - latwo rozjechac sie
  w stronep "kazdy zapis konczy LLM-em" (drift)
- 80/20 dla domeny PL legal moze byc nawet **95/5** (skali wlosnej PL
  legal sa lepiej zdefiniowane niz US, **do walidacji T2**)
- Patron juz ma LLM-fallback W INNEJ warstwie - ADR-0003 (pseudonimizacja).
  Mozemy **reuseowac** wynik tamtej warstwy zamiast osobnego wywolania
  LLM dla grafu

**Odrzucony jako default**, ale komponent "reuse wyniku pseudonim"
**zachowany** w wariancie C.

### Wariant C - ekstrakcja deterministyczna + reuse pseudonim-PII output (WYBRANY)

Pomysl: regex/gazetteer dla wszystkich encji "twardych" (sygnatury, ID,
daty, nazwy sadow). Imiona/nazwy firm reuse'ujemy z **wyniku warstwy
pseudonim** (ADR-0003), ktora juz LLM-falluje opcjonalnie. Jezeli kancelaria
ma warstwe pseudonim wlaczona - imiona dostajemy "za darmo" (juz placilismy
LLM za pseudonimizacje, graf piggybackuje).

**Plusy**:
- **Zero dodatkowych wywolan LLM** dla grafu - reuse istniejacej warstwy
- Konstytucja Art. 1, 3, 7 spelnione mocno
- Pattern gbrain "zero LLM calls" zachowany
- Dwie warstwy (pseudonim + graf) korzystaja z **tej samej** shared
  library `backend/src/lib/pl-entities/` (regex + gazetteer + checksumy)
  - jeden punkt utrzymania regexow PL, jedno zrodlo prawdy dla checksum,
  jeden audit trail jakosci detekcji

**Minusy**:
- Jezeli kancelaria **wylacza** warstwe pseudonim (niektore moga nie chciec
  - decyzja partnerow), graf traci imiona osob. **Mitigation**: graf nadal
  ma sygnatury, sady, daty, firmy z KRS - **wartosc grafu rozsadna nawet
  bez imion** (PL legal czesto pracuje z firmami KRS, mniej z osobami
  prywatnymi)
- Tight coupling pseudonim <-> graph - zmiana kontraktu warstwy pseudonim
  wymaga revisit grafu. **Mitigation**: zdefiniowac wspolny interfejs
  `ExtractedEntity` w `lib/pl-entities/types.ts`, oba modulu konsumuja

**Wybrany**.

## Konsekwencje

### Plusy

- Konstytucja Art. 1 mocno spelniona (zero LLM zewnetrznego dla ekstrakcji)
- Konstytucja Art. 3 audyt reprodukowalny
- Konstytucja Art. 7 - encje znane bez generacji
- Konstytucja Art. 4 - warstwa niezalezna od dostawcy LLM (nawet w
  konfiguracji bez pseudonim, regex/gazetteer dziala bez LLM-a w ogole)
- Koszt **constant** wzgledem dostawcy LLM dla feature "graf cytowan"
- Latency upload PDF bez narzutu LLM (<200 ms ekstrakcja regex+gazetteer
  na typowym PDF, **do walidacji T1**)
- Shared library `pl-entities` redukuje duplikacje miedzy pseudonim a graf

### Minusy i ograniczenia

- **False-positive rate** regexow - sygnatury wygladaja podobnie do innych
  ciagów (np. "III CZP 11/13" vs "III CZP 11/13" w kontekscie literackim).
  **Mitigation**: walidator kontekstu ("czy w sasiedztwie sa slowa-trigger:
  'sygn. akt', 'wyrok', 'postanowienie'") + `confidence` score per encja
- **Niepelna lista sadow** - gazetteer trzeba utrzymywac. **Mitigation**:
  zrodlo z Ministerstwa Sprawiedliwosci (otwarta lista sadow) +
  versionowanie pliku `gazetteers/sady-pl.json` w repo, update kwartalny
- **Brak ekstrakcji "miekkich" relacji** ("Jan reprezentuje X w sprawie
  Y") - regex tego nie lapie, LLM bylby potrzebny. **Mitigation**: te
  relacje dodawane recznie przez prawnika w UI grafu (planowane Faza 7),
  albo opcjonalna LLM-warstwa z explicit opt-in
- **Gazetteer firm KRS** to setki tysiecy podmiotow - nie pakujemy do
  binary. **Mitigation**: lazy lookup w `mcp-krs` (konektor istnieje
  w stacku Patrona) - przy zapisie ekstrakcja regex `[A-Z][a-z]+ Sp\.
  z o\.o\.` + opcjonalne wywolanie mcp-krs do walidacji KRS, **do
  walidacji T3** czy latency akceptowalne
- **Sygnatury bardzo stare** (przed 2000 r.) maja inny format - rzadkie,
  ale ignorujemy, prawnik moze recznie oznaczyc

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump v1.2.0 -> v1.3.0** wspolny
  z ADR-0007 i ADR-0009. Art. 1 dostaje w "Mechanizmy techniczne" punkt
  `(planowane Faza 6) entity extraction deterministyczna, zero LLM`
- **Schema SQL** - tabela `extracted_entities` (kolumny: `doc_id`,
  `entity_type` ENUM (`sygnatura_orzeczenia` / `pesel` / `nip` / `regon`
  / `krs` / `sad` / `data_publikacji` / `celex` / `eli` / `osoba` /
  `firma`), `value` TEXT, `value_normalized` TEXT, `confidence` FLOAT,
  `source_offset_start` INT, `source_offset_end` INT, `extracted_at` TIMESTAMP)
- **Shared library** `backend/src/lib/pl-entities/` (nowy modul):
  - `regex.ts` - regexy PL legal
  - `gazetteers/sady-pl.json` - lista sadow
  - `gazetteers/sygnatury-prefix.json` - prefixy sygnatur (CZP, SA, OSK...)
  - `checksums.ts` - PESEL algorytm wag 1-3-7-9 modulo 10, NIP modulo, REGON algorithm
  - `extractor.ts` - orkiestracja
  - `types.ts` - interfejs `ExtractedEntity` (kontrakt z pseudonim)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie.
  Ekstrakcja dzieje sie **przed** chatem (przy zapisie dokumentu w
  korpusie), nie w trakcie generacji

## Plan migracji 6-tygodniowy

### Tydzien 1 - shared library `pl-entities` (regex + checksumy)

- [ ] `backend/src/lib/pl-entities/regex.ts` - sygnatury orzeczen
      (sady powszechne, administracyjne, SN, TK, KIO, NSA, KIO/UZP)
- [ ] `backend/src/lib/pl-entities/checksums.ts` - PESEL algorytm wag 1-3-7-9 modulo 10, NIP modulo,
      REGON 9/14, KRS format check
- [ ] Testy: 50 cases z realnych dokumentow (anonimizowanych)
- [ ] Wspolne uzycie z ADR-0003 pseudonimizacja - refactor patron/backend/src/lib/pseudonim/
      zeby reuse'owal `pl-entities/regex.ts` (zamiast wlasnych regexow)
- [ ] Benchmark latency ekstrakcji: target <200 ms dla typowego PDF
      20-50 stron (**walidacja T1**)

### Tydzien 2 - gazetteery (sady, prefixy sygnatur)

- [ ] `gazetteers/sady-pl.json` - 150+ sadow z urzedowego rejestru MS
- [ ] `gazetteers/sygnatury-prefix.json` - mapowanie prefiksow ("III CZP" -> SN
      sprawy cywilne, "II SA/Wa" -> WSA Warszawa, etc.)
- [ ] Test gazetteera: 100 sygnatur losowo, czy rozpoznajemy prawidlowy sad

### Tydzien 3 - graf cytowan extractor + wpiec w upload pipeline

- [ ] `backend/src/lib/retrieval/graph-extractor.ts` (NIE backend graph
      sam w sobie - to ADR-0007; tu logika "ten dokument cytuje to
      orzeczenie / wspomina te strone / dotyczy tego sadu")
- [ ] Wpiec extractora w `lib/docparse.ts` (post-parse hook)
- [ ] Audit log event `entities.extracted` (count per typ + sample)
- [ ] Test na 20 PDF z pilotazu: precision >0.85, recall >0.7
      (**walidacja T2**)

### Tydzien 4 - integracja z warstwa pseudonim (ADR-0003)

- [ ] `lib/pseudonim/orchestrator.ts` zwraca `ExtractedEntity[]` w `output`
- [ ] `graph-extractor.ts` reuse'uje tamten output (zamiast osobnej
      ekstrakcji imion/firm)
- [ ] Test integracyjny: dokument z 5 osobami + 3 firmami + 2 sygnatury -
      graf dostaje 10 encji bez dodatkowego wywolania LLM
- [ ] Decyzja UI: ekstrakcja widoczna prawnikowi (badge przy uploadzie
      "wykryto: 3 sygnatury, 2 firmy") czy tylko w audit bundle

### Tydzien 5 - mcp-krs lookup walidacja firm (opcjonalna)

- [ ] Wywolanie `mcp-krs` przy ekstrakcji firmy (sprawdz czy KRS valid +
      pobierz pelna nazwe)
- [ ] Flag `.env KRS_LOOKUP_ENABLED=true` - opcja (latency +200-500ms na
      firme)
- [ ] Cache wyniku KRS (Postgres 30 dni TTL)
- [ ] Benchmark: PDF z 10 firmami - latency z KRS_LOOKUP=true vs false
      (**walidacja T3**)

### Tydzien 6 - UI grafu + recznia korekta

- [ ] UI panel "encje wykryte w dokumencie" - prawnik moze potwierdzic /
      odrzucic / dodac brakujace
- [ ] Manual corrections trafiaja do `extracted_entities` z `source=manual`
- [ ] Pierwszy widok grafu (3-warstwowy: dokument -> orzeczenia -> strony)
      dla pilotazowej kancelarii

## Status weryfikacji

- [ ] Shared library `pl-entities/` (regex + checksumy + gazetteery)
- [ ] Refactor pseudonim do uzycia shared library
- [ ] Graph extractor wpiety w upload pipeline
- [ ] Reuse output pseudonim w extractor
- [ ] Opcjonalny mcp-krs lookup z cache
- [ ] UI panel encji + manual corrections
- [ ] Audit log integration
- [ ] Decyzja Wieslawa: gazetteer sadow - update manual quarterly czy
      cron z pobraniem z MS API (jezeli istnieje publiczne)
- [ ] Decyzja Wieslawa: KRS_LOOKUP_ENABLED default - true (jakosc) czy
      false (latency)
- [ ] Decyzja Wieslawa: confidence threshold dla auto-zaakceptowania
      encji w grafie (rekomendacja: 0.8 auto, 0.5-0.8 manual review,
      <0.5 odrzucone)

## Licencja blueprintu

gbrain jest **MIT**. Cherry-pick **wzorca** (entity extraction at write-time,
zero LLM calls + typed links do grafu) NIE jest derivative work. Patron
implementuje od zera w wlasnym ekosystemie:

- **Ontologia legal PL**, nie VC dealflow: typed relations `cytuje_orzeczenie`
  / `strona_postepowania` / `reprezentuje` / `wzorzec_aneksowany` /
  `derywat_pisma` / `przed_sadem` - **zamiast** gbrain `works_at` /
  `invested_in` / `founded` / `advises`
- **Regex i checksumy specyficzne PL** - PESEL algorytm wag 1-3-7-9 modulo 10, NIP modulo, REGON,
  KRS, format sygnatur orzeczen polskich, CELEX, ELI Sejm
- **Gazetteery PL** - sady polskie, prefixy sygnatur, nie persony YC

Linkujemy w `THIRD_PARTY_INSPIRATIONS.md` jako blueprint. **NIE
portujemy** kodu TS gbrain - to YC-VC ontologia, irrelevant dla PL legal.
