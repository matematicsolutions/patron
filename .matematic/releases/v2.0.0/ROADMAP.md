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

## Etap A2 - luki produktowe (opinia CTO 2026-07-04; sesja Fabryka 2026-07-04, spec-driven)

| # | Krok | Uzasadnienie | Stan |
|---|------|--------------|------|
| A2-1 | **UI human-review komorek** (kontrolka approve/reject/correct w TRTable/TRSidePanel + badge) | backend gotowy (ADR-0126 12b/12c); ficzer governance niewidoczny dla prawnika nie istnieje - to brakujaca polowa tematu 2.0 | ZROBIONE 2026-07-04 (spec 007; i18n 6 locale, effective content corrected/rejected) |
| A2-2 | **Auto-update** (electron-updater z GitHub Releases) | 6 edycji x kazde wydanie = 6 recznych reinstalacji u klientow; najwyzszy ROI z rzeczy nieobecnych | ZROBIONE 2026-07-04 (spec 008; kanaly latest[-xx], instalacja po decyzji czlowieka, kill-switch, --publish=never) |
| A2-3 | **Runbook backup/odzyskanie KEK** (procedura "kancelaria zgubila klucz") | szyfrowanie bez procedury odzyskania = ryzyko nieodwracalnej utraty akt - odwrotnosc obietnicy produktu; podniesc z Q6 do warunku wydania | ZROBIONE 2026-07-04 (spec 009; governance/runbooks/kek-backup-recovery.md + npm run kek:verify, smoke 0/1/2; wpisane do bramek wydania) |
| A2-4 | **Eval jedna komenda** (spiac legal-eval-harness, raport = artefakt CI) | eval jest bramka flipu flag - dzis to "wydarzenie", ma byc narzedzie | ZROBIONE 2026-07-04 (spec 010; scripts/run-eval.cjs 3 etapy + eval.yml; smoke A 27/27, B LEDGAR 99.4%) |
| A2-5 | **Konfiguracja code signing** (build-locale + runbook signtool; cert kupuje WM) | przygotowanie pod B5 - po zakupie certu flip samymi env | ZROBIONE 2026-07-04 (spec 011; signtool post-build + regeneracja sha512/blockmap, runbook code-signing.md) |

## Etap A3 - fabryka do 10/10 (zielone WM 2026-07-05; sesja Fabryka, spec-driven)

| # | Krok | Wartosc | Stan |
|---|------|---------|------|
| A3-1 | Siatka testow frontendu (vitest + testing-library + parytet i18n) | pierwszy raz frontend ma testy (bylo 0 vs 1365 backend); kontrolki governance pod siatka | ZROBIONE 2026-07-05 (spec 012; 12 testow, w CI) |
| A3-2 | E2E smoke spakowanej aplikacji (`npm run e2e:smoke`) | boot win-unpacked na czystym temp profilu, health backend+frontend; koniec z recznym "czy wstaje" x6 edycji | ZROBIONE 2026-07-05 (spec 013; PASS na realnym buildzie) |
| A3-3 | Wydanie jedna komenda (`npm run release:all`) | 6 edycji sekwencyjnie + weryfikacja artefaktow + manifest SHA256 + smoke + opcjonalny DRAFT releasu gh (publikacja = WM) | ZROBIONE 2026-07-05 (spec 014) |
| A3-4 | CI na wszystkich galeziach + vitest frontendu w CI | czerwona suita widoczna na galezi roboczej, nie przy merge do release | ZROBIONE 2026-07-05 (spec 015) |

Backlog A4 (swiadomie NIE teraz): supply-chain gate w CI (npm audit/Dependabot -
wymaga najpierw triage zastanych advisories), kanal zwrotny "Zgloś problem"
(lokalna paczka diagnostyczna, zero-cloud), proba generalna auto-update rc->rc2.

## Etap B - bramki wymagajace Wieslawa (przygotowane, nie wykonywane autonomicznie)

| # | Bramka | Co przygotowuje agent | Co decyduje WM |
|---|--------|----------------------|----------------|
| B1 | Spec 005 US1-US3 (field-level encryption) | odpowiedzi-rekomendacje do Q1-Q6 + plan US1 pilot | sign-off Q1-Q6, potem OBOWIAZKOWY `security-review` krypto |
| B2 | Eval (korpus PL) | uruchomienie evalu i raport | akceptacja wyniku = warunek flipu flag |
| B3 | Flip defaultow (`PATRON_MUTATION_APPROVAL`, `PATRON_FIELD_ENCRYPTION`) | rekomendacja per flaga | decyzja 1.1 (opt-in) vs 2.0 (governance by default) |
| B4 | Decyzja #4 - asystenci: scope per modul/rola + tool-allowlist | recon gotowy (open-mercato) | wchodzi w 2.0 czy 2.1 |
| B5 | Code signing instalatora (Authenticode) | GOTOWE (A2-5, spec 011): krok signtool w build-locale.cjs, flip samymi env; runbook governance/runbooks/code-signing.md | zakup certyfikatu (EV/OV) - akt zakupowy = czlowiek |
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

## Audyt adopcji rekonesansu patentowego CN/EU/USA (2026-07-04)

Porownanie 7 wzorcow z reconu 2026-05-31 (reference_china_patent_recon) + roadmapy
retrievalu (archiwum, kandydaci ADR 0083-0088) z faktycznym stanem repo. Werdykt:
**roadmapa retrievalu zrealizowana w calosci** - fazy A/B/C wdrozone i wpiete w
request-path, faza D oceniona i swiadomie odrzucona (ADR-0088).

| Wzorzec (zrodlo) | ADR | Slad w kodzie | Decyzja |
|---|---|---|---|
| Clause-boundary chunking + parser sekcji wyroku (CN111783399B / LegRAG) | 0083 (Wdrozony) | `retrieval/legalChunker.ts` + testy | w 2.0 |
| Copy-mechanism generative NER (PMC11622873) | 0084 (Wdrozony) | `pl-entities/copySpan.ts` | w 2.0 |
| WuManber weak-supervision bootstrap PL NER (CN115221265A) | 0085 (Wdrozony) | `pl-entities/wuManber.ts` + `bootstrapAnnotate.ts` | w 2.0 |
| Dual-similarity case ranking (Ping An US12001466B2) | 0086 biblioteka + 0087 wpiecie w retrieve() | `retrieval/dualSimilarity.ts`; re-ranking post-RRF, nDCG@5 0.661->0.735 (+11.1%) | w 2.0 (flaga opt-out, alpha z env) |
| Event-centric legal KG + subgraph matching (Tianjin CN112632223B/225B) | 0089 rdzen + 0090 wpiecie | `retrieval/events.ts`; nDCG@5 0.764->0.847 (+10.8%); US2 (model uczony) i US3 (multi-hop) = rezerwacje | w 2.0; US2/US3 backlog 2.1 |
| Hash-chain audit log (prior-art CN101039186B wygasly + EP2897051A2) | 0001 (sprzed reconu) | `lib/audit/` | w 2.0 od zawsze; recon potwierdzil zero FTO / niepatentowalnosc |
| Huawei SINQ (kwantyzacja) | 0088 (ocena fazy D) | brak (celowo) | PORZUCONE: embedder PATRONA to e5-small ONNX (nie PyTorch), chat = BYOK/GGUF juz skwantyzowany - nie ma czego kwantyzowac. Wraca tylko przy bundlowaniu wlasnego modelu PyTorch |
| Alibaba Proxima/Zvec (on-device vector store) | 0088 (ocena fazy D) | `scripts/vec-bench.cjs` (pomiar, bez zmian kodu) | BACKLOG 2.1+ warunkowy (bookmark): flip dopiero gdy LACZNIE (a) korpus >~100k chunkow (dzis p95 10-50ms przy <50k = OK), (b) Zvec szyfrowalny at-rest (Art. 2 - dzis luka vs ADR-0072), (c) bench recall@k parytet z exact KNN na korpusie PL |
| CLAKG (LLM-driven konstrukcja KG) | brak | zero sladu | PORZUCONE z powodem: potrzebe konstrukcji KG pokryl wlasny deterministyczny event-KG (ADR-0089/0090); CLAKG wnosi LLM w petli budowy grafu = koszt + niedeterminizm bez przewagi dla PATRON |

ADR-0087 = wpiecie dual-similarity w retrieve() (domkniecie rezerwacji 0086).
ADR-0088 = ocena fazy D z decyzja "utrzymac sqlite-vec" + progi flipu Zvec.
Atrybucje wszystkich wzorcow sa w THIRD_PARTY_INSPIRATIONS.md (clean-room: wzorzec, nie kod).

## Stan wiedzy (uporzadkowany)

- **Wdrozone wzorce z repo obcych:** 21 (pelna lista z ADR: THIRD_PARTY_INSPIRATIONS.md).
- **Konektory:** 6 PL/EU wlasnych + KIO POC + 9 krajowych ELI w bundlu desktop; legalize-mcp
  (32 jurysdykcje) jako produkt rownolegly.
- **W 2.0-prep przed ta mapa:** spec 001-005, at-rest cipher, KG fazy a/b/c, grounding
  provenance, kancelaria proposals, OC locator, audyt P1-P3 (~285 commitow vs publiczny main).
- **Suite bazowa:** 1328 pass / 5 todo / 0 fail, tsc 0 (stan 2026-06-30, przed Etapem A).
