# ADR-0152 - Wpiecie pakietu dowodowego deliverable: trasa, granica sprawy, slad wyniesienia

- **Status:** Przyjety (wdrozony 2026-08-24, `main`)
- **Data:** 2026-08-24
- **Galaz:** `main` (linia publiczna)
- **Zrodlo:** przeglad martwych modulow przy budowie publicznego katalogu zdolnosci -
  `lib/audit-bundle.ts` mial testy i ZERO importow produkcyjnych
- **Realizuje:** rezerwacje z [ADR-0066](./0066-audit-bundle-deliverable-rdzen.md)
  ("Wpiecie: auto-trigger high-stakes / przycisk UI / endpoint eksportu")
- **Mapuje na:** ADR-0006 (art. 12), ADR-0047 (audit pack), ADR-0142 (weryfikator w paczce),
  ADR-0148 (sprawa jako granica poufnosci), ADR-0043 (meta-audyt dostepu), ADR-0035 (whitelist event_type)

## Kontekst

ADR-0066 zbudowal rdzen pakietu dowodowego dla JEDNEGO deliverable wysokiej stawki:
tresc + werdykt kazdego cytatu + fragment hash-chain + wersje modelu + manifest SHA-256.
Czyste funkcje, testy, zero IO. Wpiecie zostalo rezerwacja.

Rezerwacja przetrwala trzy miesiace i wyszla dopiero mechanicznym przegladem: modul byl
importowany **wylacznie przez wlasny test**. Kod, ktory zieleni sie w CI i nie robi nic,
wyglada w kazdym przegladzie repozytorium jak dzialajaca funkcja - i o maly wlos trafil
do publicznego opisu produktu jako zdolnosc.

Rownolegle dziala `GET /api/audit/export/:eventId` (ADR-0047): paczka dla POJEDYNCZEGO
ZDARZENIA z dziennika, admin-only, dla audytora. To co innego. Pytanie klienta albo
regulatora nie brzmi "pokaz wpis numer 812", tylko **"jak powstala ta analiza"**.

## Decyzja

**1. Trasa: `GET /api/audit/bundle/:messageId`.** Przedmiotem jest odpowiedz asystenta -
dokument koncowy. Wiadomosc uzytkownika dostaje 400: nie ma czego dowodzic.

**2. NIE admin-only - granica sprawy zamiast uprawnien admina.** Pakietu potrzebuje autor
pisma, nie audytor kancelarii. Dostep ma wlasciciel czatu albo osoba z dostepem do projektu
(ADR-0148). Brak dostepu zwracamy jako **404, nie 403** - samo istnienie cudzej wiadomosci
tez jest informacja o aktach.

**3. Eksport zostawia slad: nowy `event_type = "deliverable.bundle_export"`.** Wyniesienie
tresci dokumentu z kancelarii to inny akt niz wyniesienie wpisu z dziennika przez admina
(`admin.access.audit_export`) - sklejenie ich zatarloby slad. Slad zapisuje sie PRZED
zlozeniem archiwum, tak jak przy paczce audytora: zamiar rejestruje sie, zanim dowod opusci
system. Payload niesie liczby i identyfikatory, nigdy tresc.

Nowy typ = piec luster (AGENTS.md): `audit.ts`, `schema.sqlite.ts`, `schema.sql`, migracja
Postgres 020, rebuild SQLite v6. Pilnuje `db/event-type-parity.test.ts` - i faktycznie
zatrzymal ten commit, dopoki v6 nie powstal.

**4. Brakujacy pomiar to -1, nigdy 0.** Werdykt groundingu persystujemy jako decyzje i status
(granica ADR-0120); `worstRatio` i `offset` z `GroundingResult` nie sa zapisywane. Odtwarzamy
je jako `-1` z nota, bo **zero w `worstRatio` znaczy "dopasowanie idealne"** - wstawienie go
byloby falszywym twierdzeniem o jakosci cytatu w dokumencie, ktory ma sluzyc za dowod.

**5. Cytat bez zapisanego werdyktu nie wchodzi do podsumowania** ani jako zweryfikowany, ani
jako odrzucony. Brak pomiaru to brak pomiaru.

**5a. Wpis do dziennika jest FAIL-CLOSED, a jego faza jawna.** Gdy zapis sie nie uda,
eksport NIE nastepuje (HTTP 500 z nazwa przyczyny). Powod nie jest teoretyczny: na wdrozeniu
Postgres bez migracji 020 CHECK odrzuca nowy typ, a bez tej bramki pakiet z trescia akt
wyszedlby z kancelarii **bez sladu** - czyli audyt zostalby wylaczony przez pominiecie migracji,
a nie przez decyzje. Payload niesie `phase: "requested"`, bo wpis powstaje przed zlozeniem
archiwum; czytelnik dziennika nie musi zgadywac, czy plik dotarl do odbiorcy.

**5b. Cytaty ze zrodel MCP wchodza do pakietu** (ADR-0146). Maja wlasna adnotacje i wlasne
slownictwo werdyktu karty zrodla (green/yellow/red), odwzorowane jawnie na
verified/unverified/blocked - przy czym `red` idzie na `blocked`, bo "cytat podany jako doslowny
NIE wystepuje w zrodle" to mocniejsze twierdzenie niz "nie sprawdzono". Ich `ref` jest UJEMNY:
cytaty MCP nie sa kotwiczone znacznikami `[N]` w prozie, wiec dodatni numer sugerowalby przypis,
ktorego w tekscie nie ma. Bez tego pismo oparte na orzecznictwie pokazywaloby w pakiecie
dowodowym ZERO cytatow - dowod milczalby o tym, na czym naprawde stoi teza.

**6. Archiwum ZIP z weryfikatorami** przez istniejacy `buildAuditExportArchive` (ADR-0142).
Oba weryfikatory JUZ rozumialy `deliverable_audit_bundle` - `KINDS` w `verify.py` i
`dok.pack_kind || dok.bundle_kind` w weryfikatorze przegladarkowym. Szacowalismy tu pol dnia
pracy; pomiar pokazal zero. Warto bylo sprawdzic przed napisaniem.

**7. Przycisk stoi przy aparacie cytowan** (`GroundingLedger`, margines rozmowy), dla
ostatniej odpowiedzi, ktora ma juz `id` z bazy. Wiadomosc w trakcie streamingu id nie ma
i przycisk sie nie pokazuje - nie da sie zlozyc dowodu z czegos, czego jeszcze nie zapisano.
Klucze i18n w SIEDMIU slownikach, nie tylko `pl`: fallback pokazalby brazylijskiemu
prawnikowi polski napis przy portugalskim interfejsie.

## Konsekwencje

- Kancelaria moze dolaczyc do pisma archiwum, ktore odbiorca sprawdza bez PATRONa,
  bez instalacji i bez dostepu do bazy.
- Kazde takie wyniesienie jest widoczne w dzienniku - takze dla samej kancelarii.
- `cost_log` pozostaje `available:false` (Patron nie sledzi jeszcze tokenow per deliverable) -
  pole jest, wartosci nie ma i pakiet mowi to wprost, zamiast zgadywac.
- Model czytamy z NAJNOWSZEGO zdarzenia `llm_route` w tym czacie; brak takiego zdarzenia
  daje `null`, nie zgadniety model.
- Bundle NIE zastepuje Merkle proof: dowodzi integralnosci PLIKU, nie tego, ze zdarzenia
  nie zmieniono w bazie. Do tego sluzy paczka z ADR-0047. Dwie warstwy, dwa pytania.
- Podpis Ed25519 + RFC 3161 pozostaje rezerwacja ADR-0049 - bundle wykrywa modyfikacje
  po wygenerowaniu, ale nie dowodzi autorstwa.

## Alternatywy odrzucone

- **Zostawic modul martwym i opisac paczke per zdarzenie jako "pakiet dowodowy".** Odrzucone:
  to bylo pierwotne brzmienie publicznej strony i bylo nieprecyzyjne w strone obietnicy.
  Latwiej wpiac funkcje niz pilnowac, zeby tekst o niej klamal ostroznie.
- **Admin-only, jak paczka audytora.** Odrzucone: zamykaloby funkcje przed jedyna osoba,
  ktora jej realnie potrzebuje. Granica sprawy jest wlasciwym mechanizmem, nie rola.
- **Reuzycie `admin.access.audit_export` zamiast nowego typu.** Odrzucone: dwa rozne akty
  pod jednym wpisem to gorszy audyt niz brak wpisu, bo wyglada na kompletny.
- **403 przy braku dostepu.** Odrzucone: rozroznia "nie ma takiej wiadomosci" od "jest, ale
  nie twoja", czyli potwierdza istnienie cudzych akt.
- **Odtworzenie `worstRatio` jako 0.** Odrzucone - patrz punkt 4. To najgrozniejsza z
  odrzuconych opcji, bo wygladalaby na porzadne dane.
- **Auto-trigger dla spraw wysokiej stawki zamiast przycisku.** Odlozone, nie odrzucone:
  klasyfikator istnieje (ADR-0004), ale automatyczne skladanie pakietu przy kazdym pismie
  wysokiej stawki to decyzja o kosztach i o tym, co uznajemy za deliverable. Przycisk
  najpierw, automat po pomiarze uzycia.
- **Wlasny format archiwum.** Odrzucone: `buildAuditExportArchive` i oba weryfikatory juz
  istnialy i juz znaly ten rodzaj pakietu.
