# Patron 1.4.0 - co się zmienia

Wydanie z 10 października 2026 r. Treść dla kancelarii przed aktualizacją.

## Jak przejść na 1.4.0

Patron od wersji 1.1 sam pobierze aktualizację i zapyta, czy zainstalować ją od razu, czy przy zamknięciu programu. W trakcie pracy nad sprawą nie uruchomi się ponownie bez Twojej zgody. Jeśli masz wersję 1.0, pobierz instalator 1.4.0 ze strony https://github.com/matematicsolutions/patron/releases/latest i zainstaluj go na obecną wersję. Ręcznie robisz to tylko ten jeden raz, kolejne aktualizacje przyjdą same.

Sprawy, dokumenty, czaty, pamięć asystenta i zapisane klucze API zostają na miejscu. Leżą w profilu użytkownika Windows, osobno od programu, więc instalacja nowej wersji ich nie nadpisuje. Przy pierwszym uruchomieniu Patron 1.4.0 rozszerza listę zdarzeń, które przyjmuje dziennik audytu. Twoich danych to nie zmienia: wpisy dziennika zostają takie, jakie były, a łańcuch dowodowy się nie przerywa.

## Co się zmieni w Twojej pracy

**1. Sprawy objęte tajemnicą domyślnie pracują tylko z modelem lokalnym.**
Do tej pory Patron na komputerze kancelarii pozwalał wysłać sprawę objętą tajemnicą do modelu chmurowego bez dodatkowego kroku. Po aktualizacji taka sprawa z modelem chmurowym pokaże komunikat o blokadzie.

Jeśli świadomie chcesz używać modelu chmurowego w konkretnej sprawie, otwórz sprawę i na pasku narzędzi zaznacz pole **„Model chmurowy”** (widoczne dla właściciela sprawy). Zgoda dotyczy tylko tej sprawy i zostaje zapisana w dzienniku audytu.

Sprawy bez tajemnicy i czaty ogólne działają jak dotąd.

**2. Zmiany w dokumentach wymagają Twojego zatwierdzenia.**
Gdy asystent proponuje edycję pisma, nowy dokument, komentarze, kopie albo zapis do pamięci, akcja trafia jako karta do skrzynki **„Karty zatwierdzeń”** (menu konta). Wykonuje się dopiero po Twoim kliknięciu. Chroni to przed sytuacją, w której instrukcja ukryta w aktach strony przeciwnej skłoniłaby model do zmiany Twojego pisma.

**3. Nowe konektory zewnętrzne wymagają zatwierdzenia.**
Konektor spoza zestawu Patrona (np. weryfikator powołań) nie uruchomi się, dopóki go nie zatwierdzisz. Otwórz **„Konektory prawa”** w menu konta, przy konektorze kliknij **„Przejrzyj i zatwierdź”**, przeczytaj zastrzeżenia bramki bezpieczeństwa i zatwierdź. Po ponownym uruchomieniu Patrona konektor działa. Jeśli konektor później się zmieni (inne narzędzia albo inny adres), Patron znów poprosi o zatwierdzenie. To dotyczy także konektora używanego przed aktualizacją.

**4. „Sprawdź powołania” wysyła mniej.**
Do weryfikatora idą tylko rozpoznane powołania przepisów i sygnatury orzeczeń sądowych. Nie idą adresy, numery faktur i umów ani sygnatura Twojej sprawy z nagłówka pisma. Powołania, których nie wysłano, są widoczne na liście jako „Nie wysłano” z powodem.

**5. Repertorium w czacie (wersja polska, opcjonalnie).**
W „Konektorach prawa” jest nowa karta „Repertorium w czacie”. Po włączeniu asystent sięga do Repertorium, korpusu prawa prowadzonego przez MateMatic: tekstów jednolitych, historii zmian przepisu i powołań w orzeczeniach. Karta przed kliknięciem mówi, co wychodzi z komputera: treść zapytań asystenta, z nazwiskami, PESEL, adresami i e-mailami zamienionymi na oznaczenia zastępcze. Repertorium tych zapytań nie zapisuje. Bezpłatnie: 50 wyszukań i 10 dokumentów dziennie. Włącza to tylko Operator kancelarii.

**6. Nowe modele Claude.**
W wyborze modelu są teraz Claude Opus 5.5 i Sonnet 5.5, tańsze od poprzedników. Jeśli przed aktualizacją wybrany był Claude Opus 4.8 albo Sonnet 4.6, Patron sam przejdzie na nowszy model tego samego dostawcy.

## Co zostało naprawione (wybór)

- Treść dokumentów czytanych przez asystenta jest maskowana przed modelem chmurowym, także w tytułach czatów, w przeglądzie tabelarycznym i w panelu draftu.
- Obrazy i linki w odpowiedziach modelu nie ładują się same, więc nie mogą wyprowadzić danych bez Twojego kliknięcia.
- Usunięcie sprawy (na liście spraw: menu przy sprawie, „Usuń”) usuwa także dane wyprowadzone z akt (przeglądy tabelaryczne, karty, czaty ogólne z załącznikami z tej sprawy). Gdy coś się nie uda, zobaczysz to wprost.
- Edycja pisma nie gubi tabulatorów, podziałów linii ani odwołań do przypisów i nie zmienia liczb w innych miejscach dokumentu.
- Przegląd tabelaryczny na skanie korzysta z tekstu z OCR. Przy bardzo długim dokumencie mówi, ile tekstu przeanalizował.
- Pakiet dowodowy i eksport audytu przechodzą własny weryfikator.
- Wyszukiwanie w aktach zawsze szuka w obrębie bieżącej sprawy. Wcześniej, przy wielu sprawach z podobnymi dokumentami, potrafiło nie znaleźć nic w tej, o którą pytasz.
- Patron zapisuje każdy wpis dziennika audytu na dysk, zanim pójdzie dalej. Wcześniej przy nagłym zaniku zasilania ostatnie wpisy mogły zniknąć.
- Ustawienia konektorów (włączone, wyłączone, zatwierdzone) przetrwają aktualizację.
- Zużycie pamięci przy indeksowaniu akt nie zależy już od wielkości dokumentów. Wcześniej rosło razem z nimi.

## Czego Patron nadal nie gwarantuje

Maskowanie danych przed modelem chmurowym ogranicza ryzyko, ale go nie usuwa. Detektor nie rozpoznaje każdej osoby i każdej firmy. W tej wersji nie maskuje też numerów rachunków bankowych ani numerów telefonu zapisanych bez +48, a PESEL z błędem w zapisie (na przykład po odczycie skanu) może przejść niezamaskowany. Dlatego w sprawach objętych tajemnicą zalecamy model lokalny.

**RODO art. 17 a dziennik audytu.** Dane klienta znikają po usunięciu sprawy (menu przy sprawie, „Usuń”). Usunięcie nie anonimizuje jednak wpisów dziennika audytu, w których występuje **użytkownik Patrona** (osoba obsługująca aplikację). Gdy to ten użytkownik żąda usunięcia swoich danych, anonimizację wykonuje narzędzie administracyjne uruchamiane poza aplikacją. Wymaga ono kopii źródeł Patrona, więc napisz na kontakt@matematic.co, a przeprowadzimy to razem. Narzędzie zapisuje w dzienniku deklarację, że łańcuch dowodowy zerwano z mocy prawa, więc weryfikator odróżnia to od ingerencji. W aplikacji nie ma jeszcze przycisku dla tej operacji.
