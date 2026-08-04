# ADR-0141: Lokalny bulk-cache orzecznictwa SAOS/NSA (indeks SQLite + tresci na FS)

**Status**: PROPONOWANY (2026-07-31). Draft do przegladu WM - bez implementacji.

**Data**: 2026-07-31

**Powiazane zasady** (Konstytucja Patrona):

- **Art. 2 - Tajemnica zawodowa / zero-cloud** (zasada glowna). Orzecznictwo
  serwowane z lokalnego dysku, zapytanie o sygnature nie opuszcza maszyny
  kancelarii. Zapytania do zrodel publicznych (SAOS) zostaja wylacznie jako
  fallback i dotycza tylko metadanych orzeczenia, nigdy tresci sprawy klienta.
- **Art. 6 - Granica bledu**. Czesciowy cache NIE MOZE udawac kompletnego
  zrodla: kazdy wynik niesie jawny status i proweniencje zamiast cichego
  "nie znaleziono".
- **Art. 7 - Minimalnosc / rzetelnosc**. Reuzycie istniejacych warstw
  (adapter SQLite ADR-0053, kanal paczek ADR-0140, grounding ADR-0005/0080)
  zamiast nowego silnika.

**Powiazane ADR**:

- **ADR-0053** (LIVE) - tryb sqlite zero-cloud; tabele indeksowe wchodza do
  embedded schema `schema.sqlite.ts` + lustro Postgres.
- **ADR-0140** (Przyjety) - kanal dystrybucji paczek wiedzy; bulk-cache jest
  KONSUMENTEM tego kanalu (paczka korpusowa = zrodlo ingestu).
- **ADR-0005 / ADR-0080** - mechaniczny grounding cytatow; proweniencja
  `source` per cytat rozszerza istniejacy werdykt groundingu.
- **ADR-0027 / 0028** - konektory `saos` / `nsa` na liscie
  `APPROVED_PATRON_CONNECTORS` (mcp-security gateway); fallback idzie przez
  te sama bramke co dotychczas.

**Wzorzec upstreamu**: `Open-Legal-Products/mike` - bulk cache CourtListener
(`backend/migrations/20260523_courtlistener_bulk_indexes.sql` +
`backend/src/lib/courtlistener.ts`): lekkie tabele lookup
(`courtlistener_citation_index`: volume/reporter/page -> cluster_id;
`courtlistener_opinion_cluster_index`: metadane klastra) + pelne tresci JSON
w object storage pod deterministycznym kluczem
`courtlistener/opinions/by-cluster/{cluster_id}/{opinion_id}.json`, calosc za
flaga `COURTLISTENER_BULK_DATA_ENABLED` z fallbackiem do REST API. Przenosimy
architekture, NIE kod: u mike storage = R2 (chmura), u nas lokalny FS.

---

## Kontekst

1. **NSA ma ban 403 na harvest** (stan 2026-07). Live-query do CBOSA jest
   kruche i etycznie graniczne po banie; ponawianie/obchodzenie = ryzyko
   pogorszenia sytuacji. Orzecznictwo NSA musi byc dostepne OFFLINE z
   wczesniej zharvestowanego korpusu - to nie optymalizacja, to koniecznosc.
2. **Linia korpusowa PL istnieje**: 583 798 dokumentow (legal-pack-factory),
   gotowe zrodlo ingestu. Kanal chunkowy ADR-0140 juz umie dostarczyc paczke
   do `%APPDATA%/PATRON/packs` i ja aktualizowac delta.
3. **Konektor MCP `saos` odpytuje API na zywo** - dziala, ale kazde zapytanie
   to egress (metadane), opoznienie sieci i zaleznosc od dostepnosci SAOS.
   Dla przegladu DD z dziesiatkami cytowan orzeczen lookup musi byc lokalny
   i natychmiastowy.
4. Grounding (ADR-0080) weryfikuje, czy cytat istnieje w DOKUMENCIE sprawy.
   Nie ma dzis warstwy, ktora weryfikuje sygnature orzeczenia i podaje jego
   tresc bez siegania do sieci.

## Decyzja

### A. Tabele indeksowe lookup w lokalnym SQLite

Analogicznie do pary tabel mike (citation_index + cluster_index), w schemacie
PATRONA (embedded `backend/src/lib/db/schema.sqlite.ts`, ADR-0053):

- `corpus_case_index` - lekki lookup: `signature` (znormalizowana sygnatura),
  `court` (kod sadu), `judgment_date`, `case_id` (klucz tresci), `pack_id`
  (z ktorej paczki pochodzi wpis). Indeksy: `(signature)`,
  `(court, judgment_date)`.
- `corpus_case_meta` - metadane per `case_id`: typ orzeczenia, sklad, tezy
  (skrot), sciezka relatywna pliku tresci, sha256 tresci, wersja paczki.

Normalizacja sygnatur reuzywa `backend/src/lib/pl-entities/` (zakaz forka
struktury sygnatur - AGENTS.md). Tylko indeks i metadane w bazie - pelne
tresci NIE wchodza do SQLite (paczka 1,6 GB nie ma czego robic w tabeli;
precedens: mike trzyma w Postgres wylacznie lookup, tresci w storage).

Lustro Postgres (tryb serwerowy): migracja wezmie numer z rejestru
(`.matematic/releases/<wydanie>/README.md`) w commicie implementacyjnym -
w tym ADR numeru migracji NIE rezerwujemy.

### B. Pelne tresci JSON na lokalnym FS pod deterministycznym kluczem

Odpowiednik `courtlistener/opinions/by-cluster/{cluster_id}/{opinion_id}.json`
na R2, tylko lokalnie:

```
%APPDATA%/PATRON/corpus/{source}/{shard}/{case_id}.json
```

- `source` in {`saos`, `nsa`} (rozszerzalne o `sn`, `tk`, ...),
- `shard` = 2 pierwsze znaki hex sha256(case_id) - plaski katalog z ~600k
  plikow zabija NTFS, sharding jest obowiazkowy,
- plik JSON = pelna tresc orzeczenia + metadane zrodlowe, sha256 zgodny z
  wpisem w `corpus_case_meta` (weryfikacja przy odczycie, wzorzec ADR-0140).

Katalog konfigurowalny `PATRON_CORPUS_DIR` (default jak wyzej), spojnie z
`PATRON_PACKS_DIR`. Ingest = rozpakowanie paczki korpusowej z kanalu
ADR-0140 do tego layoutu + zbudowanie/odswiezenie indeksu (idempotentne,
per-pack, z wersjonowaniem w `corpus_case_meta.pack_version`).

### C. Feature flag

`PATRON_CORPUS_BULK_ENABLED` (default `false` do czasu przyjecia ADR i evalu
wg konwencji ADR-0101/0102) - analog `COURTLISTENER_BULK_DATA_ENABLED` u mike.
Flaga OFF = zachowanie dzisiejsze (wylacznie konektor MCP), zero regresu.

### D. Fallback do konektora MCP SAOS + merge z jawna proweniencja

Kolejnosc lookup przy flagach ON:

1. `corpus_case_index` (lokalnie, ms),
2. jesli wynik niepelny lub brak - konektor MCP `saos` przez istniejaca
   bramke mcp-security (ADR-0028); dla zrodla `nsa` fallbacku sieciowego
   NIE MA (ban 403) - koncowy status jest jawny, patrz E.

Wyniki z obu zrodel sa merge'owane, a KAZDY cytat orzeczenia niesie
proweniencje:

- `source: "bulk"` - tresc i metadane w calosci z lokalnego cache,
- `source: "bulk+mcp"` - lokalny indeks uzupelniony odpowiedzia konektora
  (albo odwrotnie).

Proweniencja jest persystowana obok werdyktu groundingu (rozszerzenie
formatu z ADR-0080, nie nowy mechanizm) i widoczna w UI przy pigulce
cytatu - prawnik widzi, czy orzeczenie potwierdzil lokalny korpus, czy
zrodlo sieciowe.

### E. Statusy per-cytat - obrona przed cicha niekompletnoscia cache

Kazdy lookup konczy sie JEDNYM z jawnych statusow:

| status | znaczenie |
|---|---|
| `ok` | indeks trafiony, plik tresci obecny, sha256 zgodny |
| `partial` | indeks trafiony, ale tresc niepelna (brak pliku / tylko metadane / paczka starsza niz zadany zakres) |
| `not_found` | brak w indeksie ORAZ fallback MCP nie znalazl (lub jest niedostepny - wtedy z adnotacja `fallback_unavailable`) |
| `invalid` | wpis indeksu lub plik uszkodzony (sha256 mismatch, JSON nieparsowalny) - traktowany jak brak + log |
| `error` | blad I/O lub bledu konektora w trakcie fallbacku |

Regula krytyczna: **`partial` NIGDY nie degraduje do `not_found` bez proby
fallbacku**. Cache pokrywajacy 583 798 dokumentow wciaz jest proba, nie
prawda absolutna - "brak w cache" znaczy tylko "brak w cache". Najgrozniejsza
awaria to ta, ktora konczy sie sukcesem z niepelnymi danymi: lookup, ktory
na czesciowym cache odpowiada `not_found`, wyglada na dzialajacy i falszywie
podpowiada prawnikowi, ze orzeczenie nie istnieje. Statusy `invalid`/`error`
sa rozroznione od `not_found` z tego samego powodu - zepsuty plik to nie
brak orzeczenia.

Zbiorczy rollup statusow (najgorszy wygrywa, wzorzec rollupu z ADR-0080)
trafia do odpowiedzi narzedzia i do UI.

## Konsekwencje

- Orzecznictwo NSA dostepne mimo bana 403 - bez jednego zapytania do CBOSA
  z maszyny kancelarii. SAOS: lookup lokalny w ms zamiast egress + latency.
- RODO/tajemnica: zapytania o sygnatury (moga zdradzac kontekst sprawy)
  przestaja byc wysylane do zrodel publicznych na sciezce glownej.
- Nowa powierzchnia operacyjna: swiezosc korpusu. Paczka kwartalna =
  orzeczenia z ostatnich tygodni beda `not_found`/`partial` w bulk -
  proweniencja i fallback czynia to jawnym, a kanal ADR-0140 daje delta-update.
- Rozmiar na dysku: korpus PL to pojedyncze GB. Instalacja paczki korpusowej
  jest opt-in (pobranie przez kanal paczek), nie czescia instalatora.
- Rezerwacje (poza zakresem): eval jakosci lookup przed flipem flagi
  (konwencja ADR-0101/0102); zdarzenie audit hash-chain dla ingestu paczki
  korpusowej (5 mirrorow event_type wg precedensu connector.toggle);
  rozszerzenie o SN/TK, gdy linia korpusowa domknie te zrodla (LEXGRAPH:
  SN dzis do 2016).

## Alternatywy odrzucone

1. **Pelne tresci w SQLite (BLOB/FTS)** - baza rosnie do rozmiaru korpusu,
   backup/podmiana paczki staje sie operacja na bazie zamiast na plikach;
   mike swiadomie trzyma tresci poza baza i to sie potwierdza.
2. **Dalszy live-harvest NSA z rotacja IP** - obejscie bana wprost odrzucone
   (regula: po banie przeczekac, nie obchodzic; ryzyko prawne i reputacyjne).
3. **Cache przezroczysty bez statusow (zwykly LRU nad konektorem)** - ukrywa
   niekompletnosc, dokladnie ta awaria, przed ktora sie bronimy w E.
4. **Wlasny format binarny indeksu poza SQLite** - nowy silnik wbrew
   Art. 7; adapter ADR-0053 juz daje transakcyjny, testowalny lookup.
