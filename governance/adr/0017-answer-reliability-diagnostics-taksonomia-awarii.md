# ADR-0017: Diagnostyka wiarygodnosci odpowiedzi (taksonomia awarii + runtime gate dla prawnika)

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-22
**Powiazane zasady**: Konstytucja AI Patrona, Art. 6 (granica bledu /
human-in-the-loop - Patron sygnalizuje "nie jestem pewien" zamiast generowac
pewna-ale-nieugruntowana odpowiedz), Art. 2 (weryfikowalnosc - diagnostyka
agreguje sygnaly weryfikacji), Art. 3 (audytowalnosc - klasyfikacja awarii laduje
do audit bundle jako artefakt AI Act art. 12), Art. 7 (minimalnosc - sygnaly
deterministyczne tam gdzie sie da, LLM-klasyfikacja tylko jako uzupelnienie)
**Powiazane ADR**: ADR-0005 (citation grounding - dostarcza verification rate),
ADR-0007 (hybrid retrieval - dostarcza coherence/score sygnaly), ADR-0016
(reasoning trace - dostarcza integralnosc sciezki), ADR-0006 (audit bundle -
diagnostyka tam laduje), ADR-0004 (debate high-stakes - eskalacja przy niskiej
wiarygodnosci), wzorzec architektoniczny
[awesome-llm-apps / rag_failure_diagnostics_clinic](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/rag_tutorials/rag_failure_diagnostics_clinic)
(Apache 2.0)

## Decyzja

Patron wprowadza **warstwe diagnostyki wiarygodnosci odpowiedzi** dzialajaca na
poziomie **calej odpowiedzi** (nie pojedynczego cytatu jak ADR-0005, nie hopa jak
ADR-0016). Warstwa pelni dwie role:

1. **Runtime gate dla prawnika** (Art. 6) - przed pokazaniem odpowiedzi agreguje
   sygnaly i przypisuje **klase wiarygodnosci** (`wysoka` / `ograniczona` /
   `niska`). Przy `niska` Patron NIE udaje pewnosci - jawnie komunikuje powod
   ("nie znalazlem zrodel dla 2 z 5 tez", "zrodla sa sprzeczne", "wszystkie
   cytaty unverified") i proponuje dzialanie (zawez zapytanie / dodaj dokument /
   eskaluj do debate ADR-0004).

2. **Klasyfikacja awarii do audytu** (Art. 3) - jezeli odpowiedz jest slaba,
   diagnostyka dopasowuje ja do **taksonomii trybow awarii PL legal** i zapisuje
   wynik do audit bundle (ADR-0006). To daje dev/ops + Inspektorowi material do
   post-mortem ("dlaczego Patron zawiodl na tym zapytaniu").

```
odpowiedz LLM + kontekst retrievalu
  -> [sygnaly deterministyczne]:
       citation_verification_rate (ADR-0005: ile cytatow verified / total)
       retrieval_coherence (ADR-0007: rozrzut score top-k, czy spojne)
       source_agreement (czy zrodla sie zgadzaja czy przecza)
       trace_integrity (ADR-0016: ile hopow verified)
       coverage (ile tez odpowiedzi ma pokrycie w zrodle)
  -> [agregacja -> klasa wiarygodnosci wysoka/ograniczona/niska]
  -> jezeli niska: [dopasowanie do taksonomii awarii PL legal]
  -> [runtime signal dla prawnika] + [zapis do audit bundle]
```

## Kontekst

Demo `rag_failure_diagnostics_clinic` z awesome-llm-apps (Apache 2.0) pokazuje
pattern **klasyfikacji awarii RAG wg taksonomii** - 12 trybow (hallucination /
chunk boundary / embedding mismatch / index staleness / router misalignment /
multi-step drift / tool misuse / memory loss / config drift / multi-tenant
interference / eval blind spots). Wg README demka: LLM dopasowuje opis buga do
jednego wzorca glownego + kandydatow pobocznych, zapisuje JSON do post-mortem.
Wg README demka: **narzedzie dev-time** (triage incydentow), single-file CLI na
gpt-4o, lokalny/Colab demo - **nie runtime gate** i **nie produkcyjne**
(wszystkie te cechy demka niezweryfikowane przez nas poza odczytem README).

Patron ma dzis wszystkie sygnaly OPROCZ warstwy, ktora je **agreguje i komunikuje
prawnikowi**:
- ADR-0005 mowi "ten cytat verified/unverified/blocked" - per cytat, nie per
  odpowiedz
- ADR-0007 ma score retrievalu - ale nie ocenia, czy CALA odpowiedz jest dobrze
  ugruntowana
- ADR-0016 weryfikuje hopy - ale tylko dla zapytan multi-hop

Brakuje **odpowiedzi na pytanie prawnika: czy moge tej odpowiedzi zaufac**. Dzis
Patron pokaze rownie pewnie odpowiedz z 5/5 verified cytatami i odpowiedz z 1/5 -
prawnik nie widzi roznicy bez recznego sprawdzania kazdego cytatu.

Wartosc dodana dla polskiej kancelarii (czego demo NIE ma):

- **Runtime gate, nie dev triage** (Art. 6). Demo diagnozuje bug po fakcie.
  Patron sygnalizuje niska wiarygodnosc **zanim** prawnik oprze sie na odpowiedzi.
  To rdzen Konstytucji Art. 6 (granica bledu) - lepiej "nie jestem pewien" niz
  pewna halucynacja, ktora prawnik wniesie do pisma
- **Taksonomia PL legal**, nie 12 generycznych wzorcow IT. Tryby istotne dla
  kancelarii: `brak_zrodla_w_SAOS` (orzeczenie niepublikowane), `zrodla_sprzeczne`
  (dwa orzeczenia przeciwne), `cytat_unverified` (ADR-0005 nie potwierdzil),
  `przepis_nieaktualny` (cytowany przepis uchylony/zmieniony), `pokrycie_czesciowe`
  (czesc tezy bez zrodla), `sygnatura_nieistniejaca`. Mapowanie do AI Act art. 12
- **Sygnaly deterministyczne first** (Art. 7 + Art. 3). Demo polega na
  LLM-klasyfikacji. Patron liczy wiekszosc sygnalow deterministycznie
  (verification rate, coherence, coverage to liczby z istniejacych warstw),
  LLM-klasyfikacja tylko dla `source_agreement` (czy zrodla sie merytorycznie
  zgadzaja - tu regex nie wystarczy). Determinizm = audyt reprodukowalny
- **Eskalacja do debate** (ADR-0004). Niska wiarygodnosc na zapytaniu high-stakes
  moze wyzwolic pipeline debate zamiast zwracac slaba odpowiedz

## Rozwazane sciezki

### Wariant A - brak warstwy diagnostyki (status quo)

Pomysl: ADR-0005 flaguje cytaty, prawnik sam ocenia calosc.

**Plusy**: zero nowego kodu.

**Minusy**:
- Cognitive load - prawnik agreguje sygnaly w glowie (5 cytatow, 3 verified,
  2 unverified - czy ufac calosci?). Cel Patrona (oszczednosc czasu) cierpi
- Konstytucja Art. 6 spelniona slabo - Patron nie ma jednego, czytelnego
  sygnalu "ta odpowiedz jest watpliwa"
- Brak materialu post-mortem - audit bundle ma cytaty, nie diagnoze awarii

**Odrzucony**.

### Wariant B - LLM-only klasyfikacja (kopia demka)

Pomysl: po wygenerowaniu odpowiedzi pytamy drugi LLM "oceń wiarygodnosc tej
odpowiedzi wg taksonomii".

**Plusy**: prosty, blisko demka, elastyczny.

**Minusy**:
- Konstytucja Art. 3 - LLM-klasyfikacja nieodtwarzalna (temperature, wersja
  modelu). Audyt "dlaczego Patron oznaczyl niska wiarygodnosc" nie jest
  reprodukowalny
- Konstytucja Art. 7 - dodatkowe wywolanie LLM per odpowiedz (koszt + latency)
  gdy wiekszosc sygnalow da sie policzyc deterministycznie
- Ryzyko - LLM oceniajacy wlasna (albo bratniego modelu) odpowiedz ma bias
  (over-confidence). Sygnal deterministyczny "2/5 cytatow unverified" jest twardy

**Odrzucony jako default**, komponent LLM zachowany TYLKO dla `source_agreement`.

### Wariant C - sygnaly deterministyczne + LLM tylko dla agreement + runtime gate (WYBRANY)

Pomysl: agregacja deterministycznych sygnalow (verification rate, coherence,
coverage, trace integrity) w klase wiarygodnosci; LLM-klasyfikacja tylko dla
sprzecznosci zrodel; runtime gate komunikuje prawnikowi; taksonomia awarii do
audytu.

**Plusy**:
- Konstytucja Art. 6 mocno (jeden czytelny sygnal + proponowane dzialanie)
- Konstytucja Art. 3 mocno (wiekszosc sygnalow deterministyczna, audyt
  reprodukowalny; LLM-agreement logowany z modelem+wersja)
- Konstytucja Art. 7 (1 wywolanie LLM tylko gdy potrzeba ocenic agreement,
  nie zawsze)
- Reuse istniejacych warstw (0005, 0007, 0016) - diagnostyka konsumuje ich
  output, nie liczy od nowa
- Eskalacja do debate (ADR-0004) zamiast zwracania slabej odpowiedzi

**Minusy**:
- Progi agregacji (kiedy `niska` vs `ograniczona`) arbitralne na starcie -
  **walidacja T3** na pilotazu
- `source_agreement` przez LLM ma koszt latency dla zapytan z wieloma zrodlami -
  liczony tylko gdy >=2 zrodla i wstepne sygnaly nie sa juz jednoznacznie niskie

**Wybrany**.

## Konsekwencje

### Plusy

- Prawnik dostaje jeden czytelny sygnal wiarygodnosci + powod + dzialanie (Art. 6)
- Audit bundle wzbogacony o diagnoze awarii (Art. 3, material post-mortem)
- Wiekszosc sygnalow deterministyczna - reprodukowalna w audycie
- Reuse 0005/0007/0016 - zero duplikacji liczenia
- Most do debate (ADR-0004) dla high-stakes z niska wiarygodnoscia

### Minusy i ograniczenia

- **Progi agregacji arbitralne** - default `wysoka` (verification_rate >= 0.9 AND
  coverage >= 0.8 AND brak sprzecznosci), `niska` (verification_rate < 0.6 OR
  coverage < 0.5 OR sprzecznosc), reszta `ograniczona`. Liczby **do walidacji T3**
  na 100 odpowiedziach pilotazu
- **source_agreement** wymaga LLM - latency + koszt. Mitigation: liczony
  warunkowo (>=2 zrodla, sygnaly wstepne niejednoznaczne)
- **Ryzyko nadmiernej ostroznosci** - zbyt czule progi = Patron za czesto mowi
  "niska wiarygodnosc", prawnik przestaje ufac sygnalowi (efekt falszywego
  alarmu - sygnal nagminny staje sie ignorowany). Mitigation:
  kalibracja na pilotazu, docelowy wskaznik falszywych alarmow **do walidacji T3**
- **Taksonomia PL legal niepelna na starcie** - 6 trybow MVP, rozszerzana wg
  realnych awarii z pilotazu (versioning pliku taksonomii w repo)
- **Nie zastepuje prawnika** - sygnal `wysoka` NIE znaczy "mozesz nie czytac".
  Konstytucja Art. 6 - human-in-the-loop pozostaje; to wskazowka, nie zwolnienie
  z odpowiedzialnosci. Komunikat UI musi to jasno stawiac

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump** wspolny z warstwa jakosci (laczy
  sie z 0004/0005/0006). Art. 6 dostaje w "Mechanizmy techniczne" punkt
  `(planowane Faza 5) diagnostyka wiarygodnosci odpowiedzi z runtime gate`
- **Schema SQL** - tabela `answer_reliability` (kolumny: `response_id`,
  `reliability_class` ENUM (`wysoka`/`ograniczona`/`niska`), `verification_rate`
  FLOAT, `retrieval_coherence` FLOAT, `coverage` FLOAT, `trace_integrity` FLOAT,
  `source_agreement` ENUM (`zgodne`/`sprzeczne`/`nieoceniane`), `failure_pattern`
  TEXT NULL, `created_at`). FK do `citation_verification` (ADR-0005)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie. Diagnostyka
  dziala **post-generation** (po skompletowaniu odpowiedzi, przed pokazaniem)
- **Plik taksonomii** - `backend/src/lib/diagnostics/failure-taxonomy-pl.json`
  (versionowany, 6 trybow MVP)

## Plan migracji (szacunek ~3-4 tygodnie, PO ADR-0005 w produkcji)

> Twarda zaleznosc: ADR-0017 konsumuje verification rate (ADR-0005) i score
> retrievalu (ADR-0007). NIE startuje przed nimi.

### Tydzien 1 - agregator sygnalow deterministycznych

- [ ] `backend/src/lib/diagnostics/signals.ts` - liczy verification_rate (z
      ADR-0005), retrieval_coherence (rozrzut score z ADR-0007), coverage
      (ile tez ma cytat-zrodlo), trace_integrity (z ADR-0016 jezeli multi-hop)
- [ ] Testy: 20 odpowiedzi syntetycznych z roznymi profilami sygnalow

### Tydzien 2 - klasyfikator wiarygodnosci + taksonomia PL

- [ ] `backend/src/lib/diagnostics/classifier.ts` - agregacja -> klasa
      (progi z `.env`, default jak w Konsekwencjach)
- [ ] `failure-taxonomy-pl.json` - 6 trybow MVP (brak_zrodla_w_SAOS /
      zrodla_sprzeczne / cytat_unverified / przepis_nieaktualny /
      pokrycie_czesciowe / sygnatura_nieistniejaca)
- [ ] LLM-klasyfikacja `source_agreement` warunkowa (>=2 zrodla)

### Tydzien 3 - runtime gate + audit bundle

- [ ] Wpiec gate przed zwrotem odpowiedzi: przy `niska` doloz komunikat +
      proponowane dzialanie (zawez / dodaj dokument / eskaluj debate ADR-0004)
- [ ] Migracja Postgres: tabela `answer_reliability`
- [ ] Audit bundle (ADR-0006): zapis diagnozy, objety hash-chain (ADR-0001)

### Tydzien 4 - UI sygnal + kalibracja

- [ ] Frontend: badge wiarygodnosci (zielony/zolty/czerwony) + rozwijany powod
- [ ] i18n: klucze PL PRZED komponentem (regula AGENTS.md)
- [ ] Komunikat UI: "wysoka" NIE zwalnia z czytania (Art. 6)
- [ ] Zbiorka metryk pilotazu do kalibracji progow (**walidacja T3**)

## Status weryfikacji

- [ ] Agregator sygnalow deterministycznych (T1)
- [ ] Klasyfikator + taksonomia PL (T2)
- [ ] LLM source_agreement warunkowy (T2)
- [ ] Runtime gate + audit bundle (T3)
- [ ] UI badge + komunikat Art. 6 (T4)
- [ ] Kalibracja progow na 100 odpowiedziach pilotazu (T3)
- [ ] Decyzja Wieslawa: progi default wiarygodnosci (rekomendacja jak w
      Konsekwencjach, dostroic po pilotazu)
- [ ] Decyzja Wieslawa: czy `niska` wiarygodnosc na high-stakes auto-eskaluje
      do debate (ADR-0004) czy tylko proponuje prawnikowi
- [ ] Decyzja Wieslawa: target false-alarm rate (jak czule progi, balans
      "ostroznosc vs efekt falszywego alarmu")

## Licencja blueprintu

Demo `rag_failure_diagnostics_clinic` jest czescia repo awesome-llm-apps na
licencji **Apache 2.0**. Cherry-pick **wzorca** (klasyfikacja awarii wg
taksonomii + strukturalny zapis do post-mortem) NIE jest derivative work.
Patron implementuje od zera:

- **Taksonomia PL legal** (brak_zrodla_w_SAOS / zrodla_sprzeczne /
  przepis_nieaktualny...), NIE 12 generycznych trybow IT demka
- **Runtime gate dla prawnika** (Art. 6) - demo to dev-time triage po fakcie,
  Patron sygnalizuje wiarygodnosc przed oparciem sie na odpowiedzi
- **Sygnaly deterministyczne first** (Art. 3/7) - demo polega na LLM-klasyfikacji,
  Patron liczy wiekszosc deterministycznie z istniejacych warstw (0005/0007/0016)
- **Integracja z audit bundle** (ADR-0006) + hash-chain (ADR-0001) + eskalacja
  debate (ADR-0004) - demo zapisuje plaski JSON
- **Stack**: TypeScript/Postgres, Ollama lokalnie dla source_agreement (Art. 1),
  NIE Python/gpt-4o (wg README demka)

**NIE portujemy** kodu Python/CLI demo. Linkujemy w
`THIRD_PARTY_INSPIRATIONS.md` jako blueprint.
