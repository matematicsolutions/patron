# PATRON - instalacja (przeczytaj przed uruchomieniem instalatora)

Ten jednostronicowy poradnik dołączamy **do pliku instalatora** (`PATRON Setup …exe`) - mailem albo na stronie pobrania. Po instalacji pełny przewodnik znajdziesz już w samej aplikacji (Baza wiedzy + Samouczek).

---

## 1. Czego potrzebujesz

- **Windows 10/11, 64-bit.**
- **Model AI - wybierz jedną z dwóch ścieżek:**
  - **Lokalnie (zero-cloud, zalecane dla akt objętych tajemnicą).** Zainstaluj [Ollama](https://ollama.com) i pobierz model wskazany w aplikacji. Dane **nie opuszczają Twojego komputera**, brak kosztów tokenów. Zalecany mocniejszy sprzęt (16 GB RAM+).
  - **Chmura (wygoda i jakość).** Klucz modelu - np. Libra/Anthropic (główne narzędzie prawników w PL), Gemini lub OpenAI. Wpiszesz go raz, już w aplikacji. Uwaga: przy modelu chmurowym treść akt jest wysyłana do dostawcy modelu - używaj za zgodą Administratora i zgodnie z polityką kancelarii.
- **Internet** - wymagany przy modelu chmurowym oraz do wyszukiwania orzecznictwa na żywo (SAOS, NSA, ISAP, KRS, EUR-Lex). Wyszukiwanie w Twoich dokumentach i baza prawa UE działają też offline.
- **LibreOffice** (bezpłatny) - **wymagany, jeśli wgrywasz starsze pliki `.doc`**; bez niego Patron ich nie przyjmie i powie o tym wprost. Dla `.pdf` i `.docx` nie jest potrzebny - te formaty działają zawsze. Można doinstalować później: [libreoffice.org](https://www.libreoffice.org).

---

## 2. Instalacja krok po kroku

1. Uruchom **`PATRON Setup …exe`**.
2. Windows pokaże niebieski ekran **„System Windows ochronił Twój komputer" (SmartScreen)** - to standard dla aplikacji bez komercyjnego certyfikatu wydawcy, nie błąd. Kliknij **„Więcej informacji" → „Uruchom mimo to"**. (Jednorazowo.)
3. Przejdź instalator (możesz wskazać katalog instalacji). Zakończ.
4. Uruchom **PATRON** z pulpitu lub menu Start. Pierwszy start trwa kilkanaście sekund - aplikacja podnosi swój silnik, bazę i konektory prawne.

---

## 3. Pierwsza minuta w aplikacji

1. Otwórz **Konto → Modele i klucze API**. Wybierz **model lokalny (Ollama)** - wtedy dane nie opuszczają komputera - albo wklej **klucz modelu chmurowego** (np. Libra/Anthropic). Zapisz.
2. Załóż pierwszą sprawę (projekt) i wgraj do niej akta - przeciągnij pliki lub użyj **„Importuj folder sprawy"**.
3. Zadaj pierwsze pytanie w czacie po prawej, np. *„Wymień terminy i kary umowne w tej umowie."* Albo zapytaj wprost: **„Co potrafisz?"** - Patron oprowadzi Cię po funkcjach.

Dalej poprowadzi Cię **Samouczek** dostępny w aplikacji (od wgrania akt po edycję pism).

---

## 4. Gdyby coś nie ruszyło

- **Asystent nie odpowiada / błąd w czacie** → najczęściej brak klucza modelu (punkt 3.1) albo brak internetu przy modelu chmurowym.
- **Błąd przy wgrywaniu `.doc` / podglądzie PDF** → doinstaluj LibreOffice (punkt 1) i uruchom Patrona ponownie.
- **Antywirus / SmartScreen blokuje** → patrz punkt 2; w razie potrzeby dodaj wyjątek dla katalogu instalacji.

## 5. RODO art. 17 - co robi aplikacja, a co narzędzie administracyjne

- **Dane klienta** (akta, czaty, przeglądy, karty sprawy) usuwa w aplikacji „Zapomnij sprawę”.
- **Wpisy dziennika audytu z użytkownikiem Patrona** jako aktorem aplikacja dziś nie anonimizuje. Robi to narzędzie `rodo:delete` uruchamiane z kopii źródeł Patrona, przy zamkniętej aplikacji i po zrobieniu kopii pliku `patron.db` (razem z `-wal` i `-shm`). Na komputerze z Patronem desktop narzędzie pracuje bezpośrednio na tej bazie: `PATRON_DB_BACKEND=sqlite`, `PATRON_DB_PATH=<katalog danych>\patron.db`, potem `npm run rodo:delete -- --user <id> --confirm` w katalogu `backend`. Pliki dokumentów wypisane na końcu usuwa się ręcznie z katalogu danych.
- Narzędzie najpierw zapisuje w dzienniku deklarację zerwania łańcucha z mocy prawa, dopiero potem anonimizuje. Weryfikator łańcucha pokaże wtedy UWAGI (kod 3), a nie BLOKADĘ.

---

*MateMatic Solutions - Patron, lokalny asystent AI dla polskiej kancelarii. Wsparcie: [kontakt do uzupełnienia].*
