# ADR-0163 - Kolizja numeracji migracji miedzy liniami: wydane kroki sa zamrozone, ostatni niesie sume

- **Status:** Proponowany (czeka na dwie rundy przegladu i decyzje WM o scaleniu linii)
- **Data:** 2026-10-01
- **Galaz:** scalenie `feat/design-system-2-0` z linia publiczna (`main`), squash na stosie
  PR #8 -> PR #9 -> ADR-0162 -> ADR-0161
- **Mapuje na:** ADR-0035 (whitelist event_type, runner migracji Postgres), ADR-0109 (runner
  migracji SQLite), ADR-0164 (`audit.chain.legal_break`, dawniej 0150 na linii 2.0),
  ADR-0152 (`deliverable.bundle_export`), ADR-0161 (straznik lancucha, krok v7 i migracja 023)

## Kontekst

Od wydania 1.2.0 dwie linie rozwijaly sie rownolegle i obie dodaly typ zdarzenia audytu:

| | linia publiczna (wydana w 1.3.0) | linia `feat/design-system-2-0` |
|---|---|---|
| krok SQLite | v6 `audit_log_add_deliverable_bundle_export_event_type` | v6 `audit_log_event_type_legal_break` |
| Postgres | `020_audit_log_event_type_deliverable_bundle_export` | `020_audit_log_drop_hash_field_fks`, `021_audit_log_event_type_legal_break` |

Oba runnery sa po numerze, nie po tresci. `runSqliteMigrations` pomija kazdy krok z
`version <= PRAGMA user_version`. `run-migrations.ts` sledzi migracje Postgres po
prefiksie `id`. Pomiar 2026-10-01 na kopii prawdziwej bazy desktopowej: `user_version = 6`,
CHECK zawiera `deliverable.bundle_export`, a `audit.chain.legal_break` nie zawiera. Po
scaleniu linii taka instalacja nigdy nie uruchamia kroku v6 linii 2.0, wiec `rodo-delete`
odbija sie od CHECK przy zapisie zdarzenia, ktore ma nazwac przerwanie lancucha z mocy
prawa. Po stronie Postgres serwer z 1.3.0 uznaje `020` za zaaplikowana i nigdy nie zdejmuje
FK z pol hasha. Z kolei `021` puszczona po `020` zdjelaby z CHECK `deliverable.bundle_export`,
wiec eksport pakietu dowodowego (fail-closed na zapisie audytu) przestalby dzialac.

Kazda migracja konczy sie przy tym sukcesem. To ta sama klasa co luka naprawiona krokiem
v5. Git scala `migrate.sqlite.ts` **bez konfliktu**: daje dwa wpisy `version: 6`, a po
zmianie nazwy zdublowanej stalej istniejace bramki parytetu sa zielone, bo swieza baza
i baza migrowana od zera przechodza oba kroki.

## Decyzja

1. **Krok, ktory wyszedl do ludzi, jest zamrozony.** Numer i nazwa kazdego kroku SQLite
   oraz plik kazdej migracji Postgres z tagu wydania sa wpisane recznie (z tagu, nie z kodu)
   w `backend/src/lib/db/migration-line-collision.test.ts`. Przy kolizji renumeruje linia
   **niewydana**.
2. **Krok drugiej linii dostaje numer powyzej wszystkiego, co juz jest na linii publicznej,
   i niesie PELNA sume.** SQLite: v8 `audit_log_event_type_union_legal_break`
   (`AUDIT_EVENT_TYPES_V8` = v7 + `legal_break`). v7 to `audit.chain.fork_acknowledged`
   z ADR-0161, wniesiony na linii publicznej pierwszy. Samo-pomijanie dopiero wtedy, gdy
   CHECK ma WSZYSTKIE wartosci. Ten sam krok naprawia baze z 1.3.0, baze po v7 i baze
   deweloperska linii 2.0, a swieza baze zostawia bez rebuildu. Straznik `prev_hash`
   (ADR-0161) odtwarza `runSqliteMigrations` po krokach, z zachowanym progiem.
   Postgres: `020` linii 2.0 staje sie `024_audit_log_drop_hash_field_fks` (tresc bez
   zmian, idempotentna). `021` staje sie `025_audit_log_event_type_union_legal_break`
   z suma w UP (24 wartosci) i lista z `023` w DOWN.
3. **Kto wnosi krok jako drugi, daje mu numer wyzszy i dopisuje sume.** Tu drugi jest
   krok linii 2.0, bo praca ADR-0161 trafila na linie publiczna wczesniej.
4. **Bramka sprawdza zachowanie, nie nazwe.** Ostatni krok SQLite, puszczony SAM na bazie
   z niepelnym CHECK (stan z 1.3.0 i stan z linii 2.0), musi dac pelne `EVENT_TYPES`.
   Dotychczasowa bramka porownywala stala z lista i sprawdzala, czy nazwa ostatniego kroku
   zawiera "event_type". Krok wstawiony pod spod albo przestawiony alias przechodzil ja.

## Konsekwencje

- Bramka byla na czerwono przed naprawa: na wiarygodnym scaleniu (oba wpisy v6) padly
  testy bazy z 1.3.0, bazy linii 2.0, numeracji i ostatniego kroku, a stare bramki
  parytetu SQLite byly zielone. Trzy mutanty naprawy, kazdy zlapany: samo-pomijanie po
  ostatniej wartosci (blad v2-v4), v8 z lista linii 2.0, krok sumy pod numerem 6.
- Przebieg na kopii prawdziwej bazy desktopowej: `user_version` 6 -> 8, `legal_break`
  odrzucany przed i przyjmowany po, kazdy typ z `EVENT_TYPES` przyjety, wiersze i hashe
  identyczne bajt w bajt, `integrity_check` = ok. Oryginal nietkniety.
- Serwer deweloperski, ktory zaaplikowal stare `020`/`021` linii 2.0, pokaze `DRIFT` na
  `020` (checksum innego pliku pod tym samym id) i dostanie 024/025 jako nowe. Obie sa
  idempotentne. Wpis `020` w `schema_migrations` trzeba wtedy poprawic recznie
  (`migrate:mark`). Linia 2.0 nie byla wydana, wiec dotyczy to wylacznie srodowisk
  deweloperskich.
- **Ta sama klasa kolizji dotyczy numeru ADR.** Obie linie mialy ADR-0150. Zostaje ten,
  ktory jest na linii publicznej (upgrade Electrona); ADR o polach hasha z linii 2.0
  dostaje 0164. Komunikaty commitow linii 2.0 nadal mowia "ADR-0150" - historii nie
  przepisujemy. Jedno odwolanie zostaje niejednoznaczne: `documentIngest.ts` pisze
  "ADR-0150 nie dotyczy" przy konwersji LibreOffice i z kodu nie da sie ustalic, ktory
  ADR mial na mysli.
- **Linia 2.0 wchodzi jednym commitem (squash), nie merge'em.** Dwa jej commity niosa
  w tresci termin z listy zakazanej bramki publikacji. Plik znanych trafien historii
  (`.publication-gate-history-baseline.txt`) budowano z `--all`, wiec obejmuje tez
  commity z galezi prywatnych: przy merge'u bramka historii milczalaby, a te commity
  poszlyby na repozytorium publiczne. Squash ich nie przenosi; w drzewie termin usuniety.
  Kosztem jest utrata 11 komunikatow commitow w historii publicznej - uzasadnienia zyja
  w ADR i CHANGELOG, a commity zostaja na prywatnej galezi.
- **Weryfikator po scaleniu jest jeden.** Linia publiczna przeniosla weryfikator do
  `src/lib/audit-chain-verify.ts` (drzewo, trojstan ok/uwagi/blokada, SQLite i Postgres).
  Linia 2.0 rozbudowala stary skrypt Postgres o trojstan zerwan TRESCI. Kategorie z linii
  2.0 weszly do biblioteki jako podzial znaleziska `hash_mismatch`: zadeklarowane
  zdarzeniem `audit.chain.legal_break` = UWAGI (deklaracja liczy sie tylko z wlasnym
  poprawnym hashem, pozniejsza od wiersza i tylko gdy wiersz ma wyzerowane pole, ktore
  nazywa), zgodne z kaskada FK = BLOKADA z hipoteza i tylko dla zrodla Postgres
  (`fkCascadePossible`), reszta = BLOKADA. Kazdy z tych warunkow ma test, ktory padl na
  mutancie.

## Alternatywy odrzucone

- **Zostawic oba kroki pod v6.** Instalacja z 1.3.0 nie dostaje drugiego, i to jest
  defekt, ktory ten ADR opisuje.
- **Przenumerowac krok linii publicznej.** Ma go juz kazda instalacja 1.3.0, a zmiana
  numeru wydanego kroku powtarza problem w druga strone.
- **Runner po nazwie kroku zamiast po numerze** (tabela zaaplikowanych krokow w SQLite).
  Usuwa cala klase problemu, ale zmienia format bazy u mecenasa i wymaga wlasnej migracji
  przejsciowej. Za duzy krok na scalenie linii, do rozwazenia osobno.
