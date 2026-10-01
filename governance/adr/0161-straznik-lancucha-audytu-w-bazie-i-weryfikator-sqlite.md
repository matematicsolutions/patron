# ADR-0161 - Straznik lancucha audytu w bazie, weryfikator dla SQLite i rozwidlenia juz zapisane

- **Status:** Proponowany - kod, testy, mutanty i E2E dla punktow 1-3. W punkcie 3 WM wybral
  wariant B (2026-10-01: "lecisz wg wlasnego ROI" po rekomendacji B). Commit i scalenie - WM.
- **Data:** 2026-10-01
- **Galaz:** nad `9308a21` (kolejka zapisow audytu, ADR-0159 sekcja "Znalezione przy
  weryfikacji"), linia publiczna
- **Rozszerza:** [ADR-0001](./0001-hash-chain-audit-trail.md) (hash chain i weryfikator)
- **Mapuje na:** ADR-0026 (Merkle), ADR-0038 (format migracji UP/DOWN), ADR-0053 (SQLite
  domyslnie), ADR-0164 (trojstan tresci, `audit.chain.legal_break` - linia
  `feat/design-system-2-0`), [ADR-0159](./0159-detektor-dryfu-obejmuje-schemat-wejscia.md)

## Kontekst

Commit `9308a21` usunal przyczyne rozwidlen w obrebie procesu: zapisy audytu ida przez
kolejke. Zostaly trzy luki, nazwane w ADR-0159 jako "poza zakresem":

1. **Wiele procesow.** Kolejka zyje w pamieci jednego procesu. Tryb serwerowy moze miec
   kilka instancji backendu, a obok desktopu pisze do tej samej bazy skrypt CLI
   (`rodo-delete.ts`, `trigger-merkle.ts`). Komentarz w `appendAuditEvent` obiecywal, ze
   wyscig zlapie `hash unique`. Nie zlapie: hash obejmuje `ts` i payload, wiec dwa ogniwa
   o wspolnym poprzedniku zawsze maja rozne hashe.
2. **Brak weryfikatora dla SQLite.** `scripts/verify-audit-chain.ts` czytal tylko Supabase.
   Desktop chodzi na SQLite (ADR-0053; backend wybiera SQLite, chyba ze
   `PATRON_DB_BACKEND=supabase`) i nie mial narzedzia, ktore wykryje rozwidlenie.
3. **Rozwidlenia juz zapisane.** Nie wiadomo bylo, ile ich jest i jak je oceniac.

Pomiar na kopii realnej bazy desktopu (`%APPDATA%/patron-desktop/patron.db`, oryginal
nietkniety, kopia czytana w trybie tylko do odczytu, hash pliku przed i po ten sam):

| Wielkosc | Wynik (skala - dokladnych liczb z instalacji nie wnosimy do repo) |
|---|---|
| wpisy | kilka tysiecy, kilka miesiecy pracy |
| hashe zgodne z trescia | wszystkie |
| `prev_hash` wskazujacy nieistniejacy wpis | zaden |
| poczatki lancucha (GENESIS) | dokladnie jeden |
| punkty rozwidlenia | kilka, jeden po drugim w jednej sesji |
| ogniwa boczne | kilka, wszystkie `ring_policy.decision`, kolejne id |
| rozrzut `ts` rodzenstwa | 0 ms (identyczny czas co do milisekundy) |
| ksztalt | lancuch biegnie dalej z najwyzszego id; pozostale ogniwa sa liscmi |

Weryfikator liniowy (kazdy `prev_hash` == hash wiersza o id-1) zakonczylby sie na pierwszym rozwidleniu
komunikatem "srodkowy wpis zostal zmodyfikowany lub usuniety". To falszywe oskarzenie:
zaden wpis nie zniknal i zaden nie zostal zmieniony.

## Decyzja

### 1. Straznik w bazie: unikalny `prev_hash` od progu

Czesciowy unikalny indeks `prev_hash ... WHERE id > N`, gdzie N = `max(id)` w chwili
instalacji straznika. Przegrany wyscig miedzy procesami konczy sie bledem 23505 (shim
SQLite mapuje `SQLITE_CONSTRAINT_UNIQUE` na ten sam kod), a `appendAuditEvent` czyta swiezy
poprzednik i ponawia zapis z krotkim losowym odstepem, do `AUDIT_APPEND_MAX_ATTEMPTS` = 8
prob. Po wyczerpaniu zwraca `ok:false` i nie rzuca, jak dotad.

Dlaczego czesciowy: pelny unikalny indeks nie zbuduje sie na bazie, ktora juz ma
rozwidlenia (test to pokazuje), a historii audytu nie przepisujemy. Na swiezej bazie N = 0,
wiec straznik obejmuje caly lancuch. Wpisy o id <= N sa historia - nowy wpis nie moze z nimi
kolidowac, bo jego poprzednik to zawsze ostatni wpis.

Trzy lustra, pilnowane testem `src/lib/db/audit-chain-guard.test.ts`:

- **Postgres:** migracja `022_audit_log_prev_hash_guard.sql` - blok `do` z `lock table ... in
  share row exclusive mode`, zeby wpis dopisany miedzy odczytem `max(id)` a budowa indeksu
  nie wypadl spod straznika. Idempotentna. DOWN zdejmuje indeks.
- **Postgres swiezy:** `schema.sql` - ten sam blok (test porownuje oba po usunieciu
  komentarzy). Nie gole `create unique index`, bo `schema.sql` bywa uruchamiany ponownie na
  istniejacej bazie.
- **SQLite:** `ensureAuditChainGuard()` w `migrate.sqlite.ts`, wolane na koncu KAZDEGO
  `runSqliteMigrations`, poza lista wersji. Nie w `SQLITE_SCHEMA`, bo ten tekst wykonuje sie
  przy kazdym starcie i wywrocilby start na bazie z rozwidleniami. Nie jako krok z numerem,
  bo kazdy rebuild `audit_log` (zmiana CHECK `event_type`, kroki v2-v7) kasuje tabele razem
  z indeksami - straznik musi sie odtworzyc sam, i to z TYM SAMYM progiem: runner czyta prog
  przed krokami i podaje go dalej. Gdyby indeks z dawnym progiem sie nie zbudowal (rozwidlenie
  powyzej progu, czyli slad ingerencji), start nie pada: straznik wraca z biezacym `max(id)`,
  a blad idzie glosno do logu. Testy symuluja oba przypadki.

Przy okazji naprawiony blad z tej samej klasy: `getLastHash` przy bledzie odczytu zwracal
GENESIS, czyli chwilowy blad bazy dopisywal **drugi poczatek lancucha** - awaria konczyla sie
"sukcesem". Teraz blad odczytu konczy `appendAuditEvent` z `ok:false`, bez zapisu.

### 2. Weryfikator: lancuch jako drzewo, SQLite i Supabase, trojstan

Rdzen to czysta funkcja `verifyAuditChain()` w `src/lib/audit-chain-verify.ts`. Kazdy wiersz
wskazuje poprzednika PO HASHU, nie po id, wiec rozwidlenie i usuniecie wpisu przestaja byc
tym samym komunikatem:

- **BLOKADA** (exit 1, jak dotychczasowe "zerwanie"): hash niezgodny z trescia, `prev_hash`
  bez wpisu w tabeli (usuniecie), poprzednik z id >= id wiersza (wstawka wstecz), liczba
  GENESIS rozna od 1, zdublowany hash, rozwidlenie powyzej progu straznika (przy zywym
  indeksie niemozliwe), rozwidlenie bez sygnatury wyscigu, pusty dziennik.
- **UWAGI** (exit 3): rozwidlenie z sygnatura wyscigu sprzed straznika, niepotwierdzone.
- **OK** (exit 0): jeden lancuch, kazdy hash zgodny; rozwidlenia potwierdzone przez
  Operatora (punkt 3) widac w raporcie jako INFO.
- exit 2: nie da sie odczytac zrodla.

Sygnatura wyscigu (wszystkie warunki naraz): rozrzut `ts` rodzenstwa <= 2 s (zmierzone:
0 ms), nikt z rodzenstwa nie jest starszy od poprzednika, lancuch biegnie dalej z co
najwyzej jednego z nich. To klasyfikator ksztaltu, nie dowod niewinnosci: kto ma zapis do
bazy, dopisze ogniwa z poprawnymi hashami i dowolnym `ts`. Przed tym chroni dopiero
zewnetrzna kotwica (Merkle + RFC 3161, ADR-0026/0037).

`npm run audit:verify` wybiera zrodlo ta sama regula co backend (`PATRON_DB_BACKEND`), wiec
sprawdza baze, do ktorej aplikacja realnie pisze, i wypisuje ja w pierwszej linii. Flagi:
`--sqlite [plik]` (domyslnie `PATRON_DB_PATH`), `--supabase`, `--guard-after-id N`. SQLite
otwierany `readonly` + `fileMustExist` - weryfikator nie moze niczego zmienic ani zalozyc
pustej bazy pod zla sciezka. Prog straznika czytany z definicji indeksu w pliku (zrodlo,
ktore realnie egzekwuje). Dla Supabase PostgREST nie siega `pg_indexes`, wiec prog podaje
sie flaga; bez niej rozwidlenia ocenia sama sygnatura. Raport podaje pelny mianownik
(kontrole zdane tez) i same id wierszy, nigdy payloadu.

### 3. Rozwidlenia juz zapisane - wariant B (decyzja WM 2026-10-01)

Czego nie robimy w zadnym wariancie: nie przepisujemy historii. Przeliczenie `prev_hash`
ogniw bocznych zmienia ich hashe, a za nimi hashe wszystkich pozniejszych wpisow
i korzenie Merkle - czyli niszczy dowod, ktory mial byc chroniony.

Co realnie tracimy przez te rozwidlenia: kazde ogniwo boczne jest lisciem, wiec jego
**usuniecia nie wykryje zaden kolejny wpis**. Te decyzje `ring_policy.decision` nie maja
dzis ochrony przed cichym skasowaniem. Test "GRANICA METODY" w
`audit-chain-verify.test.ts` pilnuje, zeby nikt nie ogloszal, ze weryfikator to wykrywa.

| Wariant | Co robi | Cena | Ryzyko |
|---|---|---|---|
| **A. Znane rozwidlenie** (stan przed potwierdzeniem) | Weryfikator zglasza UWAGI z lista id. Baza bez zmian. | zero | Liscie dalej bez ochrony przed usunieciem. UWAGI swieci przy kazdym przebiegu. Zbior jest jednak zamkniety: po strazniku nowe rozwidlenie jest BLOKADA, nie UWAGI, wiec UWAGI nie urosnie po cichu. |
| **B. A + slad w audycie (WYBRANY)** | Operator uruchamia raz `npm run audit:acknowledge-forks`. Zapis przez `appendAuditEvent` nowego zdarzenia z id poprzednikow, id rodzenstwa, **hashami ogniw bocznych**, progiem straznika i wersja weryfikatora - bez tresci. Weryfikator uznaje rozwidlenia objete deklaracja za OK z adnotacja i sprawdza, ze kazdy zadeklarowany hash nadal jest w tabeli. | Nowy `event_type` = piec luster + krok SQLite + migracja Postgres 023 + skrypt + testy, okolo pol dnia | Brak istotnego. Akt potwierdzenia wykonuje czlowiek, nie start aplikacji: to oswiadczenie "wiedzielismy o tym w chwili T", a nie automat. |
| C. Traktowac jako OK bez sladu | Weryfikator milczy o rozwidleniach sprzed progu. | zero | Ukrywa realna strate ochrony. Odrzucone. |
| D. BLOKADA do recznego przegladu | Kazda instalacja z rozwidleniem swieci na czerwono. | zero | Zmeczenie alarmem: czerwien, ktora jest zawsze, przestaje cos znaczyc. Odrzucone. |

Dlaczego B: hashe lisci wpisane do zdarzenia na glownej sciezce **przywracaja im ochrone**.
Usuniecie liscia po potwierdzeniu da zadeklarowany hash bez wiersza, czyli BLOKADE. Do
tego "wiedzielismy o tym w chwili T" samo staje sie chronione hashem. To ta sama zasada co
`audit.chain.legal_break` z ADR-0164: anomalie lancucha nazywamy w lancuchu, nie ukrywamy.

**Jak dziala B.** Nowy `event_type` `audit.chain.fork_acknowledged` (rodzina `audit.chain.*`
jak `legal_break` z ADR-0164), piec luster: `audit.ts`, `schema.sqlite.ts`, `schema.sql`,
migracja Postgres `023`, krok SQLite v7 (pelna lista, rebuild z zachowaniem wierszy).
Komenda `npm run audit:acknowledge-forks`:

- domyslnie tylko pokazuje, co by potwierdzila; zapisuje dopiero z `--tak`,
- odmawia przy BLOKADZIE (potwierdzenie nie wybiela manipulacji) i bez progu straznika
  (zbior rozwidlen nie jest jeszcze zamkniety),
- zapisuje JEDNO zdarzenie przez `appendAuditEvent` (jedyny pisarz audytu): payload
  `fork-ack/1` z progiem i, dla kazdego rozwidlenia, id + hashem poprzednika i kazdego
  ogniwa. Bez tresci zdarzen. Aktor: lokalny uzytkownik desktopu albo `--actor` (Supabase),
- po zapisie weryfikuje lancuch od nowa; drugi przebieg nie ma czego potwierdzac.

Weryfikator uznaje rozwidlenie za potwierdzone dopiero wtedy, gdy przeszlo wszystkie
wczesniejsze sprawdzenia (ponizej progu, sygnatura wyscigu) i KAZDE jego ogniwo jest w
deklaracji. Potwierdzenie rozwidlenia powyzej progu albo bez sygnatury wyscigu nic nie
zmienia - BLOKADA zostaje. Ogniwo z deklaracji, ktorego nie ma w tabeli z tym id i hashem,
daje BLOKADE `ack_missing`. Nieczytelny payload deklaracji daje BLOKADE `ack_invalid`.

**Czego B jeszcze nie ma: przycisku w aplikacji.** `npm run` dziala ze zrodel, nie z
zainstalowanego desktopu. Instalacje u klientow z rozwidleniami beda pokazywac UWAGI, dopoki
potwierdzenia nie da sie wykonac z ekranu audytu (akt czlowieka, jak karta zatwierdzenia
z ADR-0137). Nastepny krok: przycisk na ekranie audytu, ktory wola te sama logike
(`buildForkAcknowledgement` + `appendAuditEvent`). Zrealizowane w
[ADR-0165](./0165-stan-lancucha-audytu-i-potwierdzanie-rozwidlen-w-aplikacji.md).

## Rozwazone alternatywy

- **Pelny `unique(prev_hash)`.** Nie zbuduje sie na istniejacych bazach z rozwidleniami
  (test w `audit-chain-guard.test.ts`). Odrzucone.
- **`pg_advisory_xact_lock` albo `serializable` wokol odczytu i zapisu.** Wymaga funkcji
  RPC w Postgresie, bo klient Supabase nie ma transakcji; w SQLite osobnej sciezki przez
  shim. Dwie implementacje zamiast jednego indeksu, a wyscig i tak trzeba obsluzyc.
  Odrzucone.
- **Kolumna `prev_id` zamiast `prev_hash` jako klucz.** Zmienia schemat hasha albo dodaje
  pole spoza hasha, ktore mozna przepisac bez sladu. Odrzucone.
- **Jedno ponowienie zamiast petli.** Przy kilku procesach przegrany wyscig powtarza sie;
  mutant z jedna proba gubi zapisy w tescie dwoch polaczen. Odrzucone.
- **Straznik w `SQLITE_SCHEMA` z progiem 0.** Wywraca start kazdej bazy z rozwidleniem.
  Odrzucone.

## Weryfikacja

- `tsc --noEmit` backendu: exit 0. Skrypty `verify-audit-chain.ts`,
  `acknowledge-audit-forks.ts`, `audit-chain-source.ts` (poza `tsconfig`) sprawdzone
  osobnym przebiegiem: exit 0.
- Nowe testy: `audit-chain-verify.test.ts` (18), `db/audit-chain-guard.test.ts` (13),
  `audit.test.ts` (+2: blad odczytu nie zaczyna nowego lancucha; wyczerpanie prob);
  test parytetu `event_type` podniesiony do v7.
- `test/audit-chain-scripts.test.ts` (9): oba skrypty uruchamiane jako osobne procesy na
  syntetycznej bazie - kody wyjscia trojstanu, prog z pliku, odmowy, zapis przez
  `appendAuditEvent`, brak pustego pliku pod zla sciezka. Mutanty `readonly`/`fileMustExist`
  wylaczone i odmowa bez straznika wylaczona - po jednym tescie czerwonym.
- Kontrola pozytywna widziana na czerwono, trzy mutanty, kazdy uruchomiony osobno:
  `ensureAuditChainGuard` jako no-op - 7 z 12 testow straznika czerwonych;
  `AUDIT_APPEND_MAX_ATTEMPTS = 1` - test dwoch polaczen czerwony (zapis przepada);
  klasyfikator rozwidlen zawsze "wyscig" - 3 z 12 testow weryfikatora czerwonych.
  Dla wariantu B dwa kolejne: weryfikator nie sprawdza ogniw z deklaracji - test
  "usuniety lisc PO potwierdzeniu" czerwony; straznik ignoruje zachowany prog - 2 testy
  rebuildu czerwone.
- Test dwoch polaczen do jednego pliku SQLite (dwie instancje modulow = dwie kolejki): bez
  straznika lancuch sie rozwidla, ze straznikiem 20 zapisow daje jeden lancuch i kazdy
  zapis sie udaje.
- Realna baza (kopia): weryfikator - UWAGI, exit 3, wszystkie hashe zgodne, kazde
  rozwidlenie z sygnatura wyscigu. Druga kopia po migracji: indeks w ulamku sekundy z progiem
  = max(id), proba rozwidlenia odbita `SQLITE_CONSTRAINT_UNIQUE`. Trzecia kopia z recznie
  uszkodzonym payloadem: BLOKADA `hash_mismatch` (kod 1, nie 2).
- E2E wariantu B na swiezej kopii realnej bazy: komenda bez straznika - ODMOWA (kod 1);
  migracja jak przy starcie (krok v7 + straznik z progiem = max(id)); podglad - lista
  rozwidlen, nic nie zapisane (kod 3); `--tak` - jedno zdarzenie przez `appendAuditEvent`,
  weryfikacja OK z INFO (kod 0); drugi `--tak` - "nic do potwierdzenia"; usuniecie jednego
  potwierdzonego liscia - BLOKADA `ack_missing` (kod 1). Bez potwierdzenia to samo
  usuniecie bylo niewidoczne.

## Konsekwencje i ryzyko

- **Wyscig przez migracje.** Zapis, ktory przeczytal poprzednik PRZED instalacja straznika,
  a wstawil wiersz PO niej, i to wtedy, gdy w miedzyczasie przybyly inne wpisy, wskazuje
  poprzednika o id < N - poza indeksem. Okno jest jednorazowe i waskie; weryfikator i tak
  pokaze takie rozwidlenie.
- **Rebuild kasuje straznika.** Odtwarza sie z dawnym progiem. Z biezacym `max(id)` tylko
  wtedy, gdy dawnego progu nie da sie odtworzyc (rozwidlenie powyzej progu - blad w logu)
  albo indeks zdjeto recznie przed startem; wtedy weryfikator traci surowosc dla tego
  odcinka, ale hashe i krawedzie zostaja.
- **Rollback migracji 023 po potwierdzeniu nie przejdzie** - zapisane zdarzenia nie spelnia
  starego CHECK. Zamierzone: wycofanie typu zdarzenia nie moze po cichu usuwac sladu.
- **Zmiana kodow wyjscia `audit:verify`.** Doszedl kod 3 (UWAGI). Kto sprawdza tylko
  `!= 0`, dostanie czerwien przy rozwidleniach sprzed straznika - zamierzone.
- **Zrodlo domyslne.** Bez flagi `audit:verify` czyta SQLite, chyba ze
  `PATRON_DB_BACKEND=supabase` - tak samo jak backend. Instalacja serwerowa, ktora tej
  zmiennej nie ustawia, i tak pisze do SQLite, wiec weryfikator sprawdza wlasciwa baze.
- **Niezmierzone: format `ts` z Postgresa.** `timestamptz` wraca przez PostgREST jako
  `...+00:00`, a hash liczono z `...Z`. Weryfikator Supabase przekazuje `ts` tak samo jak
  dotad - tej sciezki nie przebieglem na zywym Postgresie i nie deklaruje, ze dziala.
- **Anonimizacja RODO na tej linii to nadal BLOKADA.** `rodo-delete.ts` zeruje
  `actor_user_id` w audycie, a to pole wchodzi do hasha, wiec weryfikator zglosi
  `hash_mismatch`. Deklaracja `audit.chain.legal_break` (ADR-0164) zyje na drugiej linii i
  przyjdzie ze scaleniem. Na zmierzonej bazie desktopu takich wierszy nie ma (0 niezgodnych
  hashy).
- **Pamiec.** Weryfikator trzyma caly dziennik w pamieci (mapa hashy). Kilka tysiecy wpisow
  to ulamek sekundy. Przy milionach wpisow w trybie serwerowym trzeba bedzie przejsc na strumien.
- **Scalenie z linia ADR-0164.** Tamten `verify-audit-chain.ts` ma trojstan TRESCI (zerwanie
  z mocy prawa / kaskada FK / niewyjasnione); ten ma trojstan STRUKTURY. Sa ortogonalne z
  konstrukcji: krawedzie lancucha ida po zapisanym hashu, wiec zadeklarowane zerwanie tresci
  nie rusza struktury. Przy scaleniu kategorie ADR-0164 wchodza do `verifyAuditChain` jako
  klasyfikacja znaleziska `hash_mismatch` - plik skryptu bedzie mial konflikt do recznego
  rozwiazania. Osobno: obie linie numeruja inaczej krok SQLite v6 i migracje 020, co przy
  scaleniu pominie krok na zainstalowanych bazach - zgloszone jako osobne zadanie
  (ADR-0163 w toku). Uzgodnione: v7 i 023 sa tej decyzji; tamto zadanie bierze v8, 024 i 025,
  a jego suma `event_type` musi objac `audit.chain.fork_acknowledged`.
