# ADR-0006: Audit bundle dla zgodnosci z AI Act art. 12

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-20
**Powiązane zasady**: Konstytucja AI Patrona, Art. 3 (audytowalność),
Art. 6 (human in the loop - prawnik widzi caly tok pracy Patrona),
Art. 8 (przejrzystosc - operator wie, co Patron zrobil)
**Powiązane**: ADR-0001 (hash-chain audit log), ADR-0004 (debate),
ADR-0005 (citation grounding), wzorzec architektoniczny
[AnttiHero/lavern](https://github.com/AnttiHero/lavern) (Apache 2.0)
+ [[reference_matematic_video_governance]] (4 fazy walidacji wideo,
audit log AI Act art. 12)

## Decyzja

Patron generuje **audit bundle** dla kazdego deliverable wysokiej
stawki (opinia, pozew, draft umowy M&A, due diligence). Bundle to
**samodzielny pakiet plikow** (folder lub ZIP) zawierajacy:

```
audit_bundle_<deliverable_id>/
├── deliverable.md                  - finalny output Patrona
├── deliverable.docx                - to samo, format kancelaryjny
├── debate_transcript.json          - 5 faz debate (ADR-0004) z timestampami
├── citation_verification.json      - wyniki preflight verifier (ADR-0005)
├── audit_log_excerpt.json          - fragment hash-chain z tego case
│                                     (ADR-0001) + dowod hash-chain integrity
├── cost_log.json                   - tokeny / dolary / latency per faza
├── pseudonim_map_excerpt.json      - mapa PII tylko dla tego case
│                                     (ADR-0003), szyfrowana age
├── prompts_used.json               - system prompts + user prompts
│                                     (z fingerprint hash, bez sekretow)
├── model_versions.json             - jaki Claude / Gemini / Ollama,
│                                     wersje patron / mcp-saos /
│                                     mcp-isap, snapshot konektorow
├── bundle_manifest.json            - lista plikow + ich SHA-256 + signature
└── bundle_manifest.sig             - podpis bundle_manifest kluczem
                                     prywatnym serwera Patrona
```

Bundle generujemy **automatycznie** dla zadan high-stakes (klasyfikator
z ADR-0004). Dla pozostalych zadan bundle jest **opcjonalny** -
prawnik moze kliknac "Wygeneruj audit bundle" jezeli chce dowod
dla siebie / klienta / regulatora.

Bundle ma **hash-chain integrity proof**: `bundle_manifest.json`
zawiera SHA-256 kazdego pliku, oraz wskazuje range `audit_log` events
(od `audit_log.id = X` do `audit_log.id = Y`), ktorych łańcuch hash
jest **niezalezenie weryfikowalny** komenda `npm run audit:verify --bundle=...`.

## Kontekst

**AI Act art. 12** (Regulation (EU) 2024/1689, CELEX
[32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689),
art. 12 "Record-keeping") wymaga od dostawcow systemow AI wysokiego
ryzyka prowadzenia automatycznego rejestru zdarzen ("logs") przez caly
cykl zycia systemu, z zakresem wynikajacym z art. 12 ust. 2 i 3
(automatyczna identyfikacja sytuacji ryzyka, sledzenie operacji, dane
wejsciowe ktore prowadzily do decyzji). Powyzsze brzmienie jest
**parafraza robocza dla ADR** - przy formalnej zgodnosci kancelaria
powinna korzystac z konsolidowanego tekstu EUR-Lex (link CELEX wyzej).
Kluczowe komponenty wymagane od logow:
- Rejestrowanie zdarzen systemu w trakcie dzialania
- Identyfikacja osob fizycznych odpowiedzialnych za nadzor czlowieka
- Dane wejsciowe (inputs) prowadzace do wynikow systemu
- Wersje systemu i konfiguracja w momencie zdarzenia

Patron jako narzedzie kancelarii **nie jest sam dostawca systemu AI
wysokiego ryzyka** w sensie art. 12 - kancelaria jest *deployerem*,
nie *dostawca*. Ale Patron **dostarcza kancelarii infrastrukture
zgodnosci** - jezeli regulator (UODO, KIRP, PIE, sad) pyta "jak
ta opinia powstala", kancelaria klika "wyeksportuj audit bundle" i
ma pelen dowod.

**Drugi powod** - reklamacje klientow. Kancelaria po kilku latach od
opinii moze dostac pismo "Wasza opinia byla niedokladna, oprzec sie
na niej oznaczalo strate w wysokosci X" (kwota i okres zaleza od sprawy,
przyklad ilustracyjny). Audit bundle = dowod, ze opinia
przeszla debate + citation verification + audit chain, ze prawnik
zaakceptowal kazda zmiane. Asymetria odpowiedzialnosci przesuwa sie
**w strone klienta** (klient mial dostep do narzedzia transparentnego,
swiadomie polegal na deliverable).

**Trzeci powod** - operacyjna gotowosc na pytanie klienta lub regulatora
"jak powstala ta analiza". Audit bundle jest gotowym artefaktem
gotowym do okazania - jeden komenda CLI, jeden plik zip z deliverable +
debate transcript + verification log + cost log. Pierwotnie zakres
operacyjny, dopiero wtornie argument w rozmowach z klientami kancelarii.

Lavern pokazuje pattern **bundle alongside deliverable** w prostszy
formie (findings + debate + verification + cost log). Patron rozbudowuje
o:
- **Pseudonim_map_excerpt** (ADR-0003 PL-specific)
- **Citation_verification** (ADR-0005 PL legal sources)
- **Audit_log_excerpt z hash-chain integrity** (ADR-0001 PL-specific)
- **Bundle_manifest signature** (podpis serwera Patrona kluczem
  prywatnym, weryfikacja przez `npm run audit:verify`)

[[reference_matematic_video_governance]] niesie wzorzec **4-faz walidacji
+ audit log AI Act art. 12** dla wideo MateMatic - ten sam pattern
przenosimy do legal-tech. Spojnosc patternow miedzy produktami
MateMatic.

## Rozwazane sciezki

### Wariant A - logi w pamieci, eksport ad-hoc gdy ktos pyta

Pomysl: audit_log w Postgresie wystarczy. Bundle to extract na zadanie,
nie cos co generujemy automatycznie.

**Problemy**:
- Czas pracy prawnika na manualne sklejenie bundle = 1-2h per case
- Brak gwarancji, ze wszystkie elementy zostaly uchwycone w jednym
  punkcie czasu (audit_log moze byc wyczyszczony przez retencja,
  prompts zmenia sie w nowych wersjach Patrona)
- AI Act art. 12 wymaga *zorganizowanego* recordkeeping, nie
  *odtwarzanego post-hoc*

**Odrzucony**.

### Wariant B - bundle generowane automatycznie po kazdym zapytaniu

Pomysl: kazdy czat, kazda odpowiedz Patrona generuje audit bundle.

**Problemy**:
- Storage: 1000 zapytan dziennie * 50 KB bundle = 50 MB / dziennie
  / kancelaria. Nie blocker, ale rosnie szybko
- Narzut na czat: czat researchowy "jak liczyc termin" nie potrzebuje
  bundle. Cognitive load na sortowanie 1000 bundle / msc, by znalezc
  ten ze "sprawa Klient X"
- Konstytucja Art. 7 (minimalnosc danych) - bundle dla zapytan
  low-stakes generuje artefakty niewykorzystywane, nadmiar przerobu i
  storage poza koniecznoscia

**Odrzucony**.

### Wariant C - bundle automatyczne dla high-stakes + opt-in dla pozostalych (WYBRANY)

Pomysl: ten sam klasyfikator co w ADR-0004 (high-stakes = DD / opinia /
M&A / cm_value > 100k) wyzwala automatyczny bundle. Pozostale zadania
maja przycisk "Wygeneruj audit bundle" w UI.

**Plusy**:
- Bundle generowany **tam, gdzie ma sens** (zadania high-stakes, ktore
  i tak przeszly debate + verifier; udzial high-stakes w ruchu **do
  walidacji T2** na pilotazu)
- Storage rosnie liniowo z liczba zadan high-stakes - rzedy MB/msc per
  kancelaria zamiast GB/msc przy bundle-on-default (**do walidacji T3**
  benchmarkiem rozmiaru bundle na realnych zadaniach)
- Cognitive load na prawnika minimalny - folder `audit_bundles/`
  zawiera tylko zadania high-stakes, lista ograniczona zamiast pelnej
  historii czatu
- Pattern transparentny ("kancelaria, te 50 bundle to dowod dla
  AI Act art. 12 - tu sa, weryfikowalne komenda CLI")

**Wybrany**.

## Konsekwencje

### Plusy

- **AI Act art. 12 compliance technicznie** spelnione, nie tylko
  deklaratywnie
- **Argument zgodnosci regulacyjnej** wobec deployera (kancelarii):
  bundle gotowy do okazania regulatorowi lub klientowi, wytwarzany
  automatycznie dla zadan high-stakes bez recznej rekonstrukcji
  z logow
- **Asymetria odpowiedzialnosci** - klient kancelarii mial dostep do
  bundle, swiadomie polegal na deliverable, kancelaria ma dowod
- **Spojnosc patternow MateMatic** - ten sam wzorzec co
  [[reference_matematic_video_governance]] dla wideo
- **Niezalezna weryfikowalnosc** - `npm run audit:verify --bundle=...`
  uruchamia: (a) hash-chain integrity audit_log_excerpt,
  (b) bundle_manifest signature verification, (c) recheck cytatow
  vs aktualnego stanu zrodel. Patron nie musi byc *online*,
  regulator moze odpytac offline
- **Bundle jako produkt** - zsyplemy bundle do klienta razem
  z deliverable. Klient kancelarii widzi transparentnosc, kancelaria
  ma dodatkowy product touchpoint

### Minusy i ograniczenia

- **Klucz prywatny serwera do podpisu bundle** - nowy sekret do
  zarzadzania. Mitigation: integracja z istniejaca infrastruktura
  kluczy (Vault albo plain `.env` z `age` encryption). Rotacja
  kluczy raz w roku
- **Bundle to nowy attack surface** - jezeli ktos podmieni bundle
  i regenera signature ze skradzionym kluczem, audit jest zlamany.
  Mitigation: rotacja kluczy + publikacja "trusted keys" w
  `governance/TRUSTED_KEYS.md` z hash kluczem publicznym (kancelaria
  zna, regulator zna)
- **Wersjonowanie bundle format** - jezeli za rok dodamy nowe pole
  (np. `regulatory_assessment.json`), stare bundle pozostana
  weryfikowalne? Mitigation: `bundle_manifest.json` ma pole
  `format_version`, weryfikator obsluguje wszystkie wersje
  ze schema migration
- **Pseudonim_map_excerpt = wrazliwe dane PII** - mimo szyfrowania
  age, jezeli klucz prywatny serwera jest skradziony, bundle moze
  byc rozszyfrowany. Mitigation: pseudonim_map excerpt szyfrowany
  *osobnym* kluczem (per kancelaria, NIE serwerowy klucz signature).
  Klient kancelarii dostaje bundle bez pseudonim_map (przegralby
  prywatnosc innych klientow). Wersja "for regulator" zawiera
  pseudonim_map zaszyfrowany kluczem regulatora (dostarczonym
  manualnie na zadanie)
- **Latency generowania bundle: 1-3 sekundy**. Mitigation: bundle
  generowany **w tle** po zakonczeniu zadania, UI pokazuje status
  "bundle ready in <10s", nie blokuje czata
- **Koszt storage rosnie liniowo** - 10 MB / msc / kancelaria * 12 msc
  * 10 kancelarii pilotazowych = 1.2 GB / rok. Bagatelka, ale
  retencja powinna byc swiadoma. Mitigation: bundle retained 10 lat
  (zgodnie z retencja akt prawnych); starsze przeniesione do
  cold storage (np. Backblaze B2 + age)

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja AI Patrona** - **MINOR bump 1.1.0 -> 1.2.0** planowany
  wspolnie z ADR-0003/0004/0005. Art. 3 (audytowalnosc) dostaje
  punkt `audit bundle dla high-stakes deliverables` w sekcji
  "Mechanizmy techniczne"
- **Schema SQL** - nowa tabela `audit_bundle_metadata` z polami
  `bundle_id`, `deliverable_id`, `project_id`, `created_at`,
  `manifest_hash`, `signature`, `storage_path`, `format_version`
- **Nowe komendy CLI**:
  - `npm run audit:bundle:generate -- --deliverable=<id>` (manual
    trigger dla testow)
  - `npm run audit:bundle:verify -- --path=<bundle_dir>` (regulator-side)
  - `npm run audit:bundle:export -- --bundle=<id> --format=zip` (klient
    kancelarii)

## Plan migracji 4-tygodniowy

### Tydzien 1 - schema + generator (skeleton)

- [ ] `backend/src/lib/audit/bundle.ts` - generator bundle
- [ ] Schema SQL: tabela `audit_bundle_metadata`
- [ ] `audit_log_excerpt` extractor z hash-chain integrity proof
- [ ] Testy: 5 cases (sztucznie utworzone deliverable z mockowanym
      audit_log)

### Tydzien 2 - manifest + signature

- [ ] `bundle_manifest.json` generator (lista plikow + SHA-256 kazdego)
- [ ] Signature z kluczem prywatnym serwera
- [ ] `governance/TRUSTED_KEYS.md` z hash kluczem publicznym
- [ ] CLI: `npm run audit:bundle:verify` (sprawdza signature +
      hash-chain)

### Tydzien 3 - integracja z debate + citation + pseudonim

- [ ] `debate_transcript.json` ekstrakt z `debate_session` (ADR-0004)
- [ ] `citation_verification.json` ekstrakt z `citation_verification`
      (ADR-0005)
- [ ] `pseudonim_map_excerpt.json` szyfrowany osobnym kluczem
      per kancelaria (ADR-0003)
- [ ] Klasyfikator high-stakes (z ADR-0004) wyzwala auto-generation

### Tydzien 4 - UI + pilotaz

- [ ] UI: przycisk "Wygeneruj audit bundle" dla zadan low-stakes
- [ ] UI: badge "Audit bundle ready" dla high-stakes (autogenerated)
- [ ] CLI: `npm run audit:bundle:export --format=zip` dla klienta
- [ ] Wlacz w pierwszej kancelarii pilotazowej
- [ ] Po 10 case: weryfikacja "czy bundle byl uzytecny", "czy
      kancelaria pokazala bundle klientowi", "czy regulator pytal"

## Status weryfikacji

- [ ] Skeleton modulu `backend/src/lib/audit/bundle.ts`
- [ ] Schema SQL `audit_bundle_metadata`
- [ ] Generator bundle (deliverable + transcript + verification +
      audit_log_excerpt + cost_log + pseudonim_map_excerpt +
      prompts + model_versions + manifest + signature)
- [ ] CLI `audit:bundle:generate`, `audit:bundle:verify`,
      `audit:bundle:export`
- [ ] UI badge + manual trigger button
- [ ] `governance/TRUSTED_KEYS.md` z fingerprint klucza
- [ ] Decyzja Wieslawa: storage path - lokalnie obok `audit_log`
      czy osobny mount? (rekomendacja: lokalnie, ten sam volume,
      cold storage po 1 roku)
- [ ] Decyzja Wieslawa: czy bundle dostarczany klientowi domyslnie
      z deliverable, czy tylko na zadanie? (rekomendacja: tylko
      na zadanie, ale w UI prawnik widzi "wyslij bundle z deliverable")
- [ ] Decyzja Wieslawa: format eksportu (rekomendacja: ZIP +
      sidecar JSON manifest; opcjonalnie podpisany PDF cover sheet)

## Licencja blueprintu

Lavern (Apache 2.0) i video governance MateMatic dostarczaja **wzorzec
audit bundle**. Patron implementuje od zera w ekosystemie PL
(pseudonim_map_excerpt, hash-chain audit_log_excerpt, citation
verification PL sources). Linkujemy w `THIRD_PARTY_INSPIRATIONS.md`
jako blueprint.
