# Runbook: code signing instalatora Windows (Authenticode)

**Wlasciciel:** WM (zakup certu = akt ludzki, bramka B5 trackera 2.0).
**Powiazane:** spec 011 (konfiguracja w build-locale.cjs), spec 008 (auto-update -
metadane przeliczane po podpisie automatycznie), project_patron_unsigned_installer_2_0
(tarcie SmartScreen w 1.0).
**Stan:** konfiguracja GOTOWA i uspiona. Aktywacja = same zmienne srodowiskowe,
zero zmian w repo.

---

## 1. Wybor certyfikatu (decyzja zakupowa WM)

| | OV (Organization Validation) | EV (Extended Validation) |
|---|---|---|
| SmartScreen | reputacja buduje sie z czasem/liczba instalacji - pierwsze tygodnie nadal ostrzega | reputacja od razu (natychmiastowe zaufanie MS) |
| Nosnik klucza | od VI.2023 tez wymagany sprzet/HSM (CA/B Forum) | token USB / HSM / cloud HSM |
| Cena/rok (rzad wielkosci) | ~200-400 EUR | ~300-700 EUR |
| Dla PATRONA | wystarczy przy cierpliwosci | usuwa tarcie od pierwszego klienta - REKOMENDACJA przy sprzedazy kancelariom |

Dostawcy do porownania: Certum (PL, najtaniej lokalnie, po polsku), DigiCert,
Sectigo, GlobalSign. Cloud signing (Certum SimplySign / DigiCert KeyLocker) unika
fizycznego tokena - sprawdzic, czy dostawca daje zgodnosc z signtool (CSP/KSP).

## 2. Po zakupie - instalacja

1. Zainstaluj sterowniki tokena / oprogramowanie CSP dostawcy (albo aktywuj cloud
   signing wg instrukcji CA).
2. Cert ma byc widoczny w magazynie Windows: `certutil -user -store My`
   - zanotuj **odcisk SHA1** (Thumbprint) - to najpewniejszy selektor.
3. signtool: z Windows SDK (`winget install Microsoft.WindowsSDK.10.0.26100`
   albo juz obecny w Visual Studio). Sprawdz: `where signtool`.

## 3. Aktywacja podpisywania (flip - zero commitow)

Przed `npm run build:pl` (i kazda inna edycja) ustaw:

```
set PATRON_CODE_SIGNING=on
set PATRON_CERT_SHA1=<odcisk z certutil>
:: alternatywnie zamiast SHA1:  set PATRON_CERT_SUBJECT=MateMatic Solutions
:: opcjonalnie:                 set SIGNTOOL_PATH=C:\...\signtool.exe
:: opcjonalnie:                 set PATRON_TIMESTAMP_URL=http://time.certum.pl
```

build-locale.cjs wtedy: (1) podpisze `PATRON-Setup-Windows[-XX].exe` signtoolem
(`/fd SHA256 /td SHA256 /tr <timestamp>`), (2) przeliczy sha512/size w
`latest[-xx].yml`, (3) zregeneruje blockmap - auto-update (spec 008) dostaje
spojne metadane podpisanego pliku. Brak PATRON_CERT_* przy wlaczonej fladze =
build przerwany (fail-loud). Token EV poprosi o PIN przy kazdym podpisie -
dlatego podpis jest LOKALNY u WM, nigdy w CI (klucz/token nie wchodzi do GitHub).

## 4. Weryfikacja po buildzie

```
signtool verify /pa /v desktop\dist\PATRON-Setup-Windows.exe
```

Oczekiwane: "Successfully verified", lancuch do zaufanego CA, timestamp obecny
(podpis wazny takze po wygasnieciu certu). Test SmartScreen: pobierz exe przez
przegladarke na czystej maszynie/VM i uruchom.

## 5. Ograniczenia wariantu post-build (swiadome)

- **Uninstaller NSIS pozostaje niepodpisany** (jest wbudowany w instalator przed
  naszym krokiem). SmartScreen ocenia glownie instalator; jesli klienci zglosza
  ostrzezenia przy odinstalowaniu - rewizyta na natywny signing electron-buildera
  (win.certificateSubjectName / signtoolOptions) po wyborze certu.
- Kazda edycja (6 exe) = osobny podpis; token z PIN = 6 klikniec. Cloud signing
  z PIN-less policy usuwa te niedogodnosc.
- CHECKSUMS.txt liczony z podpisanego pliku (kolejnosc krokow w build-locale) -
  publikowane sumy zgadzaja sie z tym, co pobiera klient.
