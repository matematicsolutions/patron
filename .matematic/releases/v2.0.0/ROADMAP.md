# PATRON 2.0 - mapa drogowa produkcji (kolejnosc wg ROI)

**Data:** 2026-07-04. **Zrodlo:** pelna inwentaryzacja repo (galezie vs release/v2.0.0-prep,
triage patch-id), THIRD_PARTY_INSPIRATIONS.md (21 wzorcow wdrozonych, 2 zaplanowane),
worktree'y (faza1 / oc / watchers) i archiwum. Uzupelnia tracker README.md (bramki wydania).

Zasada kolejnosci: najpierw praca JUZ WYKONANA a niewpieta (koszt=merge, zysk=ficzer),
potem dokonczenie WIP, potem bramki WM, na koncu backlog 2.1. Kazdy krok za flaga OFF
tam, gdzie zmienia zachowanie.

## Etap A - wpiecie wykonanej pracy (autonomiczne, niskie ryzyko)

| # | Krok | Zrodlo | Wartosc | Stan |
|---|------|--------|---------|------|
| A1 | Merge `006-locale-it-market` (4 commity, fast-forward) | ADR-0139 | 6 edycji jezykowych w linii 2.0 (lean market edition); domyka najwiekszy ficzer sprzedazowy | ZROBIONE 2026-07-04 (ff 37dc133) |
| A2 | Merge `feat/pilotaz-readiness` (3 commity) | ADR-0092/0093 | twarde cost-caps per sprawa + OpenRouter w selektorze = gotowosc pilotazowa (przychod) | ZROBIONE 2026-07-04 (d027c86; selektor modeli: zostala nowsza wersja z HEAD) |
| A3 | Merge `fix/faza1-audit-prep` (5 commitow) | ADR-0109/0110 | rodo.delete audit event, widocznosc posture egress w UI, ekstraktor niezacytowanych odwolan, linkage cytat-edycja + SECURITY.md - rdzen tematu "governance by default" | ZROBIONE 2026-07-04 (ee13716) |
| A4 | Merge `chore/publication-gate` (1 commit) | CI | skaner wyciekow przed publikacja - obsluguje bramke "push publiczny mat" z checklisty wydania | ZROBIONE 2026-07-04 (b9b91f5; config = unia deny_paths + precyzyjne allow_paths) |
| A5 | Merge `claude/citation-requires-judgment` (2 commity) | ADR-0103 | sygnal WYMAGA OSADU (teza nieoceniona semantycznie); flaga `PATRON_CITATION_JUDGE` OFF | ZROBIONE 2026-07-04 (f119567; wspolistnieje z lokatorem ADR-0116/0122) |
| A6 | Dokonczyc WIP z worktree oc: human-review komorek tabular (96 linii, niezacommitowane; migracja wymaga renumeracji 014->018) | ADR-0126 | domyka human-in-the-loop dla tabular review | ZROBIONE 2026-07-04 (874a8b6; 12b+12c, kontrolka UI = rezerwacja) |
| A7 | Merge `feat/watcher-d-lint` (2 commity) | ADR-0108 (Proponowany) | lint least-privilege zakresu narzedzi + ADR watchers; sama propozycja + lint, bez zmiany zachowania | ZROBIONE 2026-07-04 (e1bea44) |
| A8 | (opcja) Merge `chore/code-review-graph-integration` | devtools | code-review-graph MCP + PR-review action; CI, nie shipping | ZROBIONE 2026-07-04 |

Po kazdej partii: `npm run test:backend` + `tsc` zielone; migracje spojne (`migrate:status`).
Galezie czysto-szumowe (tylko `chore(privacy): scrub`): faza-a/b/c, tier-governance-envelope,
desktop-packaging - tresc juz wtopiona, tipy do skasowania przy sprzataniu po tagu.

## Etap B - bramki wymagajace Wieslawa (przygotowane, nie wykonywane autonomicznie)

| # | Bramka | Co przygotowuje agent | Co decyduje WM |
|---|--------|----------------------|----------------|
| B1 | Spec 005 US1-US3 (field-level encryption) | odpowiedzi-rekomendacje do Q1-Q6 + plan US1 pilot | sign-off Q1-Q6, potem OBOWIAZKOWY `security-review` krypto |
| B2 | Eval (korpus PL) | uruchomienie evalu i raport | akceptacja wyniku = warunek flipu flag |
| B3 | Flip defaultow (`PATRON_MUTATION_APPROVAL`, `PATRON_FIELD_ENCRYPTION`) | rekomendacja per flaga | decyzja 1.1 (opt-in) vs 2.0 (governance by default) |
| B4 | Decyzja #4 - asystenci: scope per modul/rola + tool-allowlist | recon gotowy (open-mercato) | wchodzi w 2.0 czy 2.1 |
| B5 | Code signing instalatora (Authenticode) | konfiguracja electron-builder + runbook signtool | zakup certyfikatu (EV/OV) - akt zakupowy = czlowiek |
| B6 | Wydanie: 2x review WM + `matematic-patron-pr-review-pl` na pelnym diffie -> merge do `main` -> tag `v2.0.0` -> push publiczny `mat` + ogloszenie EN-first | pelny diff + raport review skillem | oba review + zgoda na push publiczny |

## Etap C - backlog 2.1+ (zapisana wiedza, jeszcze nie praca)

- **ADR-0021** time-travel diff nowelizacji (wzorzec korean-law-mcp, MIT) - mechaniczne
  porownanie przepisu miedzy datami, anty-halucynacja.
- **ADR-0031/0032** preflight guardrail: policy -> SMT-LIB -> lokalny solver + proof receipt
  (wzorzec icme-preflight-guardrail, MIT).
- **Watchers pelna implementacja** (ADR-0108 - w 2.0 wchodzi tylko ADR+lint).
- **PixelRAG** (spike 2026-06-20: operacyjnie lepszy, jakosciowo nie) - czekac na 2.1.
- **ADR-0041** distributed lock dla multi-instance (dzis single-instance OK).
- **Scouting OSS**: 59 kandydatow w `reference_legaltech_oss_scouting_2026-06-25.md`
  (12 juz opublikowanych/adaptowanych) + nowe repa zgromadzone przez WM - osobna sesja triage
  przez skill `legaltech-scout` (4 bramki) PO wydaniu 2.0.

## Stan wiedzy (uporzadkowany)

- **Wdrozone wzorce z repo obcych:** 21 (pelna lista z ADR: THIRD_PARTY_INSPIRATIONS.md).
- **Konektory:** 6 PL/EU wlasnych + KIO POC + 9 krajowych ELI w bundlu desktop; legalize-mcp
  (32 jurysdykcje) jako produkt rownolegly.
- **W 2.0-prep przed ta mapa:** spec 001-005, at-rest cipher, KG fazy a/b/c, grounding
  provenance, kancelaria proposals, OC locator, audyt P1-P3 (~285 commitow vs publiczny main).
- **Suite bazowa:** 1328 pass / 5 todo / 0 fail, tsc 0 (stan 2026-06-30, przed Etapem A).
