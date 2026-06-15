# ADR-0111: RAG scope - domyslna izolacja tajemnicy miedzy sprawami

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P2 #5. `search_corpus` (`lib/chat/tool-dispatch.ts`): gdy czat ma `projectId`, RAG byl ograniczony do dokumentow sprawy; ale BEZ `projectId` (czat ogolny) `documentIds` bylo `undefined` -> `retrieve()` przeszukiwal CALY korpus usera (scoping opcjonalny). Skutek: w czacie ogolnym fragmenty akt jednego klienta moga trafic do rozmowy o innym - przy tajemnicy adwokackiej miedzy klientami to istotny wyciek.

## Decyzja

Nowy eksport `resolveSearchScope(db, projectId)` decyduje o scope RAG:
- **czat sprawy** (`projectId` ustawiony) -> tylko dokumenty tej sprawy (jak dotad).
- **czat ogolny** (`projectId` null) -> DOMYSLNIE tylko dokumenty BEZ przypisanej sprawy (standalone, `project_id IS NULL`). Akta spraw sa osiagalne wylacznie z czatu w kontekscie danej sprawy.
- **swiadome wyszukiwanie przekrojowe** -> `PATRON_RAG_CROSS_CASE=true` (caly korpus) z flaga `cross_case` i ostrzezeniem w wyniku. Tymczasowa furtka env do czasu przelacznika w UI (P2 #6).

Semantyka `documentIds`: lista (scoped) albo `undefined` (caly korpus, tylko cross-case). `[]` => `retrieve` zwraca zero trafien (NIE caly korpus) - brak standalone docs w czacie ogolnym = zero wynikow, nie wyciek.

**Proweniencja (audyt P2 #5):** kazde trafienie niesie pole `case` (nazwa sprawy lub "bez sprawy") obok `filename`/`document_id`. Gdy trafienia przekraczaja granice jednej sprawy -> ostrzezenie w `note` ("wyniki pochodza z roznych spraw - sprawdz pole 'case'").

## Konsekwencje

- (+) Czat ogolny nie wciaga akt konkretnego klienta domyslnie - granica tajemnicy egzekwowana z definicji, nie z dyscypliny uzytkownika.
- (+) Proweniencja sprawy widoczna w kazdym trafieniu; przekroczenie granicy sygnalizowane.
- (-) Pytania o akta sprawy w czacie ogolnym nie zwroca nic, dopoki nie wlaczy sie cross-case albo nie otworzy czatu sprawy - swiadomy koszt poufnosci (komunikat `scopeNote` to wyjasnia).
- Furtka env zostanie zastapiona przelacznikiem per-sprawa w UI (P2 #6) - wtedy decyzja staje sie audytowalna per zadanie.
- **Testy:** vitest 1140 pass / 0 fail / 5 todo. `search-scope.test.ts` (5: scope sprawy, standalone-only w czacie ogolnym, brak undefined w czacie ogolnym, cross-case env, priorytet projectId). Fixture `retrieval.test.ts` uzupelniony o wiersze `documents` standalone (w produkcji tworzy je ingest).
