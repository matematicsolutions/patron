# ADR-0135: Jezyk agenta wg locale - granica metoda/substancja w SYSTEM_PROMPT

**Status**: Przyjety (2026-06-25) — WM zatwierdzil zakres "lekkie v1" (przelacznik jezyka odpowiedzi + przewodnik mozliwosci EN; substancja jurysdykcyjna zostaje PL). Zaimplementowane i zweryfikowane (backend tsc=0, 33 testy prompts+messages pass).

Aneks do [ADR-0132](./0132-locale-selection-jeden-jezyk-per-instalacja.md) rozszerzajacy locale z warstwy UI na warstwe agenta (backend prompts).

## Kontekst

ADR-0132 zlokalizowal UI (frontend) wg `NEXT_PUBLIC_PATRON_LOCALE`, ale **jezyk
agenta** (system prompt w `backend/src/lib/chat/prompts.ts`) pozostal twardo PL —
anglojezyczny mecenas dostawal interfejs EN, a odpowiedzi modelu po polsku.

`SYSTEM_PROMPT` (164 linie) miesza dwie warstwy:
- **METODA / UX** — mechanika cytatu/docx/edycji/workflow (juz EN, locale-niezalezna),
  jezyk odpowiedzi, opis polskiej struktury sadow, przewodnik po mozliwosciach PATRONa.
- **SUBSTANCJA jurysdykcyjna** — drafting pism procesowych PL, formuly grzecznosciowe
  ("Wysoki Sadzie"), cytowanie prawa PL (Dz.U./ELI/DD.MM.RRRR), dyscyplina konektora SAOS.

Granica miedzy nimi to decyzja produktowa pod konstytucja (Art. 2/4), nie mechaniczna.

## Decyzja

1. **`SYSTEM_PROMPT` skladany z blokow przez `buildSystemPrompt(locale)`** zamiast jednej
   stalej. Bloki metody/UX maja warianty PL/EN; bloki substancji maja tylko PL.
2. **Zrodlo locale = `PATRON_LOCALE` (env, backend)** — mirror frontendowego
   `NEXT_PUBLIC_PATRON_LOCALE` (ADR-0132 pkt 2). Domyslnie `"pl"` -> zero regresji.
   `getAgentLocale()` w `prompts.ts`.
3. **Co sledzi locale (EN gdy `PATRON_LOCALE=en`):**
   - jezyk odpowiedzi ("Respond in English unless the user explicitly asks otherwise");
   - opis polskiej struktury sadownictwa (fakty bez zmian, jezyk opisu = EN);
   - przewodnik po mozliwosciach PATRONa (14 pkt) — przez bramki reviewer-en + humanizer-en.
4. **Co ZOSTAJE PL w obu locale (substancja):**
   - drafting pism PL (struktura pozwu/skargi/odwolania, kpa, terminologia) — **pismo do
     polskiego sadu jest po polsku niezaleznie od jezyka UI**;
   - formuly grzecznosciowe i wokatywy;
   - cytowanie prawa PL (Dz.U., ELI, DD.MM.RRRR);
   - dyscyplina konektora SAOS (grounding) — agent jest wielojezyczny i czyta PL bez straty.
5. **`SYSTEM_PROMPT = buildSystemPrompt("pl")`** zachowane jako stala dla kompatybilnosci
   wstecz z istniejacymi importami i testami.
6. **Wpiecie:** `buildMessages()` (`chat/messages.ts`) wola `buildSystemPrompt(getAgentLocale())`.
   Konstrukcja promptu pozostaje w sciezce audit hash-chain (AI Act art. 12) — bez bypassu.

### Granica (co NIE jest objete - decyzje WM odlozone do iteracji)

- Pelne dwujezyczne bloki substancji (np. EN-owy opis dyscypliny SAOS) — **na pull**,
  nie spekulacyjnie. Light v1 tlumaczy tylko 3 bloki metody/UX.
- Jezyk samych pism = zawsze jurysdykcja docelowa (pismo do PL sadu = PL). Agent moze
  *opisac/skomentowac* pismo po EN, ale tresc pisma = jezyk sadu.
- Przelacznik jezyka w runtime (jak ADR-0132: jeden jezyk per instalacja).

## Konsekwencje

**Pozytywne:**
- Anglojezyczny mecenas rozmawia z agentem po EN, zachowujac grounding PL/UE — sedno tezy
  "prawnik EU dostaje polski/unijny grounding, ale po angielsku".
- Default PL = zero regresji; zmiana czysto addytywna (33 testy zielone, w tym 9 nowych
  na granice metoda/substancja).
- Kolejny rynek = wariant EN bloku + ewentualny blok substancji na pull.

**Koszt / dlug:**
- `prompts.ts` urosl (bloki PL+EN obok siebie) — cena za jawna granice metoda/substancja.
- Mieszany prompt PL+EN dla locale=en (substancja PL w EN-owym promptcie) — akceptowalne,
  bo prompt jest wewnetrzny (nie user-facing), a model wielojezyczny.

## Alternatywy odrzucone

| Alternatywa | Powod odrzucenia |
|---|---|
| Przetlumaczyc CALY prompt na EN | Zlamaloby substancje — pismo do PL sadu po angielsku, "Wysoki Sadzie" -> "Your Honour"; bledne jurysdykcyjnie |
| Zostawic agenta PL-only | Anglojezyczny mecenas dostaje UI EN + odpowiedzi PL = niespojnosc, bariera wejscia |
| Osobny plik `prompts.en.ts` | Duplikacja substancji PL w dwoch plikach -> drift; bloki skladane trzymaja jedno zrodlo |

## Powiazania

- [ADR-0132](./0132-locale-selection-jeden-jezyk-per-instalacja.md) — locale UI (rozszerzany)
- [ADR-0001](./0001-hash-chain-audit-trail.md) — konstrukcja promptu w sciezce audit
- AGENTS.md — TS strict, audit-first, granica metoda/substancja (zakaz forkowania pl-entities)
- Brief decyzyjny: `Downloads/us2-agent-locale-brief-2026-06-25.md`
