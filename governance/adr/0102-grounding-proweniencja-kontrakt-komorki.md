# ADR-0102: Tagi proweniencji cytatu + kontrakt komorki tabeli z normalizacja verbatim

**Status**: Przyjety (wdrozony) 2026-06-04 na branch `feat/grounding-provenance-tabular`. Backend A (tagi proweniencji) + B (stan needs_review komorki tabular) + frontend (badge proweniencji w tooltipie czatu + status needs_review komorki) zaimplementowane i zweryfikowane: tsc 0 (backend + frontend), vitest 1114 pass / 0 fail (+20 testow A+B), self-review `matematic-patron-pr-review-pl` bez blockerow (zero wycieku PII - do UI/audytu tylko enumy/liczby; decision deterministyczna nietknieta). Dwa sprzezone postanowienia (A, B) wokol jednej osi: wiarygodnosc cytowania. Default OFF za flagami `PATRON_PROVENANCE_TAGS` / `PATRON_TABULAR_CELL_STATES` - zero zmiany zachowania do evalu. Konstytucja: PATCH 1.6.1 (rozszerzenie zasady audytowalnosci Art. 3 o liczniki proweniencji/needs_review; bez re-podpisu). ZOSTAJE przed merge do `main`: 2x review WM + eval na korpusie PL przed flipem flag.

**Data**: 2026-06-04

**Powiazane zasady** (Konstytucja Patrona v1.6.0):
- **Art. 1 Lokalnosc / Art. 2 Tajemnica**: tag proweniencji (A) jest DETERMINISTYCZNY - wyprowadzany z metadanych zrodla retrievalu (ktory konektor/dokument), NIE z wywolania LLM. Zero egressu, zero nowej powierzchni PII (w odroznieniu od judge w ADR-0097). Normalizacja verbatim (B) dziala lokalnie nad tekstem zrodla.
- **Art. 3 Audytowalnosc / determinizm**: `decision` (ADR-0005 `verifyOne`) ZOSTAJE deterministyczna i jest zrodlem prawdy dla BLOKADY. Tag proweniencji i stan komorki to enumy - warstwa znakowania/walidacji, nie zmiana blokady. Do audit_log i UI ida WYLACZNIE enumy (bez PII, jak `verdict` w ADR-0097).
- **Art. 7 Minimalnosc**: zero nowej zaleznosci npm. A owija istniejacy `cascade.ts`; B owija `verifyOne` + model komorki ADR-0011.

**Powiazane ADR**:
- ADR-0005 (mechaniczny grounding `verifyOne`): A i B buduja NAD nim, bez zmiany sygnatury.
- ADR-0097 (cascade + paraphrase-judge): A dokłada OSOBNA, ORTOGONALNA os do `verdict`. `verdict` = "jak bardzo zrodlo wspiera teze" (wymaga judge LLM, lokalny). Tag proweniencji = "skad pochodzi twierdzenie" (deterministyczny). Oba enumy do UI; badge moze pokazac oba. A wpina sie w `backend/src/lib/citation/cascade.ts` + `backend/src/lib/chat/ground-citations.ts` + SSE w `chat/stream.ts`, za flaga `PATRON_PROVENANCE_TAGS` (default OFF), analogicznie do `PATRON_CITATION_JUDGE`.
- ADR-0011 (span-level offsets + column type taxonomy): B ROZSZERZA istniejacy model komorki (`metadata: {segment_id, start, end}` + `col_type`). `location` z ADR-0011 = juz istniejace offsety; B NIE dodaje nowego pola lokalizacji, reuzywa `metadata`.
- ADR-0080 / ADR-0082 (grounding cytatow tabular + audit hash-chain): B wpina stany + normalizacje w istniejacy grounding tabular.
- ADR-0099 (domkniecie luk egress tabular): NIETKNIETY. Cytaty z akt nie wychodza do chmury; normalizacja lokalna.
- ADR-0001 / ADR-0026 (hash-chain + Merkle audit): tag proweniencji i licznik stanow komorek doklejane do `groundingSummary` jako enumy/liczby (jak `judge:{...}` w ADR-0097), ZERO tresci/PII. AI Act art. 12.

**Inspiracja** (clean-room, wzorzec nie kod): anthropics/claude-for-legal (Apache-2.0) - provenance tag vocabulary ("tag opisuje skad, nie pewnosc") + tabular every-cell-cited (`{value,state,quote,location}` + verbatim normalization). Bierzemy idee, nie kod. Patrz THIRD_PARTY_INSPIRATIONS.md.

---

## Kontekst

Dwie luki nad istniejaca warstwa grounding (ADR-0005/0097/0011/0080):

1. **Proweniencja dorozumiana, nie jawna.** Output nie znakuje konsekwentnie, czy twierdzenie pochodzi z pobranego zrodla (SAOS / ISAP / EUR-Lex), z dokumentu klienta, czy z wiedzy modelu. `verdict` (ADR-0097) mowi "jak bardzo wspierane", ale nie "skad". Czytelnik pisma nie odroznia faktu zweryfikowanego od pewnej-ale-niesprawdzonej wiedzy modelu - klasyczne ryzyko halucynacji wysokiej stawki (Stanford/Magesh).
2. **Tabular bez twardego kontraktu anty-halucynacyjnego per komorka.** Model komorki ADR-0011 ma offsety + score + typ, ale nie wymusza mechanicznie "cytat = kopia znak-w-znak albo komorka oznaczona do przegladu", ani petli re-weryfikacji wobec zrodla. Pusta/niska-score komorka nie rozroznia "nie ma w dokumencie" od "nie dalo sie zweryfikowac".

## Decyzja A - Tagi proweniencji cytatu (deterministyczne)

Kazde nietrywialne twierdzenie znakowane tagiem proweniencji opisujacym POCHODZENIE (deterministycznie wyprowadzone ze zrodla retrievalu), nie pewnosc.

**Slownik (enum):**
| Zrodlo | Tag |
|---|---|
| Orzeczenie PL (mcp-saos) | `[SAOS - sad - sygn. - data]` |
| Ustawa/akt PL (mcp-isap) | `[ISAP/ELI - Dz.U. ... - data]` |
| Akt UE / CJEU (mcp-eurlex) | `[EUR-Lex - CELEX:{nr} - data]` |
| Dokument klienta (RAG) | `[uzytkownik - {plik} - offset]` |
| Wszystko inne (DEFAULT) | `[model - zweryfikuj]` |

Dwie osie ortogonalne do tagu zrodla: `[zweryfikuj]` (fakt do potwierdzenia) / `[do oceny]` (osad dla prawnika).

**Reguly twarde:**
1. DEFAULT = `[model - zweryfikuj]`. Nie pobrales -> tag modelu, niezaleznie od pewnosci. Zakaz awansu tagu "bo wyglada dobrze".
2. Pinpoint zawsze `[zweryfikuj]` (numer artykulu/ustepu; polskie nowelizacje przenumerowuja).
3. Konflikt tool-vs-model -> pokaz oba z tagami, bez cichego wyboru.
4. Tag wyprowadzany z metadanych zrodla (ktory konektor/czy RAG-doc), NIE z wywolania LLM -> brak egressu, brak nowej powierzchni PII.

**Egzekucja:** `cascade.ts`/`ground-citations.ts` dolaczaja `provenance` (enum) per cytat. Do SSE i frontu - WYLACZNIE enum (jak `verdict`, slim payload ADR-0097). Badge moze pokazac tag + verdict. Tag -> `groundingSummary` (liczby per tag) -> audit_log (ADR-0001).

## Decyzja B - Kontrakt komorki tabeli: jawne stany + normalizacja verbatim

ROZSZERZENIE modelu komorki ADR-0011 (NIE nowy kontrakt). Reuzywa offsety ADR-0011 jako `location` i `verifyOne` (ADR-0005) jako mechanizm porownania.

**Dodawane:**
1. **Jawny stan komorki** (enum): `answered | not_present | unclear | needs_review`. Dzis komorka ma score + threshold (ADR-0011); brak rozroznienia "nie ma w dokumencie" (`not_present`) od "nie dalo sie zlokalizowac/skopiowac doslownie" (`needs_review`). Pusta komorka ukrywa informacje -> zawsze jeden ze stanow.
2. **Regula verbatim:** `quote` (tekst spod `metadata.start/end`) musi byc kopia ZNAK-W-ZNAK zrodla. Nie da sie zlokalizowac/skopiowac -> `state=needs_review`, `value=null`, `notes=quote_unavailable:<powod>`. Zakaz zgadywania.
3. **Pass normalizacji:** po wygenerowaniu siatki re-otworz zrodlo, porownaj `quote` znak-w-znak (reuse `verifyOne`/`normalize`, OCR-aware gdy `wasOcrd`). Mismatch -> degraduj komorke i POSZERZ spot-check na cala kolumne (mismatch = sygnal systemowego bledu ekstrakcji).

**Egzekucja:** w grounding tabular (ADR-0080/0082). Egress guard ADR-0099 nietkniety. Licznik stanow -> `groundingSummary` (enumy/liczby) -> audit.

## Granica governance (kluczowa)

`decision` z `verifyOne` (ADR-0005) ZOSTAJE deterministyczna i jest zrodlem prawdy dla BLOKADY. Tag proweniencji (A) i stan komorki (B) to warstwa DORADCZA/walidacyjna (UI + audyt). Czy `[model - zweryfikuj]` lub `needs_review` ma blokowac deliverable = osobna decyzja governance (rezerwacja, jak polityka blokady `verdict` w ADR-0097).

## Ewaluacja (eval-first)

- A: testy jednostkowe wyprowadzania tagu z metadanych (SAOS/ISAP/EUR-Lex/RAG/model), reguly default + pinpoint + konflikt. Brak retrievalu -> `[model - zweryfikuj]`.
- B: testy stanow (answered/not_present/unclear/needs_review), normalizacja (mismatch -> degradacja + poszerzenie spot-check), no-op gdy quote zgodny.
- Bramki: tsc 0, pelny suite bez regresji na grounding/cascade/tabular. Eval na korpusie PL przed flipem flagi (default OFF do pomiaru).

## Alternatywy odrzucone

- **Tag pewnosci zamiast proweniencji** (wysoka/srednia/niska). Odrzucone - pewnosc modelu nieskalibrowana; "pewny-i-bledny" to problem Stanford. Proweniencja obiektywna (pobralem / nie pobralem).
- **Tag z wywolania LLM (jak judge).** Odrzucone - proweniencja jest znana deterministycznie z metadanych zrodla; LLM dodalby egress + PII bez wartosci.
- **B jako nowy model komorki.** Odrzucone - ADR-0011 juz ma offsety + typ; B je ROZSZERZA o stany + normalizacje, nie duplikuje.
- **Stan komorki/tag zmienia `decision` (blokade) w v1.** Odrzucone - blokada deterministyczna (Art. 3); warstwa doradcza; polityka blokady = osobna decyzja governance.

## Rezerwacje (pozostale kroki)

- Wpiecie A w UI badge (tag obok verdict) + i18n; persystencja tagu w annotation (enum, bezpieczny).
- OCR-aware normalizacja B wymaga persystencji `ocrUsed` (dzis nie persystowany - wspolna rezerwacja z ADR-0097).
- Polityka blokady: czy `[model - zweryfikuj]` / `needs_review` blokuje deliverable (governance, Konstytucja).
- Eval z realnym korpusem PL (SAOS/ISAP) przed wlaczeniem flag w prod.
- Reconcile z warstwa SKILLI: sesja rownolegla rozwija domenowe weryfikatory (`kio-grounding-pl`, `uodo-grounding-pl`) reuzywajace silnika `citation-grounding-pl` (skill). To ODRENBA warstwa od kodu produktu (`backend/src/lib/citation/`) - brak kolizji, ale slownik tagow proweniencji warto trzymac spojny miedzy oboma.
