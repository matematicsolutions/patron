# ADR-0142: Weryfikator w paczce eksportu audytowego

**Status**: Wdrozony 2026-08-04 (rdzen LIVE dla audit pack; wpiecie bundla -
rezerwacja, patrz Status weryfikacji). Konstytucja v1.7.1.
**Data**: 2026-08-04
**Powiązane zasady**: Konstytucja AI Patrona, Art. 3 (audytowalnosc),
Art. 8 (przejrzystosc), AI Act art. 12 (record-keeping)
**Powiązane**: ADR-0001 (hash-chain), ADR-0026 (Merkle), ADR-0047 (audit pack),
ADR-0066 (audit bundle), ADR-0049 (rezerwacja: podpis Ed25519 + RFC 3161)

## Problem

Patron budowal artefakty audytowe (pack ADR-0047, bundle ADR-0066) i potrafil
je zweryfikowac - **wlasnym skryptem z katalogu `backend/`**. Odbiorca artefaktu
dostawal plik JSON, w ktorym stalo:

```
"offline_cli": "Uruchom z katalogu backend/: npx tsx scripts/verify-audit-pack.ts <plik.json>"
```

Sad, UODO ani klient kancelarii nie maja katalogu `backend/`. Zeby wykonac te
instrukcje, musieliby sklonowac repozytorium na AGPL-3.0 i zainstalowac
zaleznosci npm (**704 MB, 312 pakietow top-level** przy pomiarze 2026-08-04),
a do tego miec Node i `tsx`. Pomiar na czystym katalogu z samym plikiem JSON:
polecenie z instrukcji konczy sie bledem `npx canceled due to missing packages`.

Komentarze w obu skryptach glosily przy tym "samowystarczalny". Bylo to prawda
w waskim znaczeniu (bez sieci, bez bazy) i nieprawda w tym, ktore ma znaczenie
dla odbiorcy (bez instalacji). To ten sam wzorzec, co inne awarie zapisane w
tym repo: **narzedzie istnieje, wyglada na kompletne i nie dziala u tego, dla
kogo jest przeznaczone**.

Skutek praktyczny: roznica miedzy "prowadzimy dziennik zdarzen zgodny z AI Act
art. 12" a "sad, regulator i klient moga ten dziennik **sami sprawdzic**".
Pierwsze jest deklaracja. Drugie jest dowodem.

## Decyzja

Eksport audytowy zwraca **archiwum ZIP**, w ktorym obok artefaktu jada
narzedzia do jego sprawdzenia:

| plik | rola |
|---|---|
| `audit-pack-event-<id>-<data>.json` | artefakt |
| `SPRAWDZ-TEN-PLIK.html` | weryfikator przegladarkowy - zero instalacji |
| `verify.py` | weryfikator CLI - sama biblioteka standardowa Pythona 3.8+ |
| `CZYTAJ-TO-NAJPIERW.txt` | instrukcja dla odbiorcy, po polsku, bez zargonu |

Odbiorca potrzebuje przegladarki **albo** Pythona 3. Nic nie jest wysylane na
zewnatrz, nie potrzeba dostepu do systemu kancelarii, konta ani sieci.

### Dwa weryfikatory, nie jeden

Nie jest to nadmiar - kazdy pokrywa innego odbiorce i inne ryzyko:

- **HTML** pokrywa realny przypadek: sekretariat sadu na Windowsie, gdzie
  Pythona nie ma i nie bedzie. Podwojne klikniecie, przeciagniecie pliku,
  werdykt do wydruku.
- **Python** pokrywa dzial IT regulatora i **kontrole automatyczna** - kody
  wyjscia 0/1/2 wpina sie w cudzy pipeline.

Wazniejsze: weryfikator HTML uzywa **tego samego `JSON.stringify`** co strona
wydajaca, wiec nie da sie w nim odtworzyc kanonikalizacji blednie. Python musial
ja **reimplementowac** - to osobna klasa bledow (formatowanie liczb, znaki
ucieczki), a jej skutkiem bylby falszywy werdykt "naruszony" na zdrowym
artefakcie. Dlatego zgodnosc jest weryfikowana wektorami, a nie zakladana
(patrz Dowody).

### Weryfikatory sa OSADZONE w kodzie, nie czytane z dysku

`audit-verifier-assets.ts` trzyma tresc obu narzedzi jako `String.raw`.
Alternatywa (pliki na dysku, `readFileSync` przy eksporcie) jest wygodniejsza
w edycji, ale w wersji desktop (Electron) plik pominiety w krokach pakowania
zniknalby po cichu, a eksport **nadal konczylby sie sukcesem** - z archiwum bez
weryfikatora. Osadzenie zamienia to na blad kompilacji zamiast cichej
niekompletnosci u odbiorcy. Koszt: edycja przez plik `.ts`.

### Trzeci stopien weryfikacji: ciaglosc ogniw

Przy okazji domknieta luka w bundlu. Dotychczas sprawdzal on manifest per czesc
oraz sume calosci. Obie te kontrole **przechodza**, jesli podmieniajacy usunie
wpis z `audit_log_excerpt` i przeliczy skroty. Doszla kontrola ciaglosci
`prev_hash` -> `hash`, ktora lapie wpis usuniety ze srodka i wpisy przestawione
**takze po przeliczeniu manifestu**.

Kontrola sprawdza ogniwa, a nie przelicza samych skrotow - jest to swiadome i
wymuszone: `computeAuditHash` liczy skrot z payloadu **sprzed maskowania**, a
artefakt niesie `payload_masked` (ADR-0040). Nienaruszalnosc tresci
pojedynczego wpisu potwierdza dowod Merkle, nie przeliczenie.

## Dowody (pomiar, nie deklaracja)

- **Kanonikalizacja**: 17 wektorow wygenerowanych **produkcyjnym**
  `canonicalSha256` Patrona, w tym `1e-7`, `1e21`, `-0`, liczby powyzej 2^53,
  pary surogatow, znaki sterujace, polskie diakrytyki, sortowanie kluczy z
  kluczem pustym. Python: 17/17 zgodnych. HTML: 17/17 zgodnych.
- **SHA-256 w HTML**: zgodny z `node:crypto` na 310 wejsciach, w tym dlugosci
  graniczne dopelnienia bloku (55/56/63/64 bajty) i 300 napisow losowych.
- **Werdykty**: artefakt zdrowy -> nienaruszony; zmieniona tresc zdarzenia,
  podmieniony krok dowodu, podmieniony korzen po przeliczeniu sumy, zmieniona
  opinia, zmieniony werdykt cytatu, wpis usuniety, wpisy przestawione, oraz
  **usuniecie i przestawienie po przeliczeniu manifestu** -> naruszony.
  Zgodne w obu weryfikatorach.
- **Sciezka realna**: `verify.html` otwarty z `file://` w przegladarce,
  artefakt podany przez `FileReader`, polskie diakrytyki przezywaja dekodowanie,
  policzona suma zgadza sie z policzona przez backend w TypeScripcie.
- **Regresja**: backend 1429 pass / 0 fail (baseline 1408), `tsc` czysty.

## Konsekwencje

### Plusy

- Artefakt audytowy staje sie **sprawdzalny przez druga strone** - to argument
  wdrozeniowy, nie tylko techniczny.
- Zero nowych zaleznosci npm (`jszip` juz byl w `package.json`), zero migracji,
  zero nowego sekretu, zero zmian w zywym pipeline czatu.
- Bundle zyskal wykrywanie usuniecia i przestawienia wpisu odporne na
  przeliczenie manifestu.
- Instrukcja w samym artefakcie przestala klamac o tym, co odbiorca ma zrobic.

### Minusy i ograniczenia

- **Nadal brak dowodu autorstwa.** Artefakt jest odporny na NIEZAUWAZONA zmiane,
  ale nie jest podpisany - kto ma caly plik, moze zbudowac inny plik wewnetrznie
  spojny. Zamyka to dopiero podpis (rezerwacja ADR-0049). Zapisane wprost w
  instrukcji dla odbiorcy i w widoku wyniku, zeby nikt nie wyczytal z zielonego
  napisu wiecej, niz on znaczy.
- **Kontrakt endpointu zmieniony**: `GET /api/audit/export/:eventId` zwraca
  `application/zip` zamiast `application/json`. Klient w repo zaktualizowany;
  ewentualne integracje zewnetrzne oparte na tym endpoincie wymagaja zmiany.
- **Bundle (ADR-0066) nadal nie ma sciezki eksportu** - builder jest wolany
  wylacznie z testow. Archiwum jest gotowe do przyjecia bundla (`artifact` jest
  generyczne), brakuje endpointu. Dlug zapisany w ADR-0066, nie powiekszony.
- Weryfikator obsluguje `schema_version` 1.0 i **odmawia werdyktu** dla innych
  zamiast zgadywac. Przy podbiciu schematu trzeba wydac nowy weryfikator -
  swiadomy koszt, alternatywa (cichy fallback) bylaby gorsza.
- Duplikacja logiki weryfikacji w trzech jezykach (TS, Python, JS w HTML).
  Mitygacja: wspolny test werdyktow; bez niego duplikacja bylaby nie do
  utrzymania.

### Wymagane MAJOR/MINOR konstytucji

- **v1.7.0 -> v1.7.1** - PATCH. Art. 3 (audytowalnosc) i Art. 8 (przejrzystosc)
  dostaja narzedzie po stronie ODBIORCY. Bez zmiany schematu bazy, bez nowego
  sekretu, bez nowej zaleznosci. Zmiana kontraktu jednego endpointu eksportu
  (format odpowiedzi), bez zmiany jego semantyki, autoryzacji ani zakresu
  danych.

## Status weryfikacji

- [x] `lib/audit-verifier-assets.ts` - osadzone `VERIFIER_HTML` / `VERIFIER_PY` / `VERIFIER_README`
- [x] `lib/audit-export-archive.ts` - `buildAuditExportArchive` + `toArchiveFilename`
- [x] `GET /api/audit/export/:eventId` zwraca ZIP; frontend pobiera `.zip`
- [x] `verifier_instructions` w packu i bundlu wskazuja narzedzia z archiwum
- [x] Trzeci stopien: ciaglosc ogniw `prev_hash` -> `hash` w bundlu
- [x] Komentarze skryptow CLI przestaly twierdzic "samowystarczalny"
- [x] 21 testow (zgodnosc kanonikalizacji, werdykty, zawartosc i determinizm archiwum)
- [ ] Endpoint eksportu dla audit bundle (ADR-0066) - archiwum gotowe, brak trasy
- [ ] Podpis Ed25519 + znacznik czasu RFC 3161 (ADR-0049) - dowod autorstwa
- [ ] Wersja EN weryfikatora dla edycji jezykowych (ADR-0132/0139)
- [ ] Publikacja korzeni Merkle poza kancelaria (kotwica czasu) - bez tego
      odbiorca ufa korzeniowi z tego samego pliku

## Licencja

Wzorzec "weryfikator w paczce eksportu" podniesiony z
[b1rdmania/legalise](https://github.com/b1rdmania/legalise) (MIT),
`backend/app/core/export_chain_verifier.py`. Podniesiony **sam wzorzec** -
implementacja MateMatic od zera, w innym jezyku i na inna strukture artefaktu.
Produktu nie forkujemy: legalise to wydanie ewaluacyjne na Postgres/MinIO/Redis/
Gotenberg i konkurent Patron-Desktop. Patrz THIRD_PARTY_INSPIRATIONS.md.

Algorytm dowodu przynaleznosci: RFC 6962 (Laurie/Langley/Kasper, 2013).
