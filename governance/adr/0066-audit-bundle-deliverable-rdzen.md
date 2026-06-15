# ADR-0066: Audit bundle per-deliverable - rdzen (builder + offline verifier)

**Status**: Czesciowo wdrozony 2026-05-29 (rdzen LIVE; wpiecie/UI/podpis -
rezerwacja, patrz Status weryfikacji). Konstytucja v1.3.5.
**Data**: 2026-05-29
**Powiązane zasady**: Konstytucja AI Patrona, Art. 3 (audytowalnosc),
Art. 6 (human in the loop), Art. 8 (przejrzystosc), AI Act art. 12 (record-keeping)
**Powiązane**: ADR-0006 (audit bundle - blueprint), ADR-0047 (audit pack -
reuse `canonicalSha256`), ADR-0005 (citation grounding - `citation_verification`),
ADR-0001 (hash-chain - `audit_log_excerpt`), ADR-0049 (rezerwacja: podpis Ed25519
+ RFC 3161, wspolna z audit-pack)

## Decyzja

Realizacja RDZENIA blueprintu ADR-0006: samowystarczalny pakiet JSON dla
JEDNEGO deliverable, sklejajacy tresc + wynik mechanicznej weryfikacji cytatow
(ADR-0005 grounding) + fragment hash-chain audit_log + wersje modelu + log
kosztu, z manifestem SHA-256 per czesc + integrity calosci.

Trzy czyste komponenty (zero IO, testowalne):
- `backend/src/lib/audit-bundle.ts` - `buildAuditBundle` (sklada bundle +
  manifest + integrity), `verifyAuditBundleIntegrity` (2-stopniowy check:
  per-czesc + calosc), `buildAuditBundleFilename`. Reuzywa `canonicalSha256`
  z audit-pack (ADR-0047) - ten sam mechanizm integralnosci.
- `backend/scripts/verify-audit-bundle.ts` + npm `audit:verify-bundle` -
  offline weryfikator (exit 0 zdrowy / 1 naruszony / 2 blad IO). Audytor /
  regulator / klient sprawdza bundle bez dostepu do bazy kancelarii.
- 9 testow jednostkowych (struktura, determinizm, wykrywanie modyfikacji
  deliverable / werdyktu cytatu / eventu audit, schema_version). CLI
  zweryfikowany round-trip (clean exit 0, tampered exit 1 z nazwa czesci).

## Odstepstwa od blueprintu ADR-0006 (swiadome, udokumentowane)

| Blueprint ADR-0006 | Wdrozenie ADR-0066 | Powod |
|---|---|---|
| `lib/audit/bundle.ts` | `lib/audit-bundle.ts` (plaska nazwa) | konwencja repo (audit-*.ts plasko, brak katalogu audit/) |
| Folder/ZIP wielu plikow | Pojedynczy JSON + manifest per-czesc | prostszy artefakt; manifest zachowuje granularnosc "ktora czesc zmieniono" |
| Podpis kluczem prywatnym serwera | SHA-256 integrity (bez podpisu) | NIE wprowadzamy nowego sekretu - decyzja ops Wieslawa. Podpis = rezerwacja ADR-0049, wspolna z audit-pack |
| `debate_transcript.json` (ADR-0004) | pominiety | ADR-0004 debate niewpiety - brak danych |
| `pseudonim_map_excerpt` szyfrowany | pominiety | wymaga osobnego klucza per kancelaria - rezerwacja |
| tabela `audit_bundle_metadata` | brak (generowany na zadanie) | bundle nie persystowany w tej iteracji - brak migracji/schema |
| auto-trigger high-stakes + UI | brak | klasyfikator highstakes/classifier.ts jest, wpiecie + UI = rezerwacja |

`cost_log` jest best-effort: Patron nie sledzi jeszcze tokenow/dolarow, wiec
pole `available:false` + dostepne metadane (full_text_len, event_count).
Pelny cost tracking = osobny dlug.

## Konsekwencje

### Plusy

- AI Act art. 12 - dowod "jak powstala analiza" jako jeden weryfikowalny plik,
  offline, bez bazy kancelarii
- Reuse `canonicalSha256` (audit-pack) - jeden mechanizm integralnosci w
  projekcie, spojny i juz przetestowany
- Domyka petle z ADR-0005: werdykt groundingu staje sie trwalym dowodem w
  bundlu (citation_verification), nie tylko ulotnym sygnalem w UI
- Zero nowych zaleznosci npm, zero migracji, zero nowego sekretu, zero zmian
  w zywym pipeline czatu (builder wolany na zadanie)

### Minusy i ograniczenia

- Bundle nie jest jeszcze nigdzie WOLANY z produkcji - to czysty modul + CLI.
  Wpiecie (auto-trigger high-stakes / przycisk UI / endpoint eksportu) =
  rezerwacja (patrz tabela). Builder przyjmuje dane, ktore caller musi zebrac
  (tresc deliverable, grounding, audit excerpt) - wpiecie dostarczy zrodla
- Brak podpisu = bundle wykrywa modyfikacje po wygenerowaniu (SHA-256), ale
  nie dowodzi AUTORSTWA serwera Patrona. Atakujacy z dostepem do bundla moze
  przeliczyc spojny hash. Podpis (ADR-0049) zamyka te luke - swiadomie odlozony
- `audit_log_excerpt` jest osadzony jako dane; weryfikacja ze eventy nie
  zostaly zmienione w BAZIE wymaga Merkle proof (audit-pack ADR-0047) - bundle
  to osobna warstwa (integralnosc pliku), nie zastepuje Merkle

### Wymagane MAJOR/MINOR konstytucji

- **v1.3.4 -> v1.3.5** - PATCH. Art. 3 (audytowalnosc) dostaje narzedzie:
  builder audit bundle + offline verifier CLI. Bez zmiany kontraktow API
  (brak endpointu), bez zmiany schema (brak persystencji), bez nowego sekretu.

## Status weryfikacji

- [x] `lib/audit-bundle.ts` - buildAuditBundle / verifyAuditBundleIntegrity / filename
- [x] Reuse `canonicalSha256` z audit-pack (ADR-0047)
- [x] `citation_verification` = wynik groundingu (ADR-0005, GroundingResult[])
- [x] `audit_log_excerpt` osadzony (typ AuditPackEvent reuse)
- [x] Manifest SHA-256 per czesc + integrity calosci
- [x] CLI `scripts/verify-audit-bundle.ts` + npm `audit:verify-bundle` (round-trip OK)
- [x] 9 testow jednostkowych, tsc clean
- [ ] Wpiecie: auto-trigger high-stakes (classifier ADR-0004) lub przycisk UI
- [ ] Endpoint eksportu + format ZIP dla klienta kancelarii
- [ ] Podpis Ed25519 + RFC 3161 (rezerwacja ADR-0049)
- [ ] Persystencja metadanych bundla (tabela) jezeli potrzebny query/lista
- [ ] pseudonim_map_excerpt szyfrowany per kancelaria; debate_transcript (po ADR-0004)
- [ ] Cost tracking (tokeny/dolary) - obecnie best-effort

## Licencja

Implementacja MateMatic od zera (powloka AGPL-3.0). Wzorzec: bundle alongside
deliverable - [AnttiHero/lavern](https://github.com/AnttiHero/lavern) (Apache 2.0)
+ 4-fazy walidacji wideo MateMatic. Patrz THIRD_PARTY_INSPIRATIONS.md, ADR-0006.
