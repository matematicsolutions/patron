# ADR-0154 - Kolejka indeksacji w tle: rownoleglosc jako wielkosc projektowana, nie wypadkowa

- **Status:** Proponowany, **w czesci mechanizmu zastapiony przez ADR-0156** (scalenie
  2026-09-09). W mocy zostaje pomiar i wartosc limitu; sama kolejka opisana jest w ADR-0156.
  Review tresci: runda 1 marko-PL wykonana, runda 2 PENDING - AGENTS.md wymaga dwoch.
- **Data:** 2026-09-09
- **Galaz:** linia release 2.0.0
- **Zrodlo:** obserwacja zapisana w ADR-0153 ("Czego ten ADR NIE mowi") - `void indexDocument()`
  w `documentIngest.ts` zostal swiadomie poza zakresem tamtej poprawki
- **Mapuje na:** ADR-0153 (limit paczki embeddera), ADR-0056 (headless ingest + Folder Sprawy),
  ADR-0054 (indekser RAG), ADR-0055 (jedno zrodlo prawdy ingestu), ADR-0053 (desktop single-user)

## Kontekst

`ingestDocument` konczy sie zgloszeniem indeksacji bez `await`:

```ts
void indexDocument(docId, scanText).catch(...)
```

Intencja byla sluszna - embedding trwa dziesiatki sekund, a dokument jest juz utrwalony
i `ready`, wiec odpowiedz HTTP nie ma na co czekac (ADR-0056). **Ale ten zapis intencji nie
realizowal, i pierwsza wersja tego ADR-a myslila inaczej.** ADR-0156 zmierzyl, ze `void`
nie odsuwa niczego, gdy warstwa wektorowa jest wylaczona: `indexDocument` nie ma wtedy ani
jednego punktu oddania sterowania, wiec wykonuje sie w calosci przed odpowiedzia. Sprawdzone
przy scalaniu na obu implementacjach - semafor sam tego nie naprawia, dopiero `setImmediate`.
Mechanizm nalezy wiec do ADR-0156. Ten ADR odpowiada za druga wade: **nikt nie ograniczal
liczby takich zgloszen naraz**. `ingestFolder` (Folder
Sprawy, ADR-0056) idzie rekurencyjnie po wszystkich plikach katalogu i dla kazdego wola
`ingestDocument`, wiec liczba rownoczesnych indekserow byla rowna liczbie plikow w folderze.

To ta sama klasa wady co w ADR-0153, o pietro wyzej: tam nieograniczony byl rozmiar wsadu
dla modelu, tu liczba rownoczesnych wywolan modelu. Obie braly sie z danych
wejsciowych, nie z projektu.

## Pomiar (2026-09-09)

Hipoteza brzmiala: narost pamieci liniowy wzgledem liczby plikow w folderze. Nie
potwierdzila sie. Wynik negatywny jest tu opisany tak samo dokladnie jak byloby
potwierdzenie - w ADR-0153 rozumowanie z lektury kodu dalo trzy falszywe tropy.

**Aparatura** (powtorzona z ADR-0153): izolowana instancja backendu na osobnym porcie,
wlasny `PATRON_DB_PATH` i `PATRON_STORAGE_DIR` w katalogu tymczasowym (baza Operatora
nietknieta), swiezy proces na kazdy punkt pomiarowy, `PrivateMemorySize64` probkowany co
2 s, licznik zywych indekserow wpiety instrumentacja **wylacznie w `dist`** (nigdy w `src`).
Korpus: syntetyczne PDF-y z warstwa tekstowa, obsada fikcyjna (Rumpole), generator
deterministyczny. Model e5-small z zasobow instalatora, `PATRON_EMBED_ALLOW_DOWNLOAD=false`
(zero-cloud, zadnego pobierania wag).

### Rownoleglosc nie rosnie z liczba plikow - nasyca sie na 4-5

| plikow x stron | chunkow | max indekserow naraz | szczyt private | czas |
|---|---|---|---|---|
| 1 x 5 | 15 | 1 | 1 381 MB | 72 s |
| 5 x 5 | 75 | 4 | 1 385 MB | 112 s |
| 10 x 5 | 150 | 4 | 1 474 MB | 162 s |
| 20 x 5 | 300 | 4 | 1 473 MB | 317 s |
| 30 x 5 | 450 | 4 | 1 389 MB | 350 s |
| 5 x 50 | 750 | 5 | 1 389 MB | 447 s |
| 15 x 50 | 2 250 | 4 | 1 534 MB | 1 425 s |
| 30 x 50 | 4 500 | 4 | 1 403 MB | 1 498 s |

Sufit bierze sie z braku mocy, nie z granicy w kodzie. Granicy tam nie ma zadnej.
Inferencja ONNX zajmuje watek tak skutecznie, ze petla `ingestFolder` glodzi sama siebie:
nie zdaza otworzyc kolejnych plikow szybciej, niz indeksery koncza. W przebiegu 15 x 50
na 384 probki 259 mialo dokladnie jeden zywy indekser. Nawal zdarza sie tylko na poczatku
importu, zanim pierwsza indeksacja obciazy procesor.

### Pamiec nie koreluje z rownoleglescia

Srednia `PrivateMemorySize64` w przebiegu 15 x 50, w podziale na liczbe zywych indekserow:

| indekserow | srednia | probek |
|---|---|---|
| 0 | 1 248 MB | 27 |
| 1 | 1 214 MB | 259 |
| 2 | 1 265 MB | 1 |
| 3 | 1 067 MB | 44 |
| 4 | 1 135 MB | 53 |

Brak zaleznosci. Dryf w trakcie przebiegu (1 010 -> 1 290 MB) idzie za rozmiarem korpusu
i czasem, nie za liczba indekserow. Poziom ~1,4 GB to staly koszt zaladowanego modelu i
inferencji - dokladnie ten, ktory ADR-0153 zmierzyl jako "szczyt w trakcie indeksacji".
Marginalny koszt jednego dodatkowego indeksera jest rzedu megabajtow - to juz rachunek,
nie pomiar: pelny tekst akt 50-stronicowych (~250 kB), ich chunki i 150 wektorow po 384
wspolrzedne to razem okolo megabajta. Zgadza sie z brakiem widocznej zaleznosci w tabeli:
cztery indeksery zamiast jednego to kilka megabajtow przy 1 200 MB tla.

### Kolejka dziala i kosztuje

Ten sam korpus (30 x 50), ten sam zbudowany backend, roznica wylacznie w limicie:

| 30 x 50 | bez kolejki | limit 1 |
|---|---|---|
| max indekserow naraz | 4 | 1 |
| max glebokosc kolejki | - | 4 |
| szczyt private | 1 403 MB | 1 405 MB |
| czas calkowity | 1 498 s | 1 978 s (+32%) |
| odpowiedz HTTP | 1 372 s | 1 856 s (+35%) |

Zero oszczednosci pamieci, 32% czasu importu w plecy. Rownoleglosc pomagala
przepustowosci: gdy jeden indekser robi chunking, ekstrakcje encji i zapisy SQLite,
drugi moze liczyc embeddingi. Przy limicie 1 watki ORT stoja w tych fazach bezczynnie.

### Limit 2 odzyskuje przepustowosc - i dlatego on jest domyslny

| 30 x 50 | bez limitu | limit 1 | **limit 2** |
|---|---|---|---|
| max indekserow naraz | 4 | 1 | 2 |
| max glebokosc kolejki | - | 4 | 2 |
| szczyt private | 1 403 MB | 1 405 MB | 1 403 MB |
| czas calkowity | 1 498 s | 1 978 s (+32%) | 1 586 s (+6%) |
| odpowiedz HTTP | 1 372 s | 1 856 s (+35%) | 1 432 s (+4%) |

Zalozenie "embedder jest jednym procesem CPU, wiec jedna indeksacja naraz wystarczy" jest
nietrafione: indeksacja dokumentu to nie tylko inferencja, ale takze chunking, ekstrakcja
encji (ADR-0008), budowa grafu i zapisy SQLite. Drugi indekser wypelnia wlasnie te luki.
Trzeciego nie mierzylismy.

### Czego ten pomiar NIE rozstrzyga

Kazdy wariant zmierzono **raz**. Rozrzutu miedzy przebiegami nie mierzylismy, wiec:

- roznicy +6% (limit 2 wobec braku limitu) nie odrozniamy od rozrzutu. To moze byc kilka
  procent, moze byc zero. Nazwanie tego szumem wymagaloby zmierzenia szumu;
- +32% przy limicie 1 to inna skala (480 s na przebiegu ~1 500 s) i tego wniosku
  pojedynczy przebieg uniesie;
- brak korelacji pamieci z rownoleglescia opiera sie na 384 probkach z jednego przebiegu,
  ale rozklad jest plaski w calym zakresie 0-4 indekserow, a nie bliski progu decyzyjnego.

Powtorzenie kazdego wariantu trzy razy to okolo dwoch godzin maszyny. Nie zrobilismy tego,
bo zaden wniosek uzyty w decyzji nie zalezy od roznicy rzedu kilku procent.

## Decyzja

**1. Indeksacja przechodzi przez jedna kolejke FIFO o ograniczonej rownoleglosci.**
`backend/src/lib/retrieval/index-queue.ts`. Domyslnie **dwa zadania naraz**
(`PATRON_INDEX_CONCURRENCY` do przestrojenia). Dwa, a nie jedno, z pomiaru: przy limicie
1 import tego samego korpusu trwal o 32% dluzej, bo watki ORT staly bezczynnie w fazach
nie-embeddingowych indeksacji (chunking, encje, graf, zapisy SQLite). Przy limicie 2
koszt to +6% czasu importu i +4% czasu odpowiedzi, a szczyt pamieci jest ten sam.

**2. Wolajacy dalej nie czeka - i po scaleniu naprawde nie czeka.**
`scheduleIndexing(docId, text)` wraca natychmiast, a praca rusza dopiero w nastepnej fazie
petli zdarzen (`setImmediate`, ADR-0156). Pierwsza wersja tego ADR-a twierdzila, ze sam
brak `await` wystarcza; nie wystarczal. Kontrakt ADR-0056 jest teraz pilnowany bramka, ktora
sprawdza kolejnosc, a nie tylko to, czy funkcja wrocila.

**3. Limit siedzi w kolejce, nie w `ingestFolder`.** Z tego samego powodu, dla ktorego
ADR-0153 polozyl limit paczki w `embed()`, a nie w indekserze: dzis jedynym wolajacym "w tle"
jest ingest, ale kazdy nastepny (watcher folderu, ponowna indeksacja korpusu, import paczki
wiedzy) bedzie mial te sama pokuse i te sama wade. Limit nalozony w jednym miejscu obejmuje
takze tych, ktorych jeszcze nie ma.

**4. Bramka pilnuje liczby rownoczesnie pracujacych indekserow, nie zuzycia pamieci.**
`index-queue.test.ts` (kolejka w izolacji: szczyt rownoleglosci, FIFO, zadanie ktore rzucilo,
natychmiastowy powrot `scheduleIndexing`) oraz `documentIngest.indexQueue.test.ts` (szew:
12 plikow w folderze != 12 indekserow naraz). Oba deterministyczne, offline, z zamockowanym
indekserem. Progu pamieciowego w CI nie stawiamy - uzasadnienie w ADR-0153, "Alternatywy
odrzucone", i obowiazuje bez zmian.

## Czego ten ADR NIE mowi

- **Nie naprawia wycieku pamieci, bo zadnego nie znalazl.** Po ADR-0153 szczyt pamieci
  backendu przy imporcie folderu wynosi ~1,4 GB i nie zalezy ani od liczby plikow, ani
  od liczby rownoczesnych indekserow. Ta poprawka jest ograniczeniem projektowym, nie
  usunieciem usterki. Kto po latach przeczyta "kolejka indeksacji" i zalozy, ze rozwiazala
  problem pamieciowy, przeczyta zle.
- **Nie usuwa liniowego trzymania tekstu.** Zadanie czekajace w kolejce trzyma w domknieciu
  pelny tekst swojego dokumentu, wiec N oczekujacych to N tekstow. Tyle samo trzymal kod
  sprzed poprawki (tam wszystkie byly "w biegu"), wiec nic sie nie pogorszylo - ale nic tez
  nie poprawilo. Przy zmierzonych ~250 kB na akta 50-stronicowe i zaobserwowanej glebokosci
  kolejki 2-4 jest to rzad wielkosci pojedynczych megabajtow. Gdyby konwersja kiedys
  przestala blokowac watek (patrz nizej), glebokosc kolejki - a z nia to trzymanie - moglaby
  urosnac; wtedy trzeba je zmierzyc ponownie, a nie zalozyc.
- **Nie naprawia 23 minut odpowiedzi HTTP na import folderu - pogarsza je o minute.** To
  najgorsza liczba w calym pomiarze: `POST /folders/ingest` na 30 aktach po 50 stron
  odpowiadal po 1 372 s, a z limitem 2 odpowiada po 1 432 s (+4%). Zmiana wdrazana tym
  ADR-em idzie wiec w zla strone akurat na tej metryce - swiadomie, bo 60 s na 23 minutach
  nie zmienia nic w doswiadczeniu Operatora, dla ktorego oba czasy sa jednakowo nie do
  przyjecia. Przyczyna jest inna niz kolejka: konwersja do Markdown jest synchroniczna
  w watku backendu (ta sama usterka, ktora ADR-0153 zapisal jako "osobna sprawa"). Nasz
  wlasny harness pomiarowy wywrocil sie na niej najpierw - domyslny `headersTimeout`
  klienta HTTP to 5 minut, wiec pierwszy przebieg 30-plikowy zakonczyl sie wyjatkiem
  klienta, nie odpowiedzia serwera. Przegladarka Operatora ma dokladnie ten sam limit.
  Osobny ADR, i pilniejszy niz ten.
- **Nie daje kolejki trwalej.** Zamkniecie aplikacji w trakcie importu zostawia dokumenty
  utrwalone i `ready`, ale niezaindeksowane - po cichu, bez sladu i bez sciezki naprawy
  (w repo nie ma dzis zadnego endpointu ponownej indeksacji). Ta wada istniala przed ta
  poprawka i istnieje po niej; kolejka jedynie wydluza okno, w ktorym moze wystapic.
  Rozwiazanie (tabela zadan + wznowienie + widoczny postep) to osobna decyzja.
- **Nie stawia progu pamieciowego w CI.** Uzasadnienie z ADR-0153 obowiazuje bez zmian,
  a ten pomiar je wzmacnia: nie ma progu, ktory bylby zarazem stabilny i sensowny, skoro
  szczyt nie zalezy od wielkosci wsadu.
- **Nie twierdzi, ze 4 to sufit rownoleglosci na kazdej maszynie.** Szczyt 4-5 zmierzono
  na tej jednej maszynie, gdzie inferencja ONNX skutecznie glodzi petle importu. Na maszynie
  z szybszym CPU albo po przeniesieniu konwersji poza watek glowny nawal moglby byc wiekszy.
  Wlasnie dlatego limit jest w kodzie, a nie w zalozeniu o sprzecie.

## Konsekwencje

- **Liczba rownoczesnych indekserow przestaje byc wypadkowa, a staje sie parametrem** -
  kosztem +6% czasu importu i +4% czasu odpowiedzi, przy zerowej oszczednosci pamieci.
- **Bilans tej zmiany zalezy od pracy, ktora nie jest zaplanowana.** Dzisiejszy sufit 4-5
  bierze sie z tego, ze inferencja glodzi petle `ingestFolder`. Zdjecie konwersji z watku
  glownego - jedyna znana naprawa 23-minutowej odpowiedzi - to sprzezenie usunie i nawal
  urosnie do liczby plikow w folderze. Ta naprawa nie ma dzis ani numeru ADR, ani
  wlasciciela, ani terminu. Jezeli nigdy nie powstanie, ten ADR zostawia produkt z
  granica zapisana zamiast przypadkowej i rachunkiem +6%. Tyle. Nazywamy to wprost, zeby
  nikt nie czytal tej zmiany jako zysku, ktory juz zostal zainkasowany.
- **`PATRON_INDEX_CONCURRENCY` daje Operatorowi dzwignie** na slabszej maszynie (nizej =
  mniej rownoczesnej pracy, wolniej) bez przebudowy instalatora - analogicznie do
  `PATRON_EMBED_BATCH` z ADR-0153. Wartosc bezsensowna spada do domyslnej.
- **Kazdy przyszly wolajacy "w tle" dostaje limit za darmo**, bo drzwiami do indeksacji jest
  `scheduleIndexing`, nie `indexDocument`. Watcher Folderu Sprawy, ponowna indeksacja
  korpusu przy zmianie modelu i import paczki wiedzy (ADR-0140) beda z tego korzystac,
  nie wiedzac o tym.
- **Kontrakt szybkiej odpowiedzi (ADR-0056) jest teraz pilnowany testem**, a nie tylko
  komentarzem: `scheduleIndexing` musi wrocic, zanim indekser w ogole ruszy.
- **Aparatura pomiarowa jest powtarzalna i przybyla jej jedna czesc**: generator
  syntetycznych PDF-ow z warstwa tekstowa (obsada fikcyjna, deterministyczny) plus
  instrumentacja licznika indekserow nakladana na `dist`, nigdy na `src`. Warto ja odtworzyc
  przy nastepnym podejrzeniu - i pamietac, ze klient HTTP potrzebuje wylaczonego
  `headersTimeout`, inaczej mierzy sie limit klienta.

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean backend** (`npx tsc -p tsconfig.json`, exit 0).
- **Vitest backend**: 1 505 pass / 0 fail / 5 todo w 112 plikach (z 1 495 / 110 przed tym
  ADR-em; +10 w `index-queue.test.ts` i `documentIngest.indexQueue.test.ts`).
- **Bramka czerwona na kodzie sprzed poprawki** - sprawdzone, nie zalozone: przywrocenie
  `void indexDocument(...)` daje w tescie szwu 12 rownoczesnych indekserow zamiast 2.
- `scripts/adr_number_gate.py`: PASS (numer 0154 wziety z rejestru, licznik podbity
  0154 -> 0155 w tym samym kroku; rejestr zyje w prywatnym `.matematic/`, wiec w publicznym
  klonie ta kontrola jest pomijana jawnie).
- **Bramka publikacyjna** na tresci commita: 0 hard / 0 warn.
- **Zero nowych zaleznosci npm.** LoC: 117 (kolejka) + 335 (dwa pliki testowe) + 11 (szew).
- **Review tresci**: runda 1 (marko-PL) wykonana, osiem zarzutow naniesionych - w tym
  przemilczenie, ze zmiana pogarsza czas odpowiedzi HTTP. **Runda 2 PENDING.**

## Alternatywy odrzucone

**`await indexDocument(...)` w `ingestDocument`.** Najprostsze i najgorsze: odpowiedz HTTP
na upload jednego pliku rosnie o caly czas embeddingu (dziesiatki sekund do minut dla akt na
kilkaset stron), a przegladarka dostaje timeout przy dokumencie, ktory jest juz utrwalony i
gotowy. Kolejka daje ten sam limit rownoleglosci bez placenia latencja odpowiedzi.

**Limit w `ingestFolder` (petla z semaforem po plikach).** Naprawialby jedyna dzis znana
sciezke masowa i zostawial pulapke pod nogami kazdego nastepnego wolajacego w tle. Ta sama
argumentacja co w ADR-0153 przy wyborze `embed()` zamiast `indexer`.

**Kolejka trwala (tabela w SQLite zamiast struktury w pamieci).** Rozwiazywalaby wiecej -
przetrwalaby zamkniecie aplikacji, dalaby wznowienie i widoczny postep. Ale jest to inna,
wieksza decyzja: wymaga schematu, migracji, polityki ponawiania i UI postepu importu.
Odrzucona w tym ADR jako zakres, nie jako pomysl: patrz "Czego ten ADR NIE mowi".

**Limit 1 zamiast 2 ("embedder to jeden proces CPU, wiec jedna indeksacja wystarczy").**
Tak brzmiala hipoteza wyjsciowa i pomiar ja obalil: +32% czasu importu wobec +6% przy
limicie 2, przy identycznym szczycie pamieci. Limit 1 zostaje dostepny przez
`PATRON_INDEX_CONCURRENCY` dla maszyny, na ktorej ktos zmierzy go jako oplacalny - ale nie
jest domyslny, bo domyslna ma byc wartosc zmierzona, nie wartosc, ktora brzmi bezpiecznie.

**Zostawienie stanu jak byl (sam pomiar, zero zmian w kodzie).** Najmocniejsza z odrzuconych
i jedyna, ktora warto rozwazyc ponownie przy drugiej rundzie review: skoro warunek ze
zlecenia - "jesli pomiar potwierdzi narost" - nie zostal spelniony, konsekwentnym wynikiem
bylby zapis pomiaru bez zmiany kodu. Wybrano zmiane, bo brak narostu nie wynika z granicy
w kodzie, tylko z przypadkowego sprzezenia. Wazac te dwie racje trzeba pamietac, ze druga
z nich jest warta tyle, ile praca opisana w "Konsekwencjach" jako niezaplanowana.
