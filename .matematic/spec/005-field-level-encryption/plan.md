# Plan: Field-level encryption wrazliwych kolumn

**Spec:** [spec.md](./spec.md) | **ADR:** 0138 | **Project Type:** agent-product / web-app

## Technical Context
- **Language:** TypeScript (backend Node). Brak zmian frontendu w MVP (transparentne w warstwie db).
- **Crypto:** Node `crypto` AES-256-GCM (reuzyc wzorzec `backend/src/lib/userApiKeys.ts`: iv 12B, auth_tag, key = sha256(secret)). Zero nowych zaleznosci krypto.
- **DB:** dual - SQLite (desktop, `LOCAL_USER_ID`) + Postgres (serwer, multi-tenant). Warstwa app = driver-agnostic (dziala w obu, inaczej niz ADR-0072 PRAGMA key SQLite-only).
- **Klucze:** KEK desktop = `PATRON_DB_ENCRYPTION_KEY`/keychain (model ADR-0072); KEK serwer = env secret (Q1). DEK 256-bit owiniety KEK w `encryption_keys`.
- **Testing:** backend vitest (round-trip, tamper, fail-loud, migracja). Brak runnera frontendu (nie dotyczy MVP).
- **Constraints:** RODO-safe; fail-loud bez KEK (jak atrest); zero regresji przy fladze OFF; NIE szyfrowac kolumn wyszukiwanych/indeksowanych/audytu.

## Constitution Check (GATE - musi przejsc przed implementacja)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | RODO-safe, tajemnica = rdzen PATRONa; fosa sprzedazowa |
| Konstytucja Art. 5 (tajemnica) | PASS | podnosi poufnosc danych objetych tajemnica |
| Konstytucja Art. 7 (minimalizacja/bezpieczenstwo) | PASS | bezpieczenstwo przetwarzania; payload audytu nadal PII-free |
| AI Act art. 12 (record-keeping) | PASS (US3) | event_type dostepu/rotacji klucza w hash-chain |
| Bramka licencji | PASS | inspiracja open-mercato (MIT), zero portu; Node crypto stdlib; powloka AGPL |
| Bramka ToS / anty-OS | PASS | brak omijania ToS; wlasna implementacja |
| Bramka jakosci | PASS (warunkowo) | krypto = wysokie ryzyko -> wymaga: pilot 1 kolumna, fail-loud, testy round-trip+tamper+migracja, security-review, 2x review przed merge |
| Bramka strategii | PASS | druga glowa "wiekszej aktualizacji"; rozniconik "nawet my nie odczytamy akt bez waszego klucza" |
| **NIE-duplikacja ADR-0072** | PASS | inna warstwa (field vs whole-file), inny backend zasieg (dual vs SQLite), inny model zagrozen (dostep-bez-KEK vs skradziony dysk) |

GATE: brak FAIL. Warunkowy PASS jakosci -> Phase Foundational atomowa + security-review obowiazkowy przed merge.

## Struktura zmian (mapa plikow - z reconu 2026-06-29)

**Faza 2 Foundational (BLOKUJE US1) - atomowa:**
- `backend/src/lib/crypto/field-crypto.ts` (NOWY) - `encryptField/decryptField` (AES-256-GCM, format wersjonowany), czyste funkcje. Wzorzec z `userApiKeys.ts` (encrypt/decrypt).
- `backend/src/lib/crypto/dek.ts` (NOWY) - KEK loader (desktop env/keychain + serwer env), DEK provisioning (generate/wrap/unwrap), cache DEK w pamieci. Fail-loud bez KEK gdy flaga ON.
- `backend/src/lib/db/schema.sqlite.ts` - tabela `encryption_keys` (create-if-not-exists, auto-upgrade).
- `backend/schema.sql` - tabela `encryption_keys` (Postgres, lustro).
- `backend/migrations/0NN_encryption_keys.sql` (Postgres UP/DOWN) - tworzy `encryption_keys`. (SQLite: nowa tabela = auto przez SQLITE_SCHEMA, bez rebuildu - nie zmienia CHECK.)
- (BEZ nowego event_type w MVP - dochodzi w US3.)

**Faza 3 US1 (pilot 1 kolumna):**
- Warstwa odczytu/zapisu kolumny `mutation_approvals.tool_payload` przez `field-crypto` gdy `PATRON_FIELD_ENCRYPTION=on`. Punkt wpiecia: `backend/src/lib/mutation-approval.ts` (stage/get) lub - czysciej - seam w `supabase-shim` per-kolumna (jak `JSON_COLUMNS` -> `ENCRYPTED_COLUMNS`). DECYZJA w research: shim-seam = transparentne dla wszystkich callerow (preferowane), ale dotyka krytycznej warstwy db -> testy.
- Testy: `field-crypto.test.ts` (round-trip/tamper), `dek.test.ts` (wrap/unwrap/fail-loud), integracja pilot.

**Faza 4 US2 (rozszerzenie + migracja):**
- `ENCRYPTED_COLUMNS` rozszerzone o liste z Q2; `backend/scripts/encrypt-backfill.ts` (migracja istniejacych wierszy, idempotentna, DOWN decrypt); marker wersji per-wartosc (rozroznia legacy-plaintext od ciphertext).

**Faza 5 US3 (serwer per-tenant + audyt):**
- DEK per `organization` (serwer); event_type `encryption.key.access` (5 mirrorow wg connector.toggle); rotacja KEK = re-wrap.

## Decyzja architektoniczna do rozstrzygniecia w research (Phase 0)
**Punkt wpiecia szyfrowania:** (A) seam w `supabase-shim` (`ENCRYPTED_COLUMNS` jak `JSON_COLUMNS`, encrypt przy zapisie / decrypt przy odczycie per-kolumna - transparentne, jeden punkt, ale dotyka krytycznej warstwy + interakcja z `JSON_COLUMNS`) vs (B) jawne encrypt/decrypt w warstwach lib per-feature (wiecej kodu, ale lokalne i czytelne). Rekomendacja wstepna: (A) dla spojnosci, z mocnymi testami. Rozstrzygnac przed US1.

## Research notes
Inspiracja: open-mercato per-tenant DEK + field-level encryption (envelope). Adaptacja: PATRON dual-backend -> warstwa app zamiast DB-native (pgcrypto/SQLCipher per-pole); reuzycie `userApiKeys.ts` aes-gcm; KEK z modelu ADR-0072 (desktop) + env (serwer). Trade-off searchability = powod selektywnosci (recon: `doc_chunks`/`extracted_entities` indeksowane -> wykluczone).
