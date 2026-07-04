# Plan: UI human-review komorek tabular

**Spec:** ./spec.md
**Project Type:** web-app (frontend Next.js istniejacego PATRON)

## Technical Context

- **Language:** TypeScript strict, React 18 (Next.js app router), Tailwind.
- **Backend kontrakt (gotowy, ADR-0126 12c):** `POST /tabular-review/:reviewId/cells/review`
  body `{document_id, column_index, action, corrected_content?}` -> `{ok, review}`;
  cells w GET zwracane `select("*")` => kolumny review doplywaja bez zmian backendu.
- **Storage:** brak zmian (kolumny z migracji 018 juz sa).
- **Testing:** tsc --noEmit + `next build` (frontend nie ma unit testow komponentow);
  suite backendowa bez zmian.
- **Constraints:** i18n ADR-0132 (pl.ts = zrodlo kluczy, reszta pelne slowniki),
  zero nowych zaleznosci.

## Constitution Check (GATE)

| Bramka | Status | Notatka |
|---|---|---|
| Mission alignment | PASS | governance #2 widoczny dla prawnika; spina ADR-0126 |
| RODO / tajemnica | PASS | corrected_content zostaje w tabular_cells (tam gdzie content); nic nowego nie plynie do chmury |
| Audit-first | PASS | endpoint backendu juz istnieje; UI nie omija zadnej bramki |
| Bramka licencji | PASS | zero nowych zaleznosci (lucide juz jest) |
| Bramka ToS / anty-OS | PASS | n/d |
| Bramka jakosci | PASS | tsc + next build zielone przed commitem |
| Bramka strategii | PASS | domyka "brakujaca polowe tematu 2.0" (opinia CTO 2026-07-04) |

## Project Structure (pliki dotykane)

- `frontend/src/app/components/shared/types.ts` - TabularCell + pola review.
- `frontend/src/app/lib/patronApi.ts` - `reviewTabularCell()`.
- `frontend/src/app/components/tabular/TabularCell.tsx` - ReviewBadge + effective content.
- `frontend/src/app/components/tabular/TRSidePanel.tsx` - sekcja Weryfikacja prawnika.
- `frontend/src/app/components/tabular/TabularReviewView.tsx` - handler + stan.
- `frontend/src/i18n/{pl,en,it,de,es,fr}.ts` - klucze `tabular.review*`.

## Research notes

Wzorzec kontrolki: OpenContracts Datacell (approve/reject/edit) - wzorzec, nie kod.
Parytet identyfikacji komorki z regenerate-cell (document_id + column_index).
