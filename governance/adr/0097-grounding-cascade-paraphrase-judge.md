# ADR-0097: Kaskadowy grounding cytatow z paraphrase-judge (biblioteka, warstwa semantyczna nad ADR-0005)

**Status**: Wdrozony 2026-06-02 na branch `feat/tier-governance-envelope` (NIE scalony). Biblioteka kaskady + adapter realnego judge + WPIECIE w sciezke czatu ZA FLAGA `PATRON_CITATION_JUDGE` (default OFF = zero zmiany zachowania). Dodaje semantyczny etap weryfikacji cytatu (paraphrase-judge) nad deterministycznym `verifyOne` (ADR-0005), z werdyktem 3-kolorowym. Lapie przypadek, ktorego string-match nie lapie: cytat doslowny pod falszywa teza (Stanford/Magesh). Wpiecie tabular, UX zoltego stanu, polityka blokady i pelny eval z realnym Ollama PRZED wlaczeniem flagi = pozostale kroki.

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

## Hardening po przegladzie kodu (2026-06-02, high-effort review)

Recenzja (3 zbiezne findery) wskazala realne dziury - naprawione:
- **Sedzia LOKALNY-ONLY (krytyczne, PII):** judge ocenia NIEMASKOWANY fragment dokumentu klienta (cytat + kontekst zrodla); glowny czat maskuje PII (wrapConversation), pipeline obrony tez (wrapInto) - judge nie. Dla client_general/internal + ALLOW_US guardEgress przepuscilby model chmurowy -> niezamaskowane PESEL/nazwiska do US. FIX: `makeJudge` zwraca null gdy `!isLocalModel(model)` - sedzia dziala WYLACZNIE na modelu lokalnym (Ollama, no-egress). Tresc klienta nigdy nie opuszcza maszyny przez judge. Spojne z zero-egress; rozwiazuje tez audyt-residency (brak egressu = nic do logowania) i PII-po-drucie.
- **extractClaim - okno znakowe zamiast zdaniowego:** stary podzial po `[.!?]\s` lamal teze na polskich skrotach ("art. ", "ust. ", "tj. ") i mogl trafic [ref] w blok <CITATIONS> (JSON). FIX: okno +/-250 znakow wokol znacznika, przyciete do akapitu (newline); odciecie bloku <CITATIONS> przed szukaniem.
- **SSE slim (PII po drucie):** event "citations" serializowal caly CascadeResult (z judgeReason - kandydat PII). FIX: do klienta whitelistowane WYLACZNIE `{decision, verdict}`; `judgeReason` zostaje server-side (istotne w trybie serwerowym).

## Alternatywy odrzucone
- **Judge wbudowany na sztywno w verifyOne**: odrzucone - verifyOne ma byc deterministyczny i offline (reuzywany przez tabular/chat bez LLM). Etap 3 jako osobna warstwa z wstrzykiwanym portem.
- **Judge zmienia decision (blokade) automatycznie w v1**: odrzucone - blokada na niedeterministycznym LLM lamie Art. 3 (audyt "raz green raz red"). decision deterministyczna; verdict doradczy; polityka blokady verdict = osobna decyzja governance.

## Zrobione w tej iteracji (poza biblioteka cascade.ts)
- **Adapter realnego judge** `citation/judge.ts`: `makeJudge` routuje przez `guardEgress` (ADR-0067/0095) i zwraca null, gdy klasyfikacja nie dopuszcza modelu (tajemnica + chmura) = FAIL-CLOSED, tresc nie wychodzi. Prompt-template PL ("false-positive gorszy"), parse structured JSON; blad parsowania -> throw -> cascade lapie i zostaje przy werdykcie deterministycznym.
- **Ekstrakcja tezy** `extractClaim` (ground-citations.ts): zdanie odpowiedzi wokol znacznika `[ref]` jako claim dla sedziego. Brak znacznika -> brak tezy -> sedzia sie nie odpala (no-op).
- **Wpiecie w czat** `stream.ts` + `ground-citations.ts` ZA FLAGA `PATRON_CITATION_JUDGE` (default OFF). `groundCascade` z `extractClaim` per cytat; verdict/stage/confidence rida obok cytatow w SSE.

## Rezerwacje (pozostale kroki)
- **Pelny eval z realnym Ollama** (korpus TRUE/PARAPHRASE/FALSE-UNDER-TRUE, offline) PRZED wlaczeniem flagi - mierzy precision zielonego na FALSE-UNDER-TRUE (cel >=0.90). Default OFF do czasu pomiaru.
- **Kalibracja znacznika cytatu**: `extractClaim` zaklada marker `[ref]` w tekscie odpowiedzi - zweryfikowac realny format znacznikow Patrona (jesli inny, claim pusty -> judge no-op, fail-safe).
- **OCR-aware tolerant**: `normalizeOcrConfusable` (l/I/1, O/0) gdy `wasOcrd`; wymaga persystencji `ocrUsed` przez documentIngest do DocStore (dzis nie persystowany).
- **Wpiecie tabular** `tabular/grounding.ts` analogicznie do czatu.
- **Polityka blokady**: czy yellow/judge-red blokuje deliverable (governance, Konstytucja). Dzis decision deterministyczna = blokada, verdict doradczy.

## Zrobione w tej iteracji (UX werdyktu w czacie)
- Front koloruje badge cytatu wg `groundingVerdict` (green/yellow/red) z PIERWSZENSTWEM przed `decision` - bo judge lapie falszywa teze przy poprawnym tekstowo cytacie (decision byloby "verified"/zielone, verdict daje red). Bez werdyktu (sedzia off) = kolor wg decision jak dotad.
- Pliki: `shared/types.ts` (PATRONGroundingVerdict + pole annotation), `hooks/useAssistantChat.ts` (odczyt verdict z SSE), `assistant/AssistantMessage.tsx` (kolor+etykieta), `i18n/pl.ts` (verdictGreen/Yellow/Red).
- **PII:** do frontu idzie WYLACZNIE enum `verdict` (bezpieczny). `judgeReason` (wolny tekst LLM, kandydat PII / tajemnica) NIE jest przesylany do UI ani persystowany - etykieta tooltipa jest generyczna z i18n. Szczegolowe uzasadnienie sedziego = osobna, ostroznie obsluzona rezerwacja.

## Zrobione w tej iteracji (audyt sedziego, AI Act art. 12)
- `groundingSummary` (ground-citations.ts) dolacza `judge: {judged, green, yellow, red, downgraded}` gdy sedzia dzialal (stage 3). Tylko liczby/enumy, ZERO tresci/PII. Plynie do audit_log przez istniejacy payload (chat.ts/projectChat.ts spreaduja summary).
- **`downgraded`** = ile cytatow sedzia zdegradowal do red mimo tekstowo poprawnego trafienia (decision=verified) = zlapane "cytat doslowny pod falszywa teza" (Stanford). To kluczowa metryka wartosci judge - dowod due-diligence dla AI Act i miara skutecznosci do ewaluacji.
- **Ensemble** (N modeli) przez `guardEnvelopeTier` (envelope_tier, ADR-0095). **Cache werdyktow** judge (anty-koszt).
- **Persystencja `verdict`** (z przegladu): verdict jest dzis LIVE-only (SSE) - po reloadzie czatu badge wraca do koloru wg deterministycznej `decision` (judge-red znika). verdict to enum (bezpieczny do zapisu, w przeciwienstwie do judgeReason) - persystowac w annotation. Do zrobienia przy wpieciu produkcyjnym.
- **Sekwencyjne wywolania judge** (z przegladu): grounding z sedzia iteruje cytaty w petli (await per cytat) - przy wielu cytatach + lokalnym (wolniejszym) modelu zawiesza panel. Rownoleglosc z limitem przy wpieciu.
- **guardEnvelopeTier([]) = allow** (z przegladu, ADR-0095): pusty zbior modeli przepuszcza (envelope=no-egress); rozwazyc fail-closed (block "brak modeli") gdy ensemble dostanie realny call-site.
