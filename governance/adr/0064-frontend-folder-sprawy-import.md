# ADR-0064: Frontend Folder Sprawy (import lokalnego katalogu w UI)

**Status**: PROPONOWANY (2026-05-28). Wystawia backendowy import katalogu (ADR-0056) jako UI: prawnik wskazuje folder z aktami, Patron wciaga pliki lokalnie, skanuje i indeksuje, pokazujac wynik per-plik. Zweryfikowane live w przegladarce (patrz Bramki).

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 2 / zero-cloud + tajemnica zawodowa**: endpoint `/folders/ingest` czyta dysk lokalny i jest dostepny tylko w trybie desktop (sqlite). Akta sprawy nie opuszczaja maszyny. W trybie chmurowym endpoint jest zablokowany (404).
- **Art. 4 - prostota**: prawnik mysli teczkami sprawy. Jeden krok "wskaz folder -> wszystko w srodku" zamiast dodawania plikow pojedynczo.

**Powiazane ADR**: ADR-0056 (backend headless ingest + `ingestFolder` + endpoint `/folders/ingest` - ten ADR to jego UI), ADR-0055 (parytet skanu input-security - kazdy plik z folderu przechodzi ten sam skan co upload pojedynczy), ADR-0062 (frontend tryb local - panel testowany w tym trybie).

---

## Kontekst

Backend potrafi zaimportowac caly katalog lokalny (ADR-0056): kazdy plik przechodzi skan input-security + RAG-index + graf, endpoint `/folders/ingest` zwraca `{ folder, total, indexed, results[] }`. Brakowalo UI - prawnik nie mial jak tego uruchomic. Import calej teczki to naturalna pierwsza czynnosc przy instalacji u klienta (wgrywamy akta sprawy), wiec ma realna wartosc dla grupy testowej.

## Decyzja

### 1. Klient API `ingestCaseFolder` (patronApi.ts)
`ingestCaseFolder(path, projectId?)` przez `apiRequest`. Typy `FolderIngestEntry` (`{ file, httpStatus, documentId? }`) i `FolderIngestResult` lustrzane do backendu (ADR-0056).

### 2. Komponent `FolderIngestModal` (modal)
Wzorzec z `DraftRefinePanel` (createPortal, z-[200], Esc). Input sciezki folderu, guzik "Importuj" (Enter takze importuje), stan ladowania, sekcja "Wynik importu" z podsumowaniem ("Zaimportowano X z Y") i lista per-plik. Status pliku wyprowadzony z `httpStatus`: <300 zaimportowano (zielony), 202 do decyzji (amber), 422 zablokowano skanem (czerwony), reszta blad.

### 3. Guzik w `InitialView`
"Importuj folder sprawy" (ikona folderu) na ekranie startowym asystenta, pod polem czatu. Otwiera modal. v1 importuje bez sprawy; `projectId` jest opcjonalnym propem na pozniejsze przypisanie do sprawy.

### 4. i18n (pl.ts, sekcja `folderIngest`)
Slownik przed komponentami. Etykiety statusow przez `t()` z kluczem dynamicznym (`folderIngest.status.${status}`).

---

## Alternatywy odrzucone

1. **Natywny folder-picker Electrona zamiast pola sciezki**. Odrzucone na v1: dialog systemowy to kod w `desktop/` (strefa ryzykowna, sesja packaging). Pole tekstowe dziala i w przegladarce (test), i w spakowanym `.exe`. Natywny dialog = rezerwacja (lepszy UX, ta sama sciezka backendu).
2. **Auto-watcher (chokidar) zamiast importu na zadanie**. Odrzucone na v1: watcher zyje w `desktop/`, nietestowalny headless. Manualny import jest fundamentem; auto-sync = rezerwacja (ADR-0056 tez go odlozyl).
3. **Wymuszone przypisanie do projektu/sprawy**. Odrzucone na v1: `projectId` jest opcjonalny; import bez sprawy wystarcza dla single-user. UI wyboru sprawy to osobne rozszerzenie.
4. **Przeciaganie folderu do przegladarki**. Odrzucone: przegladarka nie udostepnia sciezki dyskowej serwera, a backend czyta dysk po sciezce (model desktop). Przeciaganie pojedynczych plikow to inna sciezka (upload multipart), juz istnieje.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** frontend (exit 0), w tym dynamiczny klucz `t("folderIngest.status.${s}")`.
- **Weryfikacja LIVE w przegladarce** (tryb local, backend sqlite/fs :3099 + frontend :3002, instancja Wieslawa :3000/:3001 nietknieta): guzik "Importuj folder sprawy" otwiera modal; wskazanie folderu z 2 plikami docx zwrocilo "Zaimportowano 2 z 2", oba pliki ze statusem zaimportowano. Baza potwierdzila: documents=2, doc_chunks=2 (RAG-index faktycznie wykonany).
- **Zmiana**: ~4 pliki frontend (pl.ts, patronApi.ts, FolderIngestModal.tsx nowy, InitialView.tsx) + ~230 LoC.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0064

- **Natywny folder-picker Electrona** -> rezerwacja (alternatywa 1).
- **Watcher auto-sync folderu** (chokidar w `desktop/`) -> rezerwacja (ADR-0056).
- **Scoping importu do konkretnej sprawy/projektu z UI** -> `projectId` jest gotowy w API, brakuje selektora sprawy w modalu.
- **Dedup po hashu** (pomijanie juz zaimportowanych) -> rezerwacja ADR-0056.
- **Progres per-plik na zywo** (streaming) -> v1 czeka na komplet i pokazuje liste raz.
