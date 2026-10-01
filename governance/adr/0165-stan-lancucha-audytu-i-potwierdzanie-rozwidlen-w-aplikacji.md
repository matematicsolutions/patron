# ADR-0165 - Stan lancucha audytu i potwierdzanie rozwidlen w aplikacji

- **Status:** Proponowany - kod, testy, mutanty i E2E w uruchomionej aplikacji. Decyzja WM
  2026-10-01: zadanie podjete jako nastepny krok po ADR-0161 ("jesli twoim zdaniem to zadanie
  ma dobre ROI - lecisz").
- **Data:** 2026-10-01
- **Galaz:** nad ADR-0161 (`1546220`), linia publiczna
- **Rozszerza:** [ADR-0161](./0161-straznik-lancucha-audytu-w-bazie-i-weryfikator-sqlite.md)
  (rdzen oceny lancucha i potwierdzenie rozwidlen)
- **Mapuje na:** ADR-0043 (meta-audyt dostepu admina), ADR-0046 (ekran audytu), ADR-0132
  (slownik przed komponentem), ADR-0137 (akt czlowieka w dwoch krokach), ADR-0164 (zerwania
  z mocy prawa - linia scalana)

## Kontekst

ADR-0161 dal weryfikator lancucha i potwierdzanie rozwidlen, ale tylko jako `npm run`. To
dziala ze zrodel, nie z zainstalowanego desktopu. Skutek dla kancelarii:

- nie ma jak sprawdzic wlasnego dziennika audytu, a to glowny dowod zgodnosci produktu;
- rozwidlenia z wersji 1.x (rownolegle wywolania narzedzi) zostaja bez ochrony, bo nie ma
  czym ich potwierdzic - wariant B istnieje w kodzie, ale do uzytkownika nie dociera.

Przed praca sprawdzone, co robia rownolegle sesje: panelu lancucha nikt nie budowal; sesja
scalania linii (ADR-0163/0164) zmienia `audit-chain-verify.ts` addytywnie (trzy nowe rodzaje
znalezisk, opcjonalne `fkCascadePossible`) oraz `patronApi.ts` i filtr ekranu audytu, ale
nie `routes/audit.ts`, nie strone `admin/audit` i nie slowniki `pl`/`en`. Zakres tej decyzji
ominal te pliki.

## Decyzja

**1. Dwa endpointy admin-only w `routes/audit.ts`, logika w `lib/audit-chain-status.ts`.**

- `GET /api/audit/chain` - trojstan OK / UWAGI / BLOKADA, liczniki, prog straznika,
  znaleziska (same numery wpisow, nigdy tresc) i to, co mozna potwierdzic, ze skrotem
  `digest`. Zostawia meta-slad `admin.access.audit_viewer` jak reszta ekranu (ADR-0043).
- `POST /api/audit/chain/acknowledge` z `{ digest }` - zapis jednego zdarzenia
  `audit.chain.fork_acknowledged` przez `appendAuditEvent`, aktor = zalogowany admin
  (na desktopie lokalny Operator).

Rdzen oceny jest jeden: `verifyAuditChain` i `buildForkAcknowledgement` z ADR-0161. Modul
dodaje tylko zrodlo wierszy (klient bazy backendu, stronicowanie po `id`), prog straznika
(SQLite: z definicji indeksu; Postgres: nieznany, wiec potwierdzenie przez skrypt z
`--guard-after-id`) i bramke zapisu.

**2. Potwierdzenie to akt czlowieka, przypiety do tego, co czlowiek zobaczyl.**
`digest` = SHA-256 kanonicznego payloadu potwierdzenia (ta sama kanonikalizacja co hash
audytu, ADR-0142). Przy zapisie ocena liczy sie od nowa; jesli `digest` sie nie zgadza,
zapisu nie ma (409 `stale`). Pozostale odmowy jak w skrypcie: BLOKADA (409 `blocked` -
potwierdzenie nie wybiela manipulacji), brak progu straznika (409 `no_guard`), nic do
potwierdzenia (409 `nothing_to_acknowledge`); awaria zapisu = 500. W interfejsie dwa kroki:
"Potwierdz rozwidlenia" otwiera pytanie, zapis dopiero po "Tak, zapisz potwierdzenie".

**3. Panel na ekranie audytu (`components/audit-chain-panel.tsx`).** Werdykt, liczniki,
prog, lista znalezisk z etykietami ze slownika, sekcja "Do potwierdzenia". Brak odpowiedzi
backendu to widoczny komunikat, nigdy pusty panel - cisza czytalaby sie jako "wszystko w
porzadku" (lekcja z `apiBase.ts`). Wlasny `fetch` zamiast `patronApi.ts` (plik w toku
scalania). Panel dopisany do bramki `uzycie-slownika.test.ts`.

**4. Bramka etykiet miedzy pakietami.** Test frontu czyta unie `ChainFindingKind` z
`backend/src/lib/audit-chain-verify.ts` i wymaga etykiety PL dla kazdego rodzaju (z kontrola
pozytywna: pusta lista nie jest sukcesem). Etykiety trzech rodzajow z linii ADR-0164
(`hash_mismatch_legal_break`, `hash_mismatch_fk_cascade`, `legal_break_truncated`) sa juz
w slowniku - po scaleniu panel nie pokaze surowego klucza, a test wymusi komplet przy
kazdym nowym rodzaju.

## Rozwazone alternatywy

- **Automatyczne potwierdzenie przy starcie aplikacji.** Odrzucone: potwierdzenie to
  oswiadczenie "wiedzielismy o tym w chwili T", a nie automat (ADR-0161 wariant B).
- **Zapis bez `digest` (sam przycisk).** Odrzucone: miedzy podgladem a kliknieciem stan moze
  sie zmienic (nowe rozwidlenie, usuniety wpis), a czlowiek potwierdzilby cos, czego nie
  widzial.
- **Rozszerzenie `patronApi.ts` i `useAuditLog`.** Odrzucone na teraz: oba pliki zmienia
  sesja scalania linii; konflikt bez zysku. Do ujednolicenia po scaleniu.

## Weryfikacja

- Backend: `tsc` 0; `audit-chain-status.test.ts` (8) na prawdziwym pliku SQLite przez shim -
  stan po bootstrapie, odmowy `no_guard` i `stale` bez zapisu, zapis z aktorem, brak
  duplikatu, BLOKADA i odmowa po usunieciu potwierdzonego wpisu, mapowanie kodow HTTP.
- Front: `tsc` 0; `audit-chain-panel.test.tsx` (7 + etykiety rodzajow) - werdykt, dwa
  klikniecia i `digest` w zadaniu, anulowanie bez zapytania, odmowa `stale`, BLOKADA bez
  przycisku, blad sieci i 403 widoczne.
- Mutanty, kazdy na czerwono: backend bez sprawdzenia `digest` (2 testy); przycisk zapisujacy
  od razu, bez pytania (3 testy); brak etykiety jednego rodzaju (1 test).
- E2E w uruchomionej aplikacji (backend + front w trybie lokalnym, kopia realnej bazy desktopu,
  oryginal nietkniety, kopia usunieta po tescie): panel pokazal UWAGI z rozwidleniami;
  "Potwierdz rozwidlenia" -> pytanie -> "Tak, zapisz" -> OK z rozwidleniami potwierdzonymi;
  w bazie jedno zdarzenie z aktorem lokalnego Operatora i `tool: ui:audit-chain`;
  `npm run audit:verify` na tej kopii - OK (kod 0); po usunieciu potwierdzonego wpisu
  "Sprawdz ponownie" pokazal BLOKADE z numerami wpisow.

## Konsekwencje i ryzyko

- **Odczyt calego dziennika przy kazdym GET.** Kilka tysiecy wpisow to ulamek sekundy; przy
  milionach w trybie serwerowym trzeba bedzie przejsc na strumien albo cache (jak w ADR-0161).
- **Tryb serwerowy.** Prog straznika nieznany, wiec panel pokazuje stan, a potwierdzenie
  odmawia (`no_guard`) - robi sie je skryptem z `--guard-after-id`. Ekran audytu w trybie
  serwerowym ma osobny, starszy problem: fetch bez naglowka `Authorization` (tak samo jak
  `useAuditLog`) - poza zakresem.
- **Scalenie z linia ADR-0164.** Panel jest odporny na nowe rodzaje znalezisk (etykiety sa,
  test pilnuje). Kategorie tresci z ADR-0164 (np. zerwanie z mocy prawa) pokaza sie jako
  zwykle znaleziska z wlasna waga.
