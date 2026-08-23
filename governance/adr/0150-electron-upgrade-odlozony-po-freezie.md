# ADR-0150 - Upgrade Electrona odlozony za freeze, z mierzona ekspozycja zamiast domyslu

- **Status:** Zaakceptowany (decyzja techniczna, 2026-08-23) - rekomendacja wykonania po freezie
- **Data:** 2026-08-23
- **Galaz:** `main`
- **Zrodlo:** sprzatanie repozytorium publicznego 2026-08-23; `npm audit` w `desktop/`
- **Mapuje na:** ADR-0100 (bundle konektorow w instalatorze), ADR-0053 (desktop zero-cloud),
  Konstytucja Art. 7 (bezpieczenstwo)

## Kontekst

`npm audit` w katalogu `desktop/` zglasza **2 podatnosci wysokie**: sam `electron`
oraz `extract-zip` (lancuch `electron-builder`, wylacznie czas budowania). Produkt stoi
na **Electron 35.7.5**, przy czym linie naprawione to 41.7.2+ / 42.3.4+ / 43.0.0+.
Najnowszy publikowany: 43.4.1. Jestesmy **osiem wersji glownych** za linia biezaca.

Na produkcie, ktorego teza brzmi "tajemnica zawodowa i RODO", pozycja "high" w audycie
jest widoczna dla kazdego odwiedzajacego repozytorium - audyt uruchamia sie jednym
poleceniem. To argument za pilnoscia. Argument przeciw: podniesienie Electrona o osiem
wersji glownych zmienia Chromium i Node wewnatrz aplikacji, wymaga przebudowy modulow
natywnych (`better-sqlite3-multiple-ciphers`, `sharp`) i dotyka pakowania, ktore w tym
projekcie **juz raz konczylo sie sukcesem przy niekompletnej paczce**
(electron-builder 26 wycinal `node_modules` z `extraResources` - exit 0, aplikacja
nie startowala). Freeze wypada 2-3.09, demo u klienta 7.09.

## Pomiar ekspozycji (2026-08-23)

Zamiast decydowac na podstawie samego slowa "high", sprawdzono, czy zgloszone
podatnosci w ogole siegaja naszej konfiguracji.

| Podatnosc | Nasza sytuacja | Wniosek |
|---|---|---|
| AppleScript injection w `app.moveToApplicationsFolder` (macOS) | metoda nieuzywana; budujemy tylko `win` | nie dotyczy |
| Service worker podszywa sie pod odpowiedz IPC `executeJavaScript` | `executeJavaScript` nieuzywane w `desktop/` | nie dotyczy |
| Zly origin w `setPermissionRequestHandler` dla zadan z iframe | brak handlera, brak `<iframe>`, brak `webview` | nie dotyczy |
| OOB read w IPC drugiej instancji (macOS/Linux) | `requestSingleInstanceLock` uzywany, ale podatnosc dotyczy macOS i Linuksa; cel budowania to `win` | nie dotyczy |

`extract-zip` wystepuje wylacznie w lancuchu `electron-builder`, czyli na maszynie
budujacej, nie w paczce u mecenasa.

## Decyzja

**Upgrade Electrona NIE wchodzi przed freezem.** Zadna ze zgloszonych podatnosci nie
siega konfiguracji, ktora wysylamy; ryzyko wywolane migracja jest w tym oknie wieksze
niz ryzyko, ktore migracja usuwa.

**Upgrade wchodzi zaraz po freezie**, jako wlasna galaz, z pelna sciezka weryfikacji:
`npm run build:dir` + `npm run e2e:smoke` na czystym profilu + przebieg bojowy na
ZAINSTALOWANEJ paczce (`scripts/przebieg_bojowy.py`), bo bramki jednostkowe tej klasy
regresji nie widza.

## Czego ten ADR NIE mowi

Nie mowi, ze jestesmy bezpieczni. Osiem wersji glownych wstecz oznacza brak **wszystkich**
poprawek Chromium z tego okresu, a `npm audit` wymienia wylacznie doradztwa zlozone
przeciw pakietowi `electron` - nie CVE Chromium zalatane po cichu w nowszych wydaniach.
Pomiar powyzej znosi **pilnosc**, nie **potrzebe**. Im dluzej stoimy, tym drozszy skok.

## Konsekwencje

- Repozytorium publiczne pokazuje `npm audit` z dwoma pozycjami wysokimi w `desktop/`
  do czasu wykonania upgrade'u. Kazdy, kto zapyta, dostaje tabele powyzej zamiast
  tlumaczenia - i to jest lepsza odpowiedz niz cisza.
- Backend i frontend maja **zero** podatnosci (overrides, 2026-08-23), wiec pozycja
  dotyczy wylacznie warstwy desktopowej.
- Po upgradzie sprawdzic osobno: podpis natywnych modulow, rozmiar instalatora
  (Chromium rosnie) i czy `electron-builder` nadal kopiuje `extraResources` komplet.

## Alternatywy odrzucone

- **Upgrade teraz, przed freezem.** Odrzucone: osiem wersji glownych plus przebudowa
  modulow natywnych na dwa tygodnie przed demo u klienta. Ta klasa zmiany przechodzi
  testy i wywraca spakowana aplikacje - mamy na to wlasny pomiar z 08-17.
- **Podniesc tylko do pierwszej naprawionej wersji (41.7.2).** Odrzucone: koszt migracji
  jest zdominowany przez przeskok major, a nie przez ich liczbe; zatrzymanie sie na 41
  placi ten sam koszt i zostawia nas dwie wersje glowne wstecz od razu po wykonaniu.
- **Wyciszyc pozycje w audycie** (`npm audit --omit=dev`, allowlist). Odrzucone:
  wyciszenie zamienia mierzalny fakt w niewidoczny. Bramka, ktora milczy bez powodu,
  jest gorsza niz jej brak - ta sama zasada, ktora zbudowala nam pusta liste nazw
  w bramce publikacyjnej.
