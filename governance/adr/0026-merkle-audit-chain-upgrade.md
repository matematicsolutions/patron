# ADR-0026: Merkle audit chain - upgrade nad hash-chainem dla efektywnej weryfikacji integralnosci

> **Uwaga numeracja**: numer 0026 zarezerwowany w ADR-0024 jako "Merkle upgrade audit'u". Sprawdzono `governance/adr/` 2026-05-27 - 0026 wolne. Wdrazany dzisiaj poza kolejnoscia rosnaca (po 0027, 0028, 0033) - rezerwacja z 2026-05-24 utrzymana, numer zachowany dla kontynuacji patternu z ADR-0024.

**Status**: WDROZONY (2026-05-27)

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.2, zweryfikowane grepem):
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - GLOWNA zasada tego ADR. Wzmacnia istniejacy hash-chain (ADR-0001) o efektywna weryfikacje konkretnego eventu w O(log n) zamiast O(n) lancucha.
- **Art. 5 - Determinizm** - Merkle tree to deterministyczna struktura: te same eventy w tej samej kolejnosci zawsze daja ten sam root. Audytor moze niezaleznie zweryfikowac integralnosc.
- **Art. 2 - Weryfikowalnosc zrodel** - audytor (np. UODO, rewident kancelarii, biegly w postepowaniu) dostaje proof-of-inclusion dla konkretnej decyzji AI bez ujawniania pelnego loga (chroni tajemnice zawodowa innych klientow kancelarii).

**Powiazane ADR**:
- **ADR-0001** (hash-chain audit-trail) - bezposredni rodzic. Hash-chain zostaje (wymagany dla detekcji modyfikacji srodkowego rekordu); Merkle dodany rownolegle jako warstwa weryfikacji.
- **ADR-0024** (cherry-pick MS AGT) - ADR nadrzedny dla tej iteracji. Pattern 2 z trojki (MCP Security 0025 + Privilege Rings 0027 + Merkle 0026).
- **ADR-0033** (propagacja mcp_security do audit) - korzysta z tego samego `audit_log`, ktory teraz Merkle pokrywa.

**Rezerwacje wydzielone** (per [feedback_scope_down_atomic_adr]):
- **ADR-0036** (rezerwacja) - automatyczny trigger compute root po N events + UI viewer dla audytora (proof bundle export).
- **ADR-0037** (rezerwacja) - zewnetrzny znacznik czasu (RFC 3161 lub OpenTimestamps) nad Merkle rootami - dowod istnienia w czasie dla audytu.

---

## Decyzja

Patron dodaje **Merkle tree** nad istniejacym hash-chain audit-loga jako rownolegla warstwa weryfikacji. Hash-chain zostaje nienaruszony - Merkle jest warstwa NAD nim, NIE zamiast niego.

### Architektura

```
audit_log (istnieje, ADR-0001)
  - id bigserial
  - prev_hash text (64 hex)
  - hash text (64 hex, unique)
  - ...

audit_merkle_roots (NOWA tabela w ADR-0026)
  - id bigserial
  - chain_block_start bigint - audit_log.id pierwszego eventu w bloku
  - chain_block_end bigint - audit_log.id ostatniego eventu w bloku
  - merkle_root text - SHA-256 hex root drzewa Merkle
  - event_count int - liczba eventow w bloku (= end - start + 1)
  - computed_at timestamptz
  - computed_by text - 'service' (system) lub user_id (manualnie)
```

### Algorytm

1. **Lisce drzewa Merkle**: kazdy lisc = `audit_log.hash` (juz SHA-256 hex). Brak ponownego hashowania - oszczednosc CPU.
2. **Wezly wewnetrzne**: SHA-256(left || right), gdzie `||` to konkatenacja hex.
3. **Nieparzysta liczba lisci**: ostatni lisc duplikowany do parzystej (konwencja RFC 6962 Certificate Transparency).
4. **Block size**: domyslnie 1024 eventy (configurable). Trade-off: mniejsze bloki = czestsze roots (wiekszy overhead storage), wieksze = wolniejszy compute pierwszego roota dla nowej kancelarii.
5. **Proof format**: tablica `{ position: "left" | "right", hash: string }` - audytor podaje event `hash` + proof + root i offline odtwarza scieżke do roota.

### Co robimy w tym ADR

- Tabela `audit_merkle_roots` w `backend/schema.sql` (baseline; incremental migration w ADR-0035).
- 3 moduly TypeScript w `backend/src/lib/`:
  - `audit-merkle.ts` - **pure functions** `buildMerkleTree(hashes)` + `buildMerkleProof(targetHash, hashes)` + `verifyMerkleProof(targetHash, proof, root)`. Bez side effects, testowane bez mockow.
  - `audit-merkle-roots.ts` - storage layer: `computeAndStoreRoot(db, blockStart, blockEnd, computedBy)` + `fetchProofForEvent(db, eventId)`.
  - `audit-merkle-verifier.ts` - offline verifier dla audytora (eksportowany do `scripts/verify-audit-merkle.ts` w przyszlym ADR-0036).
- Test suite: 30 testow lacznie w 2 plikach (`audit-merkle.test.ts` 20 testow + `audit-merkle-verifier.test.ts` 10 testow), pure functions zero mockow. Storage layer (`audit-merkle-roots.ts`) testowany integracyjnie w ADR-0036 (auto-trigger hook).
- AGENTS.md + CHANGELOG catchup.

### Czego NIE robimy w tym ADR

- **NIE automate compute root** - manual trigger w tym ADR. Hook na N events = ADR-0036.
- **NIE UI viewer dla audytora** = ADR-0036.
- **NIE zewnetrzny znacznik czasu** (RFC 3161 / OpenTimestamps) = ADR-0037. Patron jest single-tenant lokalny; opcja "signed by external TSA" jest dla scenariusza kontroli zewnetrznej.
- **NIE incremental migration system** (CREATE TABLE w baseline schema.sql) = wpiete w ADR-0035 (rezerwacja).
- **NIE modyfikujemy `audit_log`** - hash-chain pozostaje pierwsza warstwa obrony. Merkle to druga warstwa, ortogonalna.

---

## Kontekst

### Dlaczego hash-chain nie wystarcza

Hash-chain ADR-0001 jest **deterministyczny i tamper-evident**: modyfikacja eventu N psuje wszystkie hash'e od N+1 dalej, weryfikator wykrywa od razu.

Slabosc: weryfikacja konkretnego eventu wymaga przejscia calego lancucha od genesis. Dla kancelarii z rok pracy = setki tysiecy eventow. Audytor (UODO, rewident, biegly w postepowaniu) nie chce czytac 500k wierszy zeby zweryfikowac jeden event.

Merkle daje proof-of-inclusion w **O(log n)** kroku - dla 500k eventow to ~19 hash'y do zweryfikowania zamiast 500k.

### Dlaczego nie zamiast hash-chain

Hash-chain wykrywa modyfikacje srodkowego eventu - to detekcja, ktorej Merkle sam nie ma (Merkle wymaga przeliczenia drzewa, nie wykrywa modyfikacji w czasie linear).

Razem: hash-chain = continuous integrity, Merkle = sampled proof-of-inclusion. **Dwie warstwy ortogonalne**.

### Komplementarnosc z proof receipt (ADR-0031 PROPONOWANY)

ADR-0031 (deterministic validation z proof receipt, cherry-pick z ICME) zapisuje dla **konkretnej decyzji** dowod: policy_version + input + output + zatwierdzenie. To dowod na poziomie pojedynczej decyzji AI.

Merkle daje integralnosc lancucha audit-loga = kontekstu wszystkich decyzji. Razem:
- Audytor pyta o decyzje X z dnia Y -> dostaje proof receipt (ADR-0031)
- Audytor weryfikuje, czy ten proof receipt jest faktycznie w nienaruszanym logu kancelarii -> Merkle proof-of-inclusion (ten ADR)

Bez Merkle audytor musi czytac caly log od genesis. Z Merkle - 19 hashy.

### Dlaczego SHA-256 a nie szybsze hashe (BLAKE3 / xxHash)

- Algorithm hash-chain ADR-0001 = SHA-256. Spojnosc.
- SHA-256 jest FIPS 140-2 - wymagane w europejskich postepowaniach urzedowych.
- Wydajnosc nie jest problemem: Merkle dla 1024 eventow to ~1024 SHA-256 (~5ms na typowym CPU). Compute root dla nowego bloku nie blokuje krytycznej sciezki.

---

## Alternatywy rozwazane

**A. Zostawic tylko hash-chain (ADR-0001)** - O(n) weryfikacja akceptowalna
- Odrzucone - dla kancelarii z 500k eventow audyt UODO trwalby godziny zamiast minut. Wyzsza bariera operacyjna dla auditora = klient placi wiecej za audyt.

**B. Pelne Certificate Transparency** (signed tree heads, gossip, witness servers)
- Odrzucone - przeskalowane. CT jest dla globalnych CA z 1000+ niezaleznymi witness servers. Patron jest single-tenant per kancelaria, audyt zewnetrzny okresowy, nie online.

**C. Append-only log z external service (AWS QLDB, Google Bigtable hash)** - **odrzucone w starcie**
- Sprzeczne z Art. 1 Konstytucji (lokalnosc). Patron nie wysyla danych klienta poza maszyne kancelarii.

**D. Merkle + RFC 3161 timestamping w jednym ADR**
- Odrzucone - per [feedback_scope_down_atomic_adr], atomowy ADR > mieszany. RFC 3161 wymaga TSA URL + procedury kontraktowej, ortogonalne do compute. Wydzielenie do ADR-0037.

**E. Merkle algorithm RFC 9162** (Certificate Transparency v2) - prefix hashing
- Odrzucone na starcie - dla naszej skali (1 kancelaria, 100k-1M events/rok) klasyczny RFC 6962 wystarcza. RFC 9162 to opcja na ADR-0036 jezeli pojawi sie potrzeba dynamic tree.

**F. Adopcja patternu wybrana** - **przyjete** - SHA-256 binary tree, RFC 6962 convention (duplicate last), block-based roots, manual trigger w ADR-0026 + auto w ADR-0036.

---

## Konsekwencje

### Pozytywne

- Audyt AI Act art. 12 staje sie ekonomicznie wykonalny dla kancelarii ze sredniej skali audit-loga (500k+ events): O(log n) proof zamiast O(n).
- Audytor dostaje przenosny dowod (event hash + proof bundle + root), ktory mozna zweryfikowac offline bez dostepu do bazy kancelarii (chroni tajemnice innych klientow).
- Merkle root + computed_by + ts = punkt zakotwiczenia dla przyszlego zewnetrznego znacznika czasu (ADR-0037).
- Material edukacyjny: 99% kancelarii nie zna roznicy hash-chain vs Merkle - to pozycja eksperta MateMatic.
- Komplementarne z proof receipt (ADR-0031) - rozne warstwy weryfikacji decyzji AI.

### Negatywne / kosztowe

- +1 tabela w schema.sql (mala, ~50 wierszy/dzien dla bloku 1024).
- +3 moduly TS (~250 LoC lacznie) do utrzymania.
- Manual trigger w tej iteracji oznacza, ze administratorzy kancelarii musza wiedziec o nim - dokumentacja w AGENTS.md + IMPLEMENTATION_PLAYBOOK.
- Compute root przy 1024 eventach = nie blokuje krytycznej sciezki, ale przy duzych blokach (np. 100k events ad-hoc) - tak. Manualny trigger = administrator decyduje kiedy.

### Bramki przed implementacja - SPELNIONE

- **[X]** Reality-check briefingu vs kod (audit_log + schema.sql + baseline tests) - 4/4 zalozenia briefingu spojne z kodem.
- **[X]** Konstytucja Art. 2/3/5 zweryfikowane grepem CONSTITUTION.md - artykuly istnieja w wersji v1.2.2.
- **[X]** Numerologia ADR - 0026 wolne, 0036/0037 wolne dla rezerwacji.
- **[X]** ADR atomowy - jeden temat (Merkle compute + storage + verifier), wydzielenia jawne w sekcji "Czego NIE robimy".

### Bramki po implementacji

- TSC clean.
- Test suite +30 testow (20 audit-merkle + 10 verifier-bundle), baseline 429/434 -> 459/464 pass.
- 2x runda marko-pl na ADR i komentarze kodu.
- Self-review 6 rules.

---

## Atrybucja

Pattern Merkle audit chain zainspirowany przez [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, Microsoft Corp., 2026-03-02). Cherry-pick patternu zgodnie z ADR-0024 - Patron pisze 3 moduly od zera w TypeScript pod swoje realia (Postgres, Node 20+).

Algorytm: konwencja RFC 6962 (Certificate Transparency, 2013, Laurie/Langley/Kasper) - duplicate last leaf dla nieparzystej liczby, SHA-256 dla wezlow wewnetrznych.

Atrybucja: ten ADR + komentarz naglowkowy w `audit-merkle.ts:7-9`. Aktualizacja `THIRD_PARTY_INSPIRATIONS.md` razem z najblizsza iteracja MS AGT (juz wpis dla 0024/0025/0027, dorzucenie 0026 w tym samym commicie).
