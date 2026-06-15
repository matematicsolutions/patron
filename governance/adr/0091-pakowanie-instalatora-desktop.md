# ADR-0091: Pakowanie instalatora desktop (Electron, zero-prerequisite)

**Status**: Wdrozony 2026-06-01 (pakowanie desktop). Konstytucja v1.5.0. Zweryfikowane na maszynie Windows: cicha instalacja NSIS (exit 0) zastapila zasoby kompletnym buildem (backend node_modules + better-sqlite3 pod ABI Electrona, frontend standalone server.js + static + node_modules), zainstalowana aplikacja wstaje (backend 127.0.0.1:3001, frontend standalone 3000, okno renderuje powitanie "Witaj, Mecenasie"). Lancuch headless (build/staging/runtime) plus finalny krok docelowy (instalacja + uruchomienie okna) potwierdzone.

**Data**: 2026-06-01

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: instalator sklada aplikacje zero-cloud single-user (ADR-0053). Backend i frontend dzialaja na loopback 127.0.0.1, dane w userData OS. Bez egress przy starcie, bez pobierania czegokolwiek z sieci po instalacji.
- **Art. 3 - Audytowalnosc / determinizm**: staging zasobow jest deterministyczny (prepare-resources.cjs - czyste kopie + build z przypietymi flagami). Native better-sqlite3 budowany pod znana wersje Electrona (zrodlo prawdy ABI).
- **Art. 7 - Minimalnosc / rzetelnosc**: brak wymogu Node/npm ani toolchainu na maszynie klienta (Node wbudowany w Electron). Instalator zawiera komplet. Decyzje architektoniczne ponizej poparte realna weryfikacja runtime (nie zalozeniem).

**Powiazane ADR**:
- ADR-0053 (SQLite single-user zero-cloud): ten ADR pakuje wlasnie ten tryb w instalator desktop.
- ADR-0072 (at-rest encryption DPAPI): klucz bazy chroniony OS keychain w main.js; rebuild natywny musi objac sterownik cipher gdy szyfrowanie wlaczone (caveat nizej).
- ADR-0071 (fail-closed bez pobierania): embedder nie jest bundlowany w tej iteracji; retrieval degraduje do BM25 + graf bez sciagania modelu przy starcie.

---

## Kontekst

Aplikacja desktop (Electron) uruchamia dwa lokalne procesy: backend Node (Express + SQLite) i frontend Next.js, a okno laduje http://localhost:3000. Poprzednia konfiguracja pakowania nie nadawala sie do instalatora produkcyjnego:

- `desktop/main.js` w produkcji odpalal `npm run dev` (serwer deweloperski Next.js) oraz `node dist/index.js` przez zewnetrzny Node (zalozenie toolchainu u klienta).
- `desktop/package.json` extraResources kopiowal backend i frontend z filtrem `!node_modules/** !src/**`, czyli bez zaleznosci runtime i bez zrodel. Skutek: spakowana aplikacja nie wstaje (brak natywnego better-sqlite3, brak zaleznosci/zrodel frontu).
- `ROOT` w main.js liczony jako `__dirname/..`, niepoprawny dla aplikacji spakowanej (zasoby leza w `process.resourcesPath`).

Cel: jeden instalator Windows (NSIS), ktory wstaje bez Node/npm na maszynie klienta i bez pobierania czegokolwiek przy starcie.

### Weryfikacja runtime (przed pakowaniem)

Headless, na repo (offline):
- Backend w trybie SQLite zero-cloud wstaje i obsluguje realne endpointy: `npm run smoke:desktop` PASS (/health, upload docx 201, index doc_chunks + extracted_entities, folders/ingest, draft tracked-changes roundtrip).
- Frontend produkcyjny standalone (`next build` z output:standalone) wstaje i serwuje aplikacje: `node .next/standalone/server.js` zwraca 307 na / (redirect app-routera na /assistant) oraz HTTP 200 na realny asset referowany w HTML (/_next/static/chunks/<hash>.js). Warunek: static i public dokopiowane do standalone (Next nie robi tego automatycznie). To obala wczesniejsza obawe, ze standalone nie serwuje statyku - serwuje, pod warunkiem montazu.
- tsc --noEmit exit 0, pelny suite 1021 pass, build:all exit 0.

Nieweryfikowalne headless (wymaga docelowej maszyny Windows z toolchainem buildu): kompilacja natywnego better-sqlite3 pod ABI Electrona (@electron/rebuild), `electron-builder` (NSIS), instalacja i uruchomienie okna. To jest z natury krok build-na-celu.

---

## Decyzja

### A. Node wbudowany w Electron dla obu procesow

W trybie spakowanym backend i frontend uruchamiane przez `process.execPath` z `ELECTRON_RUN_AS_NODE=1` (Node wbudowany w Electron), nie przez zewnetrzny `node`/`npm`. Zero wymogu toolchainu u klienta. W trybie dev (`--dev`) zostaje zewnetrzny toolchain (deweloper go ma): backend `node dist/index.js`, frontend `npm run dev`. Rozgalezienie po `app.isPackaged`.

### B. Frontend produkcyjnie ze standalone

`next.config` ma output:standalone. W produkcji uruchamiany `frontend/server.js` (standalone bundluje wlasne minimalne node_modules), nie serwer deweloperski. Zmienne `NEXT_PUBLIC_*` sa inline'owane w czasie BUILDU (`NEXT_PUBLIC_PATRON_LOCAL_MODE=true`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` w prepare-resources), nie runtime. Static (`.next/static`) i `public` dokopiowane do standalone (udokumentowany krok deployu Next, ktorego build nie robi sam).

### C. Backend z natywnym modulem pod ABI Electrona

Staging backendu: `dist` + `package.json` + `npm install --omit=dev` (produkcyjne node_modules, w tym natywny better-sqlite3), nastepnie `@electron/rebuild` better-sqlite3 pod wersje Electrona (zrodlo prawdy ABI z zainstalowanego pakietu electron). Bez rebuildu `require('better-sqlite3')` pod Node Electrona rzuca ERR_DLOPEN_FAILED.

### D. Staging dist-resources + podzial asar / resources

`desktop/scripts/prepare-resources.cjs` sklada komplet do `desktop/dist-resources/{backend,frontend}`, ktory electron-builder kopiuje verbatim przez extraResources. Kod aplikacji Electrona (main.js, package.json, assets) idzie do asar przez `files`. Skrypt build: `prepare-resources && electron-builder --win --x64`.

### E. Resolucja sciezek i bind loopback

`RES()` = `app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')`. Backend i frontend bind tylko 127.0.0.1 (API kancelarii nie wychodzi na LAN). Sekrety per-instalacja i klucz bazy (ADR-0072) bez zmian.

---

## Konsekwencje

**Pozytywne**:
- Instalator bez wymogu Node/npm u klienta (Art. 7). Komplet w jednej paczce, zero pobierania przy starcie (Art. 1).
- Frontend produkcyjny (standalone), nie deweloperski: szybszy, mniejszy, bez zrodel na dysku klienta. Serwowanie aplikacji zweryfikowane (200 na realnym assecie).
- Backend zero-cloud zweryfikowany smoke testem. Native better-sqlite3 deterministycznie budowany pod ABI Electrona.
- Tryb dev nietkniety (rozgalezienie app.isPackaged): deweloper pracuje jak dotad.

**Negatywne / koszt / caveaty**:
- Finalna poprawnosc instalatora (rebuild ABI, NSIS, instalacja, uruchomienie okna) weryfikowalna tylko na docelowej maszynie Windows. Status pozostaje Zaproponowany do czasu tej weryfikacji. Nie oglaszac gotowosci na podstawie samego `electron-builder` exit 0.
- Szyfrowanie at-rest (ADR-0072, `PATRON_DB_ENCRYPTION=on`) uzywa sterownika cipher-capable (better-sqlite3-multiple-ciphers). prepare-resources rebuilduje obecnie tylko `better-sqlite3`. Gdy szyfrowanie wlaczone, rebuild musi objac modul cipher - inaczej backend rzuci fail-loud. Domyslnie szyfrowanie OFF, wiec pilot startuje; wlaczenie wymaga rozszerzenia rebuildu (rezerwacja).
- Embedder nie jest bundlowany (Art. 0071 fail-closed bez pobierania): retrieval degraduje do BM25 + graf, aplikacja startuje. Bundle modelu embeddera = osobny krok pilota.
- Konektory MCP nie sa skladane w tej iteracji (osobny `scripts/bundle-mcp.cjs`); wpiecie do paczki desktop = rezerwacja.
- Tylko Windows (NSIS). macOS/Linux poza zakresem.

**Bramki przed flip na Wdrozony**:
- Headless (spelnione): tsc exit 0, suite 1021 pass, smoke:desktop PASS, standalone serwuje assety 200.
- Na maszynie Windows (do wykonania przez Operatora/Wieslawa): `cd desktop && npm install` (electron + @electron/rebuild), `npm run build` (prepare-resources + electron-builder), instalacja wygenerowanego NSIS, uruchomienie - okno wstaje, backend i frontend odpowiadaja, mozna zaindeksowac dokument. Dopiero wtedy flip statusu.
- Marko 2x na tym ADR przed merge. Galaz feat/desktop-packaging, brama private-remote przed push.

## Co pozostaje zarezerwowane

1. **Weryfikacja instalatora na Windows** (rebuild ABI + NSIS + instalacja + launch) - warunek flipu statusu.
2. **Rebuild sterownika cipher** (better-sqlite3-multiple-ciphers) dla trybu szyfrowania at-rest.
3. **Bundle embeddera** (model lokalny) - by retrieval mial warstwe wektorowa, nie tylko BM25+graf.
4. **Bundle konektorow MCP** do paczki desktop (6 konektorow prawa PL/UE).
5. **macOS / Linux** (Linux szacowany 3-5 dni - native rebuild + windowsizmy).
