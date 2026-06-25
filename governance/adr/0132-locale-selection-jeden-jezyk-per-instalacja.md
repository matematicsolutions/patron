# ADR-0132: Wybor jezyka UI (locale) - jeden jezyk per instalacja

**Status**: Przyjety (2026-06-24) — WM zatwierdzil ship EN UI 2026-06-24. Mechanizm zaimplementowany i zweryfikowany (frontend tsc=0, runtime PL/EN OK).

## Kontekst

Ekspansja europejska (konektory MCP UE i strona juz po angielsku). Sama aplikacja
PATRON jest PL-only — anglojezyczny mecenas trafia w polska sciane UI.

Stan zastany (recon 2026-06-24): warstwa i18n **juz istnieje i dziala** —
`frontend/src/i18n/index.ts` (typowane `t(key)` + helpery formatu),
`frontend/src/i18n/pl.ts` (37KB slownik, jedno zrodlo kluczy), uzywana w ~50 plikach.
Brakuje: `en.ts`, mechanizmu wyboru locale (dzis tylko `DATE_LOCALE = "pl-PL"`
zahardkodowane), lokalizacji helperow formatu.

Autor warstwy zapisal intencje w naglowku `pl.ts`: *"Patron = jedna kancelaria =
jeden jezyk -> bez next-intl middleware, bez locale w URL. Domyslnie PL, opcjonalnie
EN (klucze fallback)."* PATRON jest aplikacja **single-user, zero-cloud desktop**
(ADR-0053) — jedna instalacja obsluguje jedna kancelarie.

## Decyzja

1. **Locale = `"pl" | "en"`**, wybierane **per instalacja** (nie per URL, nie per
   sesja, nie w trakcie rozmowy). Domyslnie `"pl"` — zero regresji dla istniejacych
   instalacji.
2. **Jedno zrodlo prawdy** = zmienna build-time **`NEXT_PUBLIC_PATRON_LOCALE`**
   (`"pl"` | `"en"`, domyslnie `pl`) — decyzja WM 2026-06-24. Frontend czyta ja przy
   inicjalizacji modulu `i18n` (stala build-time -> serwer i klient zgodne, brak
   flashu/hydration-mismatch). Backend (jezyk agenta, US2) czyta to samo zrodlo.
   Bez nowej zaleznosci, bez migracji DB. Przelacznik w UI = ewentualny przyszly
   aneks ADR (wymagalby electron-settings/pola profilu).
3. **Bez `next-intl` / `i18next` / locale-in-URL / middleware.** Rozszerzamy istniejacy
   lekki dictionary-lookup, nie zastepujemy go.
4. **`en.ts` = `DeepPartial<typeof pl>`** — PL pozostaje zrodlem kluczy
   (`TranslationKey` nadal generowane z `pl`); brak klucza EN -> fallback do PL
   (istniejaca filozofia `t()`). Pozwala uzupelniac EN przyrostowo.
5. **Helpery formatu** (`formatDate/DateTime/Relative/Number/Currency`)
   parametryzowane locale (`pl-PL` -> `en-GB` przez `Intl`); slowa wzgledne
   ("teraz/wczoraj") z mapy per-locale.
6. **`t()` pozostaje synchroniczne** — locale rozwiazywane raz przy bootstrapie
   aplikacji (przed pierwszym renderem), trzymane w stanie modulu i18n.

### Granica (co NIE jest objete)

- Substancja prawna pozostaje **wg jurysdykcji** — wybor konektora MCP = wybor prawa.
  Konektory PL, `backend/src/lib/pl-entities/` (PESEL/NIP/sygnatury) i glebokie skille
  PL **zostaja PL** (zgodnie z zakazem forkowania pl-entities, AGENTS.md).
- Natywne locale DE/FR/ES/IT — **dopiero na pull konkretnego rynku**. Architektura ma
  to udzwignac tanio, ale nie budujemy spekulacyjnie.
- US2 (jezyk odpowiedzi agenta) korzysta z tego samego zrodla configu, ale konstrukcja
  promptu **musi pozostac w sciezce audit hash-chain** (AI Act art. 12) — bypass = blad
  krytyczny.

## Konsekwencje

**Pozytywne:**
- Zdejmuje bariere wejscia produktu dla rynku EU bez utraty rdzenia PL.
- Kolejny jezyk = nowy `xx.ts` + wpis w configu; architektura gotowa.
- Default PL = zero regresji; zmiana czysto addytywna.

**Koszt / dlug:**
- Wprowadzamy **mutowalny stan modulu** (`activeLocale` + `setLocale`). Uzasadnienie:
  `t()` jest synchroniczne i wolane w ~50 call-site bez przekazywania locale; jeden
  setter ustawiany przy bootstrapie jest tansza i mniej ryzykowna zmiana niz
  przepisanie sygnatury `t()` w 50+ miejscach.
- Bootstrap musi ustawic locale **przed pierwszym renderem**, by uniknac flashu PL->EN
  (Next.js SSR/hydration).

## Alternatywy odrzucone

| Alternatywa | Powod odrzucenia |
|---|---|
| `next-intl` / `i18next` + locale w URL | Middleware + routing, ktorych single-user desktop nie potrzebuje; sprzeczne z "jedna kancelaria = jeden jezyk"; cofa swiadoma decyzje autora |
| `locale` jako argument kazdego `t()` | Zmiana sygnatury i 50+ call-site; duzy blast radius bez wartosci (jeden jezyk per instalacja i tak nie zmienia sie w runtime) |
| Przelacznik jezyka w trakcie sesji | Brak potrzeby (jedna kancelaria = jeden jezyk); dokladalby zlozonosc re-renderu i stanu |

## Powiazania

- Spec: `.matematic/spec/001-i18n-bilingual-pl-en/` (spec.md / plan.md / tasks.md)
- ADR-0053 (SQLite single-user zero-cloud) — uzasadnia "jeden jezyk per instalacja"
- AGENTS.md — TS strict, audit-first, zakaz forkowania pl-entities, ADR-first
