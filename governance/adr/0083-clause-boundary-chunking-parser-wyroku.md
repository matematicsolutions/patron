# ADR-0083: Clause-boundary chunking + parser sekcji wyroku

**Status**: Wdrozony 2026-05-31. Konstytucja v1.5.0. Wpiety w backend/src/lib/retrieval/indexer.ts (chunkLegalText zamiast chunkText).

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: chunkowanie jest deterministyczne, offline, zero wywolania LLM. Czysta arytmetyka stringow i wyrazenia regularne na tekscie, ktory backend juz trzyma w pamieci podczas ingestu (scanText z documentIngest.ts). Zero egress.
- **Art. 3 - Audytowalnosc / determinizm**: te same wejscie daje te same chunki (granice liczone tylko z tekstu, bez zegara, bez losowosci, bez stanu wspoldzielonego). Fabryki wzorcow zwracaja swiezy RegExp przy kazdym wywolaniu, zaden wzorzec nie ma flagi g. Granica chunku odpowiada granicy jednostki redakcyjnej (artykul, paragraf, ustep, punkt) albo sekcji wyroku, wiec cytat ugruntowany pozniej (ADR-0005) trafia w spojny fragment, nie w urwane zdanie z polowy akapitu.
- **Art. 7 - Minimalnosc / rzetelnosc**: slepe okno okolo 900 znakow tnie zdanie w pol i rozbija jednostke redakcyjna na dwa chunki, co psuje recall retrievalu i grounding. Ciecie po naturalnych granicach poprawia trafnosc bez nowej zaleznosci i bez kosztu LLM.

**Powiazane ADR**: ADR-0054 (hybrid retrieval RAG + graf, zrodlo funkcji `chunkText` w `lib/retrieval/indexer.ts` - ten ADR reuzywa jej jako fallbacku, nie duplikuje logiki akapitowej). ADR-0005 (mechaniczna weryfikacja cytatow - lepsze granice chunku to lepszy grounding: cytat trafia w spojna jednostke redakcyjna zamiast w urwany akapit). ADR-0008 (ekstrakcja encji i krawedzi grafu - dziala na pelnym tekscie dokumentu niezaleznie od chunkowania, wiec ta zmiana go nie dotyka).

---

## Kontekst

Indekser korpusu (`lib/retrieval/indexer.ts`, ADR-0054) tnie kazdy dokument funkcja `chunkText`: laczy akapity zachlannie do okolo 900 znakow, a akapit dluzszy niz limit tnie twardo co 900 znakow (`para.slice(i, i + maxChars)`). Dla zwyklej notatki to wystarcza. Dla wyroku sadu, uzasadnienia albo umowy slepe okno gubi strukture: ciecie co 900 znakow rozbija jeden artykul na dwa chunki, urywa zdanie w polowie i miesza koniec ustalen faktycznych z poczatkiem oceny prawnej w jednym fragmencie.

To uderza w dwa mechanizmy Patrona naraz. Po pierwsze retrieval (ADR-0054): zapytanie o "rozwazania prawne sadu" zwraca chunk, ktory w polowie jest jeszcze opisem stanu faktycznego, bo granica chunku wypadla w srodku sekcji. Po drugie grounding cytatow (ADR-0005): weryfikator porownuje cytat LLM z tekstem chunku, a jezeli chunk urywa zdanie, doslowny cytat moze nie zmiescic sie w calosci w jednym fragmencie.

Polski wyrok i uzasadnienie maja stala, rozpoznawalna strukture redakcyjna: naglowek z sygnatura, oznaczenie stron, zadanie i wnioski, ustalenia faktyczne, ocena prawna albo rozwazania, sentencja albo rozstrzygniecie. Akty normatywne i umowy maja jednostki redakcyjne: artykul, paragraf, ustep, punkt, litera. Te granice sa jawne w tekscie (naglowki, oznaczenia jednostek) i da sie je wykryc deterministycznie wyrazeniami regularnymi, bez LLM.

Pulapka false-positive. Czesc naglowkow sekcji wyroku to pospolite polskie slowa (Wniosek, Wnioski, przeciwko, Rozwazania, Ocena prawna, orzeka). Gdyby wykrywanie odpalalo granice na samym wystapieniu takiego slowa na poczatku linii, zwykla notatka albo mail z linia "Wniosek: trzeba odpisac klientowi" albo "przeciwko temu pomyslowi mam obiekcje" chunkowalyby sie inaczej niz dotychczas. To bylaby realna zmiana zachowania dla dokumentow nieprawniczych. Dlatego decyzja wprowadza brame trybu prawniczego (sekcja A) i wymog ksztaltu naglowka (sekcja B), tak zeby pospolite slowa nie aktywowaly ciecia poza realnym dokumentem prawniczym.

Wzorzec pochodzi z segment-aware judgment parser opisanego w CN111783399B i CN108763483A (oba CN-only, wiec wolne do stosowania w EU; i tak nie kopiujemy kodu) oraz z clause-boundary chunking w projekcie OSS LegRAG. Bierzemy sama idee (tnij po granicach jednostek redakcyjnych i sekcji przed chunkowaniem RAG), reimplementujemy od zera w stacku Patrona pod polski wyrok i polskie akty.

---

## Decyzja

Dodac modul `lib/retrieval/legalChunker.ts` z funkcja `chunkLegalText(text, opts)`, ktora wykrywa strukture polskiego wyroku i jednostek redakcyjnych, tnie po tych granicach, a gdy struktury brak deleguje do istniejacego `chunkText`. Indekser wola `chunkLegalText` zamiast `chunkText`. Sygnatura wyniku (`ChunkPiece { index, content }`) bez zmian, wiec reszta indeksera (embedding, FTS5, vec) dziala bez modyfikacji.

### A. Brama trybu prawniczego (dwie klasy markerow)

Wykrywanie dziala w dwoch przejsciach po liniach. Przejscie pierwsze ustala, czy dokument jest w ogole prawniczy: tryb prawniczy aktywuje sie tylko gdy w tekscie wystepuje co najmniej jeden marker mocny albo co najmniej jedna jednostka redakcyjna. Markery mocne to wzorce o niskim ryzyku false-positive w zwyklym tekscie: naglowek z sygnatura ("Sygn. akt"), "WYROK" (takze rozstrzelone "W Y R O K"), "POSTANOWIENIE", "UZASADNIENIE", "Sad ustalil" (w tym wariant "Sad ustalil nastepujacy"), "Sad zwazyl, co nastepuje". Jednostki redakcyjne to numerowane oznaczenia (Art. N, paragraf N, ust. N, pkt N, lit. x), ktore w prozie nieprawniczej praktycznie nie wystepuja na poczatku linii.

Jezeli przejscie pierwsze nie znajdzie zadnego markera mocnego ani jednostki redakcyjnej, funkcja zwraca dokladnie `chunkText(text)`. Pospolite slowa-naglowki (Wniosek, przeciwko, Rozwazania, Ocena prawna, orzeka, z powodztwa) klasyfikuja sie jako slabe i same z siebie nie wlaczaja trybu prawniczego. Zwykla notatka z linia "Wniosek:" zostaje na sciezce fallbacku.

### B. Wykrywanie sekcji kanonicznych wyroku (slabe naglowki tylko jako naglowek-linia)

Gdy tryb prawniczy jest aktywny, przejscie drugie zbiera granice. Slabe naglowki (zadanie/wnioski, ustalenia faktyczne, ocena prawna/rozwazania, sentencja/rozstrzygniecie, oznaczenie stron) licza sie jako granica tylko wtedy, gdy linia ma ksztalt naglowka: cala linia to dana fraza, opcjonalnie zakonczona dwukropkiem. Wzorzec wymaga konca linii albo dwukropka po frazie, wiec linia prozy typu "Ocena prawna sytuacji jest skomplikowana" nie jest naglowkiem, a linia "Ocena prawna:" jest. Markery mocne i jednostki redakcyjne nie wymagaja tego ograniczenia (sa wystarczajaco specyficzne). Tekst miedzy dwiema kolejnymi granicami to jeden blok logiczny.

### C. Wykrywanie jednostek redakcyjnych

W obrebie bloku (albo w dokumencie z jednostkami) granice na oznaczeniach jednostek redakcyjnych na poczatku linii: artykul ("Art. N", "Artykul N"), paragraf ("Par. N", znak paragrafu N), ustep ("ust. N"), punkt ("pkt N"), litera ("lit. x"). Jednostka redakcyjna jest naturalna granica chunku: zaczyna nowy chunk, nie jest sklejana z poprzednia. Jednostka redakcyjna jest tez markerem aktywujacym tryb prawniczy (sekcja A), wiec akt normatywny bez naglowkow wyroku tez jest ciety po jednostkach.

### D. Limit rozmiaru, fallback i jednolita normalizacja (reuzycie chunkText)

Kazdy blok sekcji albo jednostki redakcyjnej jest przepuszczany przez istniejacy `chunkText(blok, maxChars, minChars)` (import z `./indexer`). To ujednolica normalizacje: zarowno blok krotszy, jak i dluzszy niz `maxChars` przechodzi ta sama sciezka kolapsowania bialych znakow i podzialu akapitowego, wiec nie ma dwoch roznych regul normalizacji w zaleznosci od dlugosci bloku. Blok dluzszy niz `maxChars` zostaje dodatkowo podzielony do `maxChars` przez to samo wywolanie. Calosc fallbacku: gdy w dokumencie nie aktywowano trybu prawniczego (zwykla notatka, mail, pismo bez numeracji), `chunkLegalText` zwraca dokladnie `chunkText(text)`. To daje brak regresji dla dokumentow nieprawniczych: identyczny wynik jak dotychczas, potwierdzony testem rownowaznosci, w tym na notatce zawierajacej slabe slowa-naglowki.

### E. Determinizm i reindeks porzadkowy

Indeksy chunkow renumerowane od zera w kolejnosci wystapienia w tekscie. Brak zegara, brak losowosci. Zrodlem determinizmu jest to, ze fabryki wzorcow (`strongHeadingPatterns`, `weakHeadingPatterns`, `editorialUnitPatterns`) zwracaja swiezy RegExp przy kazdym wywolaniu, a zaden wzorzec nie uzywa flagi g (`.test()` nie przesuwa wtedy `lastIndex`). Nie ma wspoldzielonego stanu miedzy wywolaniami. Te same wejscie zawsze daje te same chunki, identyczne co do tresci i indeksu (Konstytucja Art. 3).

---

## Konsekwencje

**Pozytywne**:
- Wyrok i uzasadnienie tna sie po sekcjach i jednostkach redakcyjnych zamiast slepym oknem, wiec chunk odpowiada spojnej jednostce sensu. Bezposrednie wzmocnienie retrievalu (ADR-0054) i groundingu (ADR-0005).
- Zero nowej zaleznosci npm, zero kosztu LLM, zero egress. Czysty TypeScript i Node 20 stdlib, deterministyczne (Konstytucja Art. 1, 3, 7).
- Brak regresji dla dokumentow nieprawniczych. Bez aktywacji trybu prawniczego (sekcja A) wynik jest identyczny z dotychczasowym `chunkText`, takze dla notatek zawierajacych pospolite slowa-naglowki ("Wniosek:", "przeciwko", "Rozwazania", "Ocena prawna"). Potwierdzone testem rownowaznosci na fixture z tymi slowami.
- Jednolita normalizacja: kazdy blok idzie ta sama sciezka przez `chunkText`, wiec nie ma asymetrii podzialu akapitowego miedzy blokiem krotkim a dlugim.

**Negatywne / koszt**:
- Lista markerow i naglowkow jest heurystyczna i pokrywa czeste warianty polskiego wyroku, nie wszystkie. Liczba pokrytych wariantow nie jest jeszcze zmierzona na korpusie pilotazu (do potwierdzenia benchmarkiem). Nietypowy uklad uzasadnienia bez zadnego markera mocnego i bez jednostek redakcyjnych idzie sciezka fallbacku (akapitowa). To degradacja do stanu sprzed ADR, nie regres.
- Brama trybu prawniczego (sekcja A) celowo poswieca recall na rzecz braku false-positive. Dokument prawniczy zlozony wylacznie ze slabych naglowkow (np. sama "Ocena prawna" bez sygnatury, "WYROK" ani jednostek) nie aktywuje trybu i idzie fallbackiem. To swiadomy kompromis: lepiej nie zmieniac chunkowania niz ryzykowac regresje na notatkach.
- Granica chunku po jednostce redakcyjnej moze dac wiecej, krotszych chunkow niz okno 900 znakow (np. wiele krotkich punktow). Wiecej wierszy w `doc_chunks` i `vec_chunks`, ale kazdy spojny. Wplyw na rozmiar indeksu do potwierdzenia benchmarkiem na korpusie pilotazu.
- Wzorce wymagaja utrzymania, gdy pojawia sie nowe warianty z pilotazu. Mitygacja: dolozenie wariantu to jedna linia w odpowiedniej tablicy wzorcow, pokryta testem.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` EXIT 0, zero `any` bez komentarza, zero `@ts-ignore`.
- Testy zielone: nowy plik `src/lib/retrieval/legalChunker.test.ts` pokrywa fallback do akapitow (dokument bez struktury daje wynik identyczny z `chunkText`), test antyregresji na false-positive (notatka z liniami "Wniosek:", "Przeciwko", "Rozwazania", "Ocena prawna" daje wynik identyczny z `chunkText`), ciecie po sekcjach wyroku, ciecie po jednostkach redakcyjnych, wykrycie wariantu "Sad ustalil nastepujacy", komparycja po OCR ASCII ("z powodztwa") wewnatrz dokumentu prawniczego, dlugi blok dzielony do `maxChars`, determinizm (dwa wywolania daja identyczny wynik), pusty/bialy tekst. Brak regresji w pelnym backendzie.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.

## Co pozostaje zarezerwowane

1. **Metadana sekcji na chunku** (etykieta "ustalenia faktyczne" / "ocena prawna" jako kolumna `doc_chunks`, do filtrowanego retrievalu po typie sekcji). Wymaga migracji schematu i bumpu kontraktu chunku. Poza zakresem 0083 - tu chunk pozostaje plaski `{index, content}`, granica jest poprawiona, ale typ sekcji nie jest persystowany.
2. **Hierarchia jednostek redakcyjnych** (artykul zawierajacy ustepy zawierajace punkty jako drzewo, nie plaska lista granic). v1 traktuje kazda jednostke jako plaska granice chunku. Drzewo redakcyjne to osobna decyzja.
3. **Strojenie progow per typ dokumentu** (inny `maxChars` dla wyroku niz dla umowy). v1 uzywa jednego `maxChars` dziedziczonego z indeksera.
4. **Detekcja dokumentu prawniczego po slabych naglowkach** (aktywacja trybu prawniczego bez markera mocnego ani jednostki, np. po wystapieniu 2+ slabych naglowkow). v1 wymaga markera mocnego albo jednostki, zeby uniknac false-positive. Luzniejsza brama to osobna decyzja z wlasnym testem antyregresji.