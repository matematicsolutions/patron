# Plan: Dwujęzyczny PATRON (PL/EN) — i18n aplikacji

**Spec:** [spec.md](./spec.md)
**Project Type:** `agent-product` / `desktop-app`

## Technical Context
- **Language/Version:** TypeScript (strict, bez `any` — AGENTS.md). Frontend: Next.js + React. Backend: Node 20+.
- **Primary Dependencies (frontend):** next, react, tailwind, radix, supabase, @openrouter/sdk, tiptap. **Bez `next-intl`/`i18next`** — własna lekka warstwa `src/i18n` zostaje (zgodne z intencją autora).
- **Storage:** lokalny SQLite (desktop, ADR-0053) / Postgres (serwer). i18n nie dotyka schematu danych.
- **Testing:** vitest (frontend+backend), tsc gate. Stan bazowy: 1265 pass / 0 fail / 5 todo — NIE regresować.
- **Target Platform:** Windows-first desktop (Electron) + tryb serwerowy.
- **Constraints:** RODO-safe, zero-cloud default, audit-first, vendor-neutral. i18n jest warstwą prezentacji + języka interakcji — NIE dotyka egressu danych, neutralności providera ani logiki groundingu.
- **Scale/Scope:** ~50 plików konsumuje `t()`; `pl.ts` ~37KB (źródło kluczy). EN = deep-partial mirror + fallback.

## Architektura rozwiązania (rdzeń)

```
config instalacji (locale: "pl" | "en")   <- jedno źródło (Q1 do namierzenia)
        │
        ├──► frontend: i18n/index.ts  setLocale(locale) przy bootstrapie
        │         t(key): wybiera en→(fallback)pl ; format helpers wg locale
        │
        └──► backend: chat/prompts.ts  language=locale (US2)
                  prompt budowany w danym języku, audit hash-chain bez zmian
```

**`en.ts`:** `export const en: DeepPartial<typeof pl>` — PL pozostaje źródłem kluczy (`TranslationKey` nadal z `pl`), EN może być uzupełniany przyrostowo, brak klucza → fallback PL (istniejąca filozofia `t()`).

**`index.ts`:** `let activeLocale: Locale = "pl"`; `setLocale(l)`; `lookup(key)` wybiera słownik wg `activeLocale` (en→pl fallback); `DATE_LOCALE` const → funkcja `localeTag(activeLocale)` (`pl-PL`|`en-GB`); słowa względne ("teraz/wczoraj") z mapy per-locale albo z `common.relative.*` w słowniku.

## Constitution Check (GATE — przeciw `governance/CONSTITUTION.md` aplikacji + AGENTS.md + bramki MateMatic)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | ✅ PASS | Ekspansja EU bez utraty rdzenia PL; zdejmuje barierę wejścia produktu |
| Tajemnica zawodowa / zero-cloud | ✅ N/A | i18n nie zmienia ścieżki danych; brak nowego egressu |
| RODO (minimalizacja/PII) | ✅ N/A | tłumaczenie UI/promptu, brak danych osobowych |
| AI Act art. 12 — audit-first | 🟡 GATE dla US2 | konstrukcja promptu MUSI zostać w ścieżce audit hash-chain; bypass = błąd krytyczny (AC2.2) |
| Neutralność providera | ✅ N/A | brak zmian w warstwie LLM |
| `pl-entities` nietknięte | ✅ PASS | granica: PESEL/NIP/sygnatury zostają PL (AC2.3) |
| Bramka licencji | ✅ PASS | `en.ts` w powłoce = AGPL-3.0 (derivative). Bez nowych zależności |
| Bramka ToS / anty-OS | ✅ PASS | brak omijania ToS; brak `next-intl` (świadomie) |
| Bramka jakości | 🟡 GATE | `tsc` 0 + vitest bez regresji (AC3.4); strict, bez `any` |
| Bramka strategii | ✅ PASS | grot tezy EU; architektura i18n udźwignie kolejne języki na pull |
| ADR przed decyzją architektoniczną | 🟡 TODO | ADR-0132 (locale-selection) — wymóg AGENTS.md (AC3.1) |

**Werdykt GATE:** brak twardych FAIL. Dwa warunki do zielonego: (1) ADR-0132 zatwierdzony przed implementacją locale-selection; (2) US2 nie obchodzi audytu. Reszta PASS/N-A. `push`/merge = bramka WM (governance Art. VII).

## Project Structure (dotykane ścieżki)

```
frontend/src/i18n/
  index.ts        # MOD: activeLocale + setLocale + lookup wg locale + format helpers locale-aware
  pl.ts           # bez zmian (źródło kluczy)
  en.ts           # NEW: deep-partial mirror EN
  i18n.test.ts    # NEW: fallback EN→PL, kompletność kluczy, format EN
frontend/src/<bootstrap>            # MOD: setLocale(config) przed pierwszym renderem (Q2)
backend/src/lib/chat/prompts.ts     # MOD (US2): język promptu z configu
backend/src/lib/chat/{messages,stream}.ts, citation/judge.ts  # MOD (US2) wg potrzeb
<config instalacji>                 # MOD: pole locale (Q1 — namierzyć źródło)
governance/adr/0132-locale-selection-jeden-jezyk-per-instalacja.md  # NEW
AGENTS.md                           # MOD (AC3.2): i18n -> frontend/src/i18n/ (drift fix)
```

## Research notes
- Odrzucone: `next-intl` / `i18next` / locale-in-URL — sprzeczne z "jeden język per instalacja" (single-user desktop, kancelaria=jeden język), dokładają middleware i routing, którego model nie potrzebuje. Autor świadomie zbudował lekki dictionary-lookup; rozszerzamy go, nie zastępujemy.
- `Intl.DateTimeFormat`/`NumberFormat` już w użyciu — lokalizacja formatów = parametryzacja tagu locale, niski koszt.
- Drift docs: `AGENTS.md` mówi `frontend/messages/` (nie istnieje); kod żyje w `frontend/src/i18n/`. Naprawić, bo myli każdego agenta (w tym przyszłe sesje).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Wprowadzenie mutowalnego `activeLocale` (stan modułu) | `t()` jest synchroniczne i wołane w ~50 miejscach bez przekazywania locale; potrzebny stan procesu ustawiony przy bootstrapie | Przekazywanie locale do każdego `t()` = zmiana 50+ call-site'ów i sygnatury API; cięższe i bardziej ryzykowne niż jeden setter |
| Osobne źródło języka dla backendu (US2) | język interakcji agenta żyje w innym procesie/warstwie niż UI | Współdzielony stan FE/BE niemożliwy bez wspólnego configu — stąd jedno pole configu instalacji jako źródło prawdy |
