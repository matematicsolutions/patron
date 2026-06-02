# ADR-0097: Kaskadowy grounding cytatow z paraphrase-judge (biblioteka, warstwa semantyczna nad ADR-0005)

**Status**: Wdrozony 2026-06-02 jako BIBLIOTEKA na branch `feat/tier-governance-envelope` (NIE scalony, wpiecie w szwy = rezerwacja). Dodaje semantyczny etap weryfikacji cytatu (paraphrase-judge) nad deterministycznym `verifyOne` (ADR-0005), z werdyktem 3-kolorowym. Lapie przypadek, ktorego string-match nie lapie: cytat doslowny pod falszywa teza (Stanford/Magesh).

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 2 - Tajemnica zawodowa / Art. 1 - Lokalnosc**: paraphrase-judge to wywolanie LLM na tresci dokumentu klienta. Egress judge podlega wspolnemu chokepointowi `enforceEgress.ts` (ADR-0095): dla tajemnicy wylacznie model lokalny; brak lokalnego = etap 3 sie NIE odpala (fail-closed), werdykt zostaje deterministyczny. Wpiecie MUSI to respektowac.
- **Art. 3 - Audytowalnosc / determinizm**: rdzen (etap 1/2) pozostaje deterministyczny i jest zrodlem prawdy dla BLOKADY. `judgeReason` (uzasadnienie LLM, niedeterministyczne, kandydat PII) NIGDY nie wchodzi do audit_log - tylko do UI. Do audytu: enum verdict + confidence + stage.
- **Art. 7 - Minimalnosc**: zero nowej zaleznosci npm. Biblioteka owija istniejacy `verifyOne`, judge wstrzykiwany (deps-injection jak `SourceResolver`).

**Powiazane ADR**:
- ADR-0005 (mechaniczny grounding `verifyOne`): ten ADR buduje NAD nim. `verifyOne`/`normalize` reuzywane bez zmiany sygnatury; etap 3 to nowy plik `citation/cascade.ts`. Kompatybilnosc z tabular (ADR-0080/0082) i chat (ADR-0005) zachowana - `decision` nietknieta.
- ADR-0095 (wspolny chokepoint egress): adapter realnego judge (rezerwacja) MUSI routowac przez `enforceEgressGuard`; ensemble (rezerwacja) przez `guardEnvelopeTier`/`envelope_tier`.
- ADR-0087/0090 (re-ranking jako biblioteka, wpiecie osobnym ADR): ten ADR dziedziczy wzorzec "biblioteka teraz, wpiecie po pomiarze".

**Inspiracja** (clean-room, wzorzec nie kod): LegalQuants/lq-ai (Apache-2.0) - citation engine 4-stage cascade (exact -> tolerant -> paraphrase-judge -> ensemble), kalibracja "false-positive gorszy niz false-negative". Bierzemy idee, nie kod (Python). Patrz THIRD_PARTY_INSPIRATIONS.md.

---

## Kontekst

Paper Stanford/Magesh ("Hallucination-Free?", reference w pamieci): komercyjne legal-RAG (Lexis+/Westlaw) halucynuja 17-33% mimo "hallucination-free", a najgrozniejszy typ to **prawdziwy cytat pod falszywa teza** - zrodlo doslownie zawiera fragment, ale nie wspiera twierdzenia, pod ktore go podstawiono. Deterministyczny `verifyOne` (ADR-0005) sprawdza, czy cytat ISTNIEJE w zrodle (string-match) - i dla takiego przypadku zwraca ZWERYFIKOWANY/green, czyli FALSZYWE poczucie ugruntowania. To luka w glownym moacie sprzedazowym Patrona (anty-halucynacja).

## Decyzja

Biblioteka `backend/src/lib/citation/cascade.ts` - `groundCascade(citation, sourceText, opts)`:
- **Etap 1/2** (deterministyczne): `verifyOne` - exact + tolerant (bez zmian).
- **Etap 3 PARAPHRASE-JUDGE** (opcjonalny): odpala sie TYLKO gdy wstrzyknieto `judge: JudgeFn` ORAZ znana jest teza `claim` ORAZ zrodlo istnieje. Judge ocenia, czy zrodlo NAPRAWDE wspiera teze:
  - `nie` -> DEGRADUJE werdykt do red, nawet jesli cytat istnieje doslownie (lapie Stanford). Konserwatywnie (false-positive gorszy).
  - `czesciowo` -> yellow + partial.
  - `tak` -> green gdy tekst tez sie zgadzal; yellow (partial) gdy wsparcie sensem (parafraza bez dokladnego dopasowania - RATUJE tekstowo-czerwony).
- **Werdykt 3-kolorowy** `verdict: green|yellow|red` + `stage` + `confidence` + `partial` + `judgeReason?`. confidence sedziego: wysoka/srednia/niska -> 0.90/0.70/0.50.

**Granica governance (kluczowa):** `decision` (verified/unverified/blocked) z `verifyOne` ZOSTAJE deterministyczna i jest zrodlem prawdy dla BLOKADY deliverable. `verdict` to warstwa DORADCZA (UI/audyt). W v1 judge NIE zmienia blokady automatycznie - czy verdict (np. judge-red przy tekstowo-verified) ma blokowac, to decyzja governance (rezerwacja, wymaga rozstrzygniecia z Konstytucja).

## Ewaluacja (eval-first, ADR-0087)

`backend/src/lib/citation/cascade.test.ts` (12 testow, deterministyczny mock judge): no-op bez sedziego (green/yellow/red = zachowanie verifyOne); **FALSE-UNDER-TRUE** (cytat doslowny + judge "nie" -> verdict red, ale `decision` zostaje "verified" = dowod ze deterministyka nietknieta); parafraza (tekst red + judge "tak" -> yellow partial); czesciowo -> yellow; bramki odpalenia (brak claim -> sedzia nie wolany; BRAK_ZRODLA -> sedzia nie wolany).
Pelny eval z REALNYM sedzia (korpus TRUE/PARAPHRASE/FALSE-UNDER-TRUE, Ollama lokalny, offline) = krok przy wpieciu (rezerwacja), poniewaz wymaga adaptera judge i decyzji o domyslnym wlaczeniu.
Bramki: tsc 0, pelny suite 1061 pass / 0 fail (bez regresji na grounding.test.ts/tabular).

## Alternatywy odrzucone
- **Judge wbudowany na sztywno w verifyOne**: odrzucone - verifyOne ma byc deterministyczny i offline (reuzywany przez tabular/chat bez LLM). Etap 3 jako osobna warstwa z wstrzykiwanym portem.
- **Judge zmienia decision (blokade) automatycznie w v1**: odrzucone - blokada na niedeterministycznym LLM lamie Art. 3 (audyt "raz green raz red"). decision deterministyczna; verdict doradczy; polityka blokady verdict = osobna decyzja governance.

## Rezerwacje (wpiecie - osobne kroki, po decyzjach Wieslawa)
- **Adapter realnego judge** `citation/judge.ts`: prompt-template PL ("false-positive gorszy"), structured-output {verdict,confidence,uzasadnienie}, wywolanie przez `enforceEgressGuard` (tajemnica -> Ollama, fail-closed). Ensemble (N modeli) przez `guardEnvelopeTier`.
- **OCR-aware tolerant**: `normalizeOcrConfusable` (l/I/1, O/0) gdy `wasOcrd`; wymaga persystencji `ocrUsed` (ConvertResult) przez documentIngest do DocStore (dzis nie persystowany).
- **Wpiecie w szwy**: chat `ground-citations.ts` i tabular `grounding.ts` wolaja `groundCascade` gdy judge wlaczony. Domyslnie WLACZONY czy opt-in (rekomendacja: opt-in z silnym default-on gdy egress=no-egress).
- **UX zoltego stanu**: AssistantMessage.tsx ma dzis 3 klasy (verified/unverified/blocked) - dodac partial/yellow + tooltip z judgeReason+stage. Labelki i18n.
- **Polityka blokady**: czy yellow/judge-red blokuje deliverable (governance, Konstytucja).
- **Cache werdyktow** judge (in-memory keyed hash(cytat+kontekst+model)) - anty-koszt.
