# ADR-0151 - Jezyk OCR wynika z edycji, a niekompletna paczka zatrzymuje build

- **Status:** Przyjety (wdrozony 2026-08-24, `main`)
- **Data:** 2026-08-24
- **Galaz:** `main` (linia publiczna)
- **Zrodlo:** pomiar przy budowie publicznego katalogu zdolnosci (`/patron/co-potrafie`) -
  weryfikacja twierdzenia "PATRON czyta skany" dla kazdej z dziewieciu edycji
- **Mapuje na:** ADR-0106 (bundling OCR), ADR-0139 (profile jurysdykcji i wersje jezykowe),
  ADR-0132 (jeden jezyk per instalacja), Konstytucja Art. 3 (uczciwosc wyniku)

## Kontekst

Dwa defekty na tej samej sciezce, oba niewidoczne w logu builda.

**Zly jezyk.** `desktop/main.js` budowal komende OCR na sztywno: `-l pol --psm 1`. Ta sama
stala byla w sciezce zapasowej (recznie zainstalowany Tesseract). Rownolegle
`prepare-resources.cjs` wkladal do paczki wylacznie `pol.traineddata`. Skutek: **wszystkie
dziewiec edycji rozpoznawalo skany polskim modelem.** Mecenas w Monachium skanowal niemiecka
umowe i dostawal tekst, ktory wyglada na wynik i nim nie jest - a nastepnie szedl on do
indeksu, do cytatu i do odpowiedzi.

Zmierzone 2026-08-24 na renderowanych zdaniach umownych (udzial poprawnie rozpoznanych slow,
model wlasny vs model polski):

| Edycja | Model wlasny | Model polski |
|---|---|---|
| DE | 100% | 47% |
| BR (por) | 100% | 50% |
| IT | 100% | 71% |
| FR | 100% | 62% |
| ES | 100% | 67% |

**Cicha niekompletnosc.** Staging silnika byl best-effort: brak Tesseractu albo pakietu
jezykowego logowal `UWAGA:` i **przepuszczal build**. Instalator wychodzil bez OCR, a skany
byly odrzucane dopiero u odbiorcy. To ten sam ksztalt awarii co `node_modules` wyciete przez
`electron-builder` 26: zielony build, martwa funkcja, wykrycie u klienta.

## Decyzja

1. **Jezyk OCR wynika z LOCALE edycji.** Mapa `pl→pol, en/gb/us→eng, pt→por, it→ita, de→deu,
   es→spa, fr→fra`. Jeden dom dla wszystkiego, co dziala w czasie budowania:
   `desktop/scripts/ocr-lang.cjs`.
2. **Brak pakietu jezykowego w dzialajacej aplikacji WYLACZA OCR**, zamiast rozpoznawac w zlym
   jezyku. Jawny brak wyniku jest uczciwszy od wyniku przeklamanego.
3. **Brak silnika albo pakietu w czasie budowania ZATRZYMUJE build** (`throw` z nazwa
   brakujacego pliku i katalogu docelowego). Swiadome pominiecie pozostaje mozliwe, ale musi
   byc jawne: `SKIP_OCR=1`.
4. **Kompletnosc paczki sprawdza e2e** spakowanej aplikacji, obok istniejacej asercji
   `node_modules`: brak `tesseract.exe` albo `<lang>.traineddata` = exit 2 z nazwa przyczyny.

## Kopia literalu w `main.js` jest swiadoma

`build.files` w `desktop/package.json` to jawna allowlista (`main.js`, `preload.js`,
`package.json`, `assets/**/*`). Gdyby `main.js` zaczal robic `require()` nowego modulu, plik
nie trafilby do paczki i aplikacja padlaby dopiero po instalacji. Dlatego `main.js` trzyma
wlasna kopie mapy, a rozjazd wykrywa pomiar: `desktop/scripts/ocr-lang-gate.test.cjs` czyta
oba zrodla i pada z konkretna roznica. Bramka jest wpieta w `prepare:resources`, `build`
i `build:dir`.

Zmierzone: wstrzykniety rozjazd (`de: 'pol'` w `main.js`) daje exit 1 z linia
`de: modul="deu" main.js="pol"`; po przywroceniu exit 0. Bramka, ktorej nie widziano na
czerwono na znanym-zlym, nie jest bramka.

## Konsekwencje

- Maszyna budujaca musi miec pakiety jezykowe wszystkich budowanych edycji w
  `%USERPROFILE%\tessdata` albo `PATRON_TESSDATA_DIR`. Uzupelnione 2026-08-24 o `deu`, `fra`,
  `ita`, `spa`, `por` z oficjalnego repozytorium `tesseract-ocr/tessdata` (Apache-2.0), wariant
  standardowy - ten sam co obecne `pol` i `eng`.
- Instalator kazdej edycji rosnie o jeden pakiet jezykowy (14-17 MB), nie o wszystkie.
- Publiczny katalog zdolnosci moze od teraz mowic "skan czytany na Twojej maszynie" bez
  gwiazdki dla edycji obcojezycznych.

## Alternatywy odrzucone

- **`-l pol+eng+deu+...` (wszystkie jezyki naraz).** Odrzucone: Tesseract przy wielu jezykach
  zwalnia i miesza slowniki, a instalator rosnie o ~90 MB w kazdej edycji. Placilibysmy
  rozmiarem i jakoscia za uniknieciem jednej mapy.
- **Cichy fallback na `eng`, gdy brak pakietu edycji.** Odrzucone z tego samego powodu, dla
  ktorego naprawiamy caly defekt: to nadal rozpoznanie w niewlasciwym jezyku, tylko mniej
  widoczne. Fallback zamienia blad na cichy blad.
- **Pobieranie pakietu przy pierwszym skanie.** Odrzucone: to ruch na zewnatrz, ktorego nikt
  nie zatwierdzil, w produkcie sprzedawanym jako local-first. Ta sama zasada co przy silniku
  (ADR-0106).
- **Zostawienie ostrzezenia zamiast bledu builda.** Odrzucone: ostrzezenie w logu, ktorego
  nikt nie czyta, jest dokladnie mechanizmem, ktory doprowadzil do wydania edycji bez OCR.
- **Wyciagniecie mapy z `main.js` do wspolnego modulu.** Odrzucone przez `build.files` -
  patrz wyzej. Kopia z bramka dryftu jest tansza niz zmiana allowlisty tydzien przed freezem.
