# Plan: Auto-update desktop

**Spec:** ./spec.md
**Project Type:** desktop-app (Electron, istniejacy desktop/)

## Technical Context

- **Dependency:** electron-updater ^6 (MIT, dev by electron-builder team) - jedyna nowa zaleznosc runtime desktopu.
- **Provider:** GitHub Releases repo publicznego `mat` (matematicsolutions/patron). Repo publiczne = bez tokena w aplikacji.
- **Kanaly:** electron-updater `autoUpdater.channel` per locale czyta `latest[-xx].yml` z assets najnowszego releasu. Nazwa kanalu ustawiana w runtime z `installLocale()` (juz istnieje, ADR-0132/0139).
- **app-update.yml:** generowany przez electron-builder z sekcji `build.publish` (wymagane, inaczej updater nie ma feedu).
- **Constraints:** zero auto-publish (bramka governance: push publiczny = WM); update nie moze restartowac aplikacji bez zgody czlowieka (trwajaca praca nad aktami).

## Constitution Check (GATE)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | kanal dystrybucji poprawek bezpieczenstwa dla kancelarii |
| RODO / zero-cloud | PASS | jedyny egress = GET na github.com po metadane/instalator; zadnych danych klienta; kill-switch dla rygorystow |
| Human-in-the-loop | PASS | instalacja po dialogu; autoInstallOnAppQuit tylko po pobraniu |
| Bramka licencji | PASS | electron-updater MIT |
| Bramka jakosci | PASS | fail-open na blad (app dziala dalej), log |
| Bramka strategii | PASS | 6 edycji x wydania = skala nie do udzwigniecia recznie |

## Pliki dotykane

- `desktop/package.json` - dependency + build.publish + wersja bez zmian.
- `desktop/main.js` - setupAutoUpdate() (kanal z locale, dialog, kill-switch).
- `desktop/scripts/build-locale.cjs` - krok 4: yml/blockmap per edycja + --publish=never.

## Research notes

GitHubProvider czyta `${channel}.yml` z assets najnowszego pelnego releasu -
custom channel dziala, gdy plik istnieje w assets (stad patch nazw w build-locale).
sha512 w yml liczone od pliku exe - rename nie psuje (kopiujemy bajt-w-bajt).
