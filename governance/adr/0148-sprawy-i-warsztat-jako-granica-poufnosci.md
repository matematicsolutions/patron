# ADR-0148 — Sprawy i Warsztat: jeden korzen nawigacji i granica poufnosci widoczna w UI

- **Status:** Zaakceptowany (WM 2026-08-21, "dokoncz cala planowana architekture"; fala slownikowa PL+EN wdrozona w `db65017` - nav.assistant=Warsztat, nav.projects=Sprawy; pozostale jezyki i polityka egress per zakres = otwarte)
- **Data:** 2026-08-21
- **Galaz:** `feat/design-system-2-0` (dokument; kod bez zmian)
- **Zrodlo:** przeglad architektury informacji 2026-08-21 + korekta WM (mecenas uzywa Patrona
  do wielu rzeczy, nie tylko do konkretnych spraw)
- **Mapuje na:** ADR-0147 (system wizualny 2.0 — odroczyl te decyzje jako osobna),
  ADR-0101 (swiadoma zgoda Operatora), ADR-0143 (bramka egress), ADR-0132 (jeden jezyk
  per instalacja), Konstytucja Art. 1 (tajemnica zawodowa) i Art. 5

## Kontekst

### Dwie rownolegle hierarchie odziedziczone po forku

Nawigacja to dzis Asystent, Projekty, Przeglady tabelaryczne, Workflows. Przeglad tabelaryczny
istnieje pod `/tabular-reviews` **oraz** pod `/projects/[id]/tabular-reviews`. Czat tak samo:
`/assistant/chat/[id]` i `/projects/[id]/assistant/chat/[chatId]`. Uzytkownik musi pamietac,
czy pracuje "w projekcie", czy "luzem".

Slowo **projekt** przyszlo z powloki `willchen96/mike` i jest slownikiem narzedzia dla zespolow
produktowych, nie kancelarii. W kancelarii jednostka, wokol ktorej organizuje sie wszystko —
akta, rozliczenie, konflikt interesow, tajemnica — nazywa sie **sprawa**.

### Korekta, ktora zmienila projekt

Pierwsza wersja propozycji brzmiala: jeden korzen, Sprawy, wszystko wisi na sprawie, pytanie
bez sprawy trafia do brudnopisu proszacego o przypisanie.

WM (2026-08-21): mecenas uzywa Patrona do mnostwa rzeczy, ktore sprawa nie sa — sprawdzenia
przepisu, przygotowania szkolenia, przejrzenia nowej ustawy, rozmowy o czyms, co dopiero
**moze** stac sie sprawa.

Zastrzezenie jest trafne i wywraca pierwotny pomysl. Aplikacja zadajaca wyboru sprawy przy
kazdym pytaniu byla by biurokratyczna, a to najkrotsza droga do tego, zeby prawnik wrocil do
ogolnego czatu — czyli dokladnie do ryzyka, przeciw ktoremu Patron istnieje.

### Pomiar kosztu (2026-08-21)

- front: 41 plikow `.ts`/`.tsx` uzywa `project`
- i18n: 11 kluczy w `pl.ts`, czyli 77 lancuchow w 7 slownikach
- backend: 11 plikow tras, tabele `projects`, `project_subfolders`, `project_id` jako FK
  w `chats` i dalej
- dokumentacja: 67 plikow `.md` w `governance/` i `docs/`

**Ustalenie kluczowe:** `chats.project_id` jest **nullowalny** (`schema.sqlite.ts:130`). Czat
bez sprawy **juz istnieje w modelu danych** — to jest dzisiejsza sciezka `/assistant`. Warsztat
nie jest nowym bytem do zbudowania. Jest istniejacym stanem, ktory nie ma nazwy ani miejsca
w nawigacji.

## Decyzja

**1. Dwa korzenie, nie jeden: Sprawy i Warsztat.**

- **Sprawa** — miejsce, w ktorym sa dane klienta. Czat, przeglad tabelaryczny i workflow sa
  jej **widokami**, nigdy bytami obok niej.
- **Warsztat** — pelnoprawna przestrzen, nie poczekalnia. Pytanie zadane bez kontekstu moze
  w nim zostac na zawsze. Zadnego licznika, zadnego monitu "przypisz mnie".

**2. Kryterium podzialu jest prawne, nie porzadkowe.**

Przymus sprawy wlacza sie tam i tylko tam, gdzie pojawiaja sie **dane klienta** — bo od tego
zaleza tajemnica zawodowa, konflikt interesow i rozliczenie. Wgranie dokumentu klienta
**proponuje** przypisanie do sprawy; jest to propozycja, nie bramka. Gdzie danych klienta nie
ma, przymus bylby wylacznie uciazliwoscia.

**3. Zmiana slownika jest zmiana i18n, nie zmiana schematu.**

Nazwa widoczna dla uzytkownika (`Sprawa`) i identyfikator wewnetrzny (`projects`, `project_id`)
zostaja **rozdzielone**. Tabele, FK, trasy i nazwy w kodzie zostaja bez zmian; zmienia sie
11 kluczy w 7 slownikach. Zero migracji bazy, zero ruchu na kluczach obcych, zero ryzyka dla
danych. Dokumentacje aktualizuje sie stopniowo, bo mowi o strukturze kodu, nie o UI.

**4. Podzial niesie polityke egress — i to jest jego prawdziwa wartosc.**

Warsztat moze domyslnie dopuszczac model chmurowy; Sprawa nie. Wtedy podzial przestaje byc
kwestia porzadku, a staje sie **granica poufnosci widoczna w nawigacji** — to samo rozroznienie,
ktore raportuje pasek perymetru (ADR-0147).

**Ten punkt NIE jest tym ADR-em przesadzony.** Polityka egress per zakres dotyka ADR-0101
(zgoda Operatora) i ADR-0143 (bramka egress) i wymaga wlasnej decyzji. Zapisany tutaj jako
uzasadnienie ksztaltu, nie jako zatwierdzone zachowanie — inaczej zmiana nawigacji
przemyciloby zmiane regulu przetwarzania.

## Konsekwencje

**Pozytywne**

- Znika pytanie "w projekcie czy luzem": sa dwa miejsca i wiadomo, ktore do czego.
- Eksport akt sprawy i zamkniecie sprawy (pieczec Merkle, ADR-0026) staja sie jedna operacja,
  bo wszystko dotyczace klienta wisi w jednym miejscu.
- Slownik przestaje zdradzac pochodzenie powloki. "Projekt" na ekranie u adwokata brzmi jak
  narzedzie pozyczone skadinad.
- Granica poufnosci przestaje byc ustawieniem, a staje sie miejscem, w ktorym sie stoi.

**Koszty i ryzyka**

- 77 lancuchow w 7 slownikach; 5 z nich to tlumaczenia maszynowe wymagajace czytania przez
  prawnika z danego rynku (to samo ryzyko co w ADR-0147).
- Rozjazd nazwy widocznej i identyfikatora w kodzie jest swiadomym dlugiem: nowa osoba widzi
  `projects` w bazie i `Sprawy` na ekranie. Wymaga jednego zdania w AGENTS.md, inaczej wroci
  jako pytanie na kazdym onboardingu.
- Dopoki Warsztat nie ma wlasnej polityki egress, jest tylko nowa nazwa dla istniejacej
  sciezki `/assistant` — wartosc pojawia sie dopiero z punktem 4.
- Duplikacja tras (`/tabular-reviews` obok `/projects/[id]/tabular-reviews`) zostaje do
  osobnego sprzatania; ten ADR jej nie usuwa.

## Alternatywy odrzucone

- **Wszystko musi byc w sprawie** (pierwsza wersja propozycji). Odrzucone po korekcie WM:
  wymuszanie kontekstu przy kazdym pytaniu jest biurokracja, ktora wypycha prawnika do
  ogolnego czatu. Produkt przegrywa nie dlatego, ze jest gorszy, tylko dlatego, ze jest
  meczacy.
- **Brudnopis jako poczekalnia** — miejsce tymczasowe, ktore prosi o przypisanie. Odrzucone:
  to ta sama biurokracja, tylko odroczona o jeden ruch. Warsztat ma byc celem, nie korytarzem.
- **Zostawic slowo "projekt"**. Odrzucone: to nie jest kwestia gustu. Slownik produktu dla
  kancelarii ma uzywac pojec z kancelarii; "projekt" nie ma odpowiednika w aktach, rozliczeniu
  ani w regulach konfliktu interesow.
- **Przemianowac rowniez tabele i identyfikatory** (`projects` -> `matters`). Odrzucone:
  migracja bazy, ruch na kluczach obcych i 11 plikow tras backendu za zysk czysto kosmetyczny,
  niewidoczny dla uzytkownika. Cala wartosc siedzi w warstwie i18n.
- **Wprowadzic podzial razem z systemem wizualnym** (ADR-0147). Odrzucone: zmiana slownika
  produktu i zmiana palety maja inny promien razenia i inna liste bramek. Laczenie ich
  zabraloby mozliwosc wycofania jednej bez drugiej.
