# ADR-0153 - Limit paczki embeddera: rozmiar wsadu do modelu jako granica pamieci procesu

- **Status:** Przyjety (wdrozony 2026-09-09, galaz `claude/zen-pascal-f32559`)
- **Data:** 2026-09-09
- **Galaz:** linia release 2.0.0
- **Zrodlo:** zgloszenie Operatora - aplikacja po dwoch dniach ciaglej pracy zajmowala
  18 050 MB commit w szesciu procesach, z czego 17 642 MB w jednym procesie bez okna
- **Mapuje na:** ADR-0054 (lokalny embedder), ADR-0007 (hybrid retrieval),
  ADR-0091 (podprocesy przez Node wbudowany w Electrona), ADR-0053 (desktop single-user),
  ADR-0056 (import Folderu Sprawy)

## Kontekst

Kancelaria nie zamyka narzedzia na noc. To nie jest hipoteza o uzytkowniku - to zmierzony
tryb pracy: instancja Operatora chodzila od 2026-09-07 12:23 przez dwa dni. W tym czasie
laczny commit szesciu procesow doszedl do 18 050 MB, a `pagefile.sys` do 41 GB przy
31,7 GB RAM. Po zamknieciu i ponownym uruchomieniu: 385 MB lacznie.

Rozklad byl nierowny i to on wskazal kierunek. Proces z oknem mial 76 MB. Winowajca byl
JEDEN proces bez okna: **17 642 MB commit przy 41 MB working set**. Taki rozklad - ogromna
alokacja przy znikomej rezydencji - znaczy, ze pamiec zostala dotknieta raz i nigdy wiecej,
wiec Windows wypchnal ja do pagefile.

W trybie desktop backend i frontend startuja jako `process.execPath` z `ELECTRON_RUN_AS_NODE=1`
(ADR-0091), wiec w menedzerze zadan wygladaja jak `PATRON.exe` bez okna - nie do odroznienia
na oko od renderera czy procesu GPU. Rozroznia je wylacznie wiersz polecenia: procesy
pomocnicze Chromium maja `--type=`, nasze dwa serwery nie maja. Winowajca byl backendem.

## Pomiar (2026-09-09)

Przyczyne ustalil pomiar, nie lektura kodu - i to jest tresc tego ADR-a rownie wazna jak
sama poprawka. **Trzy pierwsze hipotezy, wszystkie wiarygodne z lektury, okazaly sie falszywe:**

| Hipoteza | Weryfikacja | Wynik |
|---|---|---|
| Wyciek per-zadanie HTTP | 1800 zadan na szesc endpointow odczytowych | plaska (103,7 -> 110,2 MB, plateau po 75 iteracjach) |
| `pdfjs.getDocument()` bez `destroy()` | 4 wywolania w backendzie, `destroy()` ZERO w calym repo; mikro-benchmark 60 iteracji | plaska (76 -> 94 MB RSS) |
| Cache bez limitu (`tokenCache` / `dekCache` / `metaCache`) | przeglad granic | wszystkie ograniczone; `tokenCache` w trybie sqlite w ogole nieuzywany |

Dopiero petla ingestu dokumentu w izolowanej instancji backendu (osobny port, wlasny
`PATRON_DB_PATH`, baza Operatora nietknieta) pokazala skok 130 MB -> 4,3 GB. Zrodlem byl
`backend/src/lib/retrieval/indexer.ts` - `embed(pieces.map(p => p.content), "passage")`,
czyli **caly dokument oddany modelowi w jednej paczce**. Rozmiar wsadu = liczba chunkow
dokumentu, bez zadnej gornej granicy.

onnxruntime alokuje aktywacje pod NAJWIEKSZA widziana paczke i tej pamieci nie oddaje
(arena rosnie do high-water mark). Koncowy RSS procesu przy jednej paczce, swiezy proces
na kazdy punkt pomiarowy:

| chunkow w paczce | koncowy RSS |
|---|---|
| 100 | 1 757 MB |
| 200 | 2 735 MB |
| 400 | 4 093 MB |
| 800 | 8 824 MB |

Liniowo, ~10 MB na chunk. `heapUsed` przez caly czas 95 MB - to nie jest sterta V8
(jej limit i tak wynosi ~4 GB), tylko pamiec natywna poza rozliczeniem V8.
**Akta na ~1600 chunkow, czyli 300-400 stron, daja ~17,6 GB** - dokladnie tyle, ile
zmierzono u Operatora. Chunk to `DEFAULT_MAX_CHARS = 900` znakow, wiec mowa o rozmiarach
zwyklej sprawy, nie o skrajnosci. Import Folderu Sprawy (ADR-0056) podaje takie dokumenty
seriami.

Kontrola end-to-end na jednym PDF 200 stron, ten sam zbudowany backend, rozniacy sie
wylacznie limitem paczki: **szczyt 9 791 MB bez limitu vs 1 405 MB przy paczkach po 16.**

## Decyzja

**1. Gorna granica wsadu zyje w `embed()`, nie u wolajacych.**
`backend/src/lib/retrieval/embeddings.ts` tnie liste na paczki po `EMBED_BATCH_SIZE`
(domyslnie 16, `PATRON_EMBED_BATCH` do przestrojenia) i skleja wyniki z zachowaniem
kolejnosci. Wolajacych embeddera jest dzis kilku (indexer, retrieval, tabular) i kazdy
kolejny bedzie mial te sama pokuse "podaj wszystko naraz". Limit nalozony w jednym miejscu
obejmuje takze tych, ktorych jeszcze nie ma.

**2. `enableCpuMemArena: false` przy tworzeniu pipeline'u.** Arena onnxruntime nie oddaje
pamieci po inferencji. Przy paczkach o stalym rozmiarze nie jest nam do niczego potrzebna,
a jej wylaczenie scina staly narzut o kolejne ~27% (991 MB -> 725 MB na tym samym wolumenie).

**3. Bramka pilnuje ROZMIARU PACZKI, nie zuzycia pamieci.**
`embeddings.batch.test.ts` mockuje model i sprawdza, ze zadne wywolanie nie dostaje wiecej
niz `EMBED_BATCH_SIZE` sekwencji, ze kolejnosc wektorow odpowiada wejsciu i ze prefiks e5
trafia do KAZDEJ paczki, nie tylko pierwszej. Test jest deterministyczny i offline. Progu
pamieciowego w CI nie stawiamy swiadomie - patrz alternatywy odrzucone.

## Czego ten ADR NIE mowi

- **Nie zmienia jakosci retrievalu - to zostalo zmierzone, nie zalozone.** Rozumowanie
  "embedding kazdej sekwencji jest niezalezny od pozostalych w paczce" jest prawdziwe tylko
  wtedy, gdy pooling faktycznie maskuje padding; gdyby nie maskowal, wektory rozjechalyby sie
  wzgledem juz zbudowanego indeksu i re-index bylby konieczny. Kontrola: 40 sekwencji o
  celowo roznych dlugosciach (40-910 znakow, czyli maksymalny padding w duzej paczce),
  policzone raz jednym wsadem i raz paczkami po 16. **Maksymalna roznica na wspolrzednej: 0.**
  Wymiar, model i prefiksy e5 bez zmian, re-index niepotrzebny.
- **Nie jest optymalizacja wydajnosci**, choc nia przy okazji jest: paczkowanie po 16 jest
  SZYBSZE (103 s vs 183 s na 400 chunkach), bo jedna gigantyczna paczka jest paddowana do
  najdluzszej sekwencji i liczy mase pustych tokenow. Gdyby bylo wolniejsze, i tak nalezaloby
  je wziac.
- **Nie zamyka drugiej usterki ujawnionej przy pomiarze.** Upload jednego PDF na 200 stron
  blokuje odpowiedz HTTP przez ~290 s (synchroniczna konwersja do Markdown w watku backendu),
  przez co rownolegle zadania koncza sie bledem. To wada UX, nie pamieciowa; osobna sprawa.
- **Nie rusza `void indexDocument()`** w `documentIngest.ts`. Indeksacja leci w tle bez
  `await`, wiec przy imporcie folderu kilka indekserow moze zyc naraz, kazdy trzymajac pelny
  tekst swojego dokumentu. Po tej poprawce arena jest wspolna i ograniczona, wiec ryzyko
  spadlo z GB do MB - ale kolejkowanie indeksacji zostaje do rozwazenia osobno.

## Konsekwencje

- Szczyt pamieci backendu przestaje zalezec od wielkosci dokumentu. Byl liniowy
  (~10 MB na chunk), jest staly (~1,4 GB w trakcie indeksacji, ~725 MB po niej).
- Kancelaria moze trzymac PATRON otwartego przez tydzien. To byl warunek uzywalnosci, nie
  ulepszenie: aplikacja zjadajaca 17,6 GB u klienta z dluga sesja jest ryzykiem wydania 2.0.0.
- `PATRON_EMBED_BATCH` daje Operatorowi dzwignie na slabszej maszynie (nizej = mniej pamieci,
  wolniej) bez przebudowy instalatora.
- Wzorzec jest przenosny: kazde wywolanie modelu lokalnego, ktorego rozmiar wsadu bierze sie
  z danych wejsciowych, ma te sama wade. Przy dokladaniu kolejnego modelu (OCR, reranker,
  klasyfikator) limit paczki nalezy zalozyc od razu, nie po zgloszeniu.
- Aparatura pomiarowa jest powtarzalna i warto ja odtworzyc przy nastepnym podejrzeniu o
  wyciek: izolowany backend na osobnym porcie z wlasnym `PATRON_DB_PATH`, uruchomiony pod
  `PATRON.exe` z `ELECTRON_RUN_AS_NODE=1` (better-sqlite3 w paczce instalatora jest
  zbudowany pod ABI Electrona, nie systemowego Node).

## Alternatywy odrzucone

**Podzial w `indexDocument`, a nie w `embed`.** Naprawialby jedynego dzis znanego winowajce
i zostawialby te sama pulapke pod nogami kazdego nastepnego wolajacego. Limit jest
wlasnoscia modelu, nie indeksera.

**Restart procesu backendu po duzej indeksacji.** Odzyskuje pamiec i nic nie naprawia:
tracimy singleton polaczenia SQLite, zaladowany model i ~20 s startu, a uzytkownik dostaje
zawieszenie w srodku pracy nad sprawa. Leczenie objawu przez wylaczenie i wlaczenie.

**Podniesienie limitu sterty V8 albo poleganie na GC.** Nietrafione co do przyczyny: sterta
V8 trzymala 95 MB przez caly czas. Pamiec byla natywna, poza zasiegiem GC - `global.gc()`
wywolane jawnie w pomiarze nie odzyskalo z niej nic.

**Prog pamieciowy w tescie CI (np. "RSS ponizej 2 GB po indeksacji").** Wymagalby
zaladowania prawdziwych wag i inferencji w kazdym przebiegu (dziesiatki sekund), a wynik
zalezalby od maszyny i od tego, kiedy akurat zadzialal GC. Test flaky w bramce jakosci jest
gorszy niz brak testu, bo uczy zespol ignorowania czerwonego. Mierzalna deterministycznie
jest przyczyna - rozmiar paczki - i to ona jest w bramce.

**Wylaczenie warstwy wektorowej w trybie desktop.** Retrieval degradowalby do BM25 + grafu
(ADR-0007 Faza 1). Oszczedza pamiec kosztem tego, po co produkt istnieje.
