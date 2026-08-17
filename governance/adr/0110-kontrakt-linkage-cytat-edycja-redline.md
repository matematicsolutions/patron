# ADR-0110 — Kontrakt linkage cytat↔edycja w redline (anchorId + span)

- **Status:** Proponowany (czeka na decyzje governance D1 + bramke WM)
- **Data:** 2026-06-11
- **Galaz:** `fix/faza1-audit-prep` (worktree, off `feat/tier-governance-envelope`)
- **Zrodlo:** audyt Fable5 2026-06-11 oS 4 #1 + ocena Docxodus (`reference_docxodus_redline_eval_2026-06-11`)
- **Mapuje na:** ADR-0070/0079 (redline `docxTrackedChanges.ts`), ADR-0005/0102 (grounding cytatu)

## Kontekst

Audyt Fable5 **obalil** wczesniejsza teze, jakoby redline PATRONa byl kruchy: aplikacja
edycji (`docxTrackedChanges.ts:851-908`) jest **content-anchored fail-closed** — kotwiczy
TRESCIA (`find` + `context_before/after`, 3-strategiowo), a przy braku/wieloznacznosci
dopasowania **rzuca blad** zamiast wstawic w zle miejsce; tabele sa rekursowane. To co
najmniej tak odporne jak hash-anchor Docxodusa (ktory uniewaznia sie przy KAZDEJ zmianie
bloku), w praktyce odporniejsze. **Silnika nie zmieniamy** — werdykt Docxodus: WATCH, nie
migrowac.

Realna luka jest inna: **brak trwalego powiazania edycji z ugruntowanym cytatem.** Edycja
jest dzis samodzielnym dopasowaniem tekstowym. Nie ma pary `(anchor, span)` wiazacej edycje
z konkretnym, zweryfikowanym cytatem, wiec bramka "zadna edycja bez VERIFIED" nie ma na czym
wisiec.

## Decyzja

Przyjac **KONTRAKT** (nie nowy silnik): edycja redline niesie referencje do zweryfikowanego
cytatu.

```
EditInput {
  find, replace, context_before, context_after,   // jak dzis (content-anchored)
  grounding_ref?: {                                // NOWE, opcjonalne na wejscie
    anchor_id: string,        // stabilny id segmentu zrodlowego (np. hash tresci segmentu)
    span_in_segment: [number, number],  // offset LOKALNY w segmencie (nie globalny)
    citation_ref: string      // ref cytatu z <CITATIONS>, ktorego dotyczy edycja
  }
}
```

Zasada egzekwowania (za flaga, default OFF — wzorzec ADR-0097/0102):
- jezeli edycja ma `grounding_ref`, aplikacja redline **sprawdza, ze grounding tej pary =
  VERIFIED** (przez istniejacy cascade ADR-0005) zanim zastosuje zmiane; brak VERIFIED →
  edycja wstrzymana / oznaczona do przegladu (zaleznie od decyzji D1);
- offset jest **LOKALNY w segmencie**, nie globalny — to korekta z oceny Docxodus (globalny
  offset peka po kazdej edycji; lokalny span + anchor segmentu jest stabilny).

## Konsekwencje

- (+) Domyka brakujace ogniwo "edycja tylko z ugruntowanego cytatu" — spina redline z moatem.
- (+) Zero migracji silnika (adeu/`docxTrackedChanges.ts` zostaje); to warstwa metadanych nad
  istniejaca aplikacja edycji.
- (+) `anchor_id` + `span_in_segment` = wzorzec adresowania z Docxodus bez zaleznosci od
  C#/.NET WASM (ryzyko Electron z oceny Docxodus omijiete).
- (-) Wymaga, by warstwa generujaca edycje (LLM tool) produkowala `grounding_ref` — rozszerzenie
  kontraktu toola.
- (-) Decyzja D1 (co przy braku VERIFIED: blok / needs_review / sygnal) wspolna z ADR-0109.

## Definition of done

- [ ] Rozszerzenie typu `EditInput` o opcjonalny `grounding_ref` (wstecznie zgodne).
- [ ] Sprawdzenie VERIFIED pary `(anchor_id, span)` przed aplikacja, za flaga (default OFF).
- [ ] Decyzja governance D1 (blok / needs_review / sygnal).
- [ ] Testy: edycja z grounding_ref VERIFIED przechodzi; bez VERIFIED wstrzymana.
- [ ] 2x review `matematic-patron-pr-review-pl` przed merge->main (bramka WM).

## Uwaga

To **decyzja kierunkowa** (kontrakt). Implementacja wymaga koordynacji z warstwa toola edycji
i jest swiadomie odlozona do osobnego przebiegu po decyzji D1.
