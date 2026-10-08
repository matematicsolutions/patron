# ADR-0167 - Repertorium w czacie edycji PL: klucz instalacji, klasa `patron`, budzet grafu

- **Status:** Zaakceptowany 2026-10-08 (decyzje D1-D3 podjete, sekcja nizej). Kod: sekcja
  "Wdrozenie"; wdrozenie Repertorium na produkcje i wydanie instalatora - wlasciciel produktu.
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

1. **Edycja PL ma Repertorium w panelu konektorow, domyslnie wylaczone.** Wlacza je Operator
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

## Decyzje wlasciciela produktu (podjete 2026-10-08: wszystkie wedlug rekomendacji)

- **D1 - progi klasy `patron`.** Na klucz: 50 wyszukan i 10 dokumentow na dobe (te liczby
  widzi uzytkownik w panelu). Wspolny sufit dokumentow klasy, osobny od klasy `wolny`. Propozycja liczbowa: `.matematic/spec/0167-progi-repertorium.md`
  (warsztat prywatny).
- **D2 - budzet grafu.** Wspolny dobowy budzet `get_citations` na klase, dobrany tak, zeby
  zebranie grafu obiema klasami naraz trwalo okolo dwoch lat.
  Propozycja liczbowa z arytmetyka lat przemiatania: ta sama notatka.
- **D3 - kanal wydawania kluczy: wariant A.** Automatyczny punkt wydawania dla Patrona, bez
  sekretu, z sufitem wydan i limitem na adres. Wariant B (klucz recznie po kontakcie)
  zostaje droga do wyzszej klasy. Wariant A rozszerza decyzje z 2026-09-14: samoobsluga dotyczy tylko
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
- Repertorium zostaje konektorem nakladki Operatora w Ring 2 z zatwierdzeniem bramy
  (ADR-0158), jak w ADR-0157. Wpis powstaje w nakladce przy wlaczeniu, nie w manifescie
  instalatora, wiec lista zaufanych (`APPROVED_PATRON_CONNECTORS`) i lustra nazw konektorow
  (AGENTS.md, Mirrors #2) sie nie zmieniaja.

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

## Wdrozenie (2026-10-08)

Patron (ta galaz):

- `backend/src/lib/mcp/verifier.ts`: biala lista `VERIFIER_CHAT_TOOLS` (cztery narzedzia
  odczytu); `verify_citations` poza lista zawsze.
- `backend/src/lib/mcp/index.ts`: pole `chatTools` wpisu konektora; narzedzia serwera
  weryfikatora wchodza do schematu czatu i do dispatchu tylko z bialej listy i tylko przy
  `chatTools: true` - dwa niezalezne miejsca, kazde z wlasnym testem.
- `backend/src/lib/mcp/repertorium.ts` + `POST /connectors/repertorium/chat`
  (`requireAuth` + `requireAdmin`, edycja PL): pobranie klucza z `/wydaj-patron`, zapis do
  nakladki (`writeRepertoriumToOverlay` pilnuje ksztaltu adresu), audyt `connector.toggle`.
  Klucz nie wraca w odpowiedzi API i nie trafia do audytu. Wylaczenie zdejmuje narzedzia z
  czatu; przycisk "Sprawdz powolania" dziala dalej.
- `frontend/src/app/(pages)/account/connectors/repertorium-czat.tsx`: karta w panelu
  (tylko edycja PL) z informacja, co wychodzi, i z limitami - przed kliknieciem.
- Testy: `repertorium-chat-tools.test.ts`, `repertorium-chat-tools-off.test.ts`,
  `repertorium.test.ts`, `gateway-approval.test.ts` (trasa w parze middleware Operatora),
  `repertorium-czat.test.tsx`. Piec mutantow strazy (cala lista do czatu, czat bez
  `chatTools` w dispatchu i w schemacie, trasa bez `requireAdmin`, przelacznik poza PL)
  - wszystkie zabite.

Repertorium (repo prywatne, osobna galaz):

- Klasa `patron`, wspolny budzet grafu klas `patron` i `wolny`, sufit wydan per klasa,
  punkt `/wydaj-patron` z limitem na solony skrot adresu (bez adresu albo soli odmowa).
- Punkt 6: odmowy dobowe klasy `patron` same dopisuja kontakt@matematic.co, wiec widzi go
  kazdy klient, nie tylko Patron; model przekazuje tresc odmowy narzedzia.
- Test na prawdziwym SQLite z kontrola pozytywna; pomiar na kodzie sprzed zmiany: wiele
  kluczy przepychalo wywolania grafu bez zadnego hamulca.

Niezmierzone w dniu wdrozenia: przebieg e2e na spakowanej aplikacji z zywym Repertorium -
wymaga wdrozenia Repertorium na produkcje.
