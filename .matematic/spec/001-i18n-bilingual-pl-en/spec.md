# Feature: Dwujęzyczny PATRON (PL/EN) — i18n aplikacji

**Branch:** `feat/i18n-bilingual-pl-en` (off aktualnego `main`)
**Date:** 2026-06-24
**Status:** Draft
**Project Type:** `agent-product` / `desktop-app` (Next.js frontend + Node backend, monorepo, AGPL-3.0 powłoka)

## Problem statement

Ruszamy do Europy. Konektory MCP (de/at/es/fi/ie/nl/se/fr/lu-eli) i strona już mówią po angielsku, jutro idzie EN post o europejskich MCP. Ale **sama aplikacja PATRON jest PL-only** — europejski mecenas, który po poście zechce dotknąć produktu, trafia w polską ścianę UI. Trzeba zdjąć tę ścianę: PATRON ma działać dwujęzycznie, bez utraty tego, co jest jego rdzeniem (polska głębia prawna, grounding, tajemnica zawodowa, audyt).

**Stan zastany (recon 2026-06-24):** warstwa i18n już istnieje i działa — `frontend/src/i18n/index.ts` (typowane `t(key)` + helpery formatu), `frontend/src/i18n/pl.ts` (37KB słownik, jedno źródło), używana w ~50 plikach. **Brakuje:** `en.ts`, mechanizmu wyboru locale (dziś tylko `DATE_LOCALE="pl-PL"` zahardkodowane), lokalizacji helperów formatu. Język interakcji agenta żyje osobno w `backend/src/lib/chat/prompts.ts` (+ `messages.ts`, `stream.ts`, `citation/judge.ts`).

## Granica (twarda — to NIE jest tłumaczenie całego PATRONa)

| Warstwa | Co robimy |
|---|---|
| UI / chrome / etykiety | → EN (lokalizacja, `en.ts`) |
| Język odpowiedzi agenta | → EN (opcjonalnie, US2; prompty backendu) |
| Metoda (grounding, citation-check, anti-halucynacja) | jurysdykcyjnie neutralna — działa tak samo |
| **Substancja prawna** | **wg jurysdykcji — wybór konektora MCP = wybór prawa**, nie tłumaczymy |
| `backend/src/lib/pl-entities/` (PESEL/NIP/sygnatury) | **zostaje PL** — nie forkować (reguła AGENTS.md) |
| Głębokie skille PL (adversarial-legal-review-pl itd.) | **zostają PL** |

Zasada: "kancelaria = jeden język" (intencja autora w `pl.ts`) — język **wybierany w configu instalacji**, nie przełącznik w URL, bez `next-intl`.

## User Stories

### US1 (P1, MVP) — Dwujęzyczne UI
**Jako** europejski prawnik / kancelaria pracująca po angielsku **chcę** całe UI PATRONa w EN **żeby** móc używać produktu bez polskiej bariery.

**Acceptance Criteria:**
- [ ] AC1.1: Istnieje `frontend/src/i18n/en.ts` — lustro kluczy `pl.ts` (deep-partial dozwolone; brak klucza EN → fallback do PL, zgodnie z istniejącą filozofią `t()`).
- [ ] AC1.2: `index.ts` wybiera aktywny słownik wg locale; `t()` pozostaje synchroniczne i typowane (`TranslationKey` nadal generowane z `pl` jako źródła kluczy).
- [ ] AC1.3: Helpery `formatDate/DateTime/Relative/Number/Currency` są parametryzowane locale (`pl-PL` → `en-GB` przez `Intl`); słowa względne ("teraz/wczoraj/min temu") mają odpowiedniki EN.
- [ ] AC1.4: Locale ustawiany raz przy starcie z configu instalacji (jeden język per instalacja); domyślnie PL — zero regresji dla obecnych instalacji PL.
- [ ] AC1.5: Instalacja skonfigurowana na EN pokazuje UI chrome + daty/liczby po angielsku we wszystkich ~50 miejscach używających `t()`.

**Independent Test:** ustaw locale=EN w configu → cały UI po EN, daty `DD/MM/YYYY`, brak `[i18n] missing key` w konsoli dla zaimplementowanych ekranów. Ustaw PL → identycznie jak dziś (regresja zero).

### US2 (P2) — Agent odpowiada po angielsku
**Jako** anglojęzyczny użytkownik **chcę** żeby agent prowadził rozmowę i pisał draft po EN **żeby** output był dla mnie czytelny.

**Acceptance Criteria:**
- [ ] AC2.1: Język interakcji agenta (`backend/src/lib/chat/prompts.ts` i pokrewne) parametryzowany locale z tego samego źródła configu co UI.
- [ ] AC2.2: Konstrukcja promptu nadal przechodzi przez audit hash-chain bez zmiany struktury (AGENTS.md: audit-first, bypass = błąd krytyczny).
- [ ] AC2.3: Grounding / citation-judge działa identycznie — zmiana języka NIE dotyka logiki weryfikacji cytatu ani `pl-entities`.
- [ ] AC2.4: Substancja prawna pozostaje wg jurysdykcji konektora (agent po EN nadal cytuje prawo PL z konektorów PL, prawo DE z `de-eli` itd.).

**Independent Test:** locale=EN → agent odpowiada po EN, cytaty/sygnatury bez zmian, wpis audytu obecny i zweryfikowany hash-chainem.

### US3 (P3) — Hardening, ADR, docs
**Jako** maintainer **chcę** domkniętą warstwę i zgodność z governance **żeby** dług nie odrósł.

**Acceptance Criteria:**
- [ ] AC3.1: ADR-0132 (locale-selection: jeden język per instalacja, źródło configu, brak next-intl) zatwierdzony — wymóg AGENTS.md "ADR przed decyzją architektoniczną".
- [ ] AC3.2: Naprawiony drift `AGENTS.md` — sekcja i18n wskazuje `frontend/src/i18n/` (nie nieistniejące `frontend/messages/`).
- [ ] AC3.3: Test kompletności tłumaczenia (klucze `en.ts` ⊆ `pl.ts`; brak osieroconych kluczy EN) + test fallbacku EN→PL + test formatu EN.
- [ ] AC3.4: `tsc` 0 błędów (backend+frontend), `vitest` zielone (nie regresować 1265/1270) — bramka jakości.
- [ ] AC3.5: CHANGELOG + nota w README; bez polskich znaków w commit messages (konwencja repo).

## Non-Goals (anti-scope)
- ❌ Locale w URL / `next-intl` middleware / przełącznik języka w trakcie sesji (sprzeczne z "jeden język per instalacja").
- ❌ Tłumaczenie konektorów PL, głębokich skilli PL, `pl-entities`.
- ❌ Natywne locale DE/FR/ES/IT — **dopiero na pull konkretnego rynku** (architektura ma to udźwignąć tanio, ale nie budujemy spekulacyjnie).
- ❌ Tłumaczenie treści dokumentów klienta / akt.

## Open Questions / NEEDS CLARIFICATION
- [ ] Q1: Gdzie fizycznie żyje config "język instalacji"? (electron settings store / tabela configu backendu / env). Plan musi to namierzyć — jedno źródło zasilające i frontend (`setLocale`) i backend (język promptu).
- [ ] Q2: `t()` jest synchroniczne → locale musi być rozwiązany PRZED pierwszym renderem (Next.js SSR/hydration). Jak bootstrapujemy locale, żeby nie było flashu PL→EN?
- [ ] Q3: Kto pisze i weryfikuje terminologię prawną w `en.ts`? Etykiety UI w aplikacji prawnej niosą znaczenie ("pełnomocnictwo", "sygnatura", "umocowanie"). Rekomendacja: draft → `reviewer-en` → przegląd terminologii legal-EN. NIE maszynowe tłumaczenie bez przeglądu.
- [ ] Q4: Czy US2 (język agenta) wchodzi w tę iterację, czy US1 ships solo a US2 osobno? (Domyślnie: US1 = MVP teraz, US2 decyzja WM.)
