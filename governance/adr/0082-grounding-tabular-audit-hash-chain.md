# ADR-0082: Propagacja werdyktu groundingu tabular do audit hash-chain

**Status**: Wdrozony 2026-05-31. Konstytucja v1.5.0.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: zdarzenie audit liczy sie lokalnie, payload to wylacznie liczby werdyktu (zero tresci cytatu, zero danych klienta). Zero egress.
- **Art. 7 - Minimalnosc / rzetelnosc**: dowod nalezytej starannosci anty-halucynacja powinien byc niezmienny, nie tylko widoczny w mutowalnej komorce.

**Powiazane ADR**: ADR-0080 (grounding komorek tabular - ten ADR domyka jego rezerwacje E.1), ADR-0001 (hash-chain audit_log), ADR-0035 (whitelist event_type + migracje), ADR-0070 (wzor: anty-churn jeden row na operacje, nie na klik), ADR-0067 (wzor czysty builder + appender `auditLlmRoute.ts`).

---

## Kontekst

ADR-0080 wprowadzil mechaniczna weryfikacje cytatow inline w komorkach tabular i zapisuje werdykt na komorce (`cell.content.grounding`). To stan **mutowalny**: regeneracja komorki nadpisuje werdykt, a `clear-cells` go kasuje. Jako dowod nalezytej starannosci (AI Act art. 12) to za malo - audytor nie ma niezmiennego sladu, ze w danym momencie macierz DD zostala zweryfikowana i ile cytatow nie przeszlo.

Patron ma juz dokladnie ten mechanizm dla innych zdarzen: hash-chain `audit_log` (ADR-0001) + Merkle (ADR-0026). Kazda interakcja LLM wysokiej wagi (routing - ADR-0067, pipeline obrony - ADR-0068, rozstrzygniecie tracked-change - ADR-0070) dokleja niezmienny rekord. Grounding tabular byl luka: weryfikacja sie dzieje, ale nie zostawia sladu. ADR-0080 jawnie to zarezerwowal (sekcja E.1).

---

## Decyzja

Dokleic nowy typ zdarzenia `tabular.grounding` do istniejacego hash-chain. Zaden nowy mechanizm audytu - tylko nowa wartosc `event_type` i emisja z dwoch sciezek ekstrakcji.

### A. Nowy event_type przez migracje (ADR-0035)

`tabular.grounding` dodany do whitelist CHECK `audit_log_event_type_whitelist` (16 -> 17 wartosci). Lustra zaktualizowane spojnie w czterech miejscach zgodnie z konwencja ADR-0035:
- `backend/migrations/009_audit_log_event_type_tabular_grounding.sql` (UP/DOWN per ADR-0038, idempotent DROP+ADD),
- `backend/schema.sql` (inline CHECK + ledger komentarza),
- `backend/src/lib/db/schema.sqlite.ts` (lustro CHECK dla trybu Desktop),
- `backend/src/lib/audit.ts` (`EVENT_TYPES` + komentarz konwencji).

### B. Czysty builder + agregator (testowalne bez DB)

`lib/tabular/audit-grounding.ts` (wzor `auditLlmRoute.ts`):
- `aggregateGrounding(verdicts)` - sumuje werdykty komorek do rollupu `{ cells_grounded, cells_unverified, citations_total, verified, modified, unverified }`. `undefined` (komorka bez cytatu albo bez zrodla) nie liczy sie jako ugruntowana.
- `buildTabularGroundingEvent(input)` - czysta funkcja zwracajaca `AuditEventInput`. Payload to wylacznie liczby + `review_id` (identyfikator, nie PII) + `trigger`. Bez tresci cytatu i bez fragmentu dokumentu (konwencja audit.ts - cytat moze zawierac dane klienta).
- `appendTabularGroundingEvent(db, input)` - owija `appendAuditEvent`, nie rzuca (kontrakt audit). **No-op gdy `citations_total === 0`** - brak substancji do zaswiadczenia, nie zasmiecamy lancucha.

### C. Emisja anty-churn (wzor ADR-0070)

- `/generate` (przebieg wsadowy): werdykty zbierane z `onResult` po wszystkich komorkach, **jeden** rekord audit na przebieg (`trigger: "generate"`, `documents` = liczba realnie przetworzonych dokumentow). Nie row-per-cell.
- `/regenerate-cell` (pojedyncza komorka): jeden rekord (`trigger: "regenerate_cell"`, `documents: 1`).

### D. Co pozostaje zarezerwowane (NIE w 0082)

- **UI viewer zdarzen tabular.grounding** w panelu audytu (dzis zdarzenie jest w lancuchu i w audit pack, ale bez dedykowanego widoku). Rezerwacja pod istniejacy backlog viewera (ADR-0036).
- **Trigger Merkle root po przebiegu** - rekord wchodzi do Merkle przy najblizszym compute (manualny trigger ADR-0026), nie domykamy roota per generacja.

---

## Konsekwencje

**Pozytywne**:
- Werdykt anty-halucynacja staje sie niezmienny: audytor widzi w hash-chain, ze macierz DD byla weryfikowana, kiedy, przez kogo i ile cytatow nie przeszlo. Domyka AI Act art. 12 dla tabular.
- Zero nowego mechanizmu - reuzyty hash-chain (ADR-0001), Merkle (ADR-0026), audit pack (ADR-0047). Builder czysty i przetestowany bez DB.
- Anty-churn: jeden rekord na przebieg, nie na komorke - lancuch nie puchnie przy macierzy 50 dokumentow x 15 kolumn.
- Payload bez PII - same liczby, zgodnie z konwencja audit.ts.

**Negatywne / koszt**:
- Czwarta migracja event_type w serii (009) - whitelist rosnie. Akceptowalne: to udokumentowany, idempotentny wzorzec (001-008).
- Rekord loguje liczby, nie ktore komorki maja halucynacje - audytor widzi "2 cytaty niezweryfikowane w tym przebiegu", a ktore, ustala z biezacego stanu macierzy. Swiadomy kompromis (brak PII w audit, brak churn).
- Rollback migracji 009 sprawi, ze emisja `tabular.grounding` zwroci blad z CHECK (audit append nie rzuca - sciezka produktowa dziala, audyt niepelny). Udokumentowane w DOWN.

**Bramki PRZED merge**:
- TSC clean (backend). Zrealizowane: `tsc --noEmit` EXIT 0.
- Testy zielone. Zrealizowane: `audit-grounding.test.ts` 5 pass (agregator + builder bez PII + bramka no-op); pelny backend bez regresji (w tym `audit.test.ts`, `migrations.test.ts`).
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
