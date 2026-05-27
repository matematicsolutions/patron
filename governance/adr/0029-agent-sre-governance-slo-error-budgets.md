# ADR-0029: Agent SRE Governance - SLO, error budgets, circuit breakers dla wywolan LLM w Patronie

> **Uwaga numeracja**: ostatni zajety ADR to 0025 (MCP Security Gateway). ADR-0026 (Merkle audit), 0027 (Privilege rings), 0028 (wpiecie MCP Security Gateway w startup) sa **REZERWACJAMI** z ADR-0024 - nie wpisuje sie ich teraz, bo decyzje implementacyjne nie zostaly podjete. Ten ADR celowo skacze do 0029 zeby nie wchodzic w slot tych rezerwacji.

**Status**: PROPONOWANY (decision record, bez kodu). Wdrazany w nastepnych sprintach. Ten ADR definiuje **CO** chcemy mierzyc i **JAK** ustawiac decyzje (SLO/error budget/circuit breaker dla wywolan LLM), bez wiazacych szczegolow implementacyjnych - osobny ADR implementacyjny po wybraniu konkretnej technologii (Postgres SLO state vs in-memory, OTEL vs custom).

**Data**: 2026-05-24

**Powiazane zasady** (Konstytucja Patrona v1.2.1, zweryfikowane grepem - weryfikacja grepem Konstytucji przed cytatem):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA zasada. SLO i SLI Patrona dziela istniejaca infrastrukture audit hash-chain (ADR-0001): kazda obserwacja SLI to event, kazda decyzja circuit breakera to event. Audyt SRE = audyt zgodnosci.
- **Art. 6 - Granica bledu** (human in the loop) - circuit breaker NIE wylacza Patrona autonomicznie. Decyzja "wstrzymujemy use case" trafia do Operatora kancelarii (UI + audit log). Patron sygnalizuje, czlowiek decyduje.
- **Art. 2 - Weryfikowalnosc zrodel** - jeden z naszych SLI (CitationCoverage SLI) mierzy procent odpowiedzi LLM zawierajacych weryfikowalne cytaty z konektorow MCP. Spadek tego SLI = sygnal SRE.
- **Art. 7 - Minimalnosc danych** - SLI sa policzalne lokalnie, zero telemetrii zewnetrznej. RODO-safe.
- **Art. 4 - Neutralnosc wobec dostawcow** - SLO jednolite niezaleznie od providera LLM (Claude / Gemini / Ollama). To kancelaria decyduje czy spadek wynika z providera czy z konektora.

**Powiazane ADR**:
- **ADR-0024** - rodzic. Cherry-pick 3 patternow z Microsoft AGT, ten ADR realizuje czwarty (Agent SRE).
- **ADR-0001** - hash-chain audit. Eventy SLO/SLI/circuit-breaker dziedzicza ten audit path.
- **ADR-0025** - MCP Security Gateway. Decyzje Gateway'a (denied/human_review) zasilaja SLI Patrona (`McpSecurityIncidentRate`).
- **ADR-0019/0020** - input-security. Decyzje (blocked/human_review/quarantined) zasilaja SLI (`InputSecurityIncidentRate`).

---

## Decyzja

Patron wdraza **4 SLI** kancelarii-skali (NIE 100+ jak Microsoft AGT) z error budget per use case i circuit breakerem dzialajacym jako sygnal dla Operatora (NIE autonomiczne wylaczenie).

### Cztery SLI Patrona (kancelarii-skala)

**1. TaskSuccessRate (TSR)**
- Definicja: procent zadan LLM ktore Operator zaakceptowal w pierwszej iteracji (bez retry, bez "popraw odpowiedz").
- Pomiar: kazda interakcja `streamChatWithTools` rejestruje na koniec event `task_outcome` z polem `accepted: bool` (Operator klikajacy "akceptuj" w UI).
- SLO startowy: **>= 80%** w oknie 7-dniowym.
- Window: rolling 7 dni (krotkie okno = szybka reakcja na regresje providera/konektora).

**2. HallucinationRate (HR)**
- Definicja: procent odpowiedzi LLM gdzie sampling Operator zglosil "zmyslony fakt" (nieistniejacy wyrok, blednie zacytowany przepis, fikcyjna data).
- Pomiar: UI ma przycisk "halucynacja" przy odpowiedzi; trafia do `hallucination_report` event w audit log.
- SLO startowy: **<= 2%** w oknie 30-dniowym (rzadszy event, wieksze okno = stabilniejsza statystyka).
- Bramka twarda: > 5% w 14 dni z rzedu -> alarm Operatora + circuit breaker propozycja.

**3. CitationCoverage (CC)**
- Definicja: procent odpowiedzi LLM zawierajacych co najmniej jeden citation z konektora MCP (saos, eu-compliance, krs, ...).
- Pomiar: parser odpowiedzi szuka `structuredContent.citations` lub `<cite>` markerow w outputie LLM.
- SLO startowy: **>= 70%** dla pytan prawnych (pytania nie-prawne wykluczone z mianownika przez kategoryzacje).
- Sygnal: spadek = LLM nie korzysta z konektorow, prawdopodobnie improwizuje. Powiazane z Art. 2.

**4. McpSecurityIncidentRate (MSI)**
- Definicja: liczba zdarzen w ktorych MCP Security Gateway (ADR-0025) zwrocil `human_review` lub `denied` przy ladowaniu konektora / refresh tools/list.
- Pomiar: kazda decyzja Gateway != "allowed" jest licznikiem.
- SLO startowy: **= 0** w oknie tygodniowym (zero tolerancji bo to bramka security).
- Bramka twarda: >= 1 -> human review przez Operatora w 24h, audit log z findings.

### Error budgets

Kazdy SLI ma error budget liczony jako `(1 - SLO) * window`:

| SLI | SLO | Window | Error budget |
|---|---|---|---|
| TSR | 80% | 7 dni | 20% tasks niesatysfakcjonujacych w 7 dni |
| HR | 2% | 30 dni | 2% halucynacji w 30 dni (procent, nie liczba) |
| CC | 70% | 7 dni | 30% odpowiedzi prawnych bez citation w 7 dni |
| MSI | 0 | 7 dni | 0 incydentow (zero budget = krytyczna bramka) |

Wyczerpanie error budgetu = przesuniecie Patrona w stan `WARNING` (UI banner Operatora), ale **nie wylaczenie automatyczne**. Konstytucja Art. 6 - czlowiek decyduje.

### Circuit breaker (3-stanowy, sygnalowy)

Stany:
- **CLOSED** (normalny) - kazda interakcja LLM przechodzi.
- **OPEN** (sygnalowy) - sygnal dla Operatora; Patron pyta przy kazdym uzyciu "Detekcja regresji TSR < 60%. Kontynuuj?". UI: zoltym alertem.
- **HALF_OPEN** (testowy) - po decyzji Operatora "kontynuuj", system probkuje 10% taskow zeby sprawdzic czy regresja ustapila.

Trigger transitions:
- CLOSED -> OPEN: TSR < 60% w 24h LUB HR > 5% w 14d LUB MSI >= 1.
- OPEN -> HALF_OPEN: decyzja Operatora w UI (audit log: kto, kiedy, dlaczego).
- HALF_OPEN -> CLOSED: 10% probki przekracza SLO TSR >= 80%.
- HALF_OPEN -> OPEN: ponowna regresja w probce.

**Wazne**: NIE wylaczamy Patrona autonomicznie. Circuit breaker to sygnal + brama UI. Kancelaria pracuje, ale wie ze cos nie dziala i moze swiadomie kontynuowac (z audit log).

### Co robimy w tym ADR
- Decyzja kierunku (4 SLI + error budget + 3-stanowy circuit breaker sygnalowy).
- Mapping na Konstytucje (Art. 3/6/2/7/4).
- Zarys schematu eventow audit log (`task_outcome`, `hallucination_report`, `slo_breach`, `circuit_state_change`).

### Czego NIE robimy w tym ADR (osobne ADR-y implementacyjne)
- **NIE wybieramy technologii**. Postgres ze schema `slo_state` vs in-memory + persist co N minut vs OpenTelemetry collector lokalny - decyzja w ADR-0030 implementacyjnym.
- **NIE pisemy kodu**. Skeleton nastapi po wybraniu technologii.
- **NIE adoptujemy pelnego OTEL semantic conventions Microsoft AGT**. Microsoft trzyma sie OTEL Agent Semantic Conventions w draftcie - poczekamy az draft stanie sie GA. Nasz audit hash-chain (ADR-0001) wystarczy jako MVP.
- **NIE adoptujemy chaos engineering / fault injection** Microsoft AGT. Kancelaria nie testuje produkcji chaosem; to dla 100+ agentow. Skip.
- **NIE adoptujemy Artifact Signing Ed25519** Microsoft AGT. Patron nie buduje artefaktow AI; to dla MLOps pipeline'ow.

---

## Kontekst

### Pytanie klienta po 6 miesiacach

Pierwsze 90 dni po wdrozeniu Patrona - kancelaria entuzjastyczna. 90-180 dni - pojawia sie pytanie: "skad wiemy ze AI dziala dobrze? co mierzymy?". Bez SRE governance odpowiedz brzmi "ufamy intuicji Operatora", co przy audicie regulatora (UODO, KIRP) wyglada slabo.

SRE governance daje **liczby**. Audyt regulatora widzi tabele "TSR 84% / HR 1.2% / CC 72% / MSI 0 incydentow w 6 miesiecy" - to konkretny dowod nalezytej starannosci (AI Act art. 26 - obowiazki podmiotu wdrazajacego high-risk AI: "monitorowanie dzialania").

### Wzorzec cherry-pick

Z [microsoft/agent-governance-toolkit `docs/specs/AGENT-SRE-GOVERNANCE-1.0.md`](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/specs/AGENT-SRE-GOVERNANCE-1.0.md) (MIT, RFC 2119 spec, status "Draft" 2025-07-28).

**Co bierzemy (wzorzec)**:
- Pojecia SLO/SLI/error budget/circuit breaker dla AI agents jako kategoria.
- Fail-closed semantics przy bledzie internal (status `UNKNOWN`).
- 5-stanowy enum statusow SLO (HEALTHY/UNKNOWN/WARNING/CRITICAL/EXHAUSTED) jako wzorzec - my upraszczamy do 3 (CLOSED/OPEN/HALF_OPEN) bo kancelaria ma 1-5 use case, nie 100+.
- Pojecie burn rate (tempo wyczerpania budgetu).

**Co NIE bierzemy (granica)**:
- 9-stanowy pelen model (`alert_manager` + `incident detection` + `incident response`) - przeskalowane.
- `EXHAUSTED -> FREEZE_DEPLOYMENTS / CIRCUIT_BREAK / THROTTLE` enum - Patron nie ma "deploymentow" w sensie SRE; ma jedna baza per kancelaria.
- OpenTelemetry semantic conventions - czekamy az dojrzeje.
- Distributed replay / golden traces / artifact signing - przeskalowane dla naszej skali.
- Ed25519 SignatureBundle - osobny temat (nie SRE).

---

## Alternatywy rozwazane

**A. Nie robic nic, polegac na intuicji Operatora**
- Odrzucone. Audyt AI Act art. 26 + UODO pytaja o "monitorowanie". Brak mierzalnych SLI = brak dowodu nalezytej starannoosci.

**B. Wziac pelny stack Microsoft AGT (Agent SRE Python)**
- Odrzucone. Python, OTEL infrastruktura, 100+ agentow design. Patron to TS + jedna kancelaria.

**C. Wziac 1 SLI (tylko TSR)**
- Odrzucone. TSR sam w sobie nie pokrywa Art. 2 (citation) ani Art. 5 (tajemnica - input-security incident). Potrzebne minimum 4.

**D. 4 SLI + sygnalowy circuit breaker (przyjete)**
- Pokrycie wszystkich krytycznych Artykulow Konstytucji. Skala kancelaryjna. Circuit breaker sygnalowy (NIE autonomiczne wylaczenie) zachowuje Art. 6.

---

## Konsekwencje

### Pozytywne
- Klient w 6 mc dostaje liczby. Audyt regulatora ma konkretne dane.
- Mapping na Konstytucje OWASP Agentic Top 10 ASI-08 (Cascading Agent Failures) zaadresowany.
- Mozliwosc cherry-pick patternu do skill `matematic-konstytucja-ai` (gotowe, juz LIVE w Appendix F).
- SRE jako jezyk z IT/devops - kancelarie z dzialami IT rozumieja "SLO" lepiej niz "rygor jakosci".

### Negatywne / kosztowe
- +infrastruktura SLO state (Postgres schema lub plik state w `~/.patron/slo-state.json`) - decyzja ADR-0030.
- UI dla Operatora: dashboard 4 metryk + circuit breaker alerty. Praca frontendowa.
- Kategoryzacja pytan (prawne vs nie-prawne) dla CitationCoverage - heurystyka + override Operatora.
- Sampling halucynacji wymaga procesu (5% tygodniowo). Champions kancelarii musza to robic - dorobic w Playbooku Tydzien 5.

### Bramki przed wpieciem (ADR-0030 implementacyjny)
- Decyzja: Postgres schema vs in-memory + plik. Rekomendacja: Postgres (audit z hash-chain juz tam jest).
- UI design: dashboard 4 metryk. Decyzja: prostota (Next.js komponent w `frontend/src/app/admin/`) vs zewnetrzny tool (Metabase/Grafana).
- 2x runda wewnetrznego review tresci przed merge.

---

## Atrybucja

Pattern (4 SLI + error budget + circuit breaker dla AI agents) inspirowany przez [microsoft/agent-governance-toolkit AGENT-SRE-GOVERNANCE-1.0](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/specs/AGENT-SRE-GOVERNANCE-1.0.md) (MIT, Microsoft Corporation, draft 2025-07-28). Adaptacja do skali kancelaryjnej + integracja z istniejacym audit hash-chain (ADR-0001) napisana od zera w tym ADR. Implementacja w osobnym ADR-0030 po wybraniu technologii.

Pelna atrybucja: [THIRD_PARTY_INSPIRATIONS.md sekcja microsoft/agent-governance-toolkit](../../THIRD_PARTY_INSPIRATIONS.md).
