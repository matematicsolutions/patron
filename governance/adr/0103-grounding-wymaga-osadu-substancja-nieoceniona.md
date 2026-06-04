# ADR-0103: Sygnal WYMAGA OSADU - teza tekstowo ugruntowana, ale substancja nieoceniona

**Status**: Przyjety (wdrozony) 2026-06-04 na branch `claude/citation-requires-judgment` (odgaleziony od `feat/tier-governance-envelope`). Backend (`cascade.ts` pole `requiresJudgment` + obie sciezki return; `ground-citations.ts` opcja `judgeUnavailable` + sciezka deterministyczna + licznik w `groundingSummary`; `stream.ts` wyliczenie `judgeUnavailable` + whitelist pola do klienta) + frontend (typ `PATRONCitationAnnotation.requiresJudgment`, mapowanie SSE w `useAssistantChat.ts`, pierscien amber + tooltip w `AssistantMessage.tsx`, i18n `citations.requiresJudgment`) zaimplementowane i zweryfikowane: tsc 0 (backend `npm run build` + frontend `next build` exit 0), vitest 1125 pass / 5 todo / 0 fail (+12 testow), zero regresji. Default-safe: pole pojawia sie tylko gdy `PATRON_CITATION_JUDGE` ON i sedzia byl niedostepny - tryb `judge=off` (swiadomy) NIE jest flagowany. ZOSTAJE przed merge do `main`: 2x review WM (reguła Konstytucja Art. 7) + self-review `matematic-patron-pr-review-pl`.

**Data**: 2026-06-04

**Powiazane zasady** (Konstytucja Patrona v1.6.0):
- **Art. 2 Tajemnica / Art. 1 Lokalnosc**: sygnal jest DETERMINISTYCZNY (boolean wyliczany z faktu "sedzia sie nie odpalil"), NIE z wywolania LLM. Zero egressu, zero nowej powierzchni PII (jak `verdict`/proweniencja - do UI/audytu idzie sam boolean). Co wiecej: sygnal istnieje WLASNIE PO TO, by uczciwie pokazac konsekwencje fail-closed - gdy tajemnica + model chmurowy blokuja sedziego (ADR-0097/judge.ts), teza zostaje nieoceniona i to musi byc widoczne, a nie zamaskowane falszywym "zielonym".
- **Art. 3 Audytowalnosc / determinizm**: `decision` (ADR-0005 `verifyOne`) ZOSTAJE deterministyczna i jest zrodlem prawdy dla BLOKADY. `requiresJudgment` to warstwa DORADCZA (jak `verdict` w ADR-0097) - NIE zmienia blokady. Licznik trafia do `groundingSummary` (AI Act art. 12): ile tez przeszlo bez kontroli sensu.
- **Art. 7 Minimalnosc**: zero nowej zaleznosci npm. Rozszerza istniejacy `cascade.ts` / `ground-citations.ts` / `stream.ts`; reuzywa `extractClaim` (ADR-0097) do detekcji "czy cytat podpiera teze".

**Powiazane ADR**:
- ADR-0005 (mechaniczny grounding `verifyOne`): NIETKNIETY. `requiresJudgment` to oddzielna os doradcza.
- ADR-0097 (cascade + paraphrase-judge): TO JEST jego domkniecie. ADR-0097 lapie Stanford "prawdziwy-cytat-falszywa-teza" GDY sedzia dziala. Ten ADR adresuje przypadek, GDY sedzia sie NIE odpali (flaga ON, ale fail-closed: tajemnica + model chmurowy -> `makeJudge`=null -> sciezka deterministyczna). Dotad ten przypadek byl CICHY - cytat tekstowo-zielony nieodroznlialny od ocenionego semantycznie. Teraz niesie jawny sygnal "teza nieoceniona, sprawdz".
- ADR-0102 (proweniencja): ORTOGONALNY. Tag = "skad pochodzi" (deterministyczny). `requiresJudgment` = "czy teza zostala oceniona" (deterministyczny meta-sygnal o tym, czy etap semantyczny zadzialal). Badge moze pokazac oba.

**Inspiracja** (wzorzec, nie kod): gradient weryfikacji ISTNIENIE/TRESC/FRAGMENT ze skilla MateMatic `citation-grounding-pl` (adaptacja Existence/Content/Paragraph z `jeannesulzer/international-criminal-tribunals-skills`, CC BY 4.0). Stan `WYMAGA_OSADU` (poziom TRESC: mechanika potwierdza obecnosc, substancje rozstrzyga czlowiek/judge) zmapowany na kaskade Patrona. Patrz THIRD_PARTY_INSPIRATIONS.md.

---

## Kontekst

ADR-0097 wprowadzil paraphrase-judge lapiacy najgrozniejszy przypadek halucynacji (cytat doslowny pod falszywa teza - Stanford/Magesh). Ale judge jest LOKALNY-ONLY i fail-closed (`judge.ts`): gdy sprawa to tajemnica, a model czatu jest chmurowy (Gemini/Claude/OpenRouter), `makeJudge` zwraca `null` -> kaskada nie dostaje sedziego -> grounding pozostaje czysto deterministyczny.

W tej (czestej) konfiguracji powstaje LUKA: cytat ktory istnieje doslownie w zrodle dostaje `decision="verified"` / verdict zielony, a CZY ZRODLO WSPIERA TEZE - nikt nie sprawdzil. Dla czytelnika pisma wyglada to identycznie jak cytat oceniony semantycznie. To cichy nawrot dokladnie tego ryzyka, ktore ADR-0097 mial adresowac - tyle ze poza zasiegiem judge.

## Decyzja

Wprowadzic deterministyczny sygnal doradczy **`requiresJudgment`** (WYMAGA OSADU): cytat jest tekstowo ugruntowany i podpiera teze, ale substancja NIE zostala oceniona semantycznie.

**Warunek (oba miejsca):** teza znana (cytat podpiera twierdzenie w prozie - `extractClaim` != "") AND zrodlo istnieje (status != BRAK_ZRODLA) AND etap 3 (sedzia) NIE rozstrzygnal.

Dwa miejsca wyliczenia:
1. **`cascade.ts`** (`groundCascade`): `requiresJudgment = !!claim && status != BRAK_ZRODLA && stage != 3`. Pokrywa: sedzia wstrzykniety lecz rzucil (fail-closed catch), oraz teza-bez-sedziego.
2. **`ground-citations.ts`** (sciezka deterministyczna, gdy `judge=null`): flaga `judgeUnavailable` (ustawiana w `stream.ts` gdy `PATRON_CITATION_JUDGE` ON, ale `makeJudge`=null) + `decision="verified"` + `extractClaim != ""`. Pokrywa najwazniejszy przypadek: cala sprawa fail-closed (tajemnica + chmura).

**Granice (jak ADR-0097):**
- `decision` (blokada) NIETKNIETA - `requiresJudgment` jest doradczy.
- `judge=off` SWIADOMIE (flaga OFF) NIE jest flagowany - to wybrany tryb pracy kancelarii, nie luka. Flagujemy tylko "chciano oceny, ale sie nie udala".
- Do UI/audytu idzie sam boolean (zero PII). `groundingSummary.requiresJudgment` = liczba (AI Act art. 12).

**UI:** pierscien amber wokol badge cytatu (nie zmienia koloru bazowego = grounding tekstowy) + dopisek w tooltipie ("tekstowo zgodny, ale tezy nie oceniono - sprawdz zrodlo"). Odroznia "zielony oceniony" od "zielony nieoceniony".

## Konsekwencje

**Plus**: domyka cicha luke Stanford poza zasiegiem judge; uczciwy sygnal kosztu fail-closed (tajemnica+chmura -> widac, ze teza nieoceniona); metryka audytowa AI Act art. 12; zero egressu/PII; zero nowej zaleznosci; default-safe (zero zmiany gdy flaga OFF).

**Minus / ryzyko**: przy `PATRON_CITATION_JUDGE` ON + model chmurowy + tajemnica WIELE cytatow dostanie sygnal (bo judge nigdy nie zadziala) - to poprawne, ale moze byc "halasliwe". Mitygacja: to sygnalizuje realny stan (firma wlaczyla ocene, ale konfiguracja jej nie pozwala) - wlasciwa reakcja to model lokalny dla tajemnicy, nie wyciszenie. Rezerwacja: ewentualny prog/agregacja w UI ("N cytatow wymaga osadu") zamiast per-badge, gdy eval pokaze halas.

**Rezerwacje**: wpiecie w tabular (ADR-0080) - obecnie tabular nie korzysta z judge, wiec poza zakresem; parytet do rozwazenia gdy tabular dostanie etap semantyczny. Eval na korpusie PL przed rekomendacja domyslnego ON.
