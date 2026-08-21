# PATRON 2.0 - tracker wydania

**Branch:** `release/v2.0.0-prep` (off `release/v1.0.0-prep`)
**Status:** Integracja w toku (NIE wydane). Flagi nowych ficzerow OFF do flipu po eval.
**Temat:** "governance by default" / trust & control hardening.
**Data otwarcia:** 2026-06-30

> To NIE jest osobny folder/repo - PATRON 2.0 to WERSJA istniejacego repo. "Folder 2.0"
> = ta galaz release + ten tracker. Wydanie = flip flag -> merge do `main` -> tag v2.0.0
> -> push publiczny `mat`. Anti-sprawl: jeden kod, jedna historia.

## Decyzja wersji (1.1 vs 2.0)

Wersja idzie za DECYZJA O DEFAULTACH (Konstytucja Sec 6.1), nie za kodem:
- **1.1 (MINOR)** = nowe zdolnosci jako OPT-IN (flagi OFF jak dzis). Zero zmiany zachowania.
- **2.0 (MAJOR-positioning)** = flip defaultow na ON (human-in-the-loop + szyfrowanie = domyslna
  postawa). Zmiana zachowania instalacji = ciezar 2.0 mimo braku breaking API.

Rekomendacja: celowac w **2.0 "governance by default"** (najmocniejsza historia sprzedazowa),
decyzje wersji podjac przy flipie, po eval. Owner: WM.

## Skala niepublicznego korpusu

`release/v2.0.0-prep` jest **~285 commitow przed publicznym `mat/main` (v1.0.0)**. To caly
dorobek post-1.0.0 dotad trzymany na dev (origin). 2.0 = jego publikacja jako spojne wydanie.

## Zakres (co wchodzi w 2.0)

### A. Juz zintegrowane w release-prep (niepubliczne, gotowe)
- **i18n dwujezyczny PL/EN** (spec 001, ADR-0132) - UI EN + agent locale (ADR-0135).
- **Picker konektorow MCP + 9 konektorow UE** (spec 002, ADR-0133/0134) - wybor jurysdykcji.
- **EN release + freeze konektorow UE + bundle desktop** (spec 003, ADR-0136).
- **At-rest native cipher** (ADR-0072, feat/at-rest-native-cipher - tresc wtopiona) - szyfrowanie
  calego pliku SQLite. KOMPLEMENTARNE do 005 (field-level) -> spojna historia "encryption" w 2.0.
- **Desktop packaging**, **KG fazy a/b/c** (CN patterns / dual-similarity / event-KG),
  **grounding provenance tabular** (ADR-0102), **kancelaria proposals**, **OC locator**,
  **tier governance envelope**, **pilotaz readiness** - tresc w wiekszosci wtopiona w release-prep
  (triage `--cherry-pick`: 0 pending dla wiekszosci; faza-a/grounding/tier=1, pilotaz=3 -> glownie
  szum privacy-scrub, do opcjonalnego doczyszczenia).

### B. Nowe ficzery za flaga (zmergowane na 2.0 w tej sesji)
- **Karty zatwierdzenia mutacji** (spec 004, ADR-0137) - human-in-the-loop write staging.
  Flaga `PATRON_MUTATION_APPROVAL` (off|all|high-stakes). US1+US2+US3 gotowe. ADR Przyjety, Konst. 1.7.0.
- **Field-level encryption** (spec 005, ADR-0138) - per-tenant DEK envelope. Flaga
  `PATRON_FIELD_ENCRYPTION`. Phase 2 fundament gotowy; US1+ bramkowane sign-offem WM (Q1-Q6).

### C. Kandydat (jeszcze nie zaczety) - decyzja WM
- **#4 Asystenci: scope per modul/rola + tool-allowlist + tuning promptow w UI** (agent-native,
  z reconu open-mercato). Trzecia glowa wydania - opcjonalnie.

### D. Wpiete w Etapie A roadmapy (2026-07-04, patrz ROADMAP.md)
- **Wersje jezykowe rynkow UE** (ADR-0139, 006-locale-it-market) - lean market edition IT/DE/ES/FR.
- **Cost-caps per sprawa + OpenRouter** (ADR-0092/0093, pilotaz-readiness) - migracja 010.
- **Audyt Fable5 fazy 1-5** (ADR-0109/0110, faza1-audit-prep) - rodo.delete event, posture egress
  w UI, ekstraktor niezacytowanych odwolan, linkage cytat-edycja, D4 SECURITY.md.
- **Publication gate** (CI leak-scan) + **code-review-graph** (devtools).
- **WYMAGA OSADU** (ADR-0103, flaga `PATRON_CITATION_JUDGE` OFF) - wspolistnieje z lokatorem.
- **Human-review komorek tabular** (ADR-0126 12b+12c, migracja 018) - dokonczony WIP z worktree oc;
  kontrolka UI = rezerwacja.
- **Watchers ADR-0108 (Proponowany) + lint least-privilege** (watcher-d-lint).

## Stan integracji
- 004 + 005 zmergowane na `release/v2.0.0-prep` (czysto, zero konfliktow).
- Suite po Etapie A roadmapy: **1365 pass / 5 todo / 0 fail** (backend), tsc 0 (backend),
  frontend `next build` zielony.
  Migracje spojne (004=015/016, 005=017, cost-cap=010, cell-review=018).

## Rejestr wolnych numerow (anty-kolizja, aktualizuj przy KAZDEJ rezerwacji)

Numery migracji Postgres i ADR byly rezerwowane rownolegle na galeziach -> kolizje
(migracja 014 zajeta 2x; ADR 0108-0126 zyly poza linia release). Od teraz numer
bierze sie STAD i od razu podbija licznik w tym samym commicie co plik.

- **Nastepna migracja Postgres:** `020` (ostatnia zajeta: 019_audit_log_event_type_parity_cost_cap)
- **Nastepny ADR:** `0148` (ostatni zajety: 0147-system-wizualny-2-0-i-perymetr; 0144/0145 = renumeracja Fable5 przy scaleniu linii 2026-08-18)

## Higiena galezi (lekcja z 2026-07-04)

1. WIP ZAWSZE zacommitowany (choćby `wip:`) - niezacommitowana praca na dysku
   worktree przelezala tygodnie i prawie zginela (ADR-0126 12b/12c).
2. Galaz po wtopieniu tresci do release-prep KASOWAC od razu (tipy-zombie
   z privacy-scrubem klamia o stanie repo; prawde daje tylko
   `git log --cherry-pick --right-only`).
3. Worktree po skonczonej fazie usuwac (`git worktree remove`).
4. Dane testowe = syntetyczna obsada (Rumpole) OD PIERWSZEGO commita galezi -
   scrub po fakcie zasmieca historie wszystkich galezi i generuje falszywe konflikty.
5. Galezie czysto-szumowe do skasowania po tagu v2.0.0: faza-a/b/c,
   tier-governance-envelope, desktop-packaging, backup/picker-pre-rebase.

## Bramki wydania (checklist do tagu v2.0.0)
- [ ] Decyzja #4 (trzecia glowa) - WM.
- [ ] Sign-off WM dla 005: Q1-Q6 (zrodlo KEK serwer, lista pol, migracja, format, audit_log NIE, backup KEK).
- [x] Runbook backup/odzyskania KEK + `npm run kek:verify` (A2-3, spec 009; warunek wydania - governance/runbooks/kek-backup-recovery.md). Q6 ma tresc-rekomendacje do sign-off.
- [x] Narzedzia wydania (A3, specy 012-015): testy frontendu w CI, `npm run e2e:smoke` (spakowany stack), `npm run release:all` (6 edycji + manifest + draft gh; publikacja = WM), CI na wszystkich galeziach.
- [ ] Przy wydaniu: `npm version X.Y.Z --no-git-tag-version` w desktop/ -> `npm run release:all -- --draft` -> przeglad draftu -> Publish (WM).
- [ ] `security-review` na krypto 005 (OBOWIAZKOWY przed wpieciem kolumn).
- [ ] Wpiecie kolumn 005 (US1 pilot -> US2) jezeli wchodzi w 2.0; albo 005 zostaje fundamentem.
- [ ] Eval (korpus PL) - warunek flipu flag wg konwencji (ADR-0101/0102).
- [ ] Decyzja flipu defaultow per flaga (PATRON_MUTATION_APPROVAL / PATRON_FIELD_ENCRYPTION) -> wersja 1.1 vs 2.0.
- [ ] 2x review WM + matematic-patron-pr-review-pl na pelnym diffie 2.0.
- [ ] ADR-0137/0138 status koncowy + bump Konstytucji + CHANGELOG (sekcja 2.0).
- [ ] Merge `release/v2.0.0-prep` -> `main`, tag `v2.0.0`.
- [ ] Push publiczny `mat` + ogloszenie (LinkedIn EN-first, draft gotowy w skill linkedin-voice).

## Notatka recon (2026-06-30)
Triage `git log --cherry-pick --right-only`: wiekszosc loose feat-branchy ma 0 pending patchy
(tresc w release-prep). Tipy galezi rozjechane przez `chore(privacy): scrub` - is-ancestor klamie,
dlatego patch-id (--cherry-pick) jest wlasciwym miernikiem. Pelny per-branch audit = opcjonalny.
