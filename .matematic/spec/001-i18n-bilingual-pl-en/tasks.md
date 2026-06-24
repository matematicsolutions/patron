# Tasks: Dwujęzyczny PATRON (PL/EN) — i18n aplikacji

**Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md)
Format: `[ID] [P?] [Story] Opis`. `[P]` = parallel-safe (różne pliki, brak zależności).

## Phase 1 — Setup
- [ ] T001 Branch `feat/i18n-bilingual-pl-en` off aktualnego `main` (repo siedzi na `chore/code-review-graph-integration` — odbić od main, nie od chore).
- [ ] T002 [P] ADR-0132 `governance/adr/0132-locale-selection-jeden-jezyk-per-instalacja.md` — decyzja: jeden język per instalacja, źródło=config, bez next-intl, bez locale-in-URL, EN=deep-partial+fallback PL. (Wymóg AGENTS.md; 2× wewnętrzny review treści przed merge.)

## Phase 2 — Foundational (BLOKUJE US1 i US2)
- [ ] T003 Namierzyć źródło configu "język instalacji" (Q1): electron settings store / config backendu / env. Udokumentować w plan.md jako rozstrzygnięte.
- [ ] T004 Zdefiniować typ `Locale = "pl" | "en"` + kontrakt `setLocale`/`getLocale` w `frontend/src/i18n/index.ts` (jeszcze bez en.ts — sam szkielet stanu + fallback do pl).
- [ ] T005 Rozwiązać bootstrap locale przed pierwszym renderem (Q2) — ustawić `setLocale(config)` w punkcie startowym aplikacji tak, by nie było flashu PL→EN (SSR/hydration Next.js).

## Phase 3 — US1 (P1, MVP): Dwujęzyczne UI
- [ ] T010 [US1] `frontend/src/i18n/index.ts`: `lookup` wybiera słownik wg `activeLocale` (en→fallback pl); `t()` bez zmiany sygnatury, nadal typowane.
- [ ] T011 [US1] `index.ts`: helpery formatu locale-aware — `localeTag(activeLocale)` (`pl-PL`|`en-GB`) w `formatDate/DateTime/Number/Currency`.
- [ ] T012 [US1] `index.ts`: `formatRelative` — słowa względne EN ("now / X min ago / yesterday / X days ago") wg locale (mapa per-locale lub `common.relative.*`).
- [ ] T013 [P] [US1] `frontend/src/i18n/en.ts` — `DeepPartial<typeof pl>`, tłumaczenie sekcji `common` + nawigacja (MVP rdzeń). Terminologia legal-EN: draft.
- [ ] T014 [P] [US1] `en.ts` — pozostałe sekcje (chat / docs / account / projects / modals / assistant) wg częstości użycia.
- [ ] T015 [US1] Przegląd terminologii prawnej `en.ts` przez `reviewer-en` + pass legal-EN (Q3) — etykiety niosące znaczenie ("pełnomocnictwo", "sygnatura").

**Checkpoint US1:** locale=EN → całe UI + daty/liczby po EN; locale=PL → zero regresji. Niezależnie deployowalne jako MVP.

## Phase 4 — US2 (P2): Agent odpowiada po angielsku
- [ ] T020 [US2] `backend/src/lib/chat/prompts.ts` — parametr języka z configu (to samo źródło co UI, T003).
- [ ] T021 [US2] Przeciągnąć język przez `messages.ts` / `stream.ts` / `citation/judge.ts` wg potrzeby; logika groundingu i `pl-entities` BEZ zmian.
- [ ] T022 [US2] Potwierdzić, że konstrukcja promptu nadal przechodzi przez audit hash-chain (AC2.2) — test/inspekcja ścieżki audytu.

**Checkpoint US2:** locale=EN → agent po EN, cytaty/sygnatury i audyt bez zmian.

## Phase 5 — US3 (P3): Hardening + docs
- [ ] T030 [P] [US3] `frontend/src/i18n/i18n.test.ts` — test fallbacku EN→PL, kompletności (klucze en ⊆ pl, brak osieroconych), formatu EN.
- [ ] T031 [P] [US3] Fix drift: `AGENTS.md` sekcja i18n → `frontend/src/i18n/` (nie `frontend/messages/`).
- [ ] T032 [US3] `tsc` 0 (backend+frontend) + `vitest` bez regresji (≥1265 pass / 0 fail) — bramka jakości.
- [ ] T033 [P] [US3] CHANGELOG + nota README (commit messages bez polskich znaków).
- [ ] T034 [US3] `matematic-patron-pr-review-pl` na diffie przed merge (regresje specyficzne dla repo) + bramka push WM.

## Parallel Opportunities
- T002 ‖ (faza 1, niezależne od kodu).
- T013 ‖ T014 (różne sekcje en.ts — uwaga: oba dotykają jednego pliku `en.ts`; jeśli jeden agent, sekwencyjnie; jeśli rozbić, na osobne pliki-fragmenty scalane importem).
- T030 ‖ T031 ‖ T033 (test / docs / changelog — różne pliki).

## Uwaga o równoległości en.ts
`en.ts` to jeden plik → T013/T014 NIE są bezpiecznie równoległe dla dwóch agentów piszących ten sam plik. Albo sekwencyjnie, albo rozbić słownik EN na fragmenty (`en/common.ts`, `en/chat.ts`...) scalane w `en.ts` — wtedy realnie `[P]`. Decyzja przy implementacji.
