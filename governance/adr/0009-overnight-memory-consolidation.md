# ADR-0009: Nocna konsolidacja pamieci + self-healing cytatow

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalnosc - cytaty
ktore "umarly" - usuniete z SAOS / zmienione w ISAP - wykrywane proaktywnie),
Art. 3 (audytowalnosc - kazda zmiana w pamieci logowana w hash-chain audit),
Art. 6 (granica bledu - prawnik dowiaduje sie o problemie zanim zaczna z niego
korzystac), Art. 9 (dostepnosc wiedzy - konsolidacja odchwaszcza graf)
**Powiazane ADR**: ADR-0001 (hash-chain audit log), ADR-0005 (citation grounding -
weryfikator karmi consolidation), ADR-0007 (hybrid retrieval - graf konsolidowany),
ADR-0008 (entity extraction - encje konsolidowane), wzorzec architektoniczny
[garrytan/gbrain](https://github.com/garrytan/gbrain) (MIT, cron jobs pattern)

## Decyzja

Patron uruchamia **co noc (default 03:00 lokalnego czasu kancelarii) batch
job konsolidacji pamieci**, ktory:

1. **Re-weryfikuje cytaty zapisane w korpusie** - dla kazdego cytatu z
   orzeczenia/przepisu/CELEX zweryfikowanego >30 dni temu, pobiera aktualne
   zrodlo (mcp-saos, mcp-isap, mcp-eurlex) i ponawia fuzzy match (ADR-0005).
   Jezeli orzeczenie zostalo wycofane / przeredagowane - flaga `citation_stale`
   w bazie + audit log + powiadomienie w UI rano.

2. **Deduplikuje encje w grafie** - jezeli dwie encje typu `osoba` rozlozone
   po projekcie maja te same identyfikatory (PESEL hash lub nazwa po
   normalizacji + miasto + data urodzenia), laczy je w jeden node. Encje
   typu `firma` deduplikuje po KRS. Audit log eventu `entity.merged`.

3. **Usuwa orphan nodes** w grafie - encje bez polaczen do dokumentow
   (utworzone w trakcie ekstrakcji, ale dokument usuniety) usuwa po 90 dniach
   (retencja zgodna z polityka projektu, default).

4. **Sprawdza spojnosc audit chain** (ADR-0001) - liczy hash-chain od poczatku,
   wykrywa rozjazdy (atak/blad I/O). Raport poranny.

5. **Generuje "morning brief"** - markdown w UI prawnika z lista zmian
   ("3 cytaty z SAOS unieaktualnione - kliknij by sprawdzic", "5 encji firma
   zdeduplikowane", "graf wyczyszczony z 12 orphan nodes").

```
cron 03:00 -> [recheck_citations()] -> [audit log + UI flags]
           -> [dedupe_entities()]   -> [audit log + merge events]
           -> [purge_orphans()]     -> [audit log + retention events]
           -> [audit_chain_check()] -> [raport]
           -> [morning_brief()]     -> [UI markdown rano]
```

Job idempotentny (mozna uruchomic recznie z UI: "Konsoliduj teraz"), audit log
ma full chain wszystkich zmian (Konstytucja Art. 3, AI Act art. 12).

## Kontekst

Pamiec Patrona **starzeje sie**. Trzy mechanizmy starzenia:

- **Cytaty staja sie nieaktualne**. SAOS aktualizuje publikacje orzeczen
  (poprawki redaktorskie, redakcja anonimizacji). ISAP/EUR-Lex publikuja
  zmiany przepisow (nowelizacje, omyly drukarskie). Cytat zweryfikowany
  6 miesiecy temu moze juz nie matchowac aktualnego zrodla. **Prawnik
  korzystajacy z opinii sprzed 6 mies. pisanej przez Patrona nie wie**.

- **Graf encji zarasta**. Ten sam klient wpisany jako "Jan Kowalski" w
  jednym dokumencie i "J. Kowalski" w drugim. Jezeli pseudonimizacja
  (ADR-0003) nie zlapie ich jako tej samej osoby - graf ma duplikaty.
  Backlink-boost (ADR-0007) gorzej dziala (boost rozjeżdza sie miedzy
  duplikatami).

- **Orphan nodes** - prawnik usuna dokument z projektu, ale encje wyekstrahowane
  z niego (ADR-0008) zostaja. Bez konsolidacji graf rosnie nieskonczenie.

gbrain pokazuje pattern **"the agent fixes its own citations and consolidates
memory overnight"** - cron joby chodza w nocy, rano agent ma czysta i
zaktualizowana pamiec. To **kluczowy element** dlaczego pamiec gbrain dziala
na produkcji (17.8k pages bez ludzkiej obslugi sprzata).

Patron ma **inny profil ryzyka niz gbrain**:

- gbrain: jezeli encja sie zdeduplikuje blednie, najwyzej Garry Tan
  zobaczy nie tego inwestora w timelineie - **shrug, fix it**.
- Patron: jezeli encja "klient X" sie zdeduplikuje z "klient Y" (oba "Jan
  Kowalski"), prawnik moze zmieszac sprawy dwoch klientow. **Niedopuszczalne**.

Dlatego Patron robi konsolidacje **konserwatywnie**:
- Deduplikacja encji **wymaga** silnego identyfikatora (PESEL/NIP/KRS),
  nie samej nazwy. Same imie/nazwisko = NIE merge.
- Re-weryfikacja cytatow **flaguje** (nie usuwa) - prawnik decyduje czy
  zaktualizowac opinie czy zostawic ze starym brzmieniem
- Purge orphans **retencja 90 dni** (default, ustawialny), z audit log
  ktore encje skasowane

## Rozwazane sciezki

### Wariant A - brak konsolidacji (status quo)

**Plusy**: brak kodu, brak ryzyka.

**Minusy**:
- Cytaty starzeja sie cicho. Konstytucja Art. 2 - 6 miesiecy po opinii
  cytat moze byc nieaktualny. Prawnik tego nie wie
- Graf zarasta - backlink-boost ADR-0007 gorzej dziala
- Audit chain nigdy nie sprawdzany - rozjazdy moga sie pojawic niezauwazone
  (atak/I/O fail)

**Odrzucony**.

### Wariant B - konsolidacja w czasie rzeczywistym (przy kazdym zapisie)

Pomysl: kazdy zapis sprawdza czy nie tworzy duplikatu, czy cytaty nadal
matchuja zrodlo.

**Plusy**: pamiec zawsze swieza.

**Minusy**:
- Latency upload PDF eksploduje (deduplikacja wymaga skanu calego grafu,
  re-weryfikacja cytatu - mcp-saos lookup)
- Konstytucja Art. 7 (minimalnosc) zlamana - kazdy zapis robi praca
  ktora nie jest mu potrzebna
- Audit chain sprawdzany "w locie" - jezeli sie wykryje rozjazd, **przerwac
  zapis**? Trudna logika

**Odrzucony**.

### Wariant C - nocna konsolidacja batch + ondemand (WYBRANY)

Cron default 03:00 + przycisk "konsoliduj teraz" w UI (debug/admin).

**Plusy**:
- Wszystkie 4 mechanizmy konsolidacji odbywaja sie poza godzinami pracy
  kancelarii
- Morning brief - prawnik dowiaduje sie o problemach **zanim zacznie
  uzywac**. Konstytucja Art. 6 (granica bledu, "human in the loop")
- Job idempotentny - mozna powtorzyc bez efektow ubocznych
- Audit log ma kazda zmiane - reproducible (Art. 3)
- gbrain pattern walidowany na produkcji 17.8k pages

**Minusy**:
- Job moze sie nie uruchomic (cron fail, maszyna offline). **Mitigation**:
  retry mechanism + "last consolidation" timestamp w UI - prawnik widzi
  jezeli konsolidacja nie chodzila >48h
- Re-weryfikacja cytatow generuje **load na mcp-saos / mcp-isap**.
  Mitigation: cache + rate-limit + tylko cytaty starsze niz 30 dni
  (sprzezenie cytaty * 30 dni rotacja = staly load, nie spike)

**Wybrany**.

## Konsekwencje

### Plusy

- Konstytucja Art. 2 spelniona dynamicznie (cytaty samolecza sie)
- Konstytucja Art. 3 - audit chain check zapewnia tamper-evidence
- Konstytucja Art. 6 - prawnik dostaje morning brief, nie odkrywa
  problemu w opinii klienta
- Konstytucja Art. 9 - graf czysty, retrieval lepiej dziala
- Pattern gbrain "overnight consolidation" zaadoptowany do PL legal
  konserwatywnie

### Minusy i ograniczenia

- **Job moze sie nie uruchomic** (cron fail, maszyna offline). **Mitigation**:
  timestamp ostatniej konsolidacji widoczny w UI, flag czerwony jezeli
  >48h. Cron monitorowany przez systemd timer (lub odpowiednik).
- **Load na mcp-saos przy re-weryfikacji** - jezeli 1000 cytatow w korpusie,
  to 1000 wywolan SAOS na noc. **Mitigation**:
  - Rate limit 5 req/s -> 200 sekund na 1000 cytatow, akceptowalne w nocy
  - Cache parsed orzeczen (ADR-0005) - jezeli orzeczenie nie zmienione
    w ETag/Last-Modified, skip
  - Tylko cytaty `verified_at < now() - 30d` (rotacja, nie spike)
- **False-positive deduplikacji** - dwoje rozne osoby Jan Kowalski mialy
  identyczny PESEL hash z kolizji (dla SHA-256 pelnego praktycznie
  niemozliwe; dla skroconych hashy / fingerprint funkcji prawdopodobienstwo
  rosnie, **do walidacji T3** wyborem funkcji hash i dlugosci). **Mitigation**:
  silne identyfikatory = PESEL pelny hash + NIP + KRS, nie sam imienna
  match. Deduplikacja **konserwatywna** - jezeli nie 100% pewna, NIE laczy
- **Retencja 90 dni dla orphan nodes** - dla niektorych kancelarii za
  agresywna (chca dluzej zachowac). **Mitigation**: `.env
  ORPHAN_RETENTION_DAYS=90` ustawialny. Konstytucja Art. 7 (minimalnosc)
  jednak rekomenduje krotsza retencje.
- **Morning brief generuje noise** jezeli kazdy dzien ma kilka flag.
  **Mitigation**: brief grupowany, "X cytatow nieaktualnych w opiniach
  Z, kliknij zeby otworzyc liste". Prawnik moze odlozyc - nie jest
  obligatory.
- **Audit chain sprawdzanie pelne** trwa liniowo z dlugoscia chaina
  (re-hash kazdego entry + porownanie z prev_hash). Konkretne liczby
  zaleza od hardware, schemy i dlugosci payload - **do walidacji T1
  benchmarkiem** na zbiorze syntetycznym 1k / 10k / 100k entries.
  **Mitigation**: incremental check (od ostatniego znanego
  good hash + cron tygodniowy full re-check)
- **Cron 03:00 lokalny czas** - jezeli kancelaria pracuje na noce (rzadko,
  ale zdarza sie kryzysowo), konsolidacja moze rozjechac sie z aktywna
  praca. **Mitigation**: pre-flight check "czy ktos jest zalogowany" -
  jezeli tak, odlozyc o 1h

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump v1.2.0 -> v1.3.0** wspolny
  z ADR-0007, ADR-0008. Art. 3 dostaje w "Mechanizmy techniczne" punkt
  `(planowane Faza 6) nocna konsolidacja + audit chain check + morning brief`
- **Schema SQL** - nowa tabela `consolidation_runs` (`run_id`, `started_at`,
  `finished_at`, `citations_rechecked`, `citations_stale`, `entities_merged`,
  `orphans_purged`, `audit_chain_ok` BOOL, `morning_brief_url`)
- **Skrypty migracyjne** - `backend/scripts/consolidation/` (cron job
  + recheck-citations + dedupe-entities + purge-orphans + chain-check +
  morning-brief)
- **Kontrakty LLM** - sygnatura `streamChatWithTools` NIE zmienia sie.
  Konsolidacja chodzi w tle, offline od chatu.
- **UI** - nowy widok "Konsolidacja - status + morning brief"

## Plan migracji 6-tygodniowy

### Tydzien 1 - shkielet job + cron + audit chain check

- [ ] `backend/scripts/consolidation/runner.ts` - orkiestracja, idempotency,
      lock file
- [ ] Cron entry (`/etc/cron.d/patron-consolidation`) lub systemd timer
- [ ] `backend/scripts/consolidation/audit-chain-check.ts` - incremental
      + full check
- [ ] Tabela `consolidation_runs` migracja
- [ ] Manual trigger w UI (przyciskl "Konsoliduj teraz" - admin only)

### Tydzien 2 - recheck cytatow (wpiec ADR-0005 verifier)

- [ ] `backend/scripts/consolidation/recheck-citations.ts` - iteruje
      cytaty z `citation_verification` gdzie `verified_at < now()-30d`,
      ponawia fuzzy match z aktualnym zrodlem
- [ ] Cache ETag/Last-Modified w mcp-saos cache (skip jezeli zrodlo
      nie zmienione)
- [ ] Rate limit 5 req/s (default, ustawialny)
- [ ] Flag `citation_stale` w tabeli `citation_verification` + audit
      log event `citation.staled`

### Tydzien 3 - deduplikacja encji (wpiec ADR-0008)

- [ ] `backend/scripts/consolidation/dedupe-entities.ts` - iteruje
      encje typu `osoba` (po PESEL hash) + `firma` (po NIP/KRS)
- [ ] Merge konserwatywny: 100% match silnego identyfikatora wymagany
- [ ] Audit log event `entity.merged` (old_ids + new_id + reason)
- [ ] Test: utworz 5 par duplikatow w bazie testowej, sprawdz czy
      konsoliduje (recall) i czy nie laczy falszywych par (precision)

### Tydzien 4 - purge orphans + retencja

- [ ] `backend/scripts/consolidation/purge-orphans.ts` - encje bez
      `cited_by` / `mentions_in` polaczen + `extracted_at < now() - 90d`
- [ ] Audit log event `entity.purged`
- [ ] `.env ORPHAN_RETENTION_DAYS=90` konfigurowalny

### Tydzien 5 - morning brief generator + UI

- [ ] `backend/scripts/consolidation/morning-brief.ts` - markdown z
      podsumowaniem ostatniej konsolidacji
- [ ] UI widok `Konsolidacja` - lista runs + filtry per typ event
- [ ] Notyfikacja w UI rano (badge przy logowaniu, jezeli sa flagi
      `citation_stale`)

### Tydzien 6 - pilotaz + monitoring

- [ ] Wlacz konsolidacje dla pilotazowej kancelarii (po pilotazu ADR-0007
      i ADR-0008)
- [ ] Monitoring: czy cron sie odpala, ile czasu trwa, ile flags
      tworzy
- [ ] Po tygodniu pilotazu - przeglad **z prawnikiem** czy flagi sa
      przydatne (signal) czy szum (noise). Tune progi
- [ ] Decyzja: domyslna godzina cron (03:00 czy inna), retencja orphans
      (90d default)

## Status weryfikacji

- [ ] Runner + cron entry
- [ ] Audit chain check (incremental + full)
- [ ] Recheck citations (wpiec ADR-0005)
- [ ] Dedupe entities (wpiec ADR-0008)
- [ ] Purge orphans + retencja
- [ ] Morning brief generator
- [ ] UI widok konsolidacji
- [ ] Notyfikacja w UI rano
- [ ] Decyzja Wieslawa: cron 03:00 lokalny czas (UTC+2 lato / +1 zima) - OK?
- [ ] Decyzja Wieslawa: retencja orphans default 90 dni - OK czy krotsza
      (RODO art. 5.1.e storage limitation)
- [ ] Decyzja Wieslawa: morning brief - email + UI czy tylko UI

## Licencja blueprintu

gbrain jest **MIT**. Cherry-pick **wzorca** (overnight memory consolidation
+ self-healing citations + cron jobs orkiestracja) NIE jest derivative work.
Patron implementuje od zera w wlasnym ekosystemie:

- Cron + scripts w TypeScript w stacku Patrona (nie gbrain CLI)
- Re-weryfikacja przez **konektory PL** (mcp-saos / mcp-isap / mcp-eurlex),
  nie embedder gbrain
- Deduplikacja po **PL identyfikatorach** (PESEL/NIP/KRS), nie persony
  YC
- Morning brief w **polskim** + ekosystem RODO/AI Act, nie agent feed
  gbrain

Linkujemy w `THIRD_PARTY_INSPIRATIONS.md` jako blueprint. Pattern **cron
overnight consolidation** to konkretny wkład gbrain - reszta (citation
verification, entity dedup, retencja RODO) to nasza domena.
