# ADR-0141 — Heurystyczne wykrywanie niezacytowanych odwolan prawnych (anty-bypass groundingu)

- **Status:** Proponowany (czeka na decyzje governance D1 + eval + bramke WM)
- **Data:** 2026-06-11
- **Galaz:** `fix/faza1-audit-prep` (worktree, off `feat/tier-governance-envelope`)
- **Zrodlo:** audyt Fable5 2026-06-11, oS 3 (moat groundingu) ryzyko #3 — "bypass markera"
- **Mapuje na:** ADR-0005 (mechaniczna weryfikacja cytatow), ADR-0097 (judge), ADR-0102 A (tag proweniencji)

## Kontekst

Grounding (ADR-0005) weryfikuje WYLACZNIE cytaty, ktore model oznaczyl w bloku
`<CITATIONS>`/`[ref]` (`parseCitations` w `lib/chat/stream.ts:492-506`). Twierdzenie,
ktorego model NIE oznaczy — np. "zgodnie z art. 415 k.c." w prozie — przechodzi do
uzytkownika **bez weryfikacji, bez sygnalu, bez sladu w audycie**. To luka w moacie:
mechaniczna weryfikacja jest realna, ale tylko dla tego, co model sam zglosi.

## Decyzja

### 1. Czysty ekstraktor (zbudowany w tej iteracji)

`lib/citation/heuristicCitations.ts` — `extractHeuristicCitations(prose)` wykrywa
kandydatow na odwolania prawne PL (przepis `art. N [ust. M]`, paragraf `§ N`,
sygnatura `sygn. akt III CZP 11/13`). Pure, deterministyczny, offline, bez PII/egress,
bez nakladajacych sie spanow. **Nie weryfikuje tresci** — jego rola to wykrycie, ze
cos wyglada jak odwolanie, a nie zostalo zacytowane formalnie. 9 testow jednostkowych.

### 2. Wpiecie ZA FLAGA + decyzja governance (NIE w tej iteracji)

Wpiecie w sciezke groundingu (`stream.ts`) to **zmiana zachowania moatu** i zostaje:
- za flaga `PATRON_HEURISTIC_CITATIONS` **default OFF** (wzorzec ADR-0097/0102 —
  eval-first, zero zmiany zachowania domyslnego),
- warunkowane decyzja governance **D1** (z planu wdrozenia po audycie): co zrobic z
  wykrytym, niezacytowanym odwolaniem —
  - (a) **sygnal**: oznacz tagiem `[model - zweryfikuj]` (spina sie z ADR-0102 A regula
    DEFAULT), werdykt doradczy w UI;
  - (b) **needs_review**: wymus jawna akceptacje uzytkownika (slad do audytu);
  - (c) **blok**: nie oddawaj deliverable dopoki odwolanie nieugruntowane.

Rekomendacja (do decyzji WM): zacznij od (a) sygnal — najmniej inwazyjne, nie psuje
UX, daje slad; eskalacja do (b)/(c) dla klasy high-stakes po evalu na korpusie PL.

### 3. Granica

Heurystyka MOZE dac false-positive (odwolanie wymienione informacyjnie, nie jako
podstawa tezy) — dlatego domyslny wariant to SYGNAL, nie BLOK. False-negative (egzotyczny
format) jest akceptowalny: to warstwa dodatkowa nad `<CITATIONS>`, nie zamiennik.

## Konsekwencje

- (+) Domyka bypass markera: nieoznaczone odwolanie nie przechodzi po cichu.
- (+) Zero zmiany zachowania do flip flagi (bezpieczne wejscie do repo).
- (+) Spina sie z tagiem proweniencji ADR-0102 A (`[model - zweryfikuj]`).
- (-) Wymaga decyzji D1 i evalu jakosci (precision/recall wzorcow) przed flipem.
- (-) Koszt utrzymania wzorcow regex PL (rozszerzalne).

## Definition of done

- [x] Czysty ekstraktor + testy jednostkowe (ta iteracja).
- [ ] Decyzja governance D1 (sygnal / needs_review / blok).
- [ ] Wpiecie w stream.ts za flaga `PATRON_HEURISTIC_CITATIONS` (default OFF) + test e2e
      "model bez markerow".
- [ ] Eval precision/recall na korpusie PL przed flip flagi.
- [ ] 2x review `matematic-patron-pr-review-pl` przed merge->main (bramka WM).
