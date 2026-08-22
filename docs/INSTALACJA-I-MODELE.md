# PATRON - instalacja i podlaczenie modeli

Instrukcja dla osoby, ktora dostaje instalator i ma zaczac pracowac. Nie wymaga
repozytorium ani narzedzi deweloperskich - wszystko robi sie w gotowej aplikacji.

## 1. Instalacja (Windows)

1. Uruchom `PATRON-Setup-Windows.exe`.
2. Windows pokaze ostrzezenie **"System Windows ochronil Twoj komputer"**.
   Kliknij **Wiecej informacji** -> **Uruchom mimo to**. Powod: instalator nie jest
   jeszcze podpisany certyfikatem wydawcy (podpis planowany w wersji 2.0). Zanim
   klikniesz, warto sprawdzic sume kontrolna pliku - patrz punkt 5.
3. Instalacja idzie **na konto uzytkownika, bez uprawnien administratora**.
   Domyslny katalog: `%LOCALAPPDATA%\Programs\PATRON`.
4. Pierwsze uruchomienie trwa dluzej - aplikacja stawia wlasny backend.
   **Porty 3000 i 3001 musza byc wolne.** Druga instancja PATRONa jest blokowana
   celowo (jedna aplikacja = jedna baza).
5. Weryfikacja pliku przed instalacja (PowerShell):
   `Get-FileHash .\PATRON-Setup-Windows.exe -Algorithm SHA256`
   Wynik porownaj z suma podana przy wydaniu.

Twoje dane po instalacji: `%APPDATA%\patron-desktop` - baza `patron.db`,
dokumenty spraw w `sprawy`, sekrety maszyny w `secrets`.

## 2. Podlaczenie modelu - trzy drogi

Model wybiera sie w polu pytania (nazwa modelu obok strzalki wyslania), a klucze
wpisuje w **Konto -> Modele i klucze**. Skrot: kliknij segment **MODEL** w dolnym
pasku aplikacji - prowadzi prosto do tych ustawien.

### A. OpenRouter - jeden klucz, wiele modeli (domyslna sciezka)

Domyslnie wybrany model pochodzi z OpenRoutera, wiec bez klucza nie zadziala
nic. Zaloz konto na openrouter.ai, wygeneruj klucz (zaczyna sie od `sk-or-v1-`),
wklej w polu **OpenRouter** i zapisz.

### B. Bezposrednio u dostawcy

W tym samym miejscu sa osobne pola: **Anthropic (Claude)** - klucz `sk-ant-…`,
**Google (Gemini)** - klucz `AI…`, **OpenAI** - klucz `sk-…`. Wystarczy jeden;
modele dostawcy bez klucza sa wyszarzone i opisane "Dodaj klucz".

### C. Model lokalny - zero egress

Dane nie opuszczaja maszyny i **nie potrzebujesz zadnego klucza**:

1. Zainstaluj Ollame (ollama.com), uruchom - slucha na `http://localhost:11434`.
2. Pobierz model: `ollama pull SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M`
3. W PATRONie wybierz model z grupy **Lokalny**.

Wymaga mocnej maszyny (model 11B). Na sprzecie bez GPU dziala, ale wolno.

## 3. Sprawdzenie, ze dziala

1. Dolny pasek pokazuje wybrany model i postawe perymetru.
2. Zadaj dowolne pytanie. Jesli brakuje klucza, PATRON otworzy okno **"Dodaj
   klucz"** z linkiem do ustawien - jeszcze zanim cokolwiek wyjdzie na zewnatrz.
3. Jesli odpowiedz przyszla - gotowe.

## 4. Pulapki, ktore realnie wystepuja

- **Nie kopiuj `patron.db` na inna maszyne.** Klucze API sa szyfrowane sekretem
  generowanym per maszyna (`%APPDATA%\patron-desktop\secrets`). Na nowym
  komputerze nie da sie ich odszyfrowac - wpisz je na nowo.
- **Nowa maszyna = brak kluczy.** Klucze nie sa czescia instalatora; kazde
  stanowisko konfiguruje sie osobno.
- **Puste okno przy starcie**: aplikacja sama przeladuje po 15 sekundach. Jesli
  dalej puste - sprawdz, czy port 3000 lub 3001 nie jest zajety przez inny
  program.
- **Tryb serwerowy / docker** (nie desktop) wymaga ustawienia zmiennej
  `USER_API_KEYS_ENCRYPTION_SECRET` - bez niej zapis klucza nie powiedzie sie.
  W wersji desktop sekret powstaje automatycznie przy pierwszym starcie.
- **Klucz z konfiguracji Operatora ma pierwszenstwo** nad kluczem wpisanym w UI.
  Jesli administrator ustawil klucz globalnie, pole pokaze "Skonfigurowane przez
  administratora".

## 5. Bezpieczenstwo klucza

Klucz zostaje na Twojej maszynie, zaszyfrowany. PATRON nie wysyla go nigdzie
poza wywolaniem wybranego dostawcy modelu. Nie przesylaj klucza mailem ani
komunikatorem - kazdy, kto go ma, moze generowac koszty na Twoim koncie.
