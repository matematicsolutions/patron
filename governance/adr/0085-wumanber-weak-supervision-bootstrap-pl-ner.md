# ADR-0085: WuManber weak-supervision bootstrap PL NER

**Status**: Wdrozony 2026-05-31 (biblioteka offline). Konstytucja v1.5.0. wuManber + bootstrapAnnotate gotowe, eksportowane, przetestowane; konsumpcja do LoRA = FAZA2.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: anotacja korpusu jest deterministyczna, offline, zero wywolan LLM, zero egress. Slownik termow i tekst sa juz w pamieci backendu. Pipeline danych treningowych nie wychodzi poza maszyne.
- **Art. 3 - Audytowalnosc**: ten sam slownik na tym samym tekscie zawsze produkuje ten sam zbior spanow (brak temperatury, seeda, wersji modelu). Anotacja jest reprodukowalna, co jest warunkiem rzetelnego zbioru treningowego.
- **Art. 7 - Minimalnosc**: zero nowej zaleznosci npm. Czysty TypeScript + Node 20 stdlib. Algorytm liczy tylko to, co potrzebne (multi-pattern exact match), nie generuje encji ktorych nie ma w slowniku.

**Powiazane ADR**: ADR-0008 (entity extraction przy zapisie, zero LLM - dostarcza gazetteer COURTS + SIGNATURE_PREFIXES jako zrodlo termow slownika i ontologie etykiet). ADR-0003 (pseudonimizacja - opcjonalna warstwa LLM-fallback dla imion, ktorej ten bootstrap nie zastepuje, tylko uzupelnia o termy twarde). Inspiracja wzorcem: CN115221265A (CN-only, patrz THIRD_PARTY_INSPIRATIONS.md) - mechanizm auto-anotacji gazetteerem przez multi-pattern matching, reimplementacja od zera.

---

## Kontekst

ADR-0008 wybral deterministyczna ekstrakcje encji (regex + gazetteer + checksumy) jako sciezke produkcyjna przy zapisie dokumentu, swiadomie odkladajac wszystko "miekkie" (czy ten ciag to imie osoby, czy nazwa kancelarii) na warstwe pseudonim (ADR-0003) z opcjonalnym LLM-fallback. To pokrywa termy o scislym formacie (sygnatury, PESEL, NIP), ale nie pokrywa rozpoznawania nazw wlasnych w wolnym tekscie, gdzie format nie wystarcza.

Naturalnym uzupelnieniem byloby dotrenowanie malego modelu PL NER (np. LoRA na bazie open-weight, FAZA2 poza zakresem tego ADR). Bariera jest jedna: dotrenowanie wymaga korpusu z anotacjami, a reczna anotacja 2755 skanow korpusu Koziatek (i kolejnych dokumentow kancelarii) jest niewykonalna dla solo prawnika. To klasyczny problem zimnego startu NER.

Wzorzec weak-supervision (slaby nadzor) rozwiazuje go bez czlowieka: zamiast recznych etykiet uzywamy istniejacego slownika termow jako zrodla "slabych" etykiet. Bierzemy slownik (nazwy sadow i ich aliasy z gazetteera COURTS, prefiksy sygnatur z SIGNATURE_PREFIXES, lista form prawnych spolek, dowolny slownik dostarczony przez kancelarie) i mechanicznie znajdujemy kazde wystapienie kazdego termu w korpusie, oznaczajac je etykieta przypisana do termu. Wynik (span + etykieta) to zbior treningowy, ktory potem przechodzi przez fine-tune. Etykiety sa "slabe" (slownik moze nie pokryc wariantow fleksyjnych, moze zlapac homonim), ale mnoznik danych jest duzy (jeden slownik anotuje caly korpus), a koszt zerowy.

Wzgledem znalezionego wzorca (CN115221265A, CN-only, wolny do stosowania w EU, ale i tak reimplementujemy od zera) rdzeniem jest algorytm dopasowania wielu wzorcow naraz. Naiwne podejscie (dla kazdego termu osobny przebieg `indexOf` po calym tekscie) jest kwadratowe wzgledem liczby termow i nie skaluje sie na slownik setek tysiecy termow razy korpus tysiecy dokumentow. WuManber (Wu, Manber 1994) to standardowy algorytm multi-pattern exact matching: buduje tablice SHIFT (bad-character shift na blokach B znakow, liczona z minimalnej dlugosci wzorca) i przeskakuje fragmenty tekstu, ktore na pewno nie zaczynaja zadnego wzorca, weryfikujac kandydatow tylko przy shift zero.

Granica wydajnosci jest jawna i nie jest obiecywana z gory. WuManber daje przeskoki tylko gdy najkrotszy wzorzec jest dluzszy niz rozmiar bloku. Realny gazetteer COURTS zawiera krotkie aliasy (SN, SO, SR, SA - 2 znaki), wiec `minLen` spada do 2, `B` spada do 1, `defaultShift` do 2, a kubelki HASH dla dlugich nazw sadow weryfikuja sie znak po znaku. W takim slowniku skan degraduje w strone liniowego z duzymi kubelkami i przewaga nad naiwnym `indexOf`-per-term wynika glownie z jednego przejscia po tekscie zamiast N przejsc, nie z przeskokow. Czy realna przewaga jest istotna na korpusie Koziatek to pytanie pomiarowe, nie deklaracja (patrz Bramki). Mitygacja dostepna bez zmiany algorytmu: anotowac krotkie aliasy (<= 3 znaki) osobnym przebiegiem od dlugich nazw, zeby `minLen` dlugiego przebiegu nie byl sciagany w dol przez aliasy. v1 tego nie wymusza (krotkie i dlugie ida razem); rozdzielenie przebiegow to rezerwacja.

Wazna granica: to jest narzedzie offline budujace dane treningowe, nie sciezka requestu produkcyjnego. Bootstrap nie wpina sie w `indexDocument` ani w czat. Produkcyjna ekstrakcja przy zapisie pozostaje przy ADR-0008 (regex + gazetteer + checksumy). Bootstrap uruchamia sie raz, poza ruchem uzytkownika, zeby przygotowac korpus pod przyszly fine-tune.

---

## Decyzja

Dodac dwa moduly w `backend/src/lib/pl-entities/`: czysty algorytm WuManber (`wuManber.ts`) i anotator korzystajacy z gazetteera (`bootstrapAnnotate.ts`). Oba deterministyczne, offline, zero zaleznosci npm.

### A. Algorytm WuManber (`wuManber.ts`)

`buildWuManber(patterns, options)` kompiluje slownik wzorcow do struktury wyszukiwania, `searchWuManber(machine, text)` zwraca wszystkie wystapienia. Rozdzial budowy od skanu pozwala skompilowac slownik raz i przejsc nim wiele dokumentow.

Reprezentacja tekstu: pracujemy na tablicy punktow kodowych (`Array.from`), nie na `string.length`. Polskie diakrytyki w plaszczyznie podstawowej (BMP) sa jednostkami `Array.from`, a praca na punktach kodowych jest poprawna takze dla par zastepczych (surrogate pairs), wiec emitowane offsety sa indeksami punktow kodowych, spojnymi miedzy budowa a skanem. Zalozenie jest jawnie udokumentowane w module i w typie wyniku (`start`/`end` to indeksy punktow kodowych, nie jednostek UTF-16).

Struktura WuManber:
- `B` (rozmiar bloku) liczony z `m` (minimalna dlugosc wzorca w punktach kodowych): `B = 2` typowo, `B = 1` gdy najkrotszy wzorzec ma 1 znak. Bloki dluzsze niz `m` lamia algorytm (nie da sie zaadresowac bloku w najkrotszym wzorcu), wiec `B = min(2, m)` z dokumentacja zalozenia. Wartosc `B` jest deterministyczna funkcja slownika.
- `SHIFT`: mapa z bloku B-znakowego na maksymalny bezpieczny przeskok. Domyslny shift = `m - B + 1`. Dla kazdego wzorca i kazdego jego bloku na pozycji `j` (od konca prefiksu dlugosci m) shift = `min(dotychczasowy, m - j)`. Blok konczacy prefiks (shift 0) jest kandydatem do weryfikacji.
- `HASH`: mapa z bloku konczacego (shift 0) na liste indeksow wzorcow, ktore tym blokiem koncza prefiks. Lista jest posortowana deterministycznie (malejaco po dlugosci wzorca, potem rosnaco po indeksie), zeby kolejnosc weryfikacji byla stabilna.
- Klucz bloku: znaki bloku sklejone separatorem U+0000 (NUL), z wiodacym U+0000 przed pierwszym znakiem. NUL nie wystepuje w tekstach sadowych ani w gazetteerze, wiec klucze blokow jednoznacznych roznych skladowych nie koliduja (np. blok ze spacja w srodku nie myli sie z blokiem dwoch liter). To poprawia wczesniejszy projekt, ktory uzywal spacji jako separatora - spacja wystepuje w tekscie ("Sad Okregowy") i mogla teoretycznie kolidowac.

Skan: okno przesuwa sie po tekscie, czyta blok B-znakowy konczacy prefiks na biezacej pozycji, odczytuje shift. Gdy shift > 0, przeskok (zaden wzorzec nie konczy prefiksu tutaj). Gdy shift = 0, dla kazdego kandydata z HASH sprawdzamy doslowne dopasowanie wstecz (porownanie znak po znaku punktow kodowych). Trafienie emituje `{start, end, patternIndex}`. Po weryfikacji okno przesuwa sie o 1 (nie o shift), zeby nie pominac wzorcow nakladajacych sie i konczacych blisko siebie.

Gwarancje:
- **Brak false-negative**: kazde wystapienie kazdego wzorca jest znalezione. SHIFT nigdy nie przeskakuje pozycji, na ktorej konczy sie prefiks jakiegos wzorca (z konstrukcji tablicy), a przy shift 0 weryfikujemy wszystkich kandydatow. Inwariant pokryty testem porownujacym wynik WuManber z naiwnym `indexOf`-skanem na 200 losowych slownikach i tekstach (deterministyczny PRNG).
- **Overlapping**: wzorce nakladajace sie (np. "Sad Okregowy" i "Okregowy") oraz wzorce roznej dlugosci sa raportowane niezaleznie. Przesuw o 1 po weryfikacji gwarantuje, ze krotszy wzorzec wewnatrz dluzszego nie zostanie pominiety.
- **Case-insensitive opcjonalnie** (`options.caseInsensitive`): gdy wlaczone, wzorce i tekst sa normalizowane przez `toLowerCase()` PRZED budowa i skanem. Offsety zwracane sa wzgledem oryginalnego tekstu. Zalozenie: `toLowerCase` polskich liter nie zmienia liczby punktow kodowych (kazda wielka litera PL ma odpowiednik maly bedacy pojedynczym punktem kodowym BMP). Zalozenie jest weryfikowane testem na realnych literach z diakrytykiem ("SĄD" -> "sąd", "Ł" -> "ł", "ŻÓŁĆ" -> "żółć"), nie tylko na ASCII.
- **Determinizm**: brak stanu wspoldzielonego miedzy wywolaniami, stabilne sortowanie kandydatow, wynik sortowany na koncu (niezalezny od kolejnosci iteracji mapy).

Wynik `searchWuManber` jest posortowany rosnaco po `start`, przy remisie malejaco po `end` (dluzszy span pierwszy), przy dalszej remisie rosnaco po `patternIndex`.

### B. Anotator bootstrap (`bootstrapAnnotate.ts`)

`buildDictionary(extra?)` sklada slownik termow z etykietami z trzech zrodel ADR-0008 plus opcjonalnego slownika kancelarii:
- nazwy sadow z `COURTS` oraz kazdy alias z `Court.aliases[]` jako osobny wpis (etykieta `SAD`). Term jest spłaszczeniem: jedna nazwa + N aliasow daje N+1 wpisow o tej samej etykiecie, zeby "Sąd Najwyższy" i alias "SN" byly oba szukane,
- prefiksy sygnatur z `SIGNATURE_PREFIXES` (pole `prefix`, etykieta `SYGNATURA_PREFIX`, `caseSensitive: true` wg ADR-0008 - kody izb sa case-sensitive),
- formy prawne spolek (etykieta `FORMA_PRAWNA`) z lokalnej stalej `LEGAL_FORMS` w tym module.
- dowolny slownik `{term, label}` dostarczony przez wywolujacego (np. lista klientow kancelarii).

Uczciwie o duplikacji listy form prawnych: `regex.ts` nie eksportuje listy form prawnych. Formy (`Sp. z o.o.`, `S.A.`, `Sp. k.`, `S.K.A.`, `Sp. j.`, `Sp. p.`, `P.S.A.`) sa wpisane inline w literal `FIRMA_Z_FORMA_RE` (regex.ts linia 178) i nie da sie ich zaimportowac bez parsowania zrodla regexa. `bootstrapAnnotate` utrzymuje wiec wlasna kopie w stalej `LEGAL_FORMS`. To swiadoma, ograniczona duplikacja jednej krotkiej listy (7 pozycji), nie wspoldzielenie. Mitygacja: stala ma komentarz wskazujacy `FIRMA_Z_FORMA_RE` jako drugie miejsce do aktualizacji przy dodaniu nowej formy (np. spolki europejskiej). Pełna deduplikacja (wyciagniecie listy do osobnego eksportu uzywanego przez oba miejsca) to rezerwacja - nie robimy jej tutaj, bo wymaga modyfikacji `regex.ts` i przebudowy `FIRMA_Z_FORMA_RE`, co jest poza zakresem bootstrapu.

Termy puste i biale sa odfiltrowane. Duplikaty termow (ten sam tekst z rozna etykieta) sa zachowane jako osobne wpisy, zeby anotator mogl wyemitowac obie etykiety dla tego samego spanu (rozstrzyganie, ktora wygrywa, nalezy do konsumenta zbioru, nie do anotatora).

`bootstrapAnnotate(documentText, dictionary, options)` rozdziela slownik na dwa przebiegi: wpisy case-insensitive (domyslnie, gdy `options.caseInsensitiveDefault !== false`) i wpisy oznaczone `caseSensitive: true` (prefiksy sygnatur). Kazdy przebieg kompiluje wlasna maszyne `buildWuManber` z odpowiednim `caseInsensitive` i emituje `WeakLabelSpan[]`: `{start, end, term, label}`. `start`/`end` to indeksy punktow kodowych, `term` to doslowny fragment tekstu wziety z dokumentu (re-derywowany z offsetow przez `Array.from(text).slice(start, end)`, nie z wzorca - w trybie case-insensitive zachowuje oryginalna wielkosc liter dokumentu). Inwariant `term === slice(start, end)` jest pokryty testem.

Spany sa zwracane posortowane (po start rosnaco, jak w WuManber, z polaczonych przebiegow). Anotator nie usuwa nakladan ani nie rozstrzyga konfliktow etykiet - to surowe slabe etykiety, a deduplikacja/glosowanie to krok pipeline'u treningowego, nie tego modulu.

### C. Granica (offline, nie produkcja)

Zaden z modulow nie jest importowany przez `indexDocument`, `streamChatWithTools` ani zaden route. Eksportujemy je z `pl-entities/index.ts` jako biblioteka, ale wywolanie nalezy do skryptu offline budujacego korpus treningowy (poza tym ADR). Produkcyjna ekstrakcja przy zapisie pozostaje przy ADR-0008.

---

## Konsekwencje

**Pozytywne**:
- Zbior treningowy PL NER bez recznej anotacji: jeden slownik anotuje caly korpus 2755 skanow Koziatek (i kolejne dokumenty) za zero tokenow LLM. Mnoznik danych proporcjonalny do rozmiaru korpusu (do potwierdzenia pomiarem - liczba spanow per dokument).
- Jedno przejscie po tekscie zamiast N przejsc (N = liczba termow): nawet bez przeskokow WuManber czyta tekst raz, naiwny `indexOf`-per-term czyta go N razy. To przewaga staloczynnikowa niezalezna od tego, czy aliasy sciagaja `minLen` w dol.
- Zero nowej zaleznosci npm, czysty TS + Node 20 stdlib. Deterministyczny, offline, zero egress. Spojny z Art. 1/3/7.
- Reuzycie zrodla termow z ADR-0008: nazwy i aliasy sadow (COURTS) oraz prefiksy sygnatur (SIGNATURE_PREFIXES) sa importowane, nie kopiowane. Jeden punkt utrzymania dla sadow i prefiksow. Wyjatkiem jest krotka lista form prawnych (`LEGAL_FORMS`), ktorej regex.ts nie eksportuje - tu jest swiadoma duplikacja 7 pozycji z komentarzem (patrz sekcja B).

**Negatywne / koszt**:
- Lista form prawnych jest zduplikowana z inline-literalem `FIRMA_Z_FORMA_RE` w regex.ts (regex.ts nie eksportuje jej osobno). Dodanie nowej formy wymaga aktualizacji w dwoch miejscach. Mitygacja: komentarz krzyzowy; pelna deduplikacja to rezerwacja.
- Slabe etykiety sa szumne: slownik nie pokrywa wariantow fleksyjnych ("Sadu Okregowego" gdy slownik ma "Sad Okregowy") i moze zlapac homonim. To swiadomy kompromis weak-supervision. Mitygacja: etykiety ida do fine-tune jako sygnal, nie prawda absolutna; krok treningowy robi deduplikacje i moze odfiltrowac.
- Krotkie aliasy sadow (SN, SO, SR, SA) sciagaja `minLen` slownika do 2, co kasuje przeskoki WuManber dla dlugich nazw w tym samym przebiegu (skan degraduje w strone liniowego z duzymi kubelkami HASH). v1 nie rozdziela krotkich i dlugich termow na osobne przebiegi. Przewaga nad naiwnym skanem redukuje sie wtedy do jednego przejscia po tekscie (patrz Pozytywne). Rozdzielenie przebiegow per dlugosc to rezerwacja.
- Offsety na punktach kodowych, nie jednostkach UTF-16. Konsument zbioru musi uzyc tej samej konwencji przy materializacji spanow. Zalozenie udokumentowane w typie i ADR.
- Tryb case-insensitive zaklada, ze `toLowerCase` polskich liter nie zmienia liczby punktow kodowych. Prawdziwe dla polskiego alfabetu; gdyby doszly znaki lamiace to zalozenie, mapowanie offsetow wymaga rewizji. Pokryte testem na realnych diakrytykach (SĄD/sąd, Ł/ł, ŻÓŁĆ/żółć).
- Bootstrap nie zastepuje warstwy pseudonim ani regexow ADR-0008. To uzupelnienie pipeline'u danych, nie nowa sciezka produkcyjna.

**Bramki PRZED merge**:
- `bootstrapAnnotate.ts` istnieje, kompiluje sie i jest eksportowany z `index.ts` (modul, nie tylko deklaracja w ADR).
- TSC clean (backend) - `tsc --noEmit` EXIT 0.
- Testy zielone - `src/lib/pl-entities/wuManber.test.ts`: inwariant brak false-negative vs naiwny skan, overlapping, rozne dlugosci, case-insensitive na realnych diakrytykach PL (SĄD/sąd, Ł/ł), separator NUL nie koliduje, surrogate pairs, determinizm; oraz pokrycie `bootstrapAnnotate`: slownik z gazetteera, splaszczenie aliasow COURTS (alias "SN" wchodzi do slownika), re-derywacja termu z offsetow (term === slice), case-sensitive prefiksy, posortowanie. Pelny backend bez regresji.
- Pomiar wydajnosci na realnym `buildDictionary()` (z krotkimi aliasami) vs naiwny `indexOf`-per-term na probce korpusu Koziatek. Claim o przewadze ma byc poparty liczba (czas + liczba spanow), nie deklaracja. Jezeli przewaga jest mala z powodu krotkich aliasow, decyzja czy wdrozyc rozdzielenie przebiegow (rezerwacja 5) przed FAZA2.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.

## Co pozostaje zarezerwowane

1. **Wpiecie w pipeline treningowy LoRA** (FAZA2). Ten ADR dostarcza anotator; konsumpcja spanow do dotrenowania malego modelu PL NER (wybor bazy open-weight, format datasetu, runner treningowy) to osobna decyzja poza zakresem.
2. **Rozszerzenie slownika o warianty fleksyjne** (stemming/lematyzacja PL przed dopasowaniem). v1 dopasowuje doslownie. Pokrycie fleksji to przyszle rozszerzenie slownika lub generatora wariantow.
3. **Deduplikacja i glosowanie etykiet** (gdy kilka slownikow oznacza ten sam span rozna etykieta). v1 emituje surowe slabe etykiety; rozstrzyganie nalezy do kroku pipeline'u treningowego.
4. **Wpiecie w produkcyjna ekstrakcje przy zapisie**. Swiadomie nie robione - produkcja zostaje przy ADR-0008 (regex + gazetteer + checksumy). Bootstrap jest offline.
5. **Rozdzielenie przebiegow per dlugosc termu** (krotkie aliasy <= 3 znaki osobno od dlugich nazw), zeby krotkie aliasy nie sciagaly `minLen` dlugiego przebiegu i nie kasowaly przeskokow WuManber. v1 anotuje wszystko w przebiegach po wrazliwosci na wielkosc liter, nie po dlugosci.
6. **Pelna deduplikacja listy form prawnych** - wyciagniecie inline-listy z `FIRMA_Z_FORMA_RE` (regex.ts) do osobnego eksportu uzywanego przez regex i bootstrap. Wymaga przebudowy regexa, poza zakresem tego ADR.
