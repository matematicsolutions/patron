# ADR-0106: OCR pilot-readiness - wstrzykniecie silnika, bundling Tesseract, rekursja folderu, picker

- **Status:** Zaakceptowany (pilot-driven). Branch `feat/tier-governance-envelope`, NIESCALONY do `main` (bramka: 2x review WM).
- **Data:** 2026-06-05
- **Kontekst pilota:** Pilot-01-Czechowicz. Realne akta = 626 zeskanowanych JPG (sprawa Klamczynski). Beata: "PATRON nie czyta dokumentow".

## Kontekst

OCR jest w PATRONie engine-agnostic przez env `PATRON_OCR_CMD` (ADR-0074), a silnik (Tesseract/Chandra) mial byc wpiety w "next steps" ADR-0075 - **nigdy nie zaszipowany**. Na maszynach pilota `PATRON_OCR_CMD` byl PUSTY -> `isOcrConfigured()=false` -> obrazy odrzucane na wejsciu. Dodatkowo: importer folderu sprawy **pomijal podkatalogi**, a UI wymagalo **recznego wpisania sciezki** (nietechniczna Beata: "nie wiem jak skopiowac sciezke - chce jak zalacznik"). Cztery luki pilot-readiness OCR ("Libra nie przyjmuje zdjec, my tak").

## Decyzja

1. **Wstrzykniecie `PATRON_OCR_CMD` w `desktop/main.js` (`resolveOcr`).** Priorytet: (1) override Operatora (`process.env`), (2) Tesseract zbundlowany w instalatorze (`resources/backend/ocr/tesseract/`), (3) Tesseract zainstalowany recznie w znanej lokalizacji. Ustawia tez `TESSDATA_PREFIX`. Szablon: `"<exe>" {input} stdout -l pol --psm 1`.

2. **Quote-aware tokenizer w `ocrRunner.ts`.** `buildOcrArgv` dzielilo szablon po bialych znakach -> sciezka silnika ze spacjami (`C:\Program Files\Tesseract-OCR\...`) rozpadala sie na kilka argv. Dodano `tokenizeTemplate` respektujacy cudzyslowy (segment w `"..."` = jeden token). Bez tego bundling na Windowsie bylby niewykonalny.

3. **Bundling Tesseract+pol do instalatora (`prepare-resources.cjs` -> `stageOcrEngine`).** Best-effort (jak embedder): kopiuje katalog Tesseract (exe + DLL, BEZ wlasnego tessdata) + `pol.traineddata` (+`osd` dla `--psm 1`) do `dist-resources/backend/ocr/`. Zrodlo konfigurowalne (`PATRON_TESSERACT_DIR`/`PATRON_TESSDATA_DIR`), domyslnie instalacja UB-Mannheim (Apache 2.0 - czyste do bundla komercyjnego). Gdy brak zrodla -> ostrzezenie, build bez OCR (`main.js` spadnie na sciezke 3). `preload.js` dodany do `build.files`.

4. **Rekursja importera (`documentIngest.ts` -> `collectSupportedFiles`).** `ingestFolder` schodzi w podkatalogi; sciezka wzgledna w polu `file` (audyt/UI: "Cz. 1/IMG_2462.JPG"). Akta papierowe sa czesto cyfryzowane w podfolderach - pomijanie czynilo import bezuzytecznym.

5. **Natywny folder-picker (FIX UX, parytet z Libra).** `preload.js` (contextBridge) wystawia `window.patron.selectFolder()` -> IPC `patron:selectFolder` -> `dialog.showOpenDialog({openDirectory})`. `FolderIngestModal.tsx`: w desktopie picker = akcja glowna (przycisk-bohater), **wybor folderu uruchamia import OD RAZU** (jak zalacznik); pole tekstowe schowane jako fallback techniczny. W przegladarce/dev (brak mostu) zostaje pole tekstowe.

## Konsekwencje

- (+) PATRON czyta skany z pudelka (Tesseract -l pol, zero-cloud, lokalnie). Walidacja end-to-end: 626 JPG -> 1.02 MB tekstu -> PATRON odpowiedzial na pytanie o zarzut.
- (+) Import folderu = jeden ruch (picker -> import), wchodzi w Cz.1/2/3. Domyka bariere nietechnicznego Operatora.
- (+) Tokenizer cudzyslowy: sciezki ze spacjami bezpieczne (testy).
- (-) **Rozmiar:** zbundlowany Tesseract UB-Mannheim ~245 MB (instalator 525 -> ~770 MB). Akceptowalne dla desktopu na USB; trim (pominiecie narzedzi treningowych `lstmtraining`/`text2image`/`doc`) = przyszla optymalizacja. Alternatywa: `PATRON_TESSERACT_DIR` na pre-trimowany katalog.
- (-) **Wymaga przebudowy instalatora** (`npm run build` w `desktop/`) - bundling to krok build-machine, nie hot-patch. Kod stagingu zweryfikowany dry-run (exe+51 DLL+pol+osd kopiuja sie).
- (park) OCR pisma odrecznego slabe (Tesseract); druk (akt oskarzenia, postanowienia) czytany dobrze - wystarcza do zadania pilota.

## Bramki

ADR przed merge do `main`; 2x review WM. Bundling licencyjnie czysty (Tesseract Apache 2.0 - bramka licencji Konstytucji OK). Pelny rebuild+reinstalacja u Beaty przed demo "zdjecia".
