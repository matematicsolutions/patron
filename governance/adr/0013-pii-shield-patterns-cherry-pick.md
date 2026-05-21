# ADR-0013: Cherry-pick patternow PII-Shield do pl-entities/

> **Uwaga numeracja**: pierwotnie zarezerwowany jako 0011, zmieniony na **0013** po wykryciu kolizji z rownolegla sesja (ADR-0011 span-level-offsets-column-types + ADR-0012 self-contained-viewer-html). Zgodnie z [[feedback_sesje_rownolegle_semver]] - sprawdz `git status` PRZED bumpem.

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady** (Konstytucja Patrona v1.1.1, zweryfikowane wzgledem `governance/CONSTITUTION.md`):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - patterny ze PII-Shield zachowuja zasade no-cloud (lokalne mapping store, lokalny audit log, lokalna sesja archive)
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - 3 z 5 patternow zwiekszaja audyt: source_hash + audit log + session archive
- **Art. 4 - Neutralnosc wobec dostawcow** - patterny sa technologia-agnostic (nie wiaza Patrona z konkretnym providerem LLM ani SaaS)
- **Art. 7 - Minimalnosc danych** (RODO art. 5 ust. 1 lit. c) - TTL mapping cleanup automatycznie minimalizuje retencje pseudonim-mapping (derivatu PII)
**Powiazane ADR**: ADR-0001 (hash-chain audit trail - PII-Shield audit log wzmacnia
ten sam pattern), ADR-0003 (pseudonimizacja PII pre-LLM - bezposrednio rozszerzane),
ADR-0006 (audit bundle AI Act art. 12 - session archive jako artefakt zgodnosci),
ADR-0008 (entity extraction zero-LLM - **respektowane**, NIE bierzemy GLiNER)
**Inspiracja cherry-pick**: [gregmos/PII-Shield](https://github.com/gregmos/PII-Shield)
(MIT, 92 gwiazdek, v2.0.2 z 28.04.2026, autor Grigorii Moskalev - Microsoft Presidio
team). **NIE forkujemy** - cherry-pick 5 patternow architektonicznych. Caly
polski kontent (PESEL/NIP/REGON/IBAN PL/sygnatury sadow/gazetteer polskich imion)
zostaje **NASZ**, napisany od zera, niezalezne od PII-Shield.

## Decyzja

Hey Jude / `backend/src/lib/pl-entities/` dostaje **5 patternow architektonicznych
z PII-Shield**, bez forku i bez ciezkich zaleznosci (GLiNER, ONNX). Patterny:

1. **TTL mapping cleanup** (default 7 dni, configurable per kancelaria)
2. **`source_hash` per dokument** (sha256) w `MappingDocumentEntry`
3. **`session_id` embed w docx custom properties** (tygodnie pozniej deanonymize)
4. **AES-GCM session archive** (eksport/import sesji szyfrowany scrypt-derived key)
5. **`mcp_audit.log` "proves no PII leaves"** (rownolegly z hash-chain ADR-0001, wzbogaca audit bundle ADR-0006)

Plus 4 mniejsze patternu (drugi tier):

6. Context boost (+0.35, window 200 char) w recognizerach pl-entities
7. `verified: boolean` flag per entity (confidence layer)
8. DocX redline integration (tracked changes pattern, biblioteka `docx-redline-js`)
9. Architektura `RecognizerDef { entityType, patterns, context }` - refactor obecnych pl-entities/ pod ten interface

## Kontekst

Hey Jude (ADR-0003 + ADR-0008) implementuje polskie PII deterministycznie:
PESEL z algorytmem wag 1-3-7-9 (zgodnie z [[feedback_adr_cite_algorithm_standard]]),
NIP z mod 11, REGON, IBAN PL, sygnatury sadow polskich, gazetteer polskich
imion. Pokrycie zakresu kancelaria-procesowa zwalidowane testami regression
w `pl-entities/checksums.test.ts`.

Hey Jude jest **slabszy na poziomie operacyjnym** - mapowanie placeholder ↔
wartosc zywa trzymane w pamieci procesu, brak TTL, brak session_id embed,
brak sesji szyfrowanej do archiwizacji, brak osobnego audit-log "proves no PII
leaves".

PII-Shield adresuje te same problemy operacyjne dla rynku US/UK/zach.EU.
Architektura czerpie z Microsoft Presidio (autor Grigorii Moskalev jest
zwiazany z zespolem Presidio - do walidacji w `git log` upstream). 92★
i v2.0.2 z 28.04.2026 to repo mlode, ale referencja Presidio podnosi
wiarygodnosc patternow architektonicznych.

Cherry-pick patternow operacyjnych z PII-Shield + zachowanie polskiej tresci
Hey Jude daje warstwe pseudonimizacji laczaca audit-friendly operacyjnosc
(Presidio reference) z polskimi PII (PESEL/NIP/REGON/IBAN PL/sygnatury
sadow). Wartosc dla drabiny sprzedazowej MateMatic jest poza scope tego ADR
(decyzja architektoniczna nie zalezy od ceny produktu).

## Co bierzemy z PII-Shield (5 + 4 patternow)

### 1. TTL mapping cleanup (priorytet 1)

**Plik upstream**: `src/mapping/mapping-store.ts` (TTL 7 dni default)

**Co dorzucamy do Patrona**: pole `expires_at` w schema Postgresa tabeli
`pseudonim_mappings`, cron lub on-access cleanup wpisow po 7 dniach (configurable
przez Administratora w `~/.patron/policy.yaml` -> `pseudonim_mapping_ttl_days: 7`).

**Wartosc**: art. 5 ust. 1 lit. e RODO "ograniczenie przechowywania" -
mapping placeholder ↔ wartosc zywa to PII derivative, retencja powinna byc
minimalna. Bez TTL mapping zyje wiecznie = naruszenie zasady.

**Estymacja**: 2h dev, schema migration + cleanup job + test e2e (mapping starszy
niz 7 dni jest usuwany).

### 2. `source_hash` per dokument (priorytet 1)

**Plik upstream**: `MappingDocumentEntry` w `src/mapping/mapping-store.ts`:
```ts
{
  doc_id: string;          // ULID-ish; distinguishes N docs in one session
  source_path: string;     // absolute path at anonymize time
  source_hash: string;     // "sha256:..." of original bytes
}
```

**Co dorzucamy**: pole `source_hash` w schema Postgresa tabeli
`pseudonim_documents` - sha256 bajtow oryginalnego pliku w momencie
pseudonimizacji. Audit-relevant: prawnik moze za tydzien zapytac "czy ten plik
ktory dostajemy do podpisu jest TYM SAMYM ktory anonimizowalismy", odpowiedz
deterministyczna.

**Wartosc**: AI Act art. 12 (Regulation (EU) 2024/1689, CELEX [32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689))
record-keeping - dowod ze konkretne wejscie do systemu jest tym co audyt
sprawdza. Hash-chain ADR-0001 dziala na **eventach**, source_hash dziala na
**plikach** (komplementarne).

**Estymacja**: 1h dev, schema migration + obliczenie sha256 w pipeline upload +
ekspozycja w audit bundle (ADR-0006).

### 3. `session_id` embed w docx custom properties (priorytet 2)

**Plik upstream**: integracja w `src/docx/` PII-Shield ze `docx` npm package
(custom properties tagowanie session_id w metadanych Word).

**Co dorzucamy**: przy generacji `.docx` z Patrona (kazdy export pisma /
raportu / audit bundle) embedujemy `session_id` (UUID) w custom properties
Word. Otwierajac `.docx` 3 tygodnie pozniej, Patron rozpoznaje sesje i moze
wyciagnac mapping z bazy (jezeli TTL nie wygasl) do deanonymize.

**Wartosc**: workflow prawnika - dostal `.docx` od juniora z zanonimizowanymi
nazwiskami, otwiera za tydzien, jednym klikiem widzi prawdziwe nazwiska
(jezeli ma uprawnienie). Bez `session_id` embed = manualne dopasowywanie.

**Estymacja**: 1.5h dev, modul `docx-session-tagging.ts` + integracja w
generatorze pism Patrona + test e2e (otwarcie pliku 8 dni pozniej = TTL expired
= komunikat "mapping wygasl, akceptacja Inspektora wymagana do re-anonymize").

### 4. AES-GCM session archive (priorytet 2)

**Plik upstream**: `src/portability/session-archive.ts` PII-Shield - eksport
sesji do `.tar.gz.enc` z szyfrowaniem AES-256-GCM + scrypt-derived key z hasla
uzytkownika.

**Co dorzucamy**: `patron export-pseudonim-session --session-id UUID --output
session.encrypted` + `patron import-pseudonim-session --input session.encrypted
--password` - umozliwia transfer sesji miedzy maszynami (np. junior w kancelarii
A pseudonimuje, partner w kancelarii B deanonymuje na **lokalnej** maszynie
bez zaufania do sieci).

**Wartosc**: RODO art. 32 - "srodki techniczne zapewniajace bezpieczenstwo"
przy transferze. Bez sesji szyfrowanej, transfer mapping = zwykla baza =
ryzyko wycieku. Z sesja szyfrowana = E2E encryption per transfer.

**Estymacja**: 2h dev, modul `pseudonim-portability.ts` z scrypt-derived key
+ AES-256-GCM + manifest sesji (lista doc_id + checksums) + test e2e.

### 5. `mcp_audit.log` "proves no PII leaves" (priorytet 1)

**Plik upstream**: `src/audit/audit-logger.ts` PII-Shield - osobny log file
`mcp_audit.log` z kazdym wywolaniem narzedzia + response (z hash zamiast tresci),
udowadnia ze PII nie opuscilo maszyny.

**Co dorzucamy**: Patron juz ma hash-chain audit trail ADR-0001 (zdarzenia
LLM-call-out / LLM-call-in / pseudonim-applied / pseudonim-reversed). Dorzucamy
**osobny tryb logowania `pseudonim_audit.log`** plain-text czytelny dla
Inspektora (bez wymogu odszyfrowania hash-chain), per linia: `{timestamp} -
{event} - {doc_hash} - {entity_count_per_type} - {bytes_in/out}`. Linie sa
**rownoleglą** do hash-chain (nie zastepuja), tylko czytelne dla Inspektora
i regulatorow.

**Wartosc**: AI Act art. 12 + art. 13 (Regulation (EU) 2024/1689, CELEX
[32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689))
- "instrukcje uzytkowania" wymagaja zrozumialych logow dla podmiotu
wdrazajacego AI. Hash-chain ADR-0001 jest dla maszyny (cryptographic proof),
`pseudonim_audit.log` jest dla **czlowieka Inspektora** (audyt zgodnosci
RODO/AI Act przez wizualne sprawdzenie 5-minutowe).

**Estymacja**: 1h dev, modul `pseudonim-audit-log.ts` + integracja w pipeline
+ test e2e (assert ze kazda pseudonim-applied generuje linie audit).

### 6-9: drugi tier (priorytet 3)

- **Context boost (+0.35, window 200 char)** - dorzucenie do `pl-entities/recognizers/` heurystyki "jezeli imie wystepuje obok slowa-klucza 'Pan/Pani/Klient/Strona', boost confidence". 1h dev.
- **`verified: boolean` flag** - rozszerzenie typu `DetectedEntity` w pl-entities/, default `false`, ustawiane na `true` po checksum walidacji (PESEL/NIP/REGON/IBAN). 30 min dev.
- **DocX redline integration** - dodanie `docx-redline-js` jako optional dep, rezerwujemy dla v2 ADR (osobny pattern, nie pseudonim core).
- **Architektura `RecognizerDef`** - refactor obecnych pl-entities/ pod jednolity interface `{ entityType, patterns, context }` zgodny z Presidio. 3h dev (refactor + testy regression).

## Czego NIE bierzemy

1. **GLiNER zero-shot NER + ONNX Runtime** = ciezka zaleznosc (>100 MB modeli),
   zlamie ADR-0008 "zero-LLM/ML przy zapisie" (pl-entities/ jest deterministyczne
   regex + checksum). GLiNER moze byc rozwazany w v2 ADR-NNNN jako **opcjonalny
   fallback** dla encji "miekkich" (imie/nazwa firmy w kontekscie niestandardowym),
   po explicit decyzji Wieslawa.
2. **MCP server architecture** - PII-Shield jest MCP serverem dla Claude Desktop.
   Hey Jude jest **shared library w Patron backend** (calls in-process). To inna
   integracja. Cherry-pick MCP server architecture to osobna decyzja (czy
   eksponowac pl-entities/ jako MCP konektor 6. obok mcp-saos/nsa/isap/krs/eu-sparql).
   Pending dla osobnego ADR.
3. **33 entity types PII-Shield (US/UK/DE/FR/IT/ES/CY)** - nie zwiekszamy
   scope pl-entities/ pod inne kraje. Konstytucja Art. 1 (Lokalnosc danych)
   + AGENTS.md "Polskie kancelarie - polskie PII" jako zasada brand. EU_VAT
   moze sie przydac (UE dla CJEU/EUR-Lex), ale to drobiazg.

## Plan migracji (T1-T5, ~10 godzin dev rozlozone na 2-3 sesje)

- **T1 (3h) Foundation - patterny 1, 2, 5 (priorytet 1)**:
  - Schema migration Postgres: pole `expires_at` + `source_hash` w `pseudonim_mappings` i `pseudonim_documents`
  - Cleanup job (cron lub on-access) usuwajacy mappings starsze niz `pseudonim_mapping_ttl_days` (config Administrator)
  - Obliczenie sha256 w pipeline upload + ekspozycja w audit bundle
  - `pseudonim_audit.log` plain-text (osobny log file, czytelny dla Inspektora) - kazda pseudonim-applied/reversed wpisuje linie
  - Testy: TTL expired -> mapping deleted, source_hash deterministic, audit log line per event

- **T2 (2h) `session_id` w docx + integracja**:
  - Modul `docx-session-tagging.ts` (uses `docx` npm package custom properties)
  - Integracja w generatorze pism / raportow / audit bundle Patrona - kazdy `.docx` ma `session_id` w metadanych
  - Test e2e: otwarcie pliku 8 dni pozniej (TTL expired) = komunikat "mapping wygasl, akceptacja Inspektora wymagana"

- **T3 (2h) AES-GCM session archive**:
  - Modul `pseudonim-portability.ts` - eksport sesji do `.tar.gz.enc` z scrypt-derived key
  - CLI: `patron export-pseudonim-session --session-id UUID --output session.encrypted`
  - CLI: `patron import-pseudonim-session --input session.encrypted --password`
  - Manifest sesji (lista doc_id + checksums)
  - Test e2e: export -> import na innej maszynie = identyczne mappings

- **T4 (1.5h) Patterny drugiego tieru (6, 7)**:
  - Context boost (+0.35, window 200 char) w recognizerach
  - `verified: boolean` flag po checksum walidacji
  - Testy regression (cale pl-entities/ test suite musi nadal pass)

- **T5 (1.5h) Refactor architektury `RecognizerDef` (pattern 9, opcjonalny)**:
  - Jezeli zatwierdzony - refactor pl-entities/recognizers/ pod jednolity interface `{ entityType, patterns, context }` zgodny z Presidio
  - Testy regression (44 testy pl-entities z [[session_summary_2026-05-21_patron-6adr]])

Bramki:
- Po T1 - Administrator ma policy.yaml dla TTL, Inspektor moze otworzyc plain-text audit log i przeczytac
- Po T2 - .docx z Patrona ma session_id w metadanych (sprawdzalne przez Word custom properties)
- Po T3 - eksport/import sesji dziala miedzy maszynami
- Po T5 - cale pl-entities/ testy 44/44 pass + 5 nowych testow nowych patternow

## Konsekwencje

**Pozytywne:**

- Hey Jude zyskuje 5 patternow operacyjnych architektonicznie zgodnych z Microsoft Presidio przy zachowaniu zero-LLM polskiej warstwy entities (ADR-0008 respektowany)
- AI Act art. 12 record-keeping zyskuje DWA warstwy: hash-chain (cryptographic, dla maszyny) + plain-text audit log (czytelny, dla Inspektora)
- RODO art. 5 ust. 1 lit. e (ograniczenie przechowywania) - automatyczny TTL mapping
- RODO art. 32 (bezpieczenstwo) - AES-GCM session archive dla transferu
- Audit bundle ADR-0006 zyskuje source_hash per dokument jako komplementarna warstwa dla hash-chain eventowego ADR-0001

**Negatywne / koszty:**

- ~10h dev rozlozone na 2-3 sesje (T1 + T2 + T3 oddzielnie z marko-pl 2x runda kazda)
- 2 schema migrations Postgresa (TTL field + source_hash field) = wymaga ostroznosci na production
- Refactor `RecognizerDef` (T5, opcjonalny) ma blast-radius na cale pl-entities/ test suite

**Ryzyka:**

- **TTL collision z workflow kancelarii** - co jezeli sprawa trwa 6 miesiecy a TTL = 7 dni? Mitigacja: TTL konfigurowalne per kancelaria (`pseudonim_mapping_ttl_days: 180`), Administrator decyduje
- **`session_id` w docx ma byc widoczny** - kazdy kto otworzy `.docx` w Word zobaczy custom properties. Mitigacja: dokumentacja, klient akceptuje
- **AES-GCM scrypt-derived key z hasla** - silna kryptografia ale haslo slabe = wciaz slabe. Mitigacja: walidacja sily hasla na CLI (zxcvbn lub podobne)

## Atrybucja

Wzorzec architektoniczny (5 patternow operacyjnych + 4 drugiego tieru): cherry-pick
z [gregmos/PII-Shield](https://github.com/gregmos/PII-Shield) (MIT, autor Grigorii
Moskalev - Microsoft Presidio team, snapshot 2026-05-21).

Implementacja w Patronie: **napisana od zera** pod schema Postgresa Patrona,
hash-chain ADR-0001, polskie PII (PESEL/NIP/REGON/IBAN PL/sygnatury sadow/imiona),
Konstytucja v1.1.1 (vendor-neutrality, lokalnosc, audytowalnosc). NIE jest to
fork ani port - cherry-pick patternow architektonicznych.

Wpis do `THIRD_PARTY_INSPIRATIONS.md` przy commicie tego ADR:

```markdown
### gregmos/PII-Shield (MIT)

Snapshot 2026-05-21 (v2.0.2). 5 patternow operacyjnych cherry-pick do
**ADR-0013 PII-Shield patterns**: TTL mapping cleanup, source_hash per
dokument, session_id w docx custom properties, AES-GCM session archive,
plain-text pseudonim_audit.log dla Inspektora. NIE forkujemy kodu -
implementacja Patrona przepisana od zera pod schema Postgresa, polskie
PII (PESEL/NIP/REGON/IBAN PL), hash-chain ADR-0001. GLiNER/ONNX/MCP-server
architecture NIE adoptowane (respektowanie ADR-0008 zero-LLM przy zapisie).
```

## Decyzja oczekiwana od Wieslawa

1. **Czy idziemy z ADR-0013 jako Faza 7+** (po Fazie 6 pamieci gbrain, rownolegle do ADR-0010 Contract Review Module)? Patterny 1, 2, 5 priorytet 1 (T1, 3h dev) sa **niezalezne** od reszty Patrona i moga byc zaimplementowane w izolacji - dobry kandydat na **szybki win**.
2. **Priorytet patternow** - cala paczka T1-T5 czy tylko T1-T3 (must-have) plus T4-T5 jako stretch?
3. **Wpiecie ADR + bump Konstytucji** - jezeli zatwierdzony, ADR-0013 idzie do MINOR bump v1.2.0, ale **bez dodawania Art. 10** (Konstytucja v1.1.1 ma juz 9 zasad wyczerpujacych zakres "max 9 artykulow" z sekcji 2). Patterny mapuja sie na istniejace Art. 1/3/4/7 - opisac to w changelog Konstytucji + zalaczniku A "Mapa do aktow prawnych" (RODO art. 5/25/32, AI Act art. 12/13). Alternatywa: zostawiamy ADR-0013 osobno bez bumpu Konstytucji (default).
4. **Marko-pl 2x runda** ZAREZERWOWANA PRZED commitem (zgodnie z [[feedback_marko_2x_runda_pattern]]).
