# Aktywacja szyfrowania at-rest (P1 #1 / ADR-0072 / ADR-0118)

> **Status:** SCAFFOLD. Ten branch (`feat/at-rest-native-cipher`) zawiera alias npm
> sterownika cipher-capable. Aktywacja wymaga **natywnej kompilacji** - wykonaj
> ponizsze kroki na maszynie z toolchainem (Visual Studio Build Tools / node-gyp).
>
> **KOORDYNACJA:** sesja rownolegla stroi pipeline desktop (`electron-builder`,
> `@electron/rebuild`). Aktywacja dotyka tego samego natywnego buildu - uzgodnij,
> by jeden strumien wladal natywnym rebuildem na raz.

## Co jest gotowe (przed tym runbookiem)

- Backend fail-loud: `lib/db/atrest.ts` (`PRAGMA key` + weryfikacja `cipher_version`).
- Electron safeStorage: `desktop/main.js` (`dbEncryptionKey()`, gated `PATRON_DB_ENCRYPTION=on`)
  generuje + persystuje klucz (DPAPI) i wstrzykuje `PATRON_DB_ENCRYPTION_KEY` do backendu.
- Alias sterownika: `backend/package.json` ->
  `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^12.10.0"` (ten branch).

## Kroki

### 1. Instalacja forka + lockfile

```bash
cd backend
# Sprawdz dostepna wersje forka pasujaca do better-sqlite3 12.x:
npm view better-sqlite3-multiple-ciphers version
# jezeli 12.10.0 nie istnieje, ustaw najblizsza 12.x w package.json (alias)
npm install
```

### 2. Rebuild natywny pod ABI Electrona (desktop)

```bash
cd ../desktop
# @electron/rebuild jest juz w desktop devDeps (pipeline rownoleglej sesji)
npx @electron/rebuild -f -w better-sqlite3 -m ../backend
```

### 3. Odwrocenie testow zakladajacych vanilla driver

`backend/src/lib/db/atrest.test.ts` ma 2 testy zakladajace, ze sterownik NIE
szyfruje (vanilla). Po podmianie sterownik JEST cipher-capable - zaktualizuj:

- "klucz ustawiony + vanilla driver -> FAIL-LOUD (rzuca)" -> teraz NIE rzuca
  (klucz aplikowany poprawnie); zmien asercje na: baza otwiera sie z kluczem,
  `isCipherActive(db)` === true.
- "isCipherActive: false dla vanilla better-sqlite3" -> teraz true.

```bash
cd ../backend && npm test   # po aktualizacji: 0 fail
```

### 4. Weryfikacja szyfrowania end-to-end

```bash
# Wlacz at-rest (desktop ustawi PATRON_DB_ENCRYPTION_KEY z safeStorage):
#   PATRON_DB_ENCRYPTION=on
# Po starcie na CZYSTEJ bazie:
#   - PRAGMA cipher_version  -> niepusty wynik
#   - naglowek pliku patron.db NIE jest "SQLite format 3\000" (zaszyfrowany)
head -c 16 "%APPDATA%/PATRON/patron.db"   # nie powinno byc "SQLite format 3"
```

## Migracja istniejacych baz plaintext

Wlaczenie klucza NIE szyfruje istniejacego `patron.db` (ten sam plik nie staje
sie zaszyfrowany). Wybierz:

- **Czysta instalacja** (pilot wczesny): nowa zaszyfrowana baza od zera.
- **Migracja danych:**
  ```bash
  # 1. dump plaintext (stary sterownik / sqlite3 CLI)
  sqlite3 patron.db .dump > dump.sql
  # 2. zaimportuj do nowej zaszyfrowanej (sqlcipher / better-sqlite3-multiple-ciphers z PRAGMA key)
  #    PRAGMA key='<klucz>'; .read dump.sql
  ```
  Klucz pobierz z safeStorage (desktop) lub ustaw wlasny na czas migracji.

## Rollback

```bash
# package.json: przywroc "better-sqlite3": "^12.10.0"
cd backend && npm install
cd ../desktop && npx @electron/rebuild -f -w better-sqlite3 -m ../backend
# wylacz PATRON_DB_ENCRYPTION; przywroc oryginalne atrest.test.ts
```

## Licencja

`better-sqlite3-multiple-ciphers`: MIT (wrapper) + SQLite3MultipleCiphers
(zlib/libpng-like) - czyste do bundla komercyjnego (bramka licencji Konstytucji OK).
