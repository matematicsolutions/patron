# ADR-0004: Debate + 3-warstwowa weryfikacja dla zadan high-stakes

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-20
**Powiązane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalność),
Art. 6 (granica błędu, human in the loop), Art. 7 (minimalność danych -
debate przerabia n-krotnie wiecej tokenow niz single-pass, dla zapytan
low-stakes to nadmiar przerobu poza koniecznoscia)
**Powiązane**: ADR-0001 (audit trail), ADR-0005 (citation grounding),
ADR-0006 (audit bundle), wzorzec architektoniczny
[AnttiHero/lavern](https://github.com/AnttiHero/lavern) (Apache 2.0)

## Decyzja

Patron dostaje **opcjonalna warstwe debate + 3-warstwowa weryfikacja**
uruchamiana **wylacznie dla zadan high-stakes** (due diligence, opinia
prawna, M&A, pisma procesowe w toku, draft umowy o wartosci >100k PLN).
Domyslne zapytanie (czat researchowy, draft notatki, podsumowanie
orzeczenia) idzie tradycyjnym pipelinem - bez debate i bez 10-pass
verifier.

Architektura cherry-pickowana z Lavern:

```
[zadanie] -> [klasyfikator high-stakes?] -> ALBO standardowy single-pass
                                          \-> ALBO debate pipeline:
   1. evaluator (drafter)         - generuje pierwszy draft + 3 cytaty
   2. adversarial builder         - buduje 3 najsilniejsze kontrargumenty
   3. attacker                    - punktuje slabosci draftu (pominiete
                                    przepisy, nadmiar uogolnien, brak
                                    cytatu dla kluczowej tezy)
   4. synthesizer                 - integruje krytyke, generuje v2 draftu
   5. 10-pass verifier            - 10 niezaleznych przebiegow na v2
                                    z roznymi seeds, zlicza divergencje
                                    (jezeli > 2 odpowiedzi roznia sie
                                    materialne, output trafia do
                                    human-review z flaga "low-confidence")
```

Klasyfikator high-stakes jest reguly-based (nie LLM): typ_dokumentu IN
('opinia', 'pozew', 'odpowiedz_pozew', 'apelacja', 'kasacja', 'skarga_NSA',
'umowa_M&A', 'umowa_DD', 'umowa_finansowa') OR project.cm_value > 100_000
OR user.explicit_high_stakes_flag.

Brama tokenowa: debate pipeline (drafter + 3 adversarial + synthesizer +
10-pass) wymaga **n-krotnie wiecej tokenow** niz single-pass - wg
[AnttiHero/lavern](https://github.com/AnttiHero/lavern) self-reported
benchmark autora widelki 5-8x, **do walidacji T0** niezaleznym benchmarkiem
na korpusie PL. Robocza domyslna polityka pilotazu: single-pass dla
wiekszosci zapytan, debate dla zadan high-stakes - finalny rozklad
**do walidacji T2** na realnym ruchu kancelarii.

## Kontekst

Konstytucja Art. 2 mowi: **kazda teza Patrona musi byc weryfikowalna**.
Konstytucja Art. 7 (minimalnosc danych) wymaga ograniczenia zakresu
przerobu danych do niezbednego minimum - debate dla wszystkich zapytan
to nadmiar przerobu poza koniecznoscia.

Te dwie zasady stoja w napieciu. Tradycyjny single-pass czat jest
tani, ale slabo weryfikowalny - polega na samym modelu (Claude/Gemini)
i jego cytatach. Lavern pokazuje wzorzec eskalacji: niskie stawki =
tradycyjnie, wysokie stawki = debate + 10-pass verifier.

Patron robi to samo, ale **klasyfikuje stawki reguly-based**, a nie
LLM-based, by uniknac:
- (a) zgadywania klasyfikatora ("ten czat to brzmi powaznie")
- (b) kolejnego wywolania LLM dla samej decyzji "uzyc debate czy nie"
- (c) niedeterminizmu (ta sama umowa raz uznana za high-stakes,
   innym razem nie)

Pattern z Lavern jest **blueprintem, nie implementacja**. NIE bierzemy:
- 67 promptow agentow (anglosaska semantyka US contract review,
  semantyka common law)
- Datasetow CUAD/MAUD/ACORD/UNFAIR-ToS/LEDGAR (irrelevant dla PL)
- Workflow templates contract review (US-centric)
- Brand Clawern / menubar UI

Bierzemy **wzor**:
- 3-fazowy debate (drafter -> adversarial -> synthesizer)
- Brame klasyfikacji high-stakes vs low-stakes
- 10-pass verifier z licznikiem divergencji
- Zasade "low-confidence flag" w UI (Patron nie udaje pewnosci,
  kiedy verifier zlapal rozbieznosci)

Cherry-pick **wzorca architektonicznego, nie kodu** jest utrwalonym
patternem w MateMatic (claude-obsidian, codegraph, spec-kit, hermes,
Hey Jude - patrz `memory/feedback_consolidation_pattern_2026-05-14`
i `memory/reference_narzedzia_oceny_2026-05-14`).

## Rozwazane sciezki

### Wariant A - debate-on-default (kazde zapytanie przez pipeline)

Pomysl: kazde wywolanie LLM przechodzi przez evaluator -> adversarial ->
synthesizer.

**Problemy**:
- Koszt n-krotny (Lavern self-report 5-8x, **do walidacji T0**) dla
  wiekszosci zapytan, ktore tego nie potrzebuja (czat o brzmieniu art.
  415 KC nie potrzebuje 4 agentow)
- Latency: pojedyncze zapytanie rosnie wielokrotnie - dla single-pass
  rzed kilkunastu sekund, dla pelnego pipeline rzed dziesiatek sekund
  (**do walidacji T1** benchmarkiem). UX kancelarii ginie - nikt nie
  czeka tyle na cytat orzeczenia
- Konstytucja Art. 7 (minimalnosc danych) naruszona - nadmiar przerobu
  poza koniecznoscia dla zapytan low-stakes

**Odrzucony**: Patron przestaje byc narzedziem codziennym.

### Wariant B - debate wylacznie dla DD / M&A / kasacji (klasyfikator reguly-based, WYBRANY)

Pomysl: klasyfikator reguly-based (typ_dokumentu + cm_value + explicit_flag)
decyduje, czy uruchamiamy debate. Robocza polityka pilotazu: wiekszosc
zapytan single-pass, mniejszosc high-stakes przez pelen pipeline
(orientacyjny target ~5% high-stakes wzorowany na danych Lavern, **do
walidacji T2** na realnym ruchu kancelarii).

**Plusy**:
- Konstytucja Art. 7 (minimalnosc danych) zachowana - debate uruchamia
  sie tylko tam, gdzie ryzyko bledu uzasadnia dodatkowy przerob
- Klasyfikator deterministyczny (ta sama umowa zawsze high-stakes
  albo nie - bez "model dzis uznal inaczej")
- Eskalacja transparentna - w UI prawnik widzi powod uruchomienia debate
  (typ projektu, cm_value, flaga), zmierzony czas i zliczone tokeny dla
  tej konkretnej sesji (audit log per run, nie szacunek)
- 10-pass verifier zlapie divergencje przy critical cases gdzie
  najbardziej boli halucynacja

**Wybrany**.

### Wariant C - debate jako manual user-trigger ("uruchom drugi opinion")

Pomysl: bez klasyfikatora. Prawnik klika "uruchom drugi opinion"
przy zapytaniach, gdzie chce wzmocnienia.

**Problemy**:
- Cognitive load na prawnika ("czy ten case jest na tyle wazny?")
- Czesto prawnik nie wie, ze sprawa jest high-stakes, dopoki
  draft nie wyjdzie
- Konstytucja Art. 2 (weryfikowalnosc) zostaje **opcja**, a nie
  default dla wysokich stawek - co lamie konstytucyjne zalozenie
  "Patron sam pilnuje precyzji"

**Odrzucony jako default**, ale **zachowany jako uzupelnienie**:
`user.explicit_high_stakes_flag` to wlasnie manual trigger - dla
przypadkow, gdzie klasyfikator nie zlapal (np. opinia o niskiej
cm_value ale o powaznym ryzyku reputacyjnym).

## Konsekwencje

### Plusy

- Konstytucja Art. 2 (weryfikowalnosc) + Art. 7 (minimalnosc danych)
  jednoczesnie spelnione - debate uruchamia sie selektywnie tam, gdzie
  weryfikacja sie zwraca, a single-pass zostaje dla zapytan codziennych
- Audit bundle (ADR-0006) dla high-stakes ma debate_transcript +
  verification_log - dowod w razie reklamacji "Patron przeoczyl X"
- Pattern uznany w branzy (Lavern, Anthropic Constitutional AI, OpenAI
  o1-pro reasoning) - Patron nie wymyśla kola
- 10-pass verifier z licznikiem divergencji daje prawnikowi
  **confidence signal** - flaga "low-confidence" w UI to honest UX

### Minusy i ograniczenia

- **Debate to nowy zrodlo halucynacji** - adversarial builder moze
  wymyslic kontrargument, ktorego nie ma w prawie PL. Mitigation:
  ADR-0005 (citation grounding) wymusza, ze adversarial builder
  cytuje konkretne przepisy / orzeczenia, nie luzne refleksje
- **Klasyfikator reguly-based bedzie sie psul** - kazdy nowy typ
  dokumentu wymaga dopisku reguly. Mitigation: domyslnie
  konserwatywnie (typy z niskim ryzykiem = single-pass), explicit_flag
  jako bezpiecznik manualnego eskalowania
- **Latency 60-90s dla high-stakes**. Mitigation: UI pokazuje progress
  ("evaluator generuje draft… [3/5] adversarial builder buduje
  kontrargumenty…"), prawnik widzi rezultaty po fazach, moze anulowac
- **Koszt operacyjny** - liniowy z liczba zadan high-stakes w miesiacu.
  Orientacyjna kalkulacja TCO (cena tokenow dostawcy x liczba debate
  runs x sredni rozmiar promptu pipeline) **do walidacji T6** na
  faktycznym ruchu pilotazowej kancelarii i biezacych stawkach
  dostawcow LLM. Punkt referencyjny porownawczy: koszt godziny pracy
  juniora kancelaryjnego (dane GUS / raporty plac branzy prawniczej,
  brak twardych widelek na potrzeby ADR - **do walidacji T6**)
- **Brak metryki "czy debate cokolwiek zmienil"** w pierwszej iteracji.
  Mitigation: audit_log event_type `debate.draft_vs_synthesized_delta`
  zlicza, ile draftu zostalo materialnie zmienione przez adversarial.
  Po 50 cases pilotazu wiemy, czy debate jest wartosciowy

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump 1.1.0 -> 1.2.0** planowany
  PO wpieciu warstwy do produkcji (osobny ADR + osobna sesja).
  Tymczasowo Art. 2 i Art. 7 dostaja w sekcji "Mechanizmy techniczne"
  punkty `(planowane Faza 5) debate dla high-stakes` i `klasyfikator
  reguly-based stakes`. Ten ADR traktujemy jako wczesna deklaracje
  kierunku, nie zmiane konstytucji
- **Schema SQL** - nowa tabela `debate_session` z polami `chat_id`,
  `task_type`, `classifier_decision`, `phases JSONB`, `verifier_passes`,
  `divergence_count`, `confidence_label` (high / medium / low)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie.
  Debate to nowy orchestrator wyzszego poziomu, ktory wola
  `streamChatWithTools` N razy z roznymi promptami systemowymi

## Plan migracji 8-tygodniowy

### Tydzien 1-2 - klasyfikator + szkielet orchestratora

- [ ] `backend/src/lib/debate/classifier.ts` - reguly-based klasyfikator
- [ ] `backend/src/lib/debate/orchestrator.ts` - kostkonstruktor 5 faz
- [ ] Polski prompt dla evaluator (`prompts.pl.evaluator.ts`)
- [ ] Polski prompt dla adversarial builder (3 typy: pominiete przepisy,
      nadmiar uogolnien, brak cytatu)
- [ ] Polski prompt dla synthesizer
- [ ] Testy klasyfikatora (10 cases: opinia / pozew / czat researchowy /
      umowa M&A / inne)

### Tydzien 3-4 - verifier + UI flaga confidence

- [ ] `backend/src/lib/debate/verifier.ts` - 10-pass z licznikiem divergencji
- [ ] Definicja "materialne rozbieznosci" (semantyczne, nie powierzchowne)
- [ ] UI flaga `confidence: high | medium | low` w odpowiedzi asystenta
- [ ] Audit log: nowe `event_type` `debate.session_started`,
      `debate.phase_completed`, `debate.verifier_result`,
      `debate.divergence_flag`

### Tydzien 5-6 - audit bundle integracja (ADR-0006)

- [ ] `debate_session.phases` zapisywane do audit bundle jako pelny
      transcript (5 faz + 10 verifier passes)
- [ ] Eksport audit bundle do PDF + JSON z hash-chain (ADR-0001)

### Tydzien 7-8 - pilotaz na 5 DD cases pierwszej kancelarii

- [ ] Wlacz debate dla pierwszej kancelarii pilotazowej (cm_value > 100k
      lub typ_dokumentu IN top-5 high-stakes)
- [ ] Zbieraj metryke `draft_vs_synthesized_delta`
- [ ] Po 5 cases: review razem z kancelaria. Czy delta byla
      uzyteczna? Czy verifier zlapal cos, czego nie zlapalby
      single-pass?

## Status weryfikacji

- [ ] Skeleton modulu `backend/src/lib/debate/`
- [ ] Testy klasyfikatora reguly-based
- [ ] Polskie prompty (evaluator / adversarial / synthesizer)
- [ ] 10-pass verifier z licznikiem divergencji
- [ ] UI flaga confidence w `AssistantMessage`
- [ ] Audit log integracja
- [ ] Decyzja Wieslawa: dla ktorych typow dokumentow MVP klasyfikatora?
      (proponowane: opinia, pozew, odpowiedz_pozew, apelacja, kasacja,
      skarga_NSA, umowa_M&A, umowa_DD, umowa_finansowa)
- [ ] Decyzja Wieslawa: czy `user.explicit_high_stakes_flag` widoczne
      w UI od MVP czy dopiero po pilotazu (mniejszy cognitive load
      na poczatek)

## Licencja blueprintu

Lavern jest **Apache 2.0**. Cherry-pick architektonicznych decyzji
(struktura 5 faz + 10-pass verifier + klasyfikator stakes) NIE jest
derivative work - to idea/wzorzec, nie kod. Linkujemy Lavern
w `THIRD_PARTY_INSPIRATIONS.md` jako blueprint.

Apache 2.0 jest **kompatybilny z AGPL-3.0** Patrona (Apache 2.0 ma
patent grant, AGPL akceptuje Apache 2.0 jako upstream). Jezeli
w przyszlosci zechcemy zaimportowac konkretny modul Lavern jako
zaleznosc npm, mozemy to zrobic bez naruszenia licencji.
