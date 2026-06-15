# ADR-0126: Human-review komorki tabular review (spine AI Act art. 12)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Wybor WM 2026-06-14 (T2.2 z backlogu OpenContracts). Implementacja ETAPOWA: **12a** czysty model `cell-review.ts` (state machine approved/rejected/corrected + efektywna tresc) ZROBIONE; **12b** persystencja DUAL-MODE (kolumny review w `tabular_cells`: SQLite `schema.sqlite.ts`+ALTER ORAZ Postgres `schema.sql`+migracja `NNN_*.sql`; store przez shim `db.from`) = REZERWACJA; **12c** route `POST /tabular-review/:reviewId/cells/:cellId/review` + kontrolka w UI komorki (TRTable/TRSidePanel) = REZERWACJA. Stacked na ADR-0125 (branch feat/oc-locator-loose-match).

**Data**: 2026-06-14

**Powiazane zasady**: governance #2 (agent generuje, prawnik decyduje - akceptacja/odrzucenie/poprawa komorki to akt ludzki), Art. 1/3/7 (czysta, deterministyczna, fail-closed).

**Powiazane ADR**: ADR-0080 (tabular grounding - MECHANICZNA weryfikacja cytatu, komplementarna), ADR-0082 (propagacja tabular.grounding do audit hash-chain), [[legal-ai-audit-bundle]] (art. 12).

---

## Kontekst

Tabular review (isaacus/tabular-review, THIRD_PARTY_INSPIRATIONS) ma komorke z trzema warstwami: `status` (processing: pending/generating/done/error), `content` (wynik LLM + flag + reasoning), `grounding` (ADR-0080, MECHANICZNA weryfikacja cytatu: verified/modified/unverified). BRAK warstwy **human-review**: prawnik nie moze formalnie zaakceptowac / odrzucic / poprawic wyniku ekstrakcji per komorka. To luka governance #2 (output AI bez zarejestrowanego nadzoru ludzkiego) i art. 12 (brak record-keeping "kto zatwierdzil te wartosc").

OpenContracts Datacell ma to wprost (`approved_by`/`rejected_by`/`corrected_data` + `llm_call_log`). Bierzemy WZORZEC.

## Decyzja

### Etap 12a (ten commit) - czysty model `cell-review.ts`
- `CellReview { action: approved|rejected|corrected, reviewedBy, reviewedAt, correctedContent? }`.
- `reviewCell(action, actorId, at, corrected?)` - AKT LUDZKI: actorId musi byc czlowiekiem (nie analysis/system/pusty); `corrected` wymaga niepustej tresci; approved/rejected czyszcza correctedContent. Re-review dozwolone (nadpisuje; historia=audit_log).
- `effectiveCellContent(generated, review)` - zaakceptowana tresc: brak/approved->generated, corrected->correctedContent, rejected->null.
- `isCellReviewed` - sygnal badge/art.12.
Czysta, testowalna (cell-review.test.ts).

### Etap 12b (rezerwacja) - persystencja DUAL-MODE
`tabular_cells` jest w OBU schematach (SQLite `schema.sqlite.ts` + Postgres `schema.sql`, 4 wystapienia) -> wymaga obu: kolumny `review_action TEXT`, `reviewed_by TEXT`, `reviewed_at TEXT`, `corrected_content TEXT` (nullable - brak review = nieweryfikowana). SQLite: create-table + ALTER w bootstrapie. Postgres: `schema.sql` + plik migracji `migrations/NNN_tabular_cell_review.sql` (UWAGA numer - max na branchach ~013, sprawdzic przed). Store przez shim `db.from("tabular_cells")` (jak istniejace route'y - dziala w obu trybach), NIE raw getDb (inaczej niz KGLF SQLite-only).

### Etap 12c (rezerwacja) - wpiecie
Route `POST /tabular-review/:reviewId/cells/:cellId/review` (requireAuth + org/owner scope jak inne tabular route'y; actorId = uwierzytelniony user = prawnik) wolajacy `reviewCell` -> persist. Kontrolka approve/reject/correct w UI komorki (frontend tabular istnieje - TRTable/TRSidePanel). Opcjonalnie propagacja do audit_log (jak tabular.grounding, ADR-0082). `llm_call_log` per komorka = dalsza rezerwacja.

### Granica governance/RODO
Review to akt ludzki z actorId (odpowiedzialny prawnik) -> art. 12. `corrected_content` to dane uzytkownika (tresc komorki) - persystowane w tabular_cells (gdzie content juz jest), NIE do audit_log (tam tylko liczby/akcje, jak tabular.grounding).

---

## Konsekwencje

**Pozytywne**: domyka petle nadzoru ludzkiego nad ekstrakcja tabular (governance #2) i daje per-cell record-keeping (art.12); czysty model testowalny niezaleznie od trybu/persystencji; komplementarny do mechanicznego groundingu (grounding=czy cytat realny; review=czy prawnik akceptuje wartosc).

**Negatywne / koszt**: 12a sam nie zmienia produktu (model bez persystencji); 12b dual-mode (SQLite+Postgres+migracja) - wiekszy niz SQLite-only kroki. Re-review nadpisuje (historia tylko w audit_log gdy 12c ja wepnie).

**Bramki PRZED merge (12a)**: TSC `--noEmit` exit 0 (SPELNIONE); vitest `src/lib/tabular` 26/26 (SPELNIONE, +8: akt-ludzki approved/rejected/corrected, fail-closed corrected-bez-tresci/nie-czlowiek, re-review, effectiveCellContent per akcja, isCellReviewed); patron-pr-review PASS; CHANGELOG przy merge; private-remote przed push.
