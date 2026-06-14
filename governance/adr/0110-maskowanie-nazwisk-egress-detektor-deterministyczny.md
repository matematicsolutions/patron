# ADR-0110: Maskowanie nazwisk/podmiotow/adresow przed chmura - deterministyczny detektor PERSON/ORG/ADDRESS

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3` (off `feat/tier-governance-envelope`), NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora). Domyka ADR-0067 / blocker B1.
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P1 #4 (`AUDYT_PATRON.md`). W egress (`lib/chat/stream.ts`) `wrapConversation` byl wolany BEZ detektora -> `llmDetector` = `noopLlmDetector`. Skutek: PESEL/NIP/REGON/KRS/email/telefon maskowane (regex), ale **imiona, nazwiska, nazwy podmiotow i adresy wychodzily do modelu chmurowego otwartym tekstem**. Szkielet detektora + polski prompt (`POLISH_DETECTION_PROMPT`) istnialy - to niedokonczone ADR-0067.

## Decyzja

Nowy moduł `lib/pseudonim/plDetector.ts` - `plEntityDetector` implementujacy `LlmDetector`, wpiety w `wrapConversation` przez `streamChatWithTools` (`{ llmDetector: plEntityDetector }`). Detekcja jest **deterministyczna i zero-cloud** (regulowa/regexowa, w procesie, bez wywolania modelu - mimo nazwy interfejsu `LlmDetector`, ktora jest tylko kontraktem `detect()`). Konstytucja Art. 2 (zero-cloud) + Art. 3 (determinizm).

Kategorie:
- **ORG** - reuzycie utrzymywanego regexu form prawnych z `pl-entities` (`type=FIRMA`, `FIRMA_Z_FORMA_RE`: Sp. z o.o. / S.A. / Sp. k. / ...). NIE forkujemy `pl-entities` (reguly entity to shared library, ADR-0008) - filtrujemy wynik `detectAll`.
- **PERSON** - zakotwiczone na honoryfikatorze/tytule/roli procesowej (Pan/Pani/adw./mec./r.pr./sedzia/prokurator/swiadek/oskarzony/biegly/powod/pozwany/pokrzywdzony/obronca) + nastepujace 1-3 tokeny z wielkiej litery (z polskimi znakami i lacznikiem). Maskowana jest TYLKO nazwa (grupa 1), nie marker.
- **ADDRESS** - kod pocztowy (NN-NNN) + ulica/aleja/plac/osiedle z numerem (i opcjonalnym nr mieszkania).

## Uzasadnienie kompromisu precyzja/recall

Maskowanie jest ODWRACANE przez `unwrap` na strumieniu odpowiedzi (`PseudonimStreamUnwrapper`), wiec **nad-maskowanie NIE psuje finalnego outputu** (token wraca do oryginalu) - kosztuje tylko nieco zrozumienia po stronie modelu chmurowego. Wyciek (false negative) jest grozny i nieodwracalny. Stad:
- recall > precyzja, ale BEZ goych bigramow z wielkich liter - inaczej "Sad Najwyzszy", "Kodeks Karny", nazwy ustaw bylyby maskowane masowo, powaznie psujac kontekst prawny. Kotwica osobowa daje wysoka precyzje przy realnym recall (strony sa zwykle wprowadzane przez Pan/Pani/role).
- Gdy nazwa zostanie raz rozpoznana przez kotwice, `wrapInto` maskuje WSZYSTKIE jej wystapienia w konwersacji (takze gole) wspolna mapa - jeden token na osobe.

## Bug zlapany w realizacji (utrwalony w tescie)

`\b` (ASCII word-boundary) przed markerem zaczynajacym sie od polskiej litery (np. "świadek") NIE zachodzi w trybie `u` (spacja i "ś" to oba znaki nie-word) -> marker nie byl lapany. Zamieniono na lookbehind Unicode `(?<![\p{L}\p{N}_])`.

## Zakres / aktywacja

- Maskowanie egress jest juz bramkowane: `PATRON_PSEUDONIM_EGRESS != "false"` + egress != no-egress + classification != public (`stream.ts`). Detektor PERSON/ORG/ADDRESS aktywuje sie wraz z tym maskowaniem - bez nowej flagi (audyt chce go domyslnie). Tajemnica zawodowa i tak jest blokowana na bramie data-residency (decideRoute); to defense-in-depth dla danych nieobjetych bezwzgledna tajemnica (internal/client_general).
- Wolane bez `opts` (np. testy egress) -> `noopLlmDetector` (tylko identyfikatory regexowe) - brak regresji istniejacych testow.

## Konsekwencje

- (+) Nazwiska, nazwy podmiotow i adresy nie wychodza juz do chmury otwartym tekstem - domkniecie ADR-0067, realizacja minimum z audytu ("maskowac PERSON/ORG/adres").
- (+) Zero-cloud i deterministyczne - bez kosztu modelu, bez egresu, powtarzalne (Konstytucja Art. 2/3).
- (-) OGRANICZENIE v1: nazwisko BEZ kotwicy (samo "Jan Kowalski" w srodku zdania, bez Pan/roli) nie jest lapane; markery sa case-sensitive (sentence-initial "Świadek X zeznał" - honoryfikator i tak lapie nazwe przy "Pan/Pani"). Rozszerzenie (gazetteer imion PL / lokalny model NER, OCR-tolerancja diakrytyk) - rezerwacja. Twarde identyfikatory (PESEL itd.) lapie warstwa regex niezaleznie.
- **Testy:** vitest 1135 pass / 0 fail / 5 todo (+12 regresyjnych PL w `plDetector.test.ts`: PERSON po markerze, brak maskowania terminow prawnych, ORG po formie prawnej, ADDRESS, round-trip wrap/unwrap, spojnosc tokenu w konwersacji). tsc clean.
