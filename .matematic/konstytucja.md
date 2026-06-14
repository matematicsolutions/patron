# PATRON v1.0.0 — Publikacja — Konstytucja

> Konstytucja **projektu publikacji** PATRON v1.0.0 (wydanie open source). NIE myl z
> Konstytucją AI dla kancelarii (produkt sprzedażowy) ani z Konstytucją PATRON-a jako
> aplikacji. Ta Konstytucja rządzi **jednorazowym wydarzeniem wydawniczym**: złożeniem i
> upublicznieniem w pełni otwartej wersji 1.0.0, z zerowym wyciekiem tajemnicy.
>
> Project type: `desktop-app` / `agent-product` (zdarzenie release).

## Mission (1 zdanie)

Wydać PATRON publicznie jako **w pełni otwarty** (AGPL-3.0 powłoka + MIT konektory)
referencyjny standard mechanicznego groundingu cytatów prawniczych PL/UE — **szybko**
(first-mover), z **czystą proweniencją** i **zerowym wyciekiem** sekretów oraz danych
klienta, żeby trwale zmienić świat LegalTech (standard-play), nie zatrzymując kodu dla
siebie.

## Core Principles

### Article I — Zero wycieku tajemnicy (NIEUSUWALNA, nadrzędna)
**MUST NOT.** Do publicznego repozytorium nie trafia ŻADEN sekret (klucz/token/hasło/.env)
ani ŻADNE realne dane klienta / akta / PII (nazwiska klientów, nazwy realnych spraw,
sygnatury realnych spraw, dane pilotującej kancelarii i osób) — **ani w plikach, ani w
historii git**. Tajemnica adwokacka (Prawo o adwokaturze, art. 6) = czerwona linia
absolutna; przeważa nad szybkością, kompletnością i każdą inną zasadą. Bramki skanu
(sekrety + dane klienta) są blokujące i muszą dać **0 trafień** przed `git push`.
Mechanizm realizacji: publikacja jako **świeży snapshot** (czysta historia), nie przeniesienie
skażonej historii deweloperskiej.

### Article II — W pełni otwarte, 100% (decyzja kierunkowa WM 2026-06-14)
**MUST.** Pokazujemy światu 100% tego, co mamy. Moat (lib/citation grounding
ISTNIENIE/TREŚĆ/FRAGMENT, lib/audit hash-chain/Merkle, lib/pl-entities, lib/pseudonim)
świadomie idzie do świata jako część „100%" (standard-setting, nie psy ogrodnika). Nie
wstrzymujemy kodu. Monetyzacja PÓŹNIEJ — przez usługi/wdrożenia/wsparcie/hosting/szkolenia/
partnerów, NIE przez zamykanie kodu.

### Article III — Licencja ustalona i niezmienna
**MUST.** Powłoka = **AGPL-3.0-only** (zadeklarowane publicznie 2026-05-20). Konektory MCP =
**MIT** (osobne repo). NIE BSL/PolyForm (publicznie padło „open source" — zmiana = backlash
open-washing). Wkład zewnętrzny przez **DCO** (nie CLA — nie komercjalizujemy cudzego wsadu
na krytycznej ścieżce; CLA dopiero gdyby pojawiła się potrzeba partnerów). AGPL chroni przed
ZAMKNIĘCIEM bazy przez konkurenta, nie przed kopiowaniem.

### Article IV — Czysta proweniencja i atrybucja
**MUST.** Zachować kredyt `mike` / `willchen96` (powłoka pochodna, AGPL) w `NOTICE` i
dostępność źródła per AGPL. Konektory MIT = osobne repo, nie pochodne mike. Każda
publikowana zależność z licencją zgodną i udokumentowaną (`THIRD_PARTY_INSPIRATIONS.md`).

### Article V — Standard ponad aplikacją (standard-play)
**SHOULD.** Wydajemy nie tylko aplikację, lecz **standard**: MateMatic Connector Standard
(MCS) v0.1 — kontrakt `structuredContent.citations` (source_id/url/exact_quote/locator/
confidence) + 3-kolor verbatim/paraphrase/unverified (= ISTNIENIE/TREŚĆ/FRAGMENT) + test
zgodności. PATRON = implementacja referencyjna otwartego standardu. Standard, który inni
adoptują, jest trwalszy niż zamknięta app i nie da się go cofnąć.

### Article VI — Współpraca, nie konkurencja (reguła nadrzędna WM)
**MUST.** Domyślnie kadrujemy „jak współpracować", nie „jak pokonać". Otwarty standard +
MIT konektory = zaproszenie do interop (Legal Data Space, OpenContracts, rodzeństwo legal-AI).
Współpraca w granicach: nie łamiemy ToS/licencji, nie oddajemy naiwnie kontroli nad kierunkiem.

### Article VII — Szybkość w granicach governance
**MUST.** First-mover („przewidzieliśmy i zrobiliśmy") — okno się zamyka, szybkość ma
priorytet nad architekturą monetyzacji. ALE bramki Article I są nieusuwalne mimo pośpiechu.
`push` = `deploy` = wymaga zgody WM (governance: 2× review WM + Operator). Akty nieodwracalne /
na zewnątrz (publikacja, ogłoszenie) zostają przy człowieku — agent przygotowuje, nie wykonuje.

## Boundaries

**Projekt ROBI:**
- Składa drzewo kanoniczne v1.0.0 (baza `feat/tier-governance-envelope` + scalone PR-y
  #2 audyt / #5 at-rest / #6 kancelaria / OC #3–#4 locator), z przenumerowaniem kolizji ADR.
- Scrubuje wszystkie realne identyfikatory na fikcyjne syntetyczne.
- Buduje czysty publiczny snapshot (świeża historia) i higienę docs/LICENSE/NOTICE/.gitignore.
- Przygotowuje MCS v0.1 + narrację launch (LI / aktualność / GEO) jako DRAFT do akceptacji.

**Projekt NIE ROBI (anti-scope):**
- NIE pushuje, NIE tworzy publicznego repo, NIE ogłasza niczego bez zgody WM.
- NIE re-decyduje licencji (ustalona).
- NIE komercjalizuje cudzego wsadu (split free/paid, CLA, „NEXUS poza repo" = odłożone).
- NIE przepisuje skażonej historii dewelopera w miejscu (filter-repo) — zamiast tego świeży
  snapshot; prywatny fork zachowuje pełną historię.
- NIE publikuje żadnego pliku binarnego z realną treścią akt.

**Współpracuje z:**
- 6 repo konektorów MCP (MIT, `matematicsolutions/*`).
- Standardem MCS v0.1 (`Downloads/STANDARD-matematic-connector-v0.1-draft.md`).
- Skillami publikacyjnymi (marko-pl-content, edit-article, linkedin-voice, humanizer-pl, geo)
  na etapie KROK 4/7.

## Governance

- **Owner / decydent:** Wiesław Mazur (WM). Każda decyzja kierunkowa i każde `push`/ogłoszenie.
- **Reviewers:**
  - `matematic-patron-pr-review-pl` — regresje specyficzne dla repo (org scoping, authless,
    migracje, audit_log, grounding) przed merge.
  - `security-review` / skan bramek — sekrety + dane klienta (Article I), blokujący.
  - `marko-pl-content` + `humanizer-pl` — treści launch (README publiczny, post LI, aktualność).
- **Bramka push:** 2× review WM + Operator. Push = deploy.
- **Amendment process:** zmiana tej Konstytucji = SEMVER bump + wpis w `## Amendments` +
  akceptacja WM. Article I (zero wycieku) i Article III (licencja) — zmiana = MAJOR i wymaga
  wyraźnej, świadomej decyzji WM na piśmie.

## Compliance Map

| Wymóg zewnętrzny | Odniesienie |
|---|---|
| Tajemnica adwokacka | Prawo o adwokaturze art. 6 → Article I (czerwona linia) |
| RODO | brak realnych danych osobowych w repo publicznym → Article I |
| AI Act art. 12 (record-keeping) | lib/audit hash-chain/Merkle, audit-bundle (idzie do świata, Article II) |
| Licencja powłoki | AGPL-3.0-only → Article III; `LICENSE`, `NOTICE` |
| Licencja konektorów | MIT → Article III (osobne repo) |
| Proweniencja zależności | `NOTICE`, `THIRD_PARTY_INSPIRATIONS.md` → Article IV |

## Constitution Check — GATE (stan na 2026-06-14)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | ✅ PASS | Publikacja 100% open = wprost decyzja WM 2026-06-14 |
| Article I — sekrety | ✅ PASS | Skan plików + historii: tylko placeholdery; 0 realnych sekretów |
| Article I — dane klienta | ✅ PASS (po scrubie) | Realne dane pilota (kancelaria, imię, dwie sprawy) usunięte ze WSZYSTKICH gałęzi → fikcyjna obsada „Rumpole Chambers"; re-skan 0 trafień. ⚠️ Powtórzyć scrub na drzewie kanonicznym po scaleniu PR (PR#2 wnosi ADR-y z odwołaniami) |
| Article II — 100% open | ✅ PASS | Moat świadomie do świata |
| Article III — licencja | ✅ PASS | AGPL-3.0 powłoka + MIT konektory + DCO; bez zmian |
| Article IV — proweniencja | 🟡 do potwierdzenia | NOTICE/atrybucja obecne; re-weryfikacja na zbudowanym drzewie |
| Article V — standard (MCS) | 🟡 TODO | Draft v0.1 istnieje; publish w KROK 6 |
| Bramka jakości | 🟡 częściowo | tsc/testy do potwierdzenia na drzewie kanonicznym po scrubbingu |
| Bramka strategii | ✅ PASS | first-mover + standard-play + współpraca |

**Werdykt GATE:** dane klienta i sekrety — czyste (scrub na wszystkich gałęziach, re-skan
0 trafień). Do pełnego zielonego pozostają: re-scrub na drzewie kanonicznym po scaleniu PR,
potwierdzenie proweniencji/jakości (tsc/testy) oraz budowa świeżego snapshotu. Żadne `push`
przed zielonym GATE i zgodą WM (2× review WM + Operator).

---

**Version:** 1.0.0 | **Ratified:** 2026-06-14 | **Last Amended:** 2026-06-14

## Amendments

- **2026-06-14 — v1.0.0 — ratyfikacja.** Konstytucja projektu publikacji PATRON v1.0.0.
  Wynik decyzji WM 2026-06-14 (publikacja w pełni otwarta, 100%, first-mover) oraz bramek
  bezpieczeństwa KROK 1 (sekrety PASS; dane klienta — wykryte i w pełni zescrubowane).
  Decyzje wykonawcze: baza = `feat/tier-governance-envelope` + scalone PR-y; realne
  identyfikatory pilota → **fikcyjne syntetyczne**, obsada „Rumpole Chambers" (angielski
  dystans): mec. **Rumpole** (adw. H. Rumpole), kancelaria **„Rumpole & Loophole"**, kryptonim
  pilota **Pilot-01-Rumpole**, **sprawa Doe**, **sprawa Bloggs**, **Acme Sp. z o.o.**,
  e-mail **rumpole@kancelaria.test**. Scrub wykonany na **wszystkich gałęziach** (re-skan
  0 trafień realnych identyfikatorów). Mapowanie realne→fikcyjne przechowywane wyłącznie
  prywatnie (poza repozytorium). **UWAGA:** powtórzyć scrub na drzewie kanonicznym po scaleniu
  PR-ów (część PR-ów wnosi ADR-y z odwołaniami do realnego pilota — nieobecne na tej gałęzi).
