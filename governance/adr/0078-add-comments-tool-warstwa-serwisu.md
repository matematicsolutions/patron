# ADR-0078: Narzedzie add_comments - warstwa serwisu i czatu nad silnikiem komentarzy

**Status**: PROPONOWANY 2026-05-30. Konstytucja v1.4.6.

**Data**: 2026-05-30

**Powiazane zasady** (Konstytucja Patrona v1.4.6):
- **Art. 1 - Lokalnosc danych**: komentarze powstaja lokalnie (silnik ADR-0077), zapisywane jako wersja .docx w lokalnym storage (FS/SQLite, ADR-0053). Zero egress.
- **Art. 4 - Neutralnosc wobec dostawcow**: `add_comments` to narzedzie modelowo-agnostyczne, rejestrowane w tym samym zestawie co `edit_document`. Dowolny LLM moze je wywolac.
- **Art. 7 - Minimalnosc**: brak nowej tabeli DB. Komentarz zyje w bajtach wersji (comments.xml), nie w osobnym magazynie. Adnotacja czatu jest pochodna zdarzenia, nie nowym zrodlem prawdy.

**Powiazane ADR**: ADR-0077 (silnik `applyDocxComments` - ten ADR jest jego warstwa serwisu), ADR-0060 (read side - reload czyta komentarze z biezacej wersji), `runEditDocument` / `edit_document` (wzorzec lustrzany - cala sciezka mirroruje istniejacy tracked-changes flow).

---

## Kontekst

ADR-0077 wylandowal prymityw silnika `applyDocxComments` (czysty, przetestowany). Sam silnik jest niewidoczny dla prawnika: nie ma narzedzia, ktore model moglby wywolac w czacie, ani sciezki ktora dostarczylaby skomentowany dokument do pobrania. Rezerwacja ADR-0077 wskazala te warstwe jako osobny krok.

Istnieje gotowy, sprawdzony wzorzec: `edit_document` (tracked changes). Cala sciezka - schema narzedzia, dispatch, persystencja wersji, zdarzenie SSE, adnotacja w wiadomosci, rehydracja po reload - jest juz zbudowana dla edycji. Komentarze roznia sie jednym: nie maja stanu accept/reject (sa informacyjne), wiec nie potrzebuja tabeli sledzacej jak `document_edits`.

---

## Decyzja

### A. Serwis `runAddComments` (mirror runEditDocument bez wierszy edycji)

`backend/src/lib/chat/docx-edit.ts`: nowa funkcja laduje biezace bajty wersji, wola `applyDocxComments` (ADR-0077), persystuje skomentowane bajty jako nowa wersje `assistant_edit` i zwraca link do pobrania + adnotacje per komentarz. Wspolny helper `persistAssistantVersion` obejmuje ksiegowanie wersji (numer, dziedziczenie display_name, reuse w obrebie tury). `runEditDocument` NIE jest refaktorowany (brak testow serwisowych jako siatki - mniejsze ryzyko).

Brak migracji DB: komentarz zyje w `comments.xml` wersji. Reload czyta biezaca wersje (ADR-0060), wiec model i pobranie pozostaja spojne. Adnotacja `CommentAnnotation` (kind: "comment") nie ma accept/reject - resolve komentarza to czynnosc po stronie Worda.

### B. Narzedzie `add_comments` + dispatch + prompt

Schema narzedzia w `tools.ts` (lustro `edit_document`: doc_id + lista `{find, context_before, context_after, text}`). Branch dispatchu w `tool-dispatch.ts` waliduje (.docx, niepusta lista), emituje `doc_commented_start` / `doc_commented`, wola `runAddComments`, aktualizuje `turnEditState` + `docIndex` + `docStore` na nowa wersje (jak edit_document). Prompt (`prompts.ts`, sekcja DOCUMENT REVIEW) uczy model: flaguj komentarzem, przepisuj edycja; nie komentuj spanu ktory jednoczesnie edytujesz.

### C. Strumien, persystencja, frontend

`stream.ts`: typ zdarzenia `doc_commented` w unii AssistantEvent + przekazanie `docsCommented` do events. `persistence.ts`: adnotacje `comment_data` przetrwaja reload + sweep dostepnosci dokumentu obejmuje `doc_commented`. Frontend (mirror najprostszej czesci `doc_edited`): zdarzenie SSE w `useAssistantChat`, blok "Dodano N komentarzy recenzenta" + link pobrania w `AssistantMessage`, typ zdarzenia w `shared/types.ts`.

---

## Konsekwencje

**Pozytywne**:
- Komentarze docieraja do prawnika: model wola `add_comments` w czacie, prawnik pobiera .docx z komentarzami w panelu recenzji Worda.
- Zero migracji, zero nowej tabeli - mniejsza powierzchnia ryzyka, komentarz jest w wersji.
- Cala sciezka mirroruje `edit_document` - znany, sprawdzony ksztalt; latwy do utrzymania.
- Backend: 868 testow pass (5 todo, 0 fail), TSC clean.

**Koszty / ryzyka**:
- `persistAssistantVersion` duplikuje ksiegowanie wersji z `runEditDocument`. Swiadomy wybor (brak testow serwisowych jako siatki dla refaktoru). Rezerwacja: ujednolicic gdy powstanie test serwisowy.
- Frontend v1 pokazuje licznik + pobranie, bez kart per-komentarz i bez nakladki na podglad docx-preview. Rezerwacja ponizej.
- Adnotacja komentarza nie ma accept/reject - to celowe (komentarz jest informacyjny), ale rozni sie od kart edycji, co trzeba zakomunikowac w UI.

---

## ANTY-ZAKRES (rezerwacje)

- **Nakladka komentarzy na podglad** (docx-preview gubi komentarze; render dymkow na marginesie jak tracked-change ids z ADR-0060) - osobna iteracja wizualna.
- **Karty per-komentarz** w czacie (dzis: licznik + pobranie).
- **Resolve / odpowiedz na komentarz** (threading w-comment) - poza MVP.
- **Komentarz + redline na tym samym spanie** - dziedziczy bramke ADR-0077; surgijne wstawienie bez przebudowy runow to ADR-0079.
- **Ujednolicenie `persistAssistantVersion`** z `runEditDocument` pod pelnym testem serwisowym.

---

## Weryfikacja

```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit   # clean
node node_modules/vitest/vitest.mjs run                        # 868 passed, 5 todo, 0 fail
cd ../frontend && npx tsc --noEmit                             # clean (mirror doc_edited)
```
