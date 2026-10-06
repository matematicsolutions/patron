# Nota dla użytkowników - zmiany w najbliższej wersji Patrona

Projekt treści do wysłania kancelariom przed aktualizacją. Do uzupełnienia o numer wersji i datę.

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

## Co zostało naprawione (wybór)

- Treść dokumentów czytanych przez asystenta jest maskowana przed modelem chmurowym, także w tytułach czatów, w przeglądzie tabelarycznym i w panelu draftu.
- Obrazy i linki w odpowiedziach modelu nie ładują się same, więc nie mogą wyprowadzić danych bez Twojego kliknięcia.
- „Zapomnij sprawę” usuwa także dane wyprowadzone z akt (przeglądy tabelaryczne, karty, czaty ogólne z załącznikami z tej sprawy). Gdy coś się nie uda, zobaczysz to wprost.
- Edycja pisma nie gubi tabulatorów, podziałów linii ani odwołań do przypisów i nie zmienia liczb w innych miejscach dokumentu.
- Przegląd tabelaryczny na skanie korzysta z tekstu z OCR. Przy bardzo długim dokumencie mówi, ile tekstu przeanalizował.
- Pakiet dowodowy i eksport audytu przechodzą własny weryfikator.

## Czego Patron nadal nie gwarantuje

Maskowanie danych przed modelem chmurowym ogranicza ryzyko, ale go nie usuwa. Detektor nie rozpoznaje każdej osoby i każdej firmy. Dlatego w sprawach objętych tajemnicą zalecamy model lokalny.

**RODO art. 17 a dziennik audytu.** Dane klienta usuwa „Zapomnij sprawę”. Nie anonimizuje ona jednak wpisów dziennika audytu, w których występuje **użytkownik Patrona** (osoba obsługująca aplikację). Gdy to ten użytkownik żąda usunięcia swoich danych, anonimizację wykonuje narzędzie administracyjne uruchamiane poza aplikacją. Wymaga ono kopii źródeł Patrona, więc napisz na kontakt@matematic.co, a przeprowadzimy to razem. Narzędzie zapisuje w dzienniku deklarację, że łańcuch dowodowy zerwano z mocy prawa, więc weryfikator odróżnia to od ingerencji. W aplikacji nie ma jeszcze przycisku dla tej operacji.
