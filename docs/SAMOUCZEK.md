# Patron — samouczek dla Mecenasa

**Krok po kroku, od pierwszego uruchomienia do gotowego pisma.**
Wersja zgodna z instalatorem z czerwca 2026. Nie musisz znać się na technologii — wystarczy, że umiesz pracować z dokumentami w Wordzie.

---

## Spis treści

1. [Czym jest Patron (w jednym akapicie)](#1-czym-jest-patron)
2. [Pierwsze uruchomienie](#2-pierwsze-uruchomienie)
3. [Mapa ekranu — trzy panele](#3-mapa-ekranu)
4. [Krok 1 — Załóż sprawę i wgraj akta](#4-krok-1--zaloz-sprawe-i-wgraj-akta)
5. [Krok 2 — Rozmawiaj z aktami sprawy](#5-krok-2--rozmawiaj-z-aktami)
6. [Krok 3 — Szukaj orzecznictwa i przepisów](#6-krok-3--orzecznictwo-i-przepisy)
7. [Krok 4 — Praca z dokumentami i ICH EDYCJA](#7-krok-4--edycja-dokumentow) ⭐
8. [Krok 5 — Tabela z pakietu umów (Przegląd tabelaryczny)](#8-krok-5--tabela-z-umow)
9. [Krok 6 — Workflowy (powtarzalne zadania)](#9-krok-6--workflowy)
10. [Krok 7 — Wybór modelu AI](#10-krok-7--wybor-modelu)
11. [Biblioteka umiejętności](#11-biblioteka-umiejetnosci)
12. [Najczęstsze pytania i problemy](#12-faq)
13. [Ściąga — gotowe polecenia](#13-sciaga)

---

## 1. Czym jest Patron

Patron to Twój asystent prawny zainstalowany **na Twoim komputerze** (aplikacja desktopowa, jak Word). Wgrywasz do niego akta sprawy — umowy, pozwy, wyroki, skany — a on:

- **czyta je za Ciebie** i odpowiada na pytania, cytując źródła z Twoich dokumentów,
- **szuka orzecznictwa** (Sąd Najwyższy, sądy powszechne, NSA) i **przepisów** (Dz.U., prawo UE) w komplecie wbudowanych baz,
- **proponuje zmiany w dokumentach** jako tracked changes (śledzenie zmian Worda), które akceptujesz jednym kliknięciem,
- **doskonali Twoje pisma** (recenzja + adwokat diabła + redakcja języka).

Patron nie podejmuje decyzji prawnych i nie zastępuje Twojej oceny. Jest narzędziem — szybszym czytaniem akt i pierwszym szkicem, który i tak weryfikujesz.

---

## 2. Pierwsze uruchomienie

1. Uruchom **PATRON** (ikona na pulpicie / w menu Start). Zobaczysz ekran ładowania „Warsztat pracy prawnika", a po kilkunastu sekundach główne okno. Konto ani logowanie nie są potrzebne — Patron jest jednoosobowy i lokalny; akta, baza i historia czatu zostają na komputerze.
2. **Dodaj klucz modelu AI** — to jeden krok, bez którego asystent nie odpowie. Otwórz **Konto → Modele i klucze API** i wklej klucz swojego dostawcy (np. Libra/Anthropic — główne narzędzie prawników w PL, albo Gemini/OpenAI). Zapisz. Od tej chwili czat, edycja pism i tabele działają. Szczegóły: [Krok 7](#10-krok-7--wybor-modelu).
3. **Internet i konwersja plików.** Do modelu w chmurze i wyszukiwania orzecznictwa na żywo (SAOS, NSA, ISAP, KRS, EUR-Lex) potrzebny jest internet; baza prawa UE i wyszukiwanie w Twoich dokumentach działają też offline. Jeśli przy wgrywaniu starszych plików `.doc` zobaczysz błąd konwersji — poproś administratora o doinstalowanie LibreOffice (bezpłatny).

> **Wskazówka:** Patron mówi do Ciebie „Mecenasie" i prowadzi po polsku. Nie wiesz, od czego zacząć? Zapytaj go wprost w czacie: **„Co potrafisz?"** albo **„Jak zacząć?"** — opowie o swoich funkcjach i poprowadzi krok po kroku. Jeśli czegoś nie widzisz, rozwiń lewy panel (**Eksplorator**).

---

## 3. Mapa ekranu

Ekran asystenta dzieli się na **trzy pionowe panele**:

| Panel | Nazwa | Do czego służy |
|---|---|---|
| **lewy** | **Eksplorator** | lista spraw (projektów) i dokumentów; tu wgrywasz pliki |
| **środkowy** | **Podgląd dokumentu** | treść klikniętego dokumentu; tu widać tracked changes |
| **prawy** | **Asystent** | czat — tu zadajesz pytania i wydajesz polecenia |

Lewy panel możesz zwinąć („Zwiń eksplorator") i rozwinąć, gdy potrzebujesz miejsca na podgląd.

---

## 4. Krok 1 — Załóż sprawę i wgraj akta

**Zasada nr 1: jedna sprawa = jeden projekt.** Nie mieszaj akt różnych spraw — Patron przeszukuje wszystkie dokumenty projektu przy każdym pytaniu.

### 4.1. Utwórz projekt
1. W lewym panelu kliknij **+ Nowy projekt** (lub „Nowa sprawa", skrót **Ctrl+N**).
2. Nadaj mówiącą nazwę, np. `Kowalski v. Nowak-Bud — roszczenie 2026`.

### 4.2. Wgraj dokumenty — trzy sposoby

- **Przeciągnij i upuść:** zaznacz pliki/folder w Eksploratorze Windows i upuść na panel (zobaczysz „Upuść, aby wczytać").
- **Wczytaj dokumenty:** przycisk w lewym panelu → wybierz pliki (PDF, DOCX, DOC).
- **Importuj folder sprawy** (najszybsze przy wielu aktach): podaj ścieżkę do katalogu, np. `C:\Sprawy\Kowalski-2026`. Patron wciągnie wszystkie pliki naraz, przeskanuje je pod kątem bezpieczeństwa i zindeksuje.

Co się dzieje pod spodem (nie musisz nic robić): Patron rozpoznaje strukturę prawną dokumentu (nagłówki, paragrafy, jednostki redakcyjne), dla skanów uruchamia OCR, a cały tekst trafia do wyszukiwania. Skany papierowe i pliki bez warstwy tekstowej też zadziałają.

> **Zasada nr 2: wgraj WSZYSTKIE akta przed pierwszym pytaniem.** Im pełniejsza teczka, tym trafniejsze odpowiedzi. Dokumenty dodane później nie wpłyną wstecz na wcześniejsze odpowiedzi.

---

## 5. Krok 2 — Rozmawiaj z aktami

W prawym panelu (**Asystent**) wpisz pytanie i wyślij. Patron sam wybierze najtrafniejsze fragmenty z całej teczki (nie musisz wklejać tekstu).

**Pytaj konkretnie.** Zamiast „co jest w umowie" napisz:
- „Jakie obowiązki ma Zamawiający według §5 umowy nr 3?"
- „Wymień wszystkie terminy płatności i kary umowne w tej umowie."
- „Czy są podstawy do zarzutu przedawnienia? Wskaż daty z akt."
- „Jakie są sprzeczności między umową główną a aneksem nr 2?"

### Czytaj kolorowy badge przy cytatach
Każdy cytat z Twoich dokumentów dostaje znacznik wiarygodności:

- 🟢 **zielony** — cytat dosłowny, znaleziony w Twoich aktach. Możesz go użyć w piśmie ze wskazaniem źródła.
- 🟡 **żółty** — możliwe przekształcenie / parafraz. Zajrzyj do oryginału.
- 🔴 **czerwony** — nie znaleziono w aktach. **Nie cytuj bez ręcznego sprawdzenia** — to może być sformułowanie, które tylko brzmi jak cytat.

> **Zasada nr 3: przed wklejeniem cytatu do pisma — spójrz na badge.** To Twój filtr antyhalucynacyjny.

---

## 6. Krok 3 — Orzecznictwo i przepisy

Patron ma **wbudowany komplet baz prawnych** (działają od razu po instalacji, bez konfiguracji):

| Baza | Co znajdziesz |
|---|---|
| **SAOS** | orzeczenia sądów powszechnych, Sądu Najwyższego, TK, KIO |
| **NSA** | orzecznictwo NSA i 16 WSA (CBOSA) |
| **ISAP** | polskie akty prawne — Dz.U. i Monitor Polski |
| **KRS** | dane podmiotów z Krajowego Rejestru Sądowego |
| **EUR-Lex** | prawo UE i orzecznictwo TSUE |
| **EU-Compliance** | RODO, AI Act, DORA, NIS2, eIDAS 2.0, CRA (offline) |

Po prostu zapytaj naturalnym językiem — Patron sam sięgnie do właściwej bazy:

- „Wyszukaj orzeczenia Sądu Najwyższego o zadośćuczynieniu za naruszenie dóbr osobistych. Podaj sygnatury."
  → Patron zwróci realne wyroki z bazy SAOS, np. **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, z datami i linkami.
- „Pokaż mi art. 415 KC."
- „Jaka jest definicja systemu AI wysokiego ryzyka w AI Act?"
- „Sprawdź w KRS zarząd spółki Nowak-Bud sp. z o.o."

> **Pamiętaj:** bazy to szybki dostęp i podpowiedź. Przed zacytowaniem w piśmie sprawdź aktualne brzmienie przepisu w oficjalnym źródle — przepisy się zmieniają.

---

## 7. Krok 4 — Edycja dokumentów ⭐

To jest serce codziennej pracy. Patron edytuje dokumenty na trzy sposoby. Wszystkie kończą się plikiem, który otwierasz w Wordzie.

### 7A. Poproś o zmianę → przejrzyj tracked changes → akceptuj

To najwygodniejszy tryb dla pojedynczych poprawek w umowie czy piśmie.

1. W Eksploratorze **kliknij dokument DOCX** — pojawi się w środkowym panelu (**Podgląd dokumentu**).
2. W Asystencie napisz, czego chcesz, **wskazując miejsce**:
   - „Zaproponuj zmianę w §4 — chcę ograniczyć odpowiedzialność wykonawcy do szkody rzeczywistej, z wyłączeniem utraconych korzyści."
   - „Dodaj do §3 klauzulę wskazującą sąd właściwy dla siedziby Zamawiającego."
   - „Przeredaguj §7 tak, by termin wypowiedzenia wynosił 3 miesiące ze skutkiem na koniec miesiąca."
3. Patron odpowie **kartami zmian**. Każda karta pokazuje:
   - tekst **dodawany** na zielono,
   - tekst **usuwany** na czerwono z przekreśleniem,
   - krótkie **uzasadnienie** zmiany.
4. Przy każdej karcie masz trzy przyciski:
   - **Akceptuj** — Patron nanosi zmianę i tworzy **nową wersję** dokumentu (prawdziwe tracked changes Worda),
   - **Odrzuć** — zmiana znika,
   - **Otwórz** — podgląd zmiany w kontekście całego dokumentu.
5. Po zaakceptowaniu pobierz gotowy plik (ikona pobierania przy dokumencie) i otwórz w Wordzie — zobaczysz zmiany jako recenzję do finalnej akceptacji.

> Możesz akceptować zmiany pojedynczo albo hurtem. Każda akceptacja zapisuje nową wersję — stare wersje zostają w historii, nic nie tracisz.

### 7B. Doskonal całe pismo — „Draft odpowiedzi" (recenzja + adwokat diabła + język)

To tryb dla całego pisma procesowego albo dłuższego fragmentu, który chcesz wzmocnić.

1. Otwórz panel **Draft odpowiedzi** (ikona ✨ pod odpowiedzią asystenta albo z menu).
2. W polu **Tekst pisma** wklej swój roboczy tekst.
3. Wybierz perspektywę dla adwokata diabła — **„z czyjej perspektywy"**:
   - **Strona przeciwna** — jak zaatakuje pełnomocnik drugiej strony,
   - **Skład orzekający** — o co dopyta sąd,
   - **Prokurator** — kąt oskarżycielski.
4. Kliknij **Doskonal pismo**. Patron przepuści tekst przez trzy etapy:
   - **Recenzent** — wskazuje luki logiczne i słabe powołania, wzmacnia argumentację,
   - **Adwokat diabła** — przewiduje i zbija kontrargumenty z wybranej perspektywy,
   - **Pisz po ludzku** — usuwa „styl AI", zostawia precyzję prawniczą.
5. Dostaniesz **Gotowy draft** (możesz skopiować) oraz rozwijaną sekcję **„Jak powstał draft"** — co zmienił każdy etap.

> **Zasada nr 4: pipeline działa najlepiej na gotowym tekście, nie na pustym poleceniu.** Napisz swoją wersję, wklej, poproś o wzmocnienie. Potem Twoja korekta — i ewentualnie drugi przebieg.

### 7C. Round-trip — edytuj w Wordzie, wróć do Patrona

Jeśli wolisz pracować w Wordzie:

1. Pobierz dokument z Patrona.
2. W Wordzie nanieś **własne zmiany w trybie śledzenia zmian**, dodaj komentarze, a tam gdzie chcesz, by Patron coś zrobił — wpisz w komentarzu instrukcję w formacie `[PATRON: tu napisz polecenie]`.
3. Wgraj plik z powrotem (jako nową wersję). Patron odczyta Twoje tracked changes, komentarze i instrukcje `[PATRON: ...]` — i uczy się Twojego stylu redakcji.

### 7D. Wersje i pobieranie
- Każda zaakceptowana zmiana = nowa wersja (historia zachowana).
- Pojedynczy plik pobierzesz ikoną pobierania; cały projekt możesz pobrać jako ZIP.

---

## 8. Krok 5 — Tabela z pakietu umów

Gdy masz **wiele podobnych dokumentów** (np. 30 umów najmu) i chcesz porównać je w tabeli — użyj **Przeglądu tabelarycznego**.

1. Wejdź w **Przeglądy tabelaryczne → + Utwórz nowy**.
2. Dodaj kolumny — z gotowych presetów prawniczych (Strony, Przedmiot umowy, Kara umowna, Prawo właściwe, Termin wypowiedzenia…) lub własne, np. „Klauzula RODO — tak/nie".
3. Kliknij **Generuj**. Tabela wypełnia się strumieniowo: Patron przeszukuje każdy dokument i wpisuje wynik.
4. Każda komórka ma badge wiarygodności (🟢/🟡/🔴). 🔴 = sprawdź ręcznie — kliknij komórkę, by zobaczyć źródło.
5. Eksportuj do Excela dla klienta lub zespołu.

> Efekt: due diligence pakietu 50 umów w godzinę zamiast w tydzień.

---

## 9. Krok 6 — Workflowy

Powtarzalne zadania (np. „Analiza umowy najmu", „Przegląd due diligence") zapisz raz jako **workflow** i uruchamiaj jednym kliknięciem na nowych sprawach.

- Zacznij od workflowów wbudowanych.
- Własny: **Workflowy → Nowy** → wpisz polecenia krok po kroku → zapisz.
- Możesz udostępnić workflow współpracownikom — cała kancelaria robi due diligence tym samym checklistem.

---

## 10. Krok 7 — Wybór modelu

Patron jest **neutralny wobec dostawców** — model wybierasz Ty. To jedna wartość w **Konto → Modele i klucze API**, zmiana nie wymaga reinstalacji.

- **Model w chmurze (np. Libra / Claude, Gemini)** — najwyższa jakość redakcji i rozumowania. To świadomy, normalny wybór kancelarii. Treść zapytania trafia wtedy do wybranego dostawcy.
- **Model lokalny (Ollama)** — działa bez internetu, koszt 0. Wymaga jednorazowej instalacji Ollamy i pobrania modelu na komputer.

Możesz mieszać: tańszy/lokalny model do eksploracji akt, mocniejszy do finalnego pisma. Zużycie i koszty sprawdzisz w **Konto → Zużycie** (filtr po sprawie).

**Sprawy objęte tajemnicą a chmura.** W wersji desktopowej to Ty — adwokat na własnej maszynie — jesteś gospodarzem danych, więc Twój wybór modelu chmurowego jest świadomą zgodą. Patron pozwala pracować dowolnym modelem także na sprawach oznaczonych jako objęte tajemnicą; **każde** wyjście danych do modelu jest przy tym zapisywane w niemodyfikowalnym dzienniku audytu (dowód należytej staranności, AI Act art. 12), a dane osobowe są maskowane przed wysłaniem. Jeśli kancelaria chce zaostrzyć rygor (np. tajemnica wyłącznie na modelu lokalnym), administrator może to ustawić — domyślnie nic Cię nie blokuje.

---

## 11. Biblioteka umiejętności

**Biblioteka umiejętności** to zestaw „umiejętności", które Patron stosuje przy doskonaleniu pism:

- **Wbudowane** (zawsze aktywne): **Recenzent**, **Adwokat diabła**, **Pisz po ludzku**.
- **Zainstalowane** (własne): włączasz, wyłączasz i importujesz dodatkowe etapy z pliku.

Wbudowanych nie trzeba konfigurować — działają w panelu „Draft odpowiedzi".

---

## 12. FAQ

**Asystent nie odpowiada albo czat zwraca błąd (zwłaszcza zaraz po instalacji).**
Najczęstsza przyczyna: brak klucza modelu. Otwórz **Konto → Modele i klucze API** i dodaj klucz (np. Libra/Anthropic). Druga przyczyna: brak internetu przy modelu chmurowym. Sprawdź też w **Konto → Modele**, czy wybrany jest model, do którego masz klucz.

**Czy moje akta wychodzą do chmury?**
Tylko jeśli wybrałeś model w chmurze — wtedy treść zapytania trafia do tego dostawcy. Przy modelu lokalnym wszystko zostaje na komputerze. Pliki, baza i historia czatu są zawsze przechowywane lokalnie.

**Patron napisał coś, czego nie ma w aktach.**
Sprawdź badge: 🔴 = niezweryfikowane. Modele potrafią „dopowiadać". Badge i Twoja kontrola to ostateczny filtr — Patron tego nie zastąpi.

**Konwersja DOCX/PDF nie działa.**
Do konwersji dokumentów potrzebny jest LibreOffice na komputerze. Jeśli czegoś brakuje — zgłoś administratorowi kancelarii.

**Jak wyeksportować pismo z komentarzami do Worda?**
Poproś o zmiany jako tracked changes (Krok 4A), zaakceptuj wybrane, pobierz DOCX — w Wordzie zobaczysz recenzję do finalnej akceptacji.

**Czy Patron sprawdza, czy ustawa jest aktualna?**
Bazy dają szybki dostęp do treści, ale mogą mieć opóźnienie względem Dz.U. Aktualne brzmienie zweryfikuj w oficjalnym źródle przed pismem.

**Czy Patron podejmuje decyzje prawne?**
Nie. Ocena prawna, podpis i odpowiedzialność zawodowa są po Twojej stronie.

---

## 13. Ściąga — gotowe polecenia

**Czat z aktami**
- „Wymień wszystkie terminy i kary umowne w tej umowie."
- „Jakie sprzeczności są między dokumentem A i B?"
- „Czy zachodzi przedawnienie? Wskaż daty z akt."

**Orzecznictwo i przepisy**
- „Wyszukaj orzeczenia SN o [temat]. Podaj sygnatury."
- „Pokaż art. [X] [kodeks]."
- „Sprawdź w KRS [nazwa spółki]."

**Edycja dokumentu (po kliknięciu pliku DOCX)**
- „Zaproponuj zmianę w §[X] — [czego chcesz] — jako tracked changes."
- „Dodaj do §[X] klauzulę [opis]."
- „Przeredaguj §[X]: [nowa treść/cel]."

**Doskonalenie pisma**
- Panel „Draft odpowiedzi" → wklej tekst → wybierz perspektywę → „Doskonal pismo".

---

*Patron to narzędzie wspierające pracę prawnika. Każde pismo przed wysłaniem weryfikuje i podpisuje Mecenas. Dokument zgodny ze stanem aplikacji na czerwiec 2026.*
