# RUNBOOK - instalacja osobista PATRON Desktop (pilotaz) + procedura RODO-removal

Dokument operacyjny dla Operatora MateMatic (instalacja u Testera). Uziemiony w realnej weryfikacji 2026-06-01 (ADR-0091) i w lekcjach pakowania desktop. Komplementarny do `PILOT_READINESS.md` (czy gotowe) i pakietu pilotazowego w `patron-desktop-drafts/IP/pilotaz/` (dokumenty Testera). Bramy ludzkie/prawne (NDA, podpis Konstytucji, disclosure plaintext) sa warunkiem WSTEPNYM tej instalacji.

## 0. Zasada

Instalacje u Testera przeprowadza Operator OSOBISCIE na miejscu. Rozwiazuje brak praw administratora u testerow w srodowisku zarzadzanym przez IT (instalator NSIS wymaga admina) - uprawnienia udziela dzial IT klienta przy instalacji. PATRON to narzedzie; Tester wybiera tryb (lokalny / chmura), decyduje i ponosi konsekwencje.

## 1. Bramy wstepne (MUSZA byc spelnione PRZED wyjazdem)

- [ ] **NDA + warunki pilotazu** podpisane (bez tego nie instalujemy - ochrona nowosci patentowej i tajemnicy).
- [ ] **Konstytucja AI v1.5.0** podpisana przez Administratora kancelarii.
- [ ] **Zobowiazania do poufnosci** osob dopuszczonych (dok. 5 pakietu).
- [ ] **Disclosure plaintext at-rest** przekazany: Pouczenie RODO (dok. 2, rozdz. 1) + checkbox w Protokole przekazania (dok. 3). W wersji pilotazowej baza NIE jest szyfrowana w spoczynku - zalecenie wlaczenia szyfrowania dysku (BitLocker), szczegolnie na urzadzeniu bez szyfrowania dysku.
- [ ] **Instalator** zbudowany, suma kontrolna SHA-256 policzona (do wpisania w dok. 3).

## 2. Przygotowanie instalatora (przed wizyta, na maszynie buildowej Windows)

Lancuch (per ADR-0091): `npm install` (desktop) -> `prepare-resources` (build backend+frontend + @electron/rebuild better-sqlite3 pod ABI Electrona + staging zasobow) -> `electron-builder` (NSIS).

- [ ] Build przeszedl (tsc 0, frontend standalone, vitest pelny suite zielony - nie podzbior).
- [ ] **Kompletnosc zasobow** w spakowanej aplikacji (nie tylko exit 0 buildu):
  - `resources/backend/node_modules` obecne + natywny `better_sqlite3.node`,
  - `resources/frontend/server.js` rozmiar > 0 B (nie 0 B),
  - `resources/frontend/node_modules` obecne.
  Niekompletny staging = instalator powstaje, apka nie wstaje (proces-dziecko pada, port nigdy nie binduje).
- [ ] SHA-256 instalatora policzona.

## 3. Na miejscu - instalacja

- [ ] Uprawnienia administratora od dzialu IT klienta (instalacja NSIS).
- [ ] Uruchom instalator (Setup). Cicha instalacja: `Start-Process Setup.exe /S` lub GUI.
- [ ] **DATE-CHECK zainstalowanego binarium**: `Get-Item "$env:LOCALAPPDATA\Programs\<App>\<App>.exe" | Select LastWriteTime` - potwierdz, ze to NOWE wydanie, nie stara wersja (czesta przyczyna petli "Port nie odpowiada" - uruchamiana stara apka zamiast nowego buildu).
- [ ] Uruchom aplikacje. Sprawdz, ze backend wstaje (port lokalny) - **sprawdz, czy port jest wolny** (zombie z poprzednich uruchomien/testow daja falszywe 200).
- [ ] Log czytaj przez glowny proces `<App>.exe` (electron.exe spawnowany w tle nie zrzuca stdout).
- [ ] Pierwsze okno: greeting "Witaj, Mecenasie" (wolacz domyslny + migracja seedLocalUser).

## 4. Konfiguracja z Testerem (decyzje Testera)

- [ ] **Wybor modelu LLM** (bring-your-own): Gemini / Claude / OpenAI / OpenRouter / Ollama lokalny. Dla danych objetych tajemnica - model LOKALNY (Ollama), zero egress.
- [ ] **Data-residency**: domyslnie fail-closed dla danych uprzywilejowanych (zostaja lokalnie). `ALLOW_US_PROVIDERS=true` tylko po swiadomej decyzji Administratora. UWAGA: chmura (w tym OpenRouter) idzie do USA; rezydencja UE = wylacznie tryb lokalny. Nie obiecywac EU-cloud.
- [ ] Wypelnic i podpisac **Protokol przekazania** (dok. 3): wersja, SHA-256, model, urzadzenia, checkbox disclosure plaintext.

## 5. Backup danych (SQLite WAL)

Dane PATRONA (tryb desktop) leza w `userData` Electrona. UWAGA: nazwa katalogu = **nazwa pakietu** (`patron-desktop`), NIE productName. Sciezka Windows: `%APPDATA%\patron-desktop\`.

- [ ] Kopia bazy obejmuje TRZY pliki: `*.db` + `*.db-wal` + `*.db-shm`. SQLite w trybie WAL trzyma swieze dane w `-wal`, nie w (czesto malym, ~4KB) pliku `.db`. Kopia samego `.db` = utrata danych.

## 6. Procedura RODO-removal (po pilotazu, T022)

Realizuje Protokol usuniecia (dok. 4 pakietu). Sciezka zalezy od trybu:

### Tryb desktop (SQLite zero-cloud) - oba biezace pilotaze
- [ ] Zamknij aplikacje (zaden proces nie trzyma bazy).
- [ ] Usun pliki bazy i indeksu z `%APPDATA%\patron-desktop\`: `*.db`, `*.db-wal`, `*.db-shm` oraz katalog cache/temp aplikacji.
- [ ] Odinstaluj aplikacje (Panel sterowania / Uninstall NSIS). Zweryfikuj usuniecie katalogu instalacji i `userData`.
- [ ] (Opcjonalnie, na zyczenie Testera) **eksport sladu audytowego** PRZED usunieciem, dla wlasnych celow dowodowych Testera (AI Act art. 12): `npm run rodo:export` (tryb serwerowy) lub eksport z UI audytu (tryb desktop). Slad zostaje u Testera, nie u MateMatic.
- [ ] Wypelnic i podpisac Protokol usuniecia (dok. 4): per urzadzenie - aplikacja odinstalowana / baza i indeks usuniete / cache usuniety.

### Tryb serwerowy (Supabase) - jesli dotyczy
- [ ] `npm run rodo:delete -- --user <user_id> --confirm` (kasuje chats/messages/documents/projects/workflows/profiles/api_keys; audit_log ZOSTAJE z anonimizacja actor_user_id = SET NULL - wymog AI Act art. 12).
- [ ] Pliki w MinIO (dokumenty soft-deleted) skasowac osobno przez operatora.

## 7. Czego PATRON NIE robi (granica)

- Nie zawiera samozniszczenia danych klienta. Usuwane jest wylacznie Oprogramowanie i jego dane robocze, nie akta sprawy.
- O losie akt klienta decyduje Tester jako administrator (RODO, tajemnica).

---

*MateMatic Solutions - dokument operacyjny pilotazu. Powiazany: ADR-0091, PILOT_READINESS.md, pakiet pilotazowy dok. 2/3/4.*
