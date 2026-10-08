# ADR-0167 - Repertorium w czacie edycji PL: klucz instalacji, klasa `patron`, budzet grafu

- **Status:** Proponowany (bez kodu; czeka na decyzje D1-D3 wlasciciela produktu, sekcja nizej)
- **Data:** 2026-10-08
- **Galaz:** od `main` (linia publiczna)
- **Mapuje na:** ADR-0157 (weryfikator powolan), ADR-0158 (zatwierdzenie `human_review`),
  ADR-0166 (nakladka konfiguracji MCP), ADR-0027 (privilege rings), ADR-0028 (brama przy
  starcie), ADR-0101 (model chmurowy jako decyzja Operatora), ADR-0003 (pseudonimizacja),
  Konstytucja Art. 5 (projekt zmiany: `docs/PROJEKT_KONSTYTUCJA_ART5_2026-10.md`)

## Kontekst

Repertorium to korpus prawa polskiego i UE prowadzony przez MateMatic, wystawiony jako
serwer MCP. W dniu decyzji Patron korzysta z niego w jednym miejscu: przycisk "Sprawdz powolania"
(ADR-0157) wysyla liste powolan do `verify_citations`. Zeby to zadzialalo, Operator sam
dopisuje serwer z kluczem w nakladce (ADR-0166) i zatwierdza go w panelu konektorow
(ADR-0158). Narzedzia Repertorium sa celowo ukryte przed czatem (`backend/src/lib/mcp/verifier.ts`,
poprawka R-CC-07): model, ktory przeczytal pismo, mialby inaczej droge wyslania go w calosci.

Konektory bundlowane w edycji PL (SAOS, NSA, ISAP, KRS) oddaja surowe zrodla. Repertorium
dodaje to, czego one nie maja: mape tekstow jednolitych, graf powolan, os nowelizacji
przepisu, rozpoznanie wieloznacznej sygnatury i rozjazdu dat, ostrzezenie o dawnym
brzmieniu. W czacie odpowiada to na pytanie, ktorego model sam nie rozstrzygnie: czy ten
przepis obowiazuje dzis w tym brzmieniu.

Stan Repertorium sprawdzony w jego kodzie 2026-10-08:

- Limit dokumentow na klucz liczy unikalne dokumenty i jest sprawdzany przed odczytem.
  Jako dokument liczy sie tylko `get_document` - jedyne narzedzie, ktore oddaje pelny tekst.
- Wspolny dobowy sufit dokumentow klasy (`dokumentowKlasyNaDobe`) dziala niezaleznie od
  liczby kluczy.
- Dobowy sufit wydan kluczy obejmuje tylko klase `wolny`.
- `zapis: false` na kluczu wylacza zapis do magazynu analitycznego: tresc zapytan z
  takiego klucza nie jest zapisywana. Zostaje telemetria bez tresci zapytania (narzedzie,
  status, opoznienie, liczba wynikow).
- `get_citations` oddaje do 200 powiazan na wywolanie i liczy sie tylko do limitu wywolan
  klucza. Wspolnego budzetu klasy nie ma i nikt go swiadomie nie odrzucil - to luka.
- Samoobslugowe wydawanie kluczy ze strony WWW zostalo wylaczone decyzja wlasciciela
  produktu z 2026-09-14 (uzytkownik publiczny nie widzi tokenu); punkt wydawania bez
  sekretu odpowiada 401.

Skala grafu (raport wewnetrzny Repertorium): korpus PL liczy ponad milion dokumentow, a
graf powolan ponad dziesiec milionow krawedzi, srednio kilka do kilkunastu na dokument.
Zebranie grafu wymaga wiec w praktyce jednego wywolania `get_citations` na dokument, czyli
ponad miliona wywolan.

Dokladne progi ochrony (sufity klas, sufit wydan) zyja w kodzie Repertorium, w repo
prywatnym. Ten dokument podaje skale i arytmetyke, nie wartosci - opublikowany prog
ulatwia zaplanowanie przemiatania.

## Decyzja (proponowana)

1. **Edycja PL ma Repertorium w instalatorze, domyslnie wylaczone.** Wlacza je Operator
   przelacznikiem w panelu konektorow, po przeczytaniu, co wychodzi z komputera (tresc
   zapytan modelu do Repertorium; osoby, PESEL, adresy i e-maile zostaja tokenami, jak w
   kazdym zewnetrznym konektorze MCP). Wlaczenie i wylaczenie trafiaja do lancucha audytu
   istniejacym zdarzeniem `connector.toggle` - bez nowego `event_type`.
2. **Czat dostaje tylko narzedzia do czytania:** `search_law`, `get_document`,
   `get_citations`, `trace_history`. `verify_citations` zostaje wylacznie pod przyciskiem, w
   trybie listy - R-CC-07 bez zmian.
3. **Klucz instalacji pobiera Patron.** Przy wlaczeniu Patron prosi Repertorium o klucz
   klasy `patron` i zapisuje go w nakladce Operatora (ADR-0166). Klucz nie jest pokazywany w
   interfejsie, zgodnie z decyzja z 2026-09-14. Instalator nie niesie zadnego sekretu
   wydawania: sekret w instalatorze jest sekretem publicznym. Przed wynoszeniem korpusu
   chronia budzety klasy (punkty 4 i 5), nie tajnosc wydawania.
4. **Klasa `patron` w Repertorium:** stale 50 wyszukan na dobe na klucz, 150 wywolan
   razem, kilka dokumentow; limit wywolan na minute; `zapis: false` od chwili wydania; wlasny
   wspolny dobowy sufit dokumentow klasy i wlasny dobowy sufit wydan kluczy. Progi klasy
   `wolny` sie nie zmieniaja - zmiana limitow nie moze po cichu dotknac kluczy wydanych
   wczesniej.
5. **Wspolny dobowy budzet grafu klasy** (`grafuKlasyNaDobe`): limit wywolan
   `get_citations` dla wszystkich kluczy klasy lacznie, liczony w tej samej sekcji
   krytycznej Durable Object co sufit dokumentow. Dotyczy klas `patron` i `wolny`.
   Budzet dobieramy tak, zeby zebranie grafu wszystkimi kluczami klasy naraz trwalo lata
   ciaglego przemiatania - ta sama arytmetyka co dla dokumentow.
6. **Wyczerpany limit konczy sie komunikatem, nie cisza.** Repertorium zwraca w odmowie
   `retryable: false` i `retry_after_s` (wdrozone 2026-10-08). Patron pokazuje: limit
   darmowego dostepu wyczerpany, odnowi sie o podanej godzinie; wiecej -
   kontakt@matematic.co. Klucz wyzszej klasy wydany recznie wkleja sie w to samo miejsce.

## Decyzje wlasciciela produktu

- **D1 - progi klasy `patron`.** 50 wyszukan na dobe podal wlasciciel produktu
  (2026-10-08). Do potwierdzenia: limit dokumentow na klucz i wspolny sufit dokumentow
  klasy, osobny od klasy `wolny`. Propozycja liczbowa: `.matematic/spec/0167-progi-repertorium.md`
  (warsztat prywatny).
- **D2 - budzet grafu.** Wysokosc wspolnego dobowego budzetu `get_citations` na klase.
  Propozycja liczbowa z arytmetyka lat przemiatania: ta sama notatka.
- **D3 - kanal wydawania kluczy.** (A) automatyczny punkt wydawania dla Patrona, bez
  sekretu, z sufitem wydan i limitem na adres; (B) klucz wydawany recznie po kontakcie i
  wklejany w Patronie. Wariant A rozszerza decyzje z 2026-09-14: samoobsluga dotyczy tylko
  kanalu Patron, a token nadal nie jest widoczny dla uzytkownika.

## Konsekwencje

- Repertorium widzi tresc zapytan w chwili obslugi (przetwarzanie), ale jej nie zapisuje
  (`zapis: false`). Wymaga to wpisu w informacji o przetwarzaniu Repertorium.
- Koszt infrastruktury rosnie z liczba aktywnych instalacji. Nie mamy pomiaru kosztu
  wyszukania pod realnym ruchem - mierzymy go przed wlaczeniem przelacznika w wydaniu.
- Awaria Repertorium nie moze zatrzymac czatu: czat traci wtedy tylko narzedzia
  Repertorium, konektory bundlowane dzialaja dalej. To wymaganie wdrozenia, sprawdzane w
  e2e - w dniu decyzji go nie mierzylismy.
- Model dostaje narzedzia, ktore czesciowo pokrywaja SAOS i ISAP. Instrukcja dla modelu
  musi powiedziec, kiedy siegac po ktore.
- Nowa kategoria: zdalny konektor MateMatic w instalatorze. Lista zaufanych
  (`APPROVED_PATRON_CONNECTORS`) obejmuje w dniu decyzji tylko konektory bundlowane; Repertorium
  zostaje w Ring 2 z zatwierdzeniem Operatora, a lustra nazw konektorow (AGENTS.md,
  Mirrors #2) dostaja nowy wpis razem z testem parytetu.

## Alternatywy odrzucone

- **Wspolny klucz w instalatorze** - kazdy moze go wyjac; dzienne limity jednego klucza
  dzieli wtedy cala baza instalacji.
- **Wylacznie kontakt** - kazdy recznie wydany klucz to tarcie przy pierwszym uzyciu.
  Zostaje jako wariant D3-B i jako droga do wyzszej klasy.
- **Konto z adresem e-mail** - sprzeczne z minimalizacja danych instalacji desktop
  (ADR-0053: jeden lokalny uzytkownik, bez rejestracji).
- **Dostep anonimowy klasy `konsola`** - ta klasa nie wydaje dokumentow (`dokumenty: 0`)
  i obsluguje strone WWW przez wlasna funkcje posredniczaca; nie jest przeznaczona dla
  aplikacji.

## Czego ta decyzja NIE robi

- Nie zmienia trybu `verify_citations` ani poprawki R-CC-07.
- Niczego nie wlacza domyslnie.
- Nie dotyczy edycji innych niz PL.
- Nie zmienia progow klasy `wolny`; dodaje jej tylko budzet grafu (punkt 5).

## Kolejnosc wdrozenia (po decyzjach D1-D3)

1. Repertorium: budzet grafu i klasa `patron`, kazde z testem widzianym najpierw na
   czerwono (tysiac kluczy zatrzymuje sie na wspolnym budzecie).
2. Repertorium: punkt wydawania wedlug D3.
3. Patron: przelacznik, pobranie klucza, narzedzia do czytania w czacie, komunikat o
   limicie, lustra konektorow; e2e na spakowanej aplikacji.
