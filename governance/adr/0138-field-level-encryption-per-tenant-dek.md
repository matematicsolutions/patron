# ADR-0138: Field-level encryption wrazliwych kolumn (per-tenant DEK, envelope)

**Status**: Proponowany (2026-06-29) - wymaga sign-off WM (kierunek krypto: zrodlo KEK na serwerze, zakres pol, strategia migracji) + 2x wewnetrznego review przed implementacja. Dotyka warstwy danych (odczyt/zapis wrazliwych kolumn) i modelu kluczy. Inspiracja architektoniczna: open-mercato (MIT, per-tenant DEK + field-level encryption) - NIE port kodu, wlasna implementacja na prymitywach PATRONa (`userApiKeys.ts` aes-256-gcm).

## Kontekst

PATRON trzyma w bazie tekst niosacy tajemnice adwokacka i PII: `document_edits` (deleted/inserted_text), `chat_messages.content`, `mutation_approvals.tool_payload`, `documents.filename`, `tabular_cells.content`, `document_versions.display_name`. Bajty plikow (.docx/.pdf) leza w object-storage (poza DB).

Istniejaca ochrona (recon 2026-06-29):
- **ADR-0072 / `atrest.ts`**: szyfrowanie at-rest CALEGO pliku SQLite (`PRAGMA key`, klucz DPAPI w `PATRON_DB_ENCRYPTION_KEY`, fail-loud bez sterownika cipher). Chroni przed **skradzionym dyskiem/laptopem**. Ograniczenia: SQLite-only (nie Postgres/serwer), wszystko-albo-nic, nie dotyka object-storage. Domyslnie OFF.
- **`userApiKeys.ts`**: dojrzaly wzorzec szyfrowania pola - AES-256-GCM, per-wartosc `iv`+`auth_tag`, klucz = sha256(`USER_API_KEYS_ENCRYPTION_SECRET`). Do reuzycia.

Luka: w trybie SERWEROWYM (Postgres, multi-tenant) at-rest ADR-0072 NIE dziala (brak DPAPI/PRAGMA key); dostep do bazy bez klucza (DBA, wyciek backupu, kompromitacja serwera, slaba izolacja tenantow) = tajemnica w plaintext. Nawet na desktopie defense-in-depth nad at-rest podnosi poprzeczke.

## Decyzja

1. **Field-level encryption warstwy APLIKACJI** (driver-agnostic, dziala w SQLite I Postgres) wybranych wrazliwych kolumn tekstowych. Envelope encryption:
   - **KEK** (key-encryption-key): desktop = OS keychain/DPAPI (jak `PATRON_DB_ENCRYPTION_KEY`); serwer = KMS albo env secret (jak `USER_API_KEYS_ENCRYPTION_SECRET`). KEK NIGDY plaintext na dysku. Derywacja: **HKDF-SHA256** z salt + info (domain separation) na bazie `PATRON_FIELD_ENCRYPTION_KEK` - mocniejsza niz surowy sha256 (audyt bezpieczenstwa 005, 2026-06-30). WYMOG: sekret KEK wysokoentropijny (>=32 losowych bajtow), NIE haslo.
   - **DEK** (data-encryption-key): losowy 256-bit, szyfruje wartosci pol. Per-tenant: desktop = 1 DEK (`LOCAL_USER_ID`), serwer = DEK per `organization`/user. DEK przechowywany OWINIETY przez KEK w tabeli `encryption_keys` (`wrapped_dek`, `iv`, `auth_tag`).
   - Algorytm: AES-256-GCM (jak `userApiKeys`), per-wartosc `iv`+`auth_tag`.
2. **Rozgraniczenie vs ADR-0072 (NIE duplikacja):** rozne warstwy, rozne modele zagrozen. ADR-0072 = at-rest caly plik (skradziony dysk, SQLite). 0138 = field-level warstwa app (dostep do bazy bez KEK, dual SQLite+Postgres). Na desktopie 0138 = defense-in-depth NAD at-rest; na serwerze 0138 = PODSTAWOWA ochrona (at-rest nie dziala).
3. **Selektywnosc (twarda granica):** szyfrujemy tylko kolumny czytane W CALOSCI, nie wyszukiwane w DB. NIE szyfrujemy: `doc_chunks.content`+embeddings (FTS5/vec retrieval), `extracted_entities.value_normalized` (indeks lookup encji), `audit_log.payload` (zaprojektowany PII-free; szyfrowanie zerwaloby weryfikowalnosc hash-chain/Merkle/grounding przez audytora), id/hash/timestamp/enum/FK. Searchable encryption = poza zakresem.
4. **Default OFF** (`PATRON_FIELD_ENCRYPTION`) - zero zmiany zachowania do swiadomej aktywacji + migracji.
5. **Rotacja:** rotacja KEK = re-wrap DEK (tanie, bez ruszania danych). Rotacja DEK = re-encrypt pol (drogie) - opcja pozniejsza (US3+), nie MVP.

## Konsekwencje

**Pozytywne:** tajemnica/PII nieczytelne przy dostepie do bazy bez KEK (RODO art. 32, fosa serwerowa + defense-in-depth desktop); dziala w obu backendach (nie tylko SQLite jak 0072); reuzycie sprawdzonego wzorca (`userApiKeys` aes-gcm); rozniconik sprzedazowy ("nawet my nie odczytamy waszych akt bez waszego klucza").

**Koszty/ryzyka:** (a) **utrata wyszukiwania** na zaszyfrowanych kolumnach - stad selektywnosc; (b) **migracja istniejacych danych** (backfill encrypt) - ryzykowna, wymaga strategii + odwracalnosci; (c) zarzadzanie kluczami (utrata KEK = utrata danych - fail-loud, backup KEK = procedura Operatora); (d) narzut wydajnosci (encrypt/decrypt per odczyt/zapis); (e) zwieksza zlozonosc warstwy db. Mitygacja: pilot na 1 kolumnie (US1), flaga OFF, fail-loud, testy round-trip + migracji.

**Odrzucone alternatywy:** (a) rozszerzenie ADR-0072 na Postgres - DPAPI/PRAGMA key nie istnieja w Postgres, to inny mechanizm; (b) szyfrowanie WSZYSTKICH kolumn - zabija retrieval/indeksy/audyt; (c) searchable/homomorphic encryption - przerost, ryzyko kryptograficzne; (d) szyfrowanie object-storage w tym ADR - osobny cykl (SSE MinIO/S3 serwer, ADR-0072 SQLite desktop).

**Powiazania:** ADR-0072 (at-rest SQLite - komplementarny), `userApiKeys.ts` (wzorzec aes-gcm), Konstytucja Art. 5 (tajemnica) / Art. 7 (minimalizacja/bezpieczenstwo), AI Act art. 12. Spec: `.matematic/spec/005-field-level-encryption/`.
