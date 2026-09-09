# ADR-0156 - Jedno otwarcie PDF-a w ingescie i realne odsuniecie indeksacji za odpowiedz

- **Status:** Przyjety (wdrozony 2026-09-09, galaz `claude/ecstatic-grothendieck-14737e`)
- **Data:** 2026-09-09
- **Galaz:** linia release 2.0.0
- **Zrodlo:** sprawa pozostawiona otwarta w ADR-0153 ("Czego ten ADR NIE mowi") - upload
  jednego PDF-a na 200 stron blokowal odpowiedz HTTP przez ~290 s, przez co rownolegle
  zadania konczyly sie bledem polaczenia
- **Mapuje na:** ADR-0153 (limit paczki embeddera), ADR-0074 (warstwa konwersji ->
  Markdown/OCR), ADR-0019 / ADR-0020 / ADR-0055 (skan input-security w ingescie),
  ADR-0054 (indeksacja hybrid retrieval), ADR-0056 (import Folderu Sprawy),
  ADR-0071 (zakaz pobierania wag modelu bez zgody Operatora)
- **KOLIZJA Z ADR-0154 - ROZSTRZYGNIETA PRZEZ SCALENIE (2026-09-09).** Rownolegla galaz
  `claude/bold-jennings-9d003b` (ADR-0154) tworzyla **ten sam plik**
  `backend/src/lib/retrieval/index-queue.ts` z innym API i innym limitem. Rozbieznosc nie
  byla nazewnicza: ADR-0154 przyjmowal, ze `void indexDocument(...)` bylo sluszne, bo
  "odpowiedz HTTP nie ma na co czekac". Obie strony mialy racje w swoim rezimie pomiaru -
  patrz "Dwa rezimy" ponizej. Scalono: mechanizm z tego ADR-a (`setImmediate`), wartosc
  limitu z ADR-0154 (2, zmierzone z wlaczonym embedderem). Jeden plik, jedno API
  (`scheduleIndexing` / `enqueueIndexJob` / `flushIndexQueue` / `INDEX_CONCURRENCY`).

## Kontekst

ADR-0153 zamknal sprawe pamieci i jawnie zostawil te: *"Upload jednego PDF na 200 stron
blokuje odpowiedz HTTP przez ~290 s (synchroniczna konwersja do Markdown w watku backendu),
przez co rownolegle zadania koncza sie bledem. To wada UX, nie pamieciowa; osobna sprawa."*

Zdanie w nawiasie bylo **hipoteza z lektury kodu**, nie pomiarem. Z lektury wyglada
przekonujaco: `ingestDocument()` przed odpowiedzia wola `convertToMarkdown()` (ekstrakcja
tekstu pdfjs), potem `extractStructureTree()`, potem `countPdfPages()` - czyli **trzy razy
`getDocument()` na tym samym buforze**. Naturalny wniosek: ten sam PDF jest parsowany
trzykrotnie i stad ~290 s.

Ta praca zaczela sie od zmierzenia tego podzialu. Podzial okazal sie inny, niz sugeruje
lektura, a wraz z nim - winowajca.

## Pomiar (2026-09-09)

Aparatura: PDF-y **syntetyczne** (generator `backend/scripts/make-synthetic-pdf.mjs`,
zero tresci realnej), izolowany backend z wlasnym `PATRON_DB_PATH` i storage w temp, baza
Operatora nietknieta. Przyrzady zostaja w repo: `backend/scripts/measure-ingest.ts`
(rozbicie faz calego ingestu) i `backend/scripts/measure-index.ts` (sama indeksacja).
Kazdy przebieg pdfjs mierzony takze w **swiezym procesie**, zeby cache modulu nie
faworyzowal tego, ktory akurat idzie pierwszy.

### 1. Trzy przebiegi pdfjs to nie sa trzy rowne trzecie

Swiezy proces na kazdy pomiar, sekundy:

| PDF | stron | #1 tekst (`getPage`+`getTextContent` per strona) | #2 drzewo (`getOutline`) | #3 liczba stron (`numPages`) |
|---|---|---|---|---|
| prosty | 200 | 0,60 | 0,05 | 0,06 |
| gestszy tekstem | 200 | 0,82 | 0,17 | 0,05 |
| gesty operatorami (Tj na slowo) | 200 | 1,96 - 4,00 | 0,10 - 0,15 | 0,12 - 0,21 |
| prosty | 800 | 2,06 | 0,09 | 0,06 |

Wewnatrz dzialajacego backendu (modul pdfjs juz zaladowany) przebiegi #2 i #3 schodza do
**0,0 s** - to, co widac powyzej, to w duzej czesci koszt zaladowania modulu, ponoszony
raz na proces, nie raz na dokument.

Przyczyna jest strukturalna, nie przypadkowa dla naszego materialu: `getDocument()` czyta
tablice xref i katalog dokumentu, a **tresci stron nie dotyka**. Strony parsuje dopiero
`getPage()` + `getTextContent()`, czyli wylacznie przebieg #1. Dlatego #2 i #3 sa **plaskie
wzgledem liczby stron** (800 stron kosztuje tyle samo co 200) i nie moga odpowiadac za
minuty. **Dokument byl otwierany trzy razy, ale parsowany strona po stronie tylko raz.**

### 2. Calego ~290 s na materiale syntetycznym NIE odtworzono

Pelny `ingestDocument` jednego PDF-a na 200 stron, ta sama maszyna: **2,1 - 6,0 s**.
Rozbicie (najgorszy z mierzonych plikow, 200 stron, 4,7 MB): konwersja 1,7 - 3,8 s,
`analyzeInput` 0,1 - 0,3 s, utrwalenie bajtow 0,0 - 0,1 s, drzewo 0,0 s, liczba stron 0,0 s.
Wniosek negatywny jest mocny i wystarcza do decyzji: **trzy przebiegi pdfjs nie tlumacza
~290 s.**

### 3. Co blokuje naprawde: `void indexDocument()` nie odsuwa niczego

`ingestDocument` odpala indeksacje jako `void indexDocument(...)` z komentarzem "best-effort
w tle (...) nie blokujemy odpowiedzi". To nieprawda i daje sie to zmierzyc. Funkcja `async`
wykonuje sie **synchronicznie az do pierwszego `await`, ktory faktycznie oddaje sterowanie**,
a `indexDocument` (chunkowanie, lokalizacja spanow, graf encji, zapisy SQLite) jest CPU-bound
i takiego punktu nie ma.

Zmierzone (warstwa wektorowa wylaczona, `PATRON_DISABLE_VEC=1`):

| chunkow | `indexDocument` calosc | z tego PRZED oddaniem sterowania |
|---|---|---|
| 1000 | 0,59 s | 0,59 s (100%) |
| 1595 | 1,75 s | 1,75 s (100%) |
| 4000 | 4,64 s | 4,64 s (100%) |

Sto procent. Indeksacja nie byla "w tle" ani przez chwile - siedziala w sciezce odpowiedzi,
tyle ze bez `await`, wiec bez sladu w kodzie, ktory by to zdradzil. Przy wlaczonym embedderze
w tym samym odcinku siedzi `embed()`, a **przed ADR-0153** byla to jedna gigantyczna paczka:
ADR-0153 zmierzyl dla niej 183 s na 400 chunkach. Dokument na 200 stron daje ~1000-1600
chunkow. To jest mechanizm o wlasciwym rzedzie wielkosci i tlumaczy takze drugi objaw -
zablokowana petla zdarzen nie obsluguje **nikogo**, wiec rownolegle zadania padaja.

### Czego nie zmierzono i dlaczego

- **Sciezki z prawdziwym embedderem.** Wagi `multilingual-e5-small` nie sa obecne na tej
  maszynie, a ich pobranie to egress do sieci, ktory ADR-0071 celowo zamyka za jawna zgoda
  Operatora (`PATRON_EMBED_ALLOW_DOWNLOAD`). Wlaczenie tego "przy okazji pomiaru" byloby
  obejsciem bramki zero-cloud przez agenta - decyzja nalezy do Operatora, nie do pomiaru.
- **Sciezki OCR.** Jesli PDF Operatora mial cienka warstwe tekstu, `hasEnoughText()` kieruje
  **caly** dokument do OCR (ADR-0074). Tesseract na tej klasie sprzetu robi ~1-2 s na strone,
  czyli 200-400 s dla 200 stron - sam w sobie trafia w ~290 s. Tego wariantu nie da sie
  wykluczyc bez oryginalnego pliku. Obie sciezki zostaja otwarte i sa nazwane, nie zamiecione.

## Decyzja

**1. Jedno otwarcie PDF-a na ingest.** `backend/src/lib/chat/pdf.ts` dostaje
`extractPdfDocument()`, ktore z JEDNEGO `PDFDocumentProxy` oddaje `{ text, pageCount,
outline }`. `extractPdfText()` zostaje jako cienka nakladka dla wolajacych, ktorych struktura
nie interesuje (czat, narzedzia agenta). Warstwa konwersji (ADR-0074) niesie te metadane
dalej w `ConvertResult.pdf`, a `ingestDocument` lapie je w punkcie wstrzykniecia zaleznosci -
dzieki temu przezywaja wyjatek z galezi OCR (skan ma strony, choc konwersja moze paść).

Powodem nie jest oszczednosc czasu - ta jest mala i pomiar to pokazuje. Powodem jest to, ze
byly to **trzy kopie wiedzy "jak otworzyc ten PDF"**, kazda z wlasnym `catch`, kazda mogaca
sie rozjechac. To ta sama klasa bledu, z ktora walczyl ADR-0055 (dwie kopie ingestu, jedna
bez skanu bezpieczenstwa). Przy okazji znika drugie pelne parsowanie DOCX (`mammoth` w
`extractStructureTree`) - drzewo struktury powstaje teraz z tekstu, ktory ekstrakcja juz
zwrocila, czysta funkcja `buildStructureTree()` bez I/O.

**2. Indeksacja idzie kolejka, ktora naprawde odsuwa - i ma gorna granice.**
`backend/src/lib/retrieval/index-queue.ts` robi dwie rzeczy, ktore latwo pomylic:

- `setImmediate` przesuwa start zadania za biezaca faze petli zdarzen, wiec odpowiedz HTTP
  zdazy pojsc do klienta. To naprawia wade opisana w tym ADR-ze. **Sam limit rownoleglosci
  tego nie daje**: `await` na spelnionej obietnicy to mikro-zadanie, ktore wykona sie przed
  faza I/O (sprawdzone na obu implementacjach przy scalaniu, nie wywnioskowane).
- semafor o gornej granicy `INDEX_CONCURRENCY` (domyslnie **2**, `PATRON_INDEX_CONCURRENCY`)
  ogranicza liczbe rownoczesnych indekserow, ktora przy imporcie Folderu Sprawy (ADR-0056)
  byla rowna liczbie plikow w katalogu. To wklad ADR-0154 wraz z pomiarem wartosci: limit 1
  kosztuje +32% czasu importu, limit 2 +6%, przy identycznym szczycie pamieci.

To NIE czyni indeksacji nieblokujaca: praca dalej zajmuje watek, gdy juz ruszy. Przenosi
granice - odpowiedz wychodzi przed nia, nie po niej. Zdjecie jej z watku (worker_threads)
to osobna decyzja.

**2a. Dwa rezimy pomiaru - i dlaczego oba ADR-y mialy racje.**
Pomiar w tym ADR-ze szedl przy **wylaczonej warstwie wektorowej** (wag `e5-small` nie bylo
na maszynie, a ich pobranie to egress za bramka ADR-0071). W tym rezimie `indexDocument`
nie ma ani jednego punktu oddania sterowania, wiec `void` blokowal odpowiedz w 100%.
Pomiar ADR-0154 szedl **z wlaczonym embedderem** (wagi wziete z zasobow zainstalowanej
aplikacji, zero pobierania), gdzie `await embed()` sterowanie oddaje - i tam liczyla sie
rownoleglosc, ktorej w rezimie bez wektorow po prostu nie ma. Zaden z tych pomiarow nie
obalal drugiego; kazdy widzial polowe.

**3. Bramka liczy OTWARCIA DOKUMENTU, nie sekundy.**
`documentIngest.pdfjs.test.ts` mockuje modul pdfjs i sprawdza, ze jeden ingest wola
`getDocument()` **dokladnie raz** oraz ze `page_count` i `structure_tree` sa nadal komplet.
Na kodzie sprzed tej zmiany test daje `expected 3 to be 1`. Deterministyczny, offline, bez
zegara - z tego samego powodu, dla ktorego ADR-0153 nie postawil progu pamieciowego w CI.

**4. Skan input-security zostaje PRZED utrwaleniem bajtow. Bez wyjatku.**
Kuszace bylo odsuniecie calej konwersji za odpowiedz - to najciezsza rzecz, jaka zostala w
sciezce. Nie wolno: `analyzeInput` potrzebuje tekstu, a wynik skanu decyduje, czy bajty w
ogole trafiaja do storage (`blocked` -> 422, zero zapisu). Dla skanu papierowego znaczy to,
ze **OCR tez zostaje w sciezce odpowiedzi**, bo bez niego nie ma czego skanowac. Bramka,
ktora dziala po utrwaleniu, nie jest bramka (ADR-0019 / ADR-0020 / ADR-0055).

## Czego ten ADR NIE mowi

- **Nie twierdzi, ze znalazl te ~290 s.** Wyklucza jedna hipoteze (trzy przebiegi pdfjs -
  zmierzone, falszywa), wskazuje mechanizm o wlasciwym rzedzie wielkosci (`void` nie
  odsuwajacy indeksacji - zmierzone, 100%) i nazywa dwie sciezki, ktorych na tej maszynie
  zmierzyc nie mozna (embedder bez wag, OCR bez oryginalnego pliku). Domkniecie wymaga albo
  zgody Operatora na wagi modelu, albo tego jednego PDF-a.
- **Nie czyni indeksacji nieblokujaca.** Przenosi granice: odpowiedz wychodzi **przed** nia,
  nie po niej. Gdy zadanie juz ruszy, dalej zajmuje watek. Zdjecie go z watku
  (`worker_threads`) to osobna decyzja i osobne ryzyko (better-sqlite3, singleton polaczenia).
- **Nie dodaje statusu "indeksowanie" do dokumentu.** Zmienia sie obserwowalne: dokument
  wraca jako `ready`, gdy indeks moze byc jeszcze niegotowy. Wczesniej indeks byl gotowy w
  chwili odpowiedzi - ale przez przypadek, bo `void` nie odsuwal, a nie przez obietnice
  kontraktu (ADR-0054 od poczatku opisywal indeksacje jako best-effort w tle). Nowy status
  to piec luster `event_type`/CHECK plus migracja Postgres - rezerwacja, nie ta zmiana.
- **Nie rusza progu `hasEnoughText` ani doboru silnika OCR.** Jesli to OCR zjadal minuty,
  lekarstwem jest OCR per strona i postep, nie ta zmiana.

## Konsekwencje

- Ingest PDF-a otwiera dokument raz zamiast trzech razy. Na mierzonym materiale to 0,1-0,4 s
  na dokument - malo; wartoscia jest jedno miejsce, w ktorym zyje wiedza "jak czytamy PDF".
- Ingest DOCX parsuje plik raz zamiast dwoch (znika `mammoth` z ingestu).
- Import Folderu Sprawy indeksuje po jednym dokumencie naraz zamiast wszystkich naraz.
- Odpowiedz HTTP wychodzi przed indeksacja. Testy dotykajace indeksu musza teraz czekac na
  `flushIndexQueue()` - dopisane w `documentIngest.test.ts` i w nowej bramce; bez tego
  `afterAll` zamykalby SQLite pod trwajacym zadaniem.
- Aparatura pomiarowa zostaje w repo (`make-synthetic-pdf.mjs`, `measure-ingest.ts`,
  `measure-index.ts`), zgodnie z lekcja ADR-0153. Nastepne podejrzenie o zator zaczyna sie od
  uruchomienia, nie od czytania kodu.
- Wzorzec jest przenosny i wart sprawdzenia w innych miejscach: **`void asyncFn()` nie jest
  odsunieciem w tlo.** Dla pracy CPU-bound bez punktu oddania sterowania to zwykle wywolanie
  synchroniczne, tylko bez `await`, ktory by to pokazal w kodzie.

## Alternatywy odrzucone

**Zostawic trzy przebiegi, skoro dwa sa tanie.** Pomiar faktycznie odbiera im status
winowajcy. Odrzucone mimo to: to trzy kopie tej samej wiedzy, kazda z osobnym `catch`, i
dokladnie ta klasa duplikacji rozjechala ingest przed ADR-0055. Koszt scalenia jest jednorazowy,
koszt rozjazdu placi sie w bezpieczenstwie.

**Odsunac konwersje/skan za odpowiedz HTTP.** Najwiekszy zysk czasowy i jedyna rzecz w tej
liscie, ktorej zrobic nie wolno. Skan input-security jest bramka przed utrwaleniem bajtow -
przesuniecie go za odpowiedz znaczy, ze dokument z prompt-injection lezy juz w storage, gdy
bramka sie odzywa. Granica governance wygrywa z wydajnoscia.

**Prog czasowy w tescie ("ingest 200 stron ponizej N s").** Wynik zalezalby od obciazenia
maszyny i od tego, czy LibreOffice akurat wstaje zimno. Test flaky w bramce jakosci uczy
ignorowac czerwone. Mierzalna deterministycznie jest przyczyna - liczba otwarc dokumentu -
i to ona jest w bramce (precedens ADR-0153).

**`worker_threads` dla indeksacji od razu.** Rozwiazuje wiecej: praca schodzi z watku HTTP
naprawde. Odrzucone teraz jako wieksze, niz uniesie dzisiejszy dowod - singleton polaczenia
SQLite (better-sqlite3, ADR-0053) i model embeddera musialyby zyc po drugiej stronie granicy
watkow. Najpierw domkniecie pomiaru, potem taka decyzja.

**Pobrac wagi embeddera, zeby domknac pomiar.** Odrzucone: to egress, ktory ADR-0071 zamyka
za zgoda Operatora. Agent nie otwiera bramki zero-cloud po to, zeby wygodniej mu bylo mierzyc.
