# Feature: Field-level encryption wrazliwych kolumn (per-tenant DEK)

**Branch:** `005-field-level-encryption` (off `release/v1.0.0-prep`) - DO UTWORZENIA po sign-off WM
**Date:** 2026-06-29
**Status:** Draft (czeka na sign-off WM: zrodlo KEK serwer, zakres pol, migracja)
**Project Type:** `agent-product` / `web-app` (backend dual SQLite+Postgres)
**ADR:** [0138](../../../governance/adr/0138-field-level-encryption-per-tenant-dek.md)

## Problem statement

Tekst niosacy tajemnice adwokacka i PII (tresc edycji dokumentu, historia czatu, payloady kart, nazwy plikow) lezy w bazie w plaintext. ADR-0072 (at-rest, caly plik SQLite) chroni przed skradzionym dyskiem, ale: nie dziala na Postgres (serwer), jest wszystko-albo-nic i nie chroni przed dostepem do bazy z kluczem at-rest (DBA, backup, kompromitacja serwera). Cel: zaszyfrowac NA POZIOMIE POLA wybrane wrazliwe kolumny kluczem danych (DEK) owinietym kluczem glownym (KEK), tak by dane byly nieczytelne przy dostepie do bazy bez KEK - w OBU backendach. RODO art. 32 + tajemnica.

## Granica (twarda)

| Co | Decyzja |
|---|---|
| Field-level encryption kolumn czytanych w calosci (envelope DEK/KEK, AES-256-GCM) | ✅ rdzen |
| Dual backend SQLite (desktop) + Postgres (serwer) | ✅ (warstwa app, driver-agnostic) |
| Defense-in-depth nad ADR-0072 (desktop) / podstawa (serwer) | ✅ - NIE duplikuje at-rest |
| Szyfrowanie `doc_chunks.content`+embeddings (retrieval FTS5/vec) | ❌ zabija wyszukiwanie |
| Szyfrowanie `extracted_entities.value_normalized` (indeks lookup) | ❌ zabija indeks encji |
| Szyfrowanie `audit_log.payload` | ❌ zaprojektowany PII-free; lamie weryfikowalnosc hash-chain/Merkle |
| Szyfrowanie id/hash/timestamp/enum/FK | ❌ niepotrzebne / lamie integralnosc |
| Bajty plikow .docx/.pdf w object-storage | ❌ osobny cykl (ADR-0072 SQLite / SSE serwer) |
| Searchable / homomorphic encryption | ❌ poza zakresem |
| Rotacja DEK (re-encrypt pol) | ❌ poza MVP (re-wrap KEK tak; re-encrypt DEK pozniej) |

## User Stories

### US1 (P1, MVP) - Warstwa krypto + envelope + pilot na 1 kolumnie
**Jako** kancelaria **chce**, zeby najwrazliwsza kolumna byla zaszyfrowana kluczem, ktorego nie ma w bazie **zeby** dostep do samej bazy nie ujawnial tresci (RODO art. 32).

**Acceptance Criteria:**
- [ ] AC1.1: lib `field-crypto.ts` - `encryptField(plaintext, dek)` / `decryptField(cipher, dek)` (AES-256-GCM, per-wartosc iv+auth_tag, format wersjonowany), czyste funkcje, round-trip + tamper-detection (auth_tag).
- [ ] AC1.2: tabela `encryption_keys` (dual SQLite+Postgres): `id`, `tenant_id` (desktop=`LOCAL_USER_ID`), `wrapped_dek`, `iv`, `auth_tag`, `kek_version`, `created_at`. DEK losowy 256-bit, OWINIETY przez KEK.
- [ ] AC1.3: KEK loader - desktop z `PATRON_DB_ENCRYPTION_KEY`/keychain (reuzyc model ADR-0072), serwer z env secret. KEK NIGDY plaintext na dysku; brak KEK + `PATRON_FIELD_ENCRYPTION=on` -> fail-loud (jak atrest).
- [ ] AC1.4: DEK provisioning - przy pierwszym uzyciu generuj DEK, owin KEK, zapisz; przy odczycie odwin. Cache DEK w pamieci procesu (nie na dysku).
- [ ] AC1.5: transparent encrypt/decrypt na JEDNEJ pilotazowej kolumnie (rekomendacja: `mutation_approvals.tool_payload` - mlode dane, ja je dodalem, izolowane) w warstwie odczytu/zapisu. Default OFF (`PATRON_FIELD_ENCRYPTION`) - zero regresji.

**Independent Test:** z flaga ON: zapis -> wartosc w bazie nieczytelna (ciphertext), odczyt -> plaintext odzyskany; podmiana bajtu ciphertextu -> auth_tag rzuca; bez KEK -> fail-loud; flaga OFF -> plaintext jak dotad. DEK w `encryption_keys` jest owiniety (nie goly).

### US2 (P2) - Rozszerzenie na pelna liste pol + migracja istniejacych danych
**Jako** kancelaria **chce** objac wszystkie wrazliwe kolumny i zaszyfrowac dane juz w bazie.
**AC:** lista kolumn (sign-off WM) objeta encrypt/decrypt; skrypt migracji backfill (encrypt istniejacych wierszy) idempotentny + odwracalny (DOWN decrypt); marker per-wartosc (wersja/prefix) odrozniajacy plaintext-legacy od ciphertext (migracja lazy-or-batch).

### US3 (P3) - Per-tenant DEK na serwerze + audyt dostepu do klucza
**Jako** dostawca multi-tenant **chce** osobny DEK per kancelaria (izolacja kryptograficzna) + slad uzycia klucza.
**AC:** DEK per `organization` (serwer); event_type audytu dostepu/rotacji klucza (np. `encryption.key.access` - wg precedensu 5 mirrorow); rotacja KEK = re-wrap wszystkich DEK.

## Non-Goals
- Searchable/homomorphic encryption; szyfrowanie kolumn indeksowanych/wyszukiwanych (retrieval, encje).
- Szyfrowanie bajtow plikow w object-storage (osobny cykl).
- HSM / zewnetrzny KMS jako twardy wymog (env secret dopuszczalny w MVP serwera).
- Rotacja DEK z re-encrypt pol w MVP (tylko re-wrap KEK).

## Open Questions / NEEDS CLARIFICATION (sign-off WM)
- [ ] Q1: zrodlo KEK na SERWERZE - env secret (jak `USER_API_KEYS_ENCRYPTION_SECRET`) czy zewnetrzny KMS (AWS/GCP/Vault)?
- [ ] Q2: dokladna lista kolumn do szyfrowania (kandydaci: `document_edits.deleted_text/inserted_text`, `chat_messages.content`, `mutation_approvals.tool_payload`, `documents.filename`, `tabular_cells.content`, `document_versions.display_name`). Ktore wchodza w US2?
- [ ] Q3: strategia migracji istniejacych wierszy - lazy (encrypt przy najblizszym zapisie) vs batch backfill (skrypt jednorazowy)?
- [ ] Q4: format przechowywania ciphertextu - inline (prefix wersji + base64(iv|ct|tag) w tej samej kolumnie TEXT) vs osobne kolumny `_iv`/`_tag` (jak userApiKeys)?
- [ ] Q5: potwierdzenie ze `audit_log.payload` NIE szyfrujemy (rekomendacja: NIE - PII-free + lamie weryfikowalnosc; zamiast tego trzymac payload PII-free jak dotad).
- [ ] Q6: utrata KEK = utrata danych - jaka procedura backupu KEK po stronie Operatora (RODO art. 32 dostepnosc vs poufnosc)?
