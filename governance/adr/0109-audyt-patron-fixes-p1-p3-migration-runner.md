# ADR-0109: Audyt PATRON - domkniecie usterek P1-P3 + runner migracji SQLite

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3` (off `feat/tier-governance-envelope`), NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt techniczny builda u pilotki (Rumpole) - `AUDYT_PATRON.md` + `RAPORT_CTO_PATRON.md`. Niniejsze ADR pokrywa podzbior usterek o najlepszym stosunku wartosci do ryzyka; wieksze inicjatywy (at-rest native, maskowanie nazwisk, dyski zewnetrzne) - osobne ADR.

## Kontekst

Audyt zidentyfikowal usterki w warstwie danych SQLite, retrievalu i routes. Z listy P1-P3 wybrano do tej iteracji te bounded i testowalne bez nowych zaleznosci natywnych ani zmian behawioralnych egressu:

- **P1 #2** - zwykle `DELETE` dokumentu/sprawy zostawialo dane: tabele retrievalu/grafu (`doc_chunks`/`vec_chunks`/`doc_chunks_fts`/`extracted_entities`/`citation_graph`/`events`) NIE maja FK do `documents`, a route'y nie wolaly `clearDocumentIndex`. `DELETE /projects/:id` dodatkowo zostawial pliki na dysku, wektory, encje PII i pamiec "brain". Tylko swiadome "RODO - zapomnij sprawe" (`forgetCase`, ADR-0061) bylo kompletne.
- **P1 #3** - `CHECK (provider in ('claude','gemini','openai'))` blokowal zapis wlasnego klucza OpenRouter z UI (warstwa `userApiKeys.ts` obsluguje `openrouter`). SQLite nie zmienia CHECK przez `ALTER` - wymaga rebuildu tabeli.
- **P2 #7** - desktop nie mial runnera migracji (`migrations/*.sql` ida tylko na Postgres), upgrade'y robil ad-hoc `ensureSchemaUpgrades` (tylko `ALTER ADD COLUMN`). Zmiany CHECK/FK byly niewykonalne.
- **P3 #12** - brak `busy_timeout`/`synchronous` pod WAL -> ryzyko `SQLITE_BUSY` przy zapisie indeksera/Merkle w tle.
- **P3 #13** - `clearDocumentIndex` czyscil graf tylko po `from_doc_id` -> krawedzie przychodzace (`to_doc_id`) i odwolujace sie do encji dokumentu (`to_entity_id`) osierocone.
- **P3 #16** - `getExtractor` cache'owal odrzucony promise -> nieudany pierwszy load modelu = martwy embedder do restartu procesu.

## Decyzja

1. **Runner migracji SQLite (P2 #7)** - nowy `lib/db/migrate.sqlite.ts`: wersjonowany po `PRAGMA user_version`, kroki `1..N` aplikowane w transakcji wraz z bumpem wersji, idempotentny, kazdy krok dodatkowo samo-pomijalny (guard). Wpiety w `getDb()` po `ensureSchemaUpgrades`, przed warstwa retrievalu. NIE zastepuje `ensureSchemaUpgrades` (proste `ADD COLUMN`) - dziala obok, dla zmian ktorych `ALTER` nie obsluguje (rebuild pod CHECK/FK).
2. **OpenRouter w CHECK (P1 #3)** - migracja v1 rebuilduje `user_api_keys` z `openrouter` w CHECK (nowa tabela -> kopia -> drop -> rename -> indeks); `schema.sqlite.ts` (source of truth dla swiezych baz) zaktualizowany rownolegle.
3. **Szczelne kasowanie (P1 #2)** - `DELETE /projects/:id` wola `forgetCase` (zachowany owner-only auth-check, 404 dla cudzej sprawy); `DELETE /single-documents/:id` wola `clearDocumentIndex` (tryb sqlite). Pamiec "brain" jest per-sprawa, wiec nie ruszana przy kasowaniu pojedynczego dokumentu.
4. **PRAGMA (P3 #12)** - `busy_timeout = 5000` + `synchronous = NORMAL` (bezpieczne i zalecane pod WAL).
5. **Graf obukierunkowo (P3 #13)** - `clearDocumentIndex` kasuje krawedzie po `to_doc_id` oraz po `to_entity_id` encji dokumentu (przed usunieciem encji).
6. **Embedder (P3 #16)** - `getExtractor` zeruje `extractorPromise` przy bledzie ladowania (retry bez restartu).

## Co NIE jest objete (osobne ADR / decyzja Operatora)

- **P1 #1 (at-rest)** - kod jest gotowy i fail-loud (`applyEncryptionKey`, ADR-0072); brakuje podmiany sterownika `better-sqlite3` -> `better-sqlite3-multiple-ciphers` + klucz z Electron `safeStorage`. To zadanie infra/packaging (kompilacja natywna + strona desktop) - osobny PR, weryfikacja na realnym buildzie.
- **P1 #4 (maskowanie nazwisk)** - wpiecie lokalnego detektora PERSON/ORG w egress (`wrapConversation`) to zmiana behawioralna sciezki do chmury; wymaga ADR (domkniecie ADR-0067) + testow regresyjnych PL. Osobno.
- Inicjatywy CTO A-H (dyski zewnetrzne, sejf przenośny, OCR domyslny, panel stanu) - roadmapa, wlasne specyfikacje.

## Konsekwencje

- (+) Po "normalnym" skasowaniu sprawy/dokumentu z UI nie zostaja osierocone akta, embeddingi ani encje PII na maszynie - domkniecie RODO art. 17 dla zwyklej sciezki, nie tylko trybu "zapomnij".
- (+) Wlasny klucz OpenRouter zapisuje sie z UI (bezposrednio dotyka biezacego problemu pilotki z OpenRouterem).
- (+) Schemat SQLite ma odtad wykonalna sciezke zmian CHECK/FK (rebuild przez runner) zamiast tylko `ADD COLUMN`.
- (+) Mniej `SQLITE_BUSY`; embedder odporny na nieudany pierwszy load.
- (-) `forgetCase` przy `DELETE /projects/:id` jest ciezszy (czysci wszystkie magazyny) - akceptowalne; kasowanie sprawy nie jest sciezka goraca.
- **Audit:** `audit_log` nietkniety przez forgetCase (RODO art. 17 ust. 3 lit. b + AI Act art. 12).
- **Testy:** 1123 pass / 0 fail / 5 todo; TSC clean. Nowy `migrate.sqlite.test.ts` (5 testow: kolejnosc, idempotencja, selekcja po user_version, rebuild CHECK z zachowaniem danych, samo-pomijalnosc).
