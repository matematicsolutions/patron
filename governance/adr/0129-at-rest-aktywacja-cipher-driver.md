# ADR-0129: Aktywacja szyfrowania at-rest - podmiana sterownika na cipher-capable

- **Status:** Proponowany (SCAFFOLD - wymaga natywnej kompilacji do dokonczenia/weryfikacji). Branch `feat/at-rest-native-cipher`, NIESCALONY do `main`. Domkniecie P1 #1 audytu + ADR-0072.
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P1 #1. `patron.db` (akta objete tajemnica adwokacka) lezy na dysku PLAINTEXT. Logika at-rest jest gotowa, brakuje TYLKO sterownika cipher-capable.

## Stan zastany (co JUZ jest)

- **Backend fail-loud (ADR-0072):** `lib/db/atrest.ts` `applyEncryptionKey` aplikuje `PRAGMA key` i weryfikuje `PRAGMA cipher_version`; gdy klucz ustawiony a sterownik NIE szyfruje -> rzuca (zero falszywego bezpieczenstwa). Wpiete jako pierwsza operacja w `getDb()` (sqlite-connection.ts).
- **Electron safeStorage (JUZ wpiete):** `desktop/main.js` `dbEncryptionKey()` (gated `PATRON_DB_ENCRYPTION=on`, ~linie 49-71): klucz generowany raz, persystowany zaszyfrowany DPAPI (`safeStorage.encryptString`) w `userData/secrets`, wstrzykiwany do backendu jako `PATRON_DB_ENCRYPTION_KEY` (`backendLocalEnv`, ~linia 88). Default off -> plaintext jak dotad.
- **BRAK (jedyne):** `package.json` ma `better-sqlite3` (vanilla, IGNORUJE `PRAGMA key`). Trzeba cipher-capable fork.

## Decyzja

Podmiana sterownika przez **alias npm** (zero zmian importow - fork jest API-drop-in):

```
"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^12.10.0"
```

Wszystkie `import Database from "better-sqlite3"` (sqlite-connection.ts, atrest.test.ts, supabase-shim.ts) rozwiazuja sie do forka bez zmian. `@types/better-sqlite3` nadal pasuje (API identyczne). better-sqlite3-multiple-ciphers (SQLite3MultipleCiphers, domyslnie SQLCipher-compatible) honoruje `PRAGMA key` i eksponuje `PRAGMA cipher_version` -> `isCipherActive` = true -> at-rest dziala.

## Kroki aktywacji (na maszynie z toolchainem natywnym - patrz docs/at-rest-activation.md)

1. `package.json` alias (w tym commicie).
2. `cd backend && npm install` (pobiera fork, aktualizuje lockfile).
3. `cd desktop && npx @electron/rebuild -f -w better-sqlite3` (rebuild natywny pod ABI Electrona).
4. Zaktualizowac `atrest.test.ts`: 2 testy zakladaja VANILLA (rzuca / isCipherActive=false) - po podmianie sterownik JEST cipher-capable, wiec odwracaja sie (klucz dziala / cipher_version niepuste). To czesc aktywacji.
5. Wlaczyc: `PATRON_DB_ENCRYPTION=on` (desktop ustawia klucz z safeStorage).
6. Weryfikacja: nowy `patron.db` nie jest czytelny jako plaintext (naglowek != "SQLite format 3" gdy zaszyfrowany); `PRAGMA cipher_version` zwraca wersje; app dziala.

## Migracja istniejacych plaintext baz

Istniejacy `patron.db` (plaintext) NIE odczyta sie po wlaczeniu klucza (ten sam plik nie staje sie magicznie zaszyfrowany). Sciezki:
- **Czysta instalacja** (pilot wczesny) - nowa zaszyfrowana baza od zera.
- **Migracja danych** - `sqlcipher`/`.dump` plaintext -> import do nowej zaszyfrowanej. Runbook w docs.
Decyzja per pilot (Operator). Default fail-closed: bez `PATRON_DB_ENCRYPTION=on` nic sie nie zmienia.

## Dlaczego SCAFFOLD (nie zrobione "na zielono")

Kompilacja natywna (`node-gyp`/`@electron/rebuild`) + weryfikacja w realnym Electronie nie sa wykonalne w tym srodowisku agenta bez ryzyka wypchniecia builda nie do sprawdzenia. Dostarczamy: alias (1 linia) + runbook + odwrocone testy do zastosowania. Aktywacja + weryfikacja end-to-end = na maszynie WM.

## Konsekwencje

- (+) Po aktywacji akta na dysku zaszyfrowane (DPAPI-chroniony klucz, zero-cloud) - domkniecie najpowazniejszej luki poufnosci audytu.
- (+) Zero zmian kodu aplikacji (alias); Electron juz wpiety; fail-loud chroni przed plaintext-z-kluczem.
- (-) Wymaga natywnej kompilacji + rebuild pod Electron (toolchain na maszynie buildujacej instalator).
- (-) Istniejace plaintext bazy wymagaja swiadomej migracji lub czystej instalacji.
- (-) 2 testy atrest.test odwracaja sie (vanilla->cipher) - do zaktualizowania przy aktywacji.
- **Rozmiar instalatora** ronsie nieznacznie (fork ~podobny do better-sqlite3). better-sqlite3-multiple-ciphers: MIT + SQLite3MultipleCiphers (zlib/libpng-like) - czyste do bundla komercyjnego (bramka licencji Konstytucji OK).
