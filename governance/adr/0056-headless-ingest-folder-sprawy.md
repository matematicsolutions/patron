# ADR-0056: Headless ingest core + import z folderu lokalnego (fundament Folder Sprawy)

**Status**: PROPONOWANY (2026-05-28). Rozdziela logike ingestu od warstwy HTTP i dodaje import dokumentow z katalogu lokalnego. Fundament pod Folder Sprawy (watcher Electrona) z roadmapy Dnia 6. Backend dziala, niewpiety jeszcze w UI/watcher.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 2 - Tajemnica zawodowa / zero-cloud** - import czyta dysk lokalny maszyny (tryb desktop), bajty nie ida do chmury. Endpoint folder-ingest dostepny tylko w trybie sqlite/desktop.
- **Art. 1 + Art. 3** - kazdy plik z folderu przechodzi ten sam deterministyczny skan input-security + audit + RAG-index co upload HTTP. Brak osobnej, slabszej sciezki.
- **Art. 6 - Granica bledu** - import respektuje gate skanu (blocked/human_review/quarantined nie trafiaja do indeksu), tak samo jak upload.

**Powiazane ADR**: ADR-0055 (wspolny documentIngest - ten ADR wyciaga z niego headless rdzen), ADR-0020 (skan input-security w ingescie), ADR-0054 (RAG-index, gate allowIndex), ADR-0053 (tryb sqlite/desktop - gating endpointu).

---

## Kontekst

Po ADR-0055 `handleDocumentUpload` byl jednym zrodlem prawdy, ale **zwiazanym z HTTP** (`req`/`res`). Folder Sprawy (lokalny folder watch -> auto-ingest dokumentow) potrzebuje wywolac ten sam potok dla pliku z dysku, bez sztucznego opakowywania w zadanie multipart. Mieszanie odczytu dysku z warstwa transportu utrudnialoby tez testowanie (wymagalo Express + multer).

## Decyzja

### 1. Headless `ingestDocument(params)`
Rdzen ingestu wyciagniety do `ingestDocument({ content, filename, userId, projectId, db })` w `backend/src/lib/documentIngest.ts`. Zwraca `{ httpStatus, body, documentId }` - bez `req`/`res`. Robi dokladnie to co wczesniej: skan input-security -> resolveIngestOutcome -> gate persist -> uploadFile -> wersja V1 -> RAG-index (gate allowIndex). Zachowanie i ksztalty odpowiedzi bez zmian.

### 2. `handleDocumentUpload` jako cienki wrapper HTTP
Wyciaga plik z multera (`req.file`) i mapuje wynik na `res.status(httpStatus).json(body)`. Oba routery (documents.ts, projects.ts) bez zmian - dalej wolaja `handleDocumentUpload`.

### 3. `ingestFolder(folderPath, userId, projectId, db)`
Czyta wspierane pliki (pdf/docx/doc) z katalogu i ingestuje kazdy przez `ingestDocument`. Pomija podkatalogi i niewspierane rozszerzenia. Kazdy plik przechodzi pelny skan + RAG-index. Zwraca liste `{ file, httpStatus, documentId }`.

### 4. Endpoint `POST /folders/ingest` (tylko desktop)
`{ path, project_id? }` -> ingestFolder -> podsumowanie. Chroniony `requireAuth`. Zablokowany (404) gdy `!isSqliteBackend()` - czytanie dowolnej sciezki serwera w trybie chmurowym byloby grozne. W trybie desktop user czyta wlasny dysk (auth bypass, localhost).

---

## Alternatywy odrzucone

1. **Watcher POST-uje pliki do `/single-documents` (multipart)**. Odrzucone jako glowna sciezka: w trybie desktop backend czyta dysk bezposrednio - opakowywanie lokalnego pliku w multipart HTTP do samego siebie to zbedny narzut i utrata sciezki path-based potrzebnej watcherowi. Endpoint HTTP upload zostaje dla przegladarki.
2. **Osobna, lzejsza logika ingestu dla folderu**. Odrzucone: powtarza blad sprzed ADR-0055 (dwie kopie sie rozjada, jedna omija skan). Jedno zrodlo prawdy (ingestDocument) obowiazuje.
3. **Indeksacja folderu awaited (blokujaca) zamiast per-plik w tle**. Pozostawione jak w uploadzie (RAG-index best-effort w tle per plik). Batch moze chciec awaited progress - rezerwacja, gdy pojawi sie UI postepu importu.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 669 pass / 5 todo / 0 fail (z 666 przed ADR; +3 w `documentIngest.test.ts` - ingestDocument 201 + ready + wersja, niewspierany typ 400, ingestFolder pomija .txt). Testy headless, bez Express.
- **LoC**: ~314 (documentIngest.ts +149/-49 refaktor na headless + ingestFolder; folders.ts 47; documentIngest.test.ts 116; index.ts +2 mount).
- **Zero nowych zaleznosci npm**.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0056

- **Watcher Electrona** (chokidar/native FS w `desktop/`, wybor folderu przez UI, debounce, per-plik change events) -> nastepna jednostka (desktop/, nietestowalne headless tutaj).
- **Deduplikacja** (hash pliku, pomijanie juz zaimportowanych, wykrywanie zmian) -> rezerwacja. Obecnie ponowny import tworzy nowy dokument.
- **UI postepu importu** + obsluga 202/422 per plik w froncie -> rezerwacja (lustro frontowego follow-upu z ADR-0055).
- **Mapowanie struktury podkatalogow na projekty/foldery sprawy** -> rezerwacja. Obecnie plaski import jednego katalogu.
- **Re-index przy zmianie pliku na dysku** -> czesc watchera (nastepna jednostka).
