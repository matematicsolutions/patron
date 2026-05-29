# ADR-0068: Hardening /draft/refine - klasyfikator high-stakes + audit + sanityzacja + pseudonimizacja

**Status**: Wdrozony 2026-05-29 (H10-H14 LIVE). Konstytucja v1.4.1.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 3 (audytowalnosc), Art. 5 (ochrona danych),
Art. 2 (zero-cloud / tajemnica), AI Act art. 12 (record-keeping)
**Powiazane**: ADR-0058 (pipeline obrony - Invisible AI), ADR-0004 (klasyfikator high-stakes),
ADR-0067 (egress router + pseudonimizacja - reuse egressForModel + wrap/unwrap),
ADR-0001 (hash-chain), ADR-0035 (migration infra)

## Kontekst

Audyt FAZA 0 wskazal 5 luk w endpoincie `POST /draft/refine` (pipeline obrony: Recenzent ->
Adwokat diabla -> Pisz po ludzku, do 3 wywolan LLM na drogim modelu):

- H10: klasyfikator high-stakes (ADR-0004) nigdzie nie wpiety - martwy kod, zero importow poza testami.
- H11: pipeline nie zapisywal zadnego zdarzenia w audit_log - 3 wywolania LLM bez sladu (AI Act art. 12).
- H12: pole `context` interpolowane wprost do user promptu - prompt injection, bez limitu.
- H13: brak limitu rozmiaru `text` - DoS i koszt (50 MB x 3 etapy x 8000 maxTokens).
- H14: draft z PESEL/imionami szedl jawnie do `completeText` - PII do chmury bez maskowania (powiazane z B1).

## Decyzja

### H13 - limit rozmiaru (`routes/draft.ts`)
`MAX_DRAFT_CHARS = 100_000`. Powyzej -> 400. Dlugie pismo procesowe miesci sie; runaway request nie.

### H12 - sanityzacja context (`lib/pipeline/defense.ts`)
`sanitizeContext`: usuwa znaki kontrolne (zachowuje tab/newline/cr), tnie do `MAX_CONTEXT_CHARS = 2000`.
`withContext` otacza kontekst separatorem `<kontekst_sprawy>...</kontekst_sprawy>` - model traktuje go
jako dane, nie instrukcje. Mitygacja "Ignoruj poprzednie instrukcje..." we wszystkich 3 etapach.

### H10 - klasyfikator high-stakes jako brama minimalna (`routes/draft.ts`)
`classifyHighStakes` wolany na wejsciu z `configFromEnv(process.env)`. Request przyjmuje opcjonalne
`document_type` / `cm_value` / `explicit_high_stakes`. Wynik (isHighStakes + reasons + threshold) trafia
do audit_log - sygnal "to pismo zasluguje na eskalacje". Faktyczne wlaczenie debate pozostaje za flaga
`DEBATE_ENABLED` (rezerwacja ADR-0004 T3) - tu tylko ozywiamy klasyfikator i logujemy.

### H11 - per-call audit (`routes/draft.ts`)
Po pipeline `appendAuditEvent` typu `defense.pipeline.run`. Payload bez tresci draftu: model, etapy,
adwokat_mode, document_type, high_stakes + reasons + threshold, dlugosci (text/final), duration_ms.
Wchodzi do hash-chain (ADR-0001) + Merkle. Typ dodany migracja 007 (ALTER CHECK, 4 lustra enum).

### H14 - pseudonimizacja pipeline (`lib/pipeline/defense.ts`)
`runDefensePipeline` maskuje draft (`wrapInto`, wspolna mapa) gdy `egressForModel(model) != no-egress`
i `PATRON_PSEUDONIM_EGRESS != false`. Draft plynie zamaskowany przez wszystkie etapy (spojne tokeny);
output kazdego etapu i final sa odwracane (`unwrap`) do prezentacji. Model lokalny (Ollama) pomijany.

## Konsekwencje

Pozytywne:
- Pipeline obrony objety audytem i lancuchem Merkle (AI Act art. 12) jak reszta wywolan LLM.
- Klasyfikator high-stakes ozywiony - fundament pod automatyczne wlaczanie debate (ADR-0004 T3).
- context i text odporne na injection i DoS.
- PII nie wychodzi jawnie do chmury z pipeline obrony (spojne z ADR-0067 B1).

Koszty i ryzyka:
- document_type/cm_value przychodza od klienta (opcjonalne) - bez nich klasyfikator zwraca low-stakes.
- Reuse rejestru egress i wrap/unwrap z ADR-0067 - zaleznosc lib/pipeline -> lib/routing + lib/pseudonim.

## Ograniczenia / dlug (FAZA 1)

- context nie jest maskowany (tylko draft) - kontekst to zwykle metadane (rodzaj pisma), nizsze ryzyko PII.
- Detektor imion wciaz LLM-noop (jak w B1) - maskujemy identyfikatory regexowe.
- /draft/refine nie ma twardej bramy egress (decideRoute) - endpoint nie jest zwiazany ze sprawa, wiec
  brak klasyfikacji data-residency; maskowanie H14 to obecna mitygacja. Wiazanie ze sprawa = FAZA 1.

## Status weryfikacji

- 6 nowych testow (sanizityzacja context: znaki kontrolne/limit/injection-wrap; pseudonimizacja pipeline:
  chmura maskuje + odwraca, lokalny pomija, wylacznik). Zaktualizowany 1 test (format context H12).
- `tsc --noEmit` clean. Backend 787 testow pass (5 todo).
- Migracja 007 (defense.pipeline.run, 4 lustra enum). Commit chirurgiczny.
