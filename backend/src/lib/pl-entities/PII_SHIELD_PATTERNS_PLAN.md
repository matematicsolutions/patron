# PII_SHIELD_PATTERNS_PLAN.md - design doc dla cherry-picku do pl-entities/

**Status**: UNCOMMITTED design doc, NIE rusza kodu
**Data**: 2026-05-21
**Powiazane**: [governance/adr/0013-pii-shield-patterns-cherry-pick.md](../../../../governance/adr/0013-pii-shield-patterns-cherry-pick.md)
**Decyzja oczekiwana**: Wieslaw + wewnetrzny review 2x runda PRZED dotknieciem production code

## Cel

Konkretyzacja ADR-0013 z proponowanymi nazwami plikow + sygnaturami funkcji + planem testow. Czyta sie ten dokument PRZED otwarciem PR. Po wewnetrzny review 2x runda i akceptacji - implementacja per pattern w izolacji.

## Obecny stan pl-entities/ (chronione)

```
backend/src/lib/pl-entities/
  checksums.ts        - PESEL (wagi 1-3-7-9), NIP (mod 11), REGON, IBAN PL
  checksums.test.ts   - testy regression
  gazetteers/         - foldery gazetteer (sady-pl, sygnatury-prefix, imiona-pl)
  gazetteers.ts       - loader gazetteer
  gazetteers.test.ts  - testy gazetteer
  index.ts            - public API
  regex.ts            - regex pattern recognizers (uzywa pola `baseConfidence`)
  regex.test.ts       - testy regex
  types.ts            - typy
```

**44 testy pass** (z sesja 2026-05-21 (6 ADR)). **Bramka**: cale test suite musi nadal pass po kazdym patternu.

## Plan implementacji per pattern (T1-T5)

### T1 (3h): Patterny 1, 2, 5 (priorytet 1)

#### Pattern 1: TTL mapping cleanup

**Nowe pliki**:
- `backend/src/lib/pl-entities/mapping-store.ts` - in-memory + Postgres fallback z `expires_at`
- `backend/src/lib/pl-entities/mapping-store.test.ts` - testy TTL expired -> deleted
- `backend/db/migrations/NNNN_add_pseudonim_mappings_ttl.sql` - migracja schema

**Schema migration** (Postgres) - default TTL liczy aplikacja, nie DB,
zeby per-kancelaria policy mogla dziwic wartosc bez `ALTER COLUMN`:

```sql
-- migrations/NNNN_add_pseudonim_mappings_ttl.sql
ALTER TABLE pseudonim_mappings
ADD COLUMN expires_at TIMESTAMPTZ NOT NULL;
-- BEZ DEFAULT - aplikacja MUSI wyliczyc expires_at = NOW() + INTERVAL
-- ('pseudonim_mapping_ttl_days' z kancelaria_policy) PRZED insertem.

CREATE INDEX idx_pseudonim_mappings_expires_at
  ON pseudonim_mappings (expires_at)
  WHERE expires_at < NOW();

-- Policy per kancelaria - source of truth dla TTL
CREATE TABLE IF NOT EXISTS kancelaria_policy (
  kancelaria_id UUID PRIMARY KEY,
  pseudonim_mapping_ttl_days INTEGER NOT NULL DEFAULT 7,
  CHECK (pseudonim_mapping_ttl_days BETWEEN 1 AND 730)
);
```

W `MappingStore.store()` (linia ponizej): `expires_at = now + (policy.pseudonim_mapping_ttl_days * dni)`. Jezeli `kancelaria_policy` brak wpisu, fallback do 7 dni (zakodowany w aplikacji jako `DEFAULT_TTL_DAYS = 7`).

**API surface**:
```ts
// backend/src/lib/pl-entities/mapping-store.ts
export interface MappingRecord {
  session_id: string;        // ULID
  doc_id: string;            // ULID per dokument
  placeholders: Map<string, string>;  // [OSOBA_1] -> "Jan Kowalski"
  created_at: Date;
  expires_at: Date;
  source_hash: string;       // sha256:... (pattern 2)
}

export class MappingStore {
  constructor(private db: PostgresClient, private kancelariaId: string) {}

  async store(record: MappingRecord): Promise<void>;
  async get(sessionId: string): Promise<MappingRecord | null>;
  async cleanupExpired(): Promise<{ removed: number; reclaimed_bytes: number }>;
}
```

**Testy**:
- TTL nie wygasl -> mapping zwrócony
- TTL wygasl -> mapping = null + cleanupExpired() usuwa
- Konfiguracja `pseudonim_mapping_ttl_days` per kancelaria
- 44 testy regression nadal pass

#### Pattern 2: source_hash per dokument

**Rozszerzenie istniejacego**: `mapping-store.ts` ma juz `source_hash` w `MappingRecord` (pattern 1 nizej). Dodatkowy helper:

**Nowe pliki**:
- `backend/src/lib/pl-entities/hash-document.ts` - sha256 bajtow oryginalnego pliku
- `backend/src/lib/pl-entities/hash-document.test.ts`

**API surface**:
```ts
// backend/src/lib/pl-entities/hash-document.ts
import { createHash } from "node:crypto";

export function hashDocument(bytes: Buffer): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

export async function hashFile(path: string): Promise<string> {
  const stream = createReadStream(path);
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return "sha256:" + hash.digest("hex");
}
```

**Integracja**: pipeline upload Patrona wolaja `hashFile()` przed pseudonimizacja, zapisuje w `MappingRecord.source_hash`.

**Testy**:
- Identyczne pliki -> identyczny hash (determinizm)
- Streaming dla duzych plikow (>100 MB) nie OOM

#### Pattern 5: pseudonim_audit.log plain-text

**Nowe pliki**:
- `backend/src/lib/pl-entities/audit-log.ts` - osobny logger plain-text dla Inspektora
- `backend/src/lib/pl-entities/audit-log.test.ts`

**API surface**:
```ts
// backend/src/lib/pl-entities/audit-log.ts
export interface AuditLogEvent {
  event: "pseudonim-applied" | "llm-call-out" | "llm-call-in"
       | "mapping-stored" | "docx-generated" | "mapping-cleanup";
  doc_id?: string;
  source_hash?: string;
  entities?: Record<string, number>;  // {OSOBA: 3, PESEL: 1, NIP: 2}
  pii_count?: number;                 // dla llm-call-out: liczba PII w prompcie (POWINNO byc 0); snake_case zgodnie z konwencja
  bytes_in?: number;
  bytes_out?: number;
  expires_at?: Date;
  removed_sessions?: number;
}

export class PseudonimAuditLog {
  constructor(private logPath: string) {}

  async append(event: AuditLogEvent): Promise<void>;

  // Walidacja krytyczna: rzuca jezeli pii_count > 0 na llm-call-out
  async appendLLMCallOut(promptText: string, placeholders: Map<string, string>): Promise<void> {
    const piiCount = detectResidualPII(promptText, placeholders);
    if (piiCount > 0) {
      throw new ResidualPIIError(`prompt zawiera ${piiCount} PII po pseudonimizacji - LLM call ZATRZYMANY`);
    }
    await this.append({
      event: "llm-call-out",
      bytes_out: Buffer.byteLength(promptText, "utf8"),
      pii_count: 0,
    });
  }
}
```

**Format pliku** (czytelny dla Inspektora bez narzedzi):
```
2026-05-21T18:42:13Z | pseudonim-applied | doc_id=01HXY... | source_hash=sha256:abc... | entities={OSOBA:3,PESEL:1,NIP:2} | bytes_in=12450 | bytes_out=12180
2026-05-21T18:42:14Z | llm-call-out | bytes_out=8200 | pii_count=0
...
```

**Lokalizacja**: `/var/lib/patron/audit/pseudonim_audit.log` (rotated daily, retencja **do walidacji T1** - AI Act art. 12 (CELEX [32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689)) nie precyzuje liczby lat; ADR-0006 ustala wlasny okres retencji audit bundle Patrona - synchronizujemy `pseudonim_audit.log` do tej samej polityki).

**Testy**:
- Linia zapisana z poprawnym formatem
- `appendLLMCallOut()` rzuca przy PII residual
- Rotation dziala (testowo: log > N MB -> nowy plik)

### T2 (2h): Pattern 3 (session_id w docx custom properties)

**Nowe pliki**:
- `backend/src/lib/docx-session-tagging.ts` (w `backend/src/lib/`, nie pl-entities/ - to integracja docx)
- `backend/src/lib/docx-session-tagging.test.ts`

**API surface**:
```ts
// backend/src/lib/docx-session-tagging.ts
import { Document, CustomProperties } from "docx";

export interface SessionTag {
  session_id: string;       // ULID
  tool_version: string;     // "patron@v1.2.0"
  timestamp: string;        // ISO8601
  kancelaria_id: string;    // UUID
}

export function embedSessionTag(doc: Document, tag: SessionTag): Document {
  // dodaj custom properties:
  // - PatronSessionId
  // - PatronToolVersion
  // - PatronTimestamp
  // - PatronKancelariaId
}

export function readSessionTag(docxPath: string): SessionTag | null {
  // czyta custom properties z pliku .docx
}
```

**Integracja**: generator pism / raportow / audit bundle Patrona wola `embedSessionTag()` przed zapisem.

**Testy**:
- Tag zapisany w custom properties
- Tag odczytany z pliku po zapisie (round-trip)
- Pliki bez tagu zwracaja `null`

### T3 (2h): Pattern 4 (AES-GCM session archive)

**Nowe pliki**:
- `backend/src/lib/pl-entities/portability.ts` - eksport/import sesji szyfrowany
- `backend/src/lib/pl-entities/portability.test.ts`
- `backend/scripts/pseudonim-export.ts` - CLI
- `backend/scripts/pseudonim-import.ts` - CLI

**API surface**:
```ts
// backend/src/lib/pl-entities/portability.ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export interface SessionArchiveManifest {
  session_id: string;
  exported_at: Date;
  tool_version: string;
  documents: Array<{ doc_id: string; source_hash: string }>;
  schema_version: number;
}

export async function exportSession(
  sessionId: string,
  password: string,
  outputPath: string
): Promise<SessionArchiveManifest>;

export async function importSession(
  archivePath: string,
  password: string,
  targetDb: PostgresClient
): Promise<SessionArchiveManifest>;
```

**Algorytm** (zgodnie z PII-Shield pattern):
1. Pobierz mapping sesji z DB
2. Serializuj do JSON
3. Derive key: `scryptSync(password, salt, 32)` z `salt = randomBytes(16)`
4. Encrypt: AES-256-GCM z `iv = randomBytes(12)`
5. Zapisz: `{salt, iv, ciphertext, auth_tag, manifest}` jako `.tar.gz`

**Walidacja sily hasla**: zxcvbn minimum score 3 (skala 0-4, gdzie 3 = "safely unguessable: moderate protection from offline slow-hash scenario"; zrodlo: dokumentacja [zxcvbn](https://github.com/dropbox/zxcvbn#usage)). Score 4 podnosi friction przy ustalaniu hasla bez znaczacego zysku w kontekscie sesji szyfrowanej kluczem scrypt-derived (rate-limiting i scrypt N=2^15 zalatwiaja reszte). Wartosc do re-walidacji w T3.

**Testy**:
- Export -> import na tej samej DB = round-trip OK
- Zle haslo = blad rozszyfrowania (auth_tag check)
- Slabe haslo = blad walidacji (zxcvbn score < 3)
- Manifest poprawny

### T4 (1.5h): Drugi tier (patterny 6, 7)

**Pattern 6: context boost**
- Modyfikacja `backend/src/lib/pl-entities/regex.ts` - dodaj `contextWords` per recognizer
- Funkcja `applyContextBoost(detections, text, window=200)`:
  ```ts
  if (entity.type === "PERSON") {
    if (/Pan|Pani|Klient|Strona|Pelnomocnik/i.test(textNear(entity, 200))) {
      entity.score += 0.35;
    }
  }
  ```

**Pattern 7: `verified: boolean` flag**
- Modyfikacja `backend/src/lib/pl-entities/types.ts` - dodaj `verified: boolean` w `DetectedEntity`
- Po checksum walidacji (PESEL/NIP/REGON/IBAN) ustaw `verified = true`

**Testy regression**: 44 testy pl-entities + nowe testy context boost + verified flag.

### T5 (1.5h, opcjonalny): Refactor architektury `RecognizerDef`

**Tylko jezeli explicit zatwierdzony przez Wieslawa** - refactor `regex.ts` + `gazetteers.ts` pod jednolity interface:

```ts
// proponowany interface
interface RecognizerDef {
  entityType: EntityType;
  patterns: PatternDef[];
  context: string[];
  checksumValidator?: (match: string) => boolean;
}

// rejestr recognizerow - score'y poprzedzic prefix "do walidacji T5"
// wzgledem `baseConfidence` z obecnego pl-entities/regex.ts (NIE hard-coded
// w przykladzie, tylko ilustracja kontraktu interfejsu).
const POLISH_RECOGNIZERS: RecognizerDef[] = [
  { entityType: "PESEL", patterns: [{ regex: /\d{11}/, score: /* do walidacji T5 vs regex.ts */ 0.6 }], context: ["PESEL", "nr"], checksumValidator: validatePeselChecksum },
  { entityType: "NIP", patterns: [{ regex: /\d{10}/, score: /* do walidacji T5 vs regex.ts */ 0.5 }], context: ["NIP", "podatnik"], checksumValidator: validateNipChecksum },
  // ...
];
```

Blast-radius: cala biblioteka `regex.ts` (~500 lin?) i `gazetteers.ts` - **wymaga wewnetrzny review 2x runda + Wieslaw decyzja**.

## Bramki implementacji (kolejnosc commitow)

Kazdy pattern = **osobny commit + osobny wewnetrzny review 2x runda**. Sekwencja:

1. **T1.1 Pattern 1 (TTL)** - commit, wewnetrzny review, push (3 testy: TTL nie wygasl / TTL wygasl / cleanup)
2. **T1.2 Pattern 2 (source_hash)** - commit, wewnetrzny review, push (2 testy: determinizm + streaming)
3. **T1.3 Pattern 5 (audit log)** - commit, wewnetrzny review, push (3 testy: format + walidacja PII residual + rotation)
4. **T2 Pattern 3 (docx session_id)** - commit, wewnetrzny review, push (3 testy: zapis + odczyt + null)
5. **T3 Pattern 4 (AES-GCM archive)** - commit, wewnetrzny review, push (4 testy: round-trip + zle haslo + slabe haslo + manifest)
6. **T4 Patterny 6-7 (drugi tier)** - commit, wewnetrzny review, push (testy regression + nowe)
7. **T5 Refactor (opcjonalny)** - commit, wewnetrzny review 2x runda PELNY przeglad, push (44 testy regression + reorganizacja)

## Estymacja calkowita

- T1: 3h dev (3 commity)
- T2: 2h dev (1 commit)
- T3: 2h dev (1 commit + 2 CLI scripty)
- T4: 1.5h dev (1 commit)
- T5: 1.5h dev (1 commit, opcjonalny)

**Total: 10h dev** rozlozone na **2-3 sesje**, z wewnetrzny review 2x runda kazda. Bramka jakosci: 44 testy pl-entities nadal pass po kazdym commicie.

## Atrybucja

Patterny operacyjne 1-5 (TTL mapping cleanup / source_hash / session_id w docx / AES-GCM archive / audit log) sa cherry-pick z [gregmos/PII-Shield](https://github.com/gregmos/PII-Shield) (MIT, snapshot 2026-05-21, autor Grigorii Moskalev - Microsoft Presidio team).

Patterny drugiego tieru 6-7 (context boost + verified flag) i 9 (refactor RecognizerDef) sa portowane z Microsoft Presidio (referencja architektoniczna PII-Shield).

Implementacja Patrona: **napisana od zera** pod schema Postgresa Patrona, hash-chain ADR-0001, polskie PII (PESEL/NIP/REGON/IBAN PL), Konstytucja v1.1.1 (vendor-neutrality, lokalnosc, audytowalnosc). NIE jest to fork ani port.

Wpis do `THIRD_PARTY_INSPIRATIONS.md` przy pierwszym commicie patternu (T1.1):

```markdown
### gregmos/PII-Shield (MIT)

Snapshot 2026-05-21 (v2.0.2, autor Grigorii Moskalev - Microsoft Presidio team).
5 patternow operacyjnych cherry-pick do **ADR-0013 PII-Shield patterns**:
TTL mapping cleanup, source_hash per dokument, session_id w docx custom
properties, AES-GCM session archive, plain-text pseudonim_audit.log dla
Inspektora. NIE forkujemy kodu - implementacja Patrona przepisana od zera
pod schema Postgresa, polskie PII (PESEL/NIP/REGON/IBAN PL), hash-chain
ADR-0001. GLiNER/ONNX/MCP-server architecture NIE adoptowane (respektowanie
ADR-0008 zero-LLM przy zapisie).
```

## Decyzja oczekiwana od Wieslawa (przed implementacja)

1. **Czy idziemy z T1 (3h, patterny 1+2+5)** w najblizszej sesji jako szybki win - **niezalezne** od reszty Patrona, daje audit-friendly proof "no PII leaves"?
2. **T2 + T3 (4h razem)** - w tej samej sesji czy osobno? Pattern 3 (docx session_id) jest user-facing (otwiera workflow "reopen-session"), Pattern 4 (AES-GCM archive) jest niche (transfer miedzy maszynami).
3. **T4 (1.5h)** - patterny drugiego tieru. Wzgledne pominiecie nie boli, ale dodanie context boost potencjalnie zwieksza recall dla PERSON entities (ktore sa najbardziej miekkie).
4. **T5 (1.5h, opcjonalny)** - refactor architektury RecognizerDef ma blast-radius cale `pl-entities/`. Tylko jezeli dosc czasu na pelny wewnetrzny review 2x runda + Wieslaw weryfikacja diff'u.
5. **wewnetrzny review 2x runda** PRZED kazdym commitem patternu (zgodnie z 2x runda wewnetrznego review tresci - po kazdym, nie zbiorczy na koniec).

Po Twoim decyzji - **otwieram osobna sesje** na implementacje, nie tej (zbyt wiele faz juz, zbyt dlugi context).
