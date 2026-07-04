# Feature: UI human-review komorek tabular (kontrolka approve/reject/correct)

**Branch:** `feat/etap-a2-fabryka` (pozycja A2-1 roadmapy 2.0)
**Date:** 2026-07-04
**Status:** Implemented

## Problem statement

Backend human-review komorki (ADR-0126 12b/12c: kolumny review w `tabular_cells`,
endpoint `POST /tabular-review/:reviewId/cells/review`) istnieje, ale prawnik nie ma
zadnej kontrolki w UI - ficzer governance niewidoczny dla prawnika nie istnieje.
To brakujaca polowa tematu 2.0 "governance by default" (governance #2: agent
generuje, prawnik decyduje; AI Act art. 12: kto zatwierdzil te wartosc).

## User Stories

### US1 (P1, MVP) - Decyzja prawnika w panelu bocznym komorki

**Jako** prawnik przegladajacy wynik ekstrakcji tabular **chce** w panelu
szczegolow komorki (TRSidePanel) zaakceptowac / odrzucic / poprawic wynik,
**zeby** moj nadzor byl zarejestrowany per komorka (art. 12).

**Acceptance Criteria:**
- [x] AC1.1: TRSidePanel ma sekcje "Weryfikacja prawnika" z akcjami Zatwierdz / Odrzuc / Popraw.
- [x] AC1.2: "Popraw" otwiera pole tekstowe; zapis wymaga niepustej tresci (walidacja tez po stronie backendu - reviewCell).
- [x] AC1.3: Po decyzji panel pokazuje stan review (akcja + data) i pozwala na re-review (nadpisanie).
- [x] AC1.4: Blad zapisu nie gubi stanu - komorka wraca do stanu sprzed decyzji, blad w konsoli.

**Independent Test:** otworzyc komorke "done", kliknac Zatwierdz -> POST /cells/review
wraca {ok}, badge w panelu i w tabeli; reload strony -> stan utrzymany (kolumny w DB).

### US2 (P2) - Badge stanu review w macierzy

**Jako** prawnik **chce** widziec w tabeli, ktore komorki sa zatwierdzone /
odrzucone / poprawione, **zeby** wiedziec co jeszcze wymaga przegladu.

**Acceptance Criteria:**
- [x] AC2.1: Komorka z review_action pokazuje badge (ikona + tytul z i18n): approved=zielony check, rejected=czerwony X, corrected=bursztynowy olowek.
- [x] AC2.2: Komorka "corrected" wyswietla tresc poprawiona (effectiveCellContent), "rejected" wyswietla tresc wygaszona (przekreslenie/opacity).
- [x] AC2.3: Brak review = brak badge (zero szumu dla nieprzejrzanych).

### US3 (P2) - i18n 6 locale

**Acceptance Criteria:**
- [x] AC3.1: Wszystkie nowe stringi przez t() z kluczami `tabular.review*` w pl/en/it/de/es/fr.

## Non-Goals (anti-scope)

- Propagacja decyzji do audit_log (opcjonalna rezerwacja ADR-0126; osobny krok).
- llm_call_log per komorka (dalsza rezerwacja ADR-0126).
- Bulk review (zatwierdz wszystkie) - backlog.
- Historia re-review w UI (historia = audit_log, gdy zostanie wpiety).

## Open Questions

- brak (backend zamrozil kontrakt: action approved|rejected|corrected, corrected_content).
