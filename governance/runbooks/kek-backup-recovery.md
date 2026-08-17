# Runbook: backup i odzyskanie kluczy szyfrowania (KEK)

**Wlasciciel procedury:** Operator PATRONA w kancelarii (rola z Konstytucji).
**Powiazane:** ADR-0072 (at-rest SQLite), ADR-0138 (field-level encryption, spec 005),
Konstytucja Art. 5 (tajemnica) / Art. 7 (bezpieczenstwo).
**Status:** warunek wydania 2.0 (pozycja A2-3 roadmapy; podniesione z Q6 spec 005).

> **Zasada nadrzedna (fail-loud by design):** PATRON szyfruje tak, ze **utrata klucza
> = trwala utrata zaszyfrowanych danych**. Nie ma tylnej furtki, nie ma "resetu hasla",
> MateMatic NIE posiada kopii kluczy kancelarii i NIE odzyska danych. Dlatego escrow
> klucza wykonuje sie W MOMENCIE aktywacji szyfrowania, nigdy "pozniej".

---

## 1. Inwentarz kluczy i sekretow

| # | Klucz / sekret | Wlacza | Gdzie zyje | Co szyfruje | Utrata bez backupu |
|---|---|---|---|---|---|
| 1 | Klucz at-rest bazy (`PATRON_DB_ENCRYPTION_KEY`) | `PATRON_DB_ENCRYPTION=on` (domyslnie OFF) | desktop: blob `db_key.enc` w `%APPDATA%\PATRON\secrets\`, owiniety przez Windows DPAPI (Electron safeStorage) | CALY plik SQLite `patron.db` | **baza nieczytelna w calosci** |
| 2 | KEK field-level (`PATRON_FIELD_ENCRYPTION_KEK`) | `PATRON_FIELD_ENCRYPTION=on` (domyslnie OFF) | desktop: OS keychain/DPAPI; serwer: env secret / KMS | DEK-i w tabeli `encryption_keys`, ktore szyfruja wrazliwe kolumny (ADR-0138) | **zaszyfrowane kolumny nieczytelne** (reszta bazy czytelna) |
| 3 | `USER_API_KEYS_ENCRYPTION_SECRET` | zawsze (desktop generuje) | plik `api_keys_encryption_secret` w `%APPDATA%\PATRON\secrets\` (plaintext 0600) | klucze API dostawcow LLM wpisane przez prawnika | klucze API do ponownego wpisania (bez utraty akt) |
| 4 | `DOWNLOAD_SIGNING_SECRET` | zawsze (desktop generuje) | jw. | podpisy HMAC linkow download | linki przestaja dzialac; regeneracja bez utraty danych |

Krytyczne dla akt sa **#1 i #2**. #3/#4 sa odtwarzalne niska kara.

### Gotcha DPAPI (dotyczy #1, czesciowo #2 na desktopie)

Blob `db_key.enc` jest zaszyfrowany przez **DPAPI zwiazane z profilem uzytkownika
Windows na TEJ maszynie**. Skopiowanie samego bloba na inny komputer lub do innego
profilu Windows **NIE jest backupem** - nie da sie go tam odszyfrowac. Przenosny
backup to zawsze **jawny material klucza** zabezpieczony fizycznie (sejf), nigdy blob.
Reinstalacja Windows / reset profilu / wymiana dysku systemowego niszczy DPAPI -
patrz scenariusz S2.

---

## 2. Procedura escrow - wykonac PRZY aktywacji szyfrowania

### 2a. Field-level encryption (ADR-0138) - zalecana kolejnosc aktywacji

1. Wygeneruj wysokoentropijny sekret (NIE haslo czlowieka):
   `openssl rand -base64 32`
2. Zapisz sekret w DWOCH kopiach escrow, zanim ustawisz go w srodowisku:
   - wydruk w zaklejonej kopercie do sejfu kancelarii (opisz: "PATRON KEK
     field-level, data, kto zdeponowal"),
   - pendrive offline (nie podpiety do sieci) w drugim miejscu fizycznym.
3. Ustaw `PATRON_FIELD_ENCRYPTION_KEK=<sekret>` i `PATRON_FIELD_ENCRYPTION=on`
   w srodowisku backendu.
4. Uruchom aplikacje - pierwszy zapis utworzy owiniety DEK w `encryption_keys`.
5. **Natychmiast zweryfikuj escrow z KOPII (nie z env):**
   przepisz sekret z wydruku do pliku tymczasowego i uruchom
   `npm run kek:verify -- --kek-file <plik>` (sekcja 4). Wynik OK = escrow dziala.
   Usun plik tymczasowy.

### 2b. At-rest SQLite (ADR-0072)

Klucz #1 jest dzis generowany automatycznie przez desktop przy pierwszym
uruchomieniu z `PATRON_DB_ENCRYPTION=on` i trafia wylacznie do bloba DPAPI.
Procedura escrow:

1. PRZED aktywacja: mozesz podac klucz JAWNIE przez env `PATRON_DB_ENCRYPTION_KEY`
   (64 hex; wygeneruj `openssl rand -hex 32`) - wtedy escrow robisz identycznie
   jak w 2a pkt 2 i masz pelna kontrole nad materialem klucza.
2. Jesli klucz wygenerowal sie automatycznie (blob): backup = kopia bloba
   `db_key.enc` **plus** swiadomosc, ze dziala tylko na tej maszynie i profilu
   (gotcha DPAPI). Do backupu przenosnego trzeba przejsc na wariant env (pkt 1)
   przy najblizszej migracji.
3. Dodatkowo utrzymuj regularny backup CALEGO katalogu danych
   (`%APPDATA%\PATRON\` - baza, sprawy, brain, secrets) na nosnik offline.
   Backup zaszyfrowanej bazy bez klucza jest bezwartosciowy - klucz i backup
   przechowuj OSOBNO, ale oba musza istniec.

---

## 3. Scenariusze "kancelaria zgubila klucz"

### S1: Zgubiony KEK field-level, aplikacja dziala

Objaw: nic - aplikacja ma KEK w srodowisku. Zguba dotyczy kopii escrow.
Dzialanie: **potraktuj jak pozar.** Sekret wciaz jest w env/keychain dzialajacej
instalacji - wykonaj procedure 2a pkt 2 od nowa (nowe koperty), zweryfikuj
`kek:verify`. Nie odkladaj: awaria maszyny w miedzyczasie = scenariusz S3.

### S2: Reinstalacja Windows / nowa maszyna / reset profilu (at-rest)

Objaw: backend fail-loud przy starcie - baza nie daje sie otworzyc (zly klucz),
albo desktop wygenerowal NOWY klucz i proba otwarcia starej bazy konczy sie bledem.
Drzewko:
1. Masz escrow klucza (hex z 2b pkt 1)? -> ustaw `PATRON_DB_ENCRYPTION_KEY=<hex>`
   w env desktopu, przywroc plik bazy z backupu, start. KONIEC.
2. Masz stary dysk/profil sprawny? -> uruchom PATRONA tam i wykonaj 2b pkt 1
   (przejscie na env + escrow), potem migruj.
3. Nie masz ani escrow, ani zywego profilu? -> **dane w zaszyfrowanej bazie sa
   stracone.** Przywroc najnowszy backup bazy sprzed aktywacji szyfrowania
   lub backup wykonany z dzialajacym kluczem. Zgloś incydent zgodnie z
   procedura RODO kancelarii (utrata dostepnosci danych, art. 32).

### S3: Zgubiony KEK field-level i maszyna nie zyje

1. Odszukaj kopie escrow (sejf / pendrive). Zweryfikuj na przywroconej bazie:
   `npm run kek:verify -- --kek-file <plik-z-sekretem>`.
2. OK -> ustaw env, uruchom, KONIEC.
3. Brak dzialajacej kopii -> zaszyfrowane kolumny sa stracone. Reszta bazy
   (niezaszyfrowane kolumny, pliki spraw jesli nieobjete) pozostaje czytelna.
   Przywroc backup sprzed aktywacji, incydent RODO jak w S2.3.

### S4: Podejrzenie kompromitacji klucza (nie zguba, wyciek)

KEK field-level: rotacja KEK = re-wrap DEK (ADR-0138 pkt 5; US3 spec 005 -
do czasu implementacji: eksport danych, nowy KEK, import). At-rest: rekey bazy
(`PRAGMA rekey` sterownika cipher) z nowym kluczem + nowy escrow. W obu
przypadkach: nowe koperty, stare zniszcz protokolarnie.

---

## 4. Weryfikacja backupu - `npm run kek:verify`

Skrypt `backend/scripts/verify-kek-backup.ts` (read-only, zero-cloud) sprawdza,
czy podany material KEK odwija WSZYSTKIE owiniete DEK-i w `encryption_keys`:

```
cd backend
# kandydat z pliku (zalecane dla kopii escrow; plik = sam sekret, 1 linia):
npm run kek:verify -- --kek-file C:\tmp\kek-escrow.txt

# desktop SQLite spoza aplikacji - wskaz baze jawnie:
set PATRON_DB_BACKEND=sqlite
set PATRON_DB_PATH=%APPDATA%\PATRON\patron.db
npm run kek:verify -- --kek-file C:\tmp\kek-escrow.txt
```

Wyniki: exit 0 = wszystkie DEK odwiniete (escrow dziala); exit 1 = zly klucz lub
uszkodzony wiersz (NIE chowaj tego wyniku - to alarm); exit 2 = brak wierszy
(szyfrowanie nigdy nieaktywowane - nie ma czego weryfikowac).

**Harmonogram:** weryfikacja kwartalna z kopii escrow (nie z env!) + po kazdej
zmianie infrastruktury (nowa maszyna, migracja, zmiana Operatora). Wynik odnotuj
(data, kto, exit code) w dzienniku Operatora - to dowod nalezytej starannosci
(art. 32 RODO).

---

## 5. Czego ta procedura NIE obiecuje

- Odzyskania danych bez klucza - niemozliwe by design (i to jest ficzer).
- Escrow u MateMatic - klucz nie opuszcza kancelarii ("nawet my nie odczytamy
  waszych akt bez waszego klucza").
- Ochrony przed zlym backupem bazy - klucz odzyskuje szyfrogram, nie brakujacy plik.
