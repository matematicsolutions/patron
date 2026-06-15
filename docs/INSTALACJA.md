# PATRON — instalacja (przeczytaj przed uruchomieniem instalatora)

Ten jednostronicowy poradnik dołączamy **do pliku instalatora** (`PATRON Setup …exe`) — mailem albo na stronie pobrania. Po instalacji pełny przewodnik znajdziesz już w samej aplikacji (Baza wiedzy + Samouczek).

---

## 1. Czego potrzebujesz

- **Windows 10/11, 64-bit.**
- **Model AI — wybierz jedną z dwóch ścieżek:**
  - **Lokalnie (zero-cloud, zalecane dla akt objętych tajemnicą).** Zainstaluj [Ollama](https://ollama.com) i pobierz model wskazany w aplikacji. Dane **nie opuszczają Twojego komputera**, brak kosztów tokenów. Zalecany mocniejszy sprzęt (16 GB RAM+).
  - **Chmura (wygoda i jakość).** Klucz modelu — np. Libra/Anthropic (główne narzędzie prawników w PL), Gemini lub OpenAI. Wpiszesz go raz, już w aplikacji. Uwaga: przy modelu chmurowym treść akt jest wysyłana do dostawcy modelu — używaj za zgodą Administratora i zgodnie z polityką kancelarii.
- **Internet** — wymagany przy modelu chmurowym oraz do wyszukiwania orzecznictwa na żywo (SAOS, NSA, ISAP, KRS, EUR-Lex). Wyszukiwanie w Twoich dokumentach i baza prawa UE działają też offline.
- **LibreOffice** (bezpłatny, opcjonalnie) — przyda się do konwersji starszych plików `.doc` i podglądu PDF. Można doinstalować później: [libreoffice.org](https://www.libreoffice.org).

---

## 2. Instalacja krok po kroku

1. Uruchom **`PATRON Setup …exe`**.
2. Windows pokaże niebieski ekran **„System Windows ochronił Twój komputer" (SmartScreen)** — to standard dla aplikacji bez komercyjnego certyfikatu wydawcy, nie błąd. Kliknij **„Więcej informacji" → „Uruchom mimo to"**. (Jednorazowo.)
3. Przejdź instalator (możesz wskazać katalog instalacji). Zakończ.
4. Uruchom **PATRON** z pulpitu lub menu Start. Pierwszy start trwa kilkanaście sekund — aplikacja podnosi swój silnik, bazę i konektory prawne.

---

## 3. Pierwsza minuta w aplikacji

1. Otwórz **Konto → Modele i klucze API**. Wybierz **model lokalny (Ollama)** — wtedy dane nie opuszczają komputera — albo wklej **klucz modelu chmurowego** (np. Libra/Anthropic). Zapisz.
2. Załóż pierwszą sprawę (projekt) i wgraj do niej akta — przeciągnij pliki lub użyj **„Importuj folder sprawy"**.
3. Zadaj pierwsze pytanie w czacie po prawej, np. *„Wymień terminy i kary umowne w tej umowie."* Albo zapytaj wprost: **„Co potrafisz?"** — Patron oprowadzi Cię po funkcjach.

Dalej poprowadzi Cię **Samouczek** dostępny w aplikacji (od wgrania akt po edycję pism).

---

## 4. Gdyby coś nie ruszyło

- **Asystent nie odpowiada / błąd w czacie** → najczęściej brak klucza modelu (punkt 3.1) albo brak internetu przy modelu chmurowym.
- **Błąd przy wgrywaniu `.doc` / podglądzie PDF** → doinstaluj LibreOffice (punkt 1) i uruchom Patrona ponownie.
- **Antywirus / SmartScreen blokuje** → patrz punkt 2; w razie potrzeby dodaj wyjątek dla katalogu instalacji.

---

*MateMatic Solutions — Patron, lokalny asystent AI dla polskiej kancelarii. Wsparcie: [kontakt do uzupełnienia].*
