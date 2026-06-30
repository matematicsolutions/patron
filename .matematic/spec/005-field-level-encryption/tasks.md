# Tasks: Field-level encryption wrazliwych kolumn

Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (rozne pliki, bez zaleznosci).

> **GATE PRZED IMPLEMENTACJA:** sign-off WM na Q1 (zrodlo KEK serwer), Q2 (lista pol),
> Q3 (migracja), Q4 (format ciphertext). Krypto = wysokie ryzyko: NIE zaczynac kodu
> bez rozstrzygnietych open questions. Po implementacji: security-review + 2x review.

## Phase 0 - Research / decyzje (BLOKUJE)
- [ ] T000 Rozstrzygnac punkt wpiecia (A shim-seam `ENCRYPTED_COLUMNS` vs B per-feature) + interakcja z `JSON_COLUMNS` (kolejnosc: encrypt po serializacji JSON, decrypt przed parse). Zapisac w plan.md research.
- [ ] T001 Sign-off WM: Q1-Q4 (+Q5 audit_log NIE, +Q6 backup KEK). Bez tego Phase 2 stoi.

## Phase 1 - Setup
- [ ] T002 Branch `005-field-level-encryption` off `release/v1.0.0-prep`
- [ ] T003 ADR-0138 (juz jest, Proponowany) -> uzupelnic decyzje z T000/T001

## Phase 2 - Foundational (BLOKUJE US1) - atomowa
- [ ] T010 [P] `backend/src/lib/crypto/field-crypto.ts`: `encryptField/decryptField` AES-256-GCM, format wersjonowany (prefix `v1:`), per-wartosc iv+auth_tag. Wzorzec z `userApiKeys.ts`.
- [ ] T011 [P] `backend/src/lib/crypto/field-crypto.test.ts`: round-trip, tamper (auth_tag rzuca), pusty/null, determinizm formatu.
- [ ] T012 `backend/src/lib/crypto/dek.ts`: KEK loader (desktop `PATRON_DB_ENCRYPTION_KEY`/keychain + serwer env Q1), DEK generate/wrap/unwrap, cache w pamieci, fail-loud bez KEK gdy `PATRON_FIELD_ENCRYPTION=on`.
- [ ] T013 `backend/src/lib/db/schema.sqlite.ts`: tabela `encryption_keys` (create-if-not-exists).
- [ ] T014 [P] `backend/schema.sql`: tabela `encryption_keys` (Postgres, lustro).
- [ ] T015 [P] `backend/migrations/0NN_encryption_keys.sql` (Postgres UP/DOWN).
- [ ] T016 `backend/src/lib/crypto/dek.test.ts`: wrap/unwrap round-trip, fail-loud bez KEK, DEK owiniety (nie goly) w bazie, cache.

**Checkpoint:** warstwa krypto + tabela kluczy + envelope dziala i jest otestowana, BEZ wpiecia w zadna kolumne produkcyjna (samodzielnie weryfikowalny fundament). Default OFF.

## Phase 3 - US1 (P1, MVP) pilot 1 kolumna
- [ ] T020 [US1] Wpiecie szyfrowania `mutation_approvals.tool_payload` wg decyzji T000 (seam shim `ENCRYPTED_COLUMNS` albo lib). Encrypt przy zapisie, decrypt przy odczycie, tylko gdy flaga ON.
- [ ] T021 [US1] Test integracyjny: flaga ON -> wartosc w bazie ciphertext, odczyt = plaintext; flaga OFF -> plaintext; bez KEK -> fail-loud; round-trip przez stage/getPending (reuzyc fixture 004).
- [ ] T022 [US1] Regresja: suite 004 (mutation-approval) zielona z flaga ON i OFF.

**Checkpoint:** 1 kolumna realnie szyfrowana end-to-end, reszta nietknieta. US1 deployowalne jako pilot.

## Phase 4 - US2 (P2) pelna lista + migracja
- [ ] T030 [US2] `ENCRYPTED_COLUMNS` += lista z Q2 (document_edits text, chat_messages.content, ...).
- [ ] T031 [US2] `backend/scripts/encrypt-backfill.ts`: migracja istniejacych wierszy (idempotentna - marker wersji rozroznia legacy-plaintext od ciphertext; DOWN decrypt). Strategia wg Q3.
- [ ] T032 [US2] Testy migracji: backfill encrypt, idempotencja (drugi przebieg no-op), DOWN decrypt, mieszane wiersze legacy+ciphertext czytane poprawnie.

## Phase 5 - US3 (P3) serwer per-tenant + audyt
- [ ] T040 [US3] DEK per `organization` (serwer); desktop dalej 1 DEK (LOCAL_USER_ID).
- [ ] T041 [US3] event_type `encryption.key.access` (5 mirrorow wg connector.toggle/ADR-0133) - dostep/rotacja klucza w hash-chain (AI Act art. 12).
- [ ] T042 [US3] Rotacja KEK = re-wrap wszystkich DEK (bez re-encrypt pol); skrypt + test.

## Phase N - Polish / bramki
- [ ] T050 [P] `security-review` skill na pelnym diffie krypto (obowiazkowy - bramka jakosci konstytucji).
- [ ] T051 [P] `matematic-patron-pr-review-pl` na pelnym diffie.
- [ ] T052 CHANGELOG + AGENTS.md (regula kodu field-encryption) + ADR-0138 -> Przyjety (po 2x review + WM) + bump Konstytucji (nowa zasada bezpieczenstwa = MINOR, lub event_type US3).
- [ ] T053 Doc: procedura backupu/utraty KEK dla Operatora (Q6) w IMPLEMENTATION_PLAYBOOK.

## Parallel Opportunities
T010+T011 razem; T014+T015 obok T013; T050+T051 na koncu. Phase 2 atomowa (cala albo nic, jak Phase 2 spec 004).
