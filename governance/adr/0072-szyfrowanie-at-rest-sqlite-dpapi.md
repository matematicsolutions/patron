# ADR-0072: Szyfrowanie at-rest SQLite - klucz DPAPI + honest fail-loud (rdzen)

**Status**: Czesciowo wdrozony 2026-05-29 (zarzadzanie kluczem DPAPI + aplikacja klucza +
fail-loud LIVE; podmiana sterownika cipher-capable = krok infra, patrz Status weryfikacji).
Konstytucja v1.4.5.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 2 (tajemnica zawodowa), Art. 5 (ochrona danych /
bezpieczenstwo przetwarzania), RODO art. 32
**Powiazane**: ADR-0053 (SQLite single-user), ADR-0054 (sqlite-vec - ryzyko kompatybilnosci),
ADR-0062 (Electron tryb local - wzorzec sekretow), ADR-0067 (wzorzec opt-in egress)

## Kontekst

Krytyk audytu FAZA 0 (elevated, "powinno byc RED"): baza SQLite (`patron.db`) nie ma szyfrowania
at-rest - zero PRAGMA key / SQLCipher. Skradziony laptop = pelna tajemnica zawodowa (akta klientow,
graf cytowan, audit_log) w plaintext. Dla produktu regulowanego (tajemnica adwokacka/radcowska,
RODO art. 32) to powazna luka.

Decyzja Wieslawa (2026-05-29) co do zrodla klucza: **OS keychain / DPAPI** - klucz chroniony przez
system, transparentny dla mecenasa (zero frictionu przy starcie), realnie chroni przed kradzieza
dysku gdy atakujacy nie ma sesji usera. (Odrzucono: passphrase przy starcie - friction + brak
recovery; klucz w pliku obok danych - falszywe bezpieczenstwo.)

## Decyzja

### Zarzadzanie kluczem (Electron main, DPAPI)
Backend dziala jako osobny proces (`spawn node dist/index.js`), wiec nie ma dostepu do Electron
`safeStorage`. Klucz prowizjonowany w main.js: 256-bit losowy, zaszyfrowany przez `safeStorage`
(DPAPI na Windows / Keychain na macOS), persystowany jako blob `userData/secrets/db_key.enc` -
NIGDY w plaintext na dysku (inaczej niz istniejacy getOrCreateSecret). Jawny klucz wstrzykiwany do
backendu przez `PATRON_DB_ENCRYPTION_KEY` (wzorzec istniejacych sekretow). Gdy DPAPI niedostepny -
rzuca (nie tworzy klucza w plaintext). Aktywne tylko gdy `PATRON_DB_ENCRYPTION=on`.

### Aplikacja klucza + honest fail-loud (backend)
`applyEncryptionKey(db)` (lib/db/atrest.ts) wolane jako PIERWSZA operacja po `new Database()`
(przed PRAGMA/DDL). Brak klucza -> no-op (plaintext jak dotad). Klucz ustawiony -> `PRAGMA key`,
po czym WERYFIKACJA `PRAGMA cipher_version`: jezeli sterownik nie szyfruje (vanilla better-sqlite3
ignoruje PRAGMA key) -> RZUCA, zamiast po cichu pracowac na plaintext z falszywym poczuciem
bezpieczenstwa. To kluczowa wlasciwosc: nie da sie przypadkiem myslec, ze baza jest szyfrowana,
gdy nie jest.

## Konsekwencje

- Material klucza chroniony przez OS (DPAPI), nie lezy w plaintext - honoruje decyzje o zrodle klucza.
- Domyslnie OFF (brak PATRON_DB_ENCRYPTION) -> zero zmiany zachowania, baza plaintext jak dotad.
  Wlaczenie = swiadoma decyzja Operatora (spojne z wzorcem opt-in ADR-0067).
- Fail-loud eliminuje klase bledu "mysleli ze szyfrowane, a nie bylo".

## Ograniczenia / pozostaly krok infra (BLOKUJACY pelna aktywacje)

Prawdziwe szyfrowanie wymaga podmiany sterownika `better-sqlite3` -> `better-sqlite3-multiple-ciphers`
(drop-in API-compatible, wspiera PRAGMA key/cipher). NIE wykonane w tym ADR z powodu:
- **node_modules przez junction do ~/patron** (publiczny baseline + zywa instancja Wieslawa) -
  instalacja natywnej zaleznosci dotknelaby ~/patron (zakaz). Wymaga najpierw de-junction
  (wlasne node_modules dla PATRON-Desktop) albo osobnej strategii zaleznosci.
- **Ryzyko kompatybilnosci z sqlite-vec** (ADR-0054): rozszerzenie vec0 ladowane do innego buildu
  sqlite - do przetestowania (fallback: PATRON_DISABLE_VEC -> BM25+graf).
- **Migracja istniejacej bazy** plaintext -> szyfrowana (sqlcipher_export albo re-ingest na czystej
  zaszyfrowanej bazie).

Do czasu tego kroku: kod jest gotowy i HONEST (fail-loud), ale szyfrowanie pozostaje wylaczone -
brak falszywej deklaracji. Pelna aktywacja + bump na MINOR przy wlaczeniu domyslnym.

## Status weryfikacji

- `lib/db/atrest.ts` + 3 testy (no-op bez klucza; FAIL-LOUD klucz + vanilla driver; isCipherActive
  false dla vanilla). Backend `tsc` clean, 790 testow pass.
- main.js: getOrCreateDbKey przez safeStorage + wstrzykniecie env (proces Electron - bez testow auto).
- Podmiana sterownika + kompat vec + migracja = krok infra (wymaga decyzji o node_modules).
