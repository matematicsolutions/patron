# ADR-0061: RODO art. 17 - pelna purga sprawy po dodaniu RAG / grafu / brain

**Status**: PROPONOWANY (2026-05-28). Domyka luke compliance: nowe magazyny danych dodane w tej sesji (ADR-0054/0057) nie byly objete kasacja RODO. Backend dziala (lib + endpoint), niewpiety jeszcze w UI.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 5 - Minimalizacja + RODO art. 17** (zasada glowna). Prawo do bycia zapomnianym musi obejmowac wszystkie kopie danych sprawy, nie tylko tabele relacyjne. Po dodaniu RAG i pamieci doszly nowe miejsca, w ktorych osadza sie tresc.
- **Art. 3 - Audytowalnosc** - audit_log zostaje (append-only, pod drzewem Merkle). RODO art. 17 ust. 3 lit. b: przetwarzanie konieczne do obowiazku prawnego (AI Act art. 12 record-keeping). Kasacja audytu zniszczylaby dowod compliance.

**Powiazane ADR**: ADR-0054 (RAG - doc_chunks/vec_chunks/FTS, extracted_entities, citation_graph), ADR-0057 (brain Bibliotekarza - forgetScope), ADR-0026 (Merkle - czemu audit zostaje), wczesniejszy skrypt `rodo-delete.ts` (kasacja per-user, Supabase-bound, nie znal nowych magazynow).

---

## Kontekst - luka otwarta w tej samej sesji

`rodo-delete.ts` (kasacja per-user) zna tabele relacyjne (chats, documents, projects...), ale powstal PRZED RAG i brain. W tej sesji doszly magazyny, ktore utrwalaja tresc sprawy:
- **RAG**: `doc_chunks` (fragmenty pelnotekstowe), `vec_chunks` (embeddingi), `doc_chunks_fts` (BM25), `extracted_entities` (PESEL/NIP/sygnatury/osoby), `citation_graph`.
- **brain**: pamiec Bibliotekarza per sprawa (`brain/<projectId>/*.md`).

Bez ich purgi "zapomnij sprawe X" zostawialby fragmenty pism w indeksie RAG, wykryte PESEL-e/NIP-y w `extracted_entities` i wnioski w pamieci. To realna luka RODO, ktora sam wprowadzilem dodajac magazyny.

## Decyzja

### 1. `backend/src/lib/rodo/forget.ts` - `forgetCase(projectId, db)`
Idempotentna purga wszystkich magazynow sprawy w kolejnosci:
1. per dokument: `clearDocumentIndex` (chunks/vec/FTS + extracted_entities + citation_graph) - tylko tryb sqlite.
2. czaty + wiadomosci.
3. tabular reviews + komorki + czaty review.
4. document_edits -> document_versions -> documents.
5. project_subfolders.
6. `forgetScope(projectId)` - brain (tylko sqlite).
7. sam projekt.

Zwraca raport `{ documents, chats, tabularReviews, ragCleared, brainCleared }` (transparency). **audit_log nietkniety.**

### 2. Endpoint `POST /rodo/forget-case` (desktop-only)
`{ project_id, confirm: true }`. requireAuth. Wymaga `confirm: true` (operacja nieodwracalna). Zablokowany (404) gdy `!isSqliteBackend()` - w trybie chmurowym kasacja idzie przez kontrolowany skrypt operatora z weryfikacja wlasnosci; endpoint bez ownership-check bylby grozny (single-user desktop owns all).

---

## Alternatywy odrzucone

1. **Rozszerzyc rodo-delete.ts (per-user) o nowe magazyny**. Odrzucone jako jedyne rozwiazanie: tamten skrypt jest Supabase-bound (createClient) i nie dziala w trybie sqlite/desktop. Potrzebny reuzywalny modul dzialajacy przez createServerSupabase (oba tryby) + helpery nowych magazynow. forgetCase to ten modul; rozszerzenie skryptu per-user o brain/RAG = osobna rezerwacja.
2. **Kasowac takze audit_log sprawy**. Odrzucone: lamie AI Act art. 12 i RODO art. 17 ust. 3 lit. b. Audit jest append-only pod Merkle - jego integralnosc to dowod compliance. Identyfikatory w audit to historyczne referencje, nie tresc.
3. **Poleganie na FK ON DELETE CASCADE**. Odrzucone jako mechanizm wystarczajacy: kaskada nie obejmuje magazynow bez FK do projektu (doc_chunks/vec/FTS maja document_id jako zwykly tekst; brain to pliki na dysku). Jawna purga jest pewna i identyczna w obu trybach.
4. **Soft-delete (status='deleted')** dla nowych magazynow. Odrzucone: RODO wymaga faktycznego usuniecia tresci. Soft-delete zostawia PESEL-e w extracted_entities i fragmenty w doc_chunks. Twarda kasacja.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 703 pass / 5 todo / 0 fail (z 702 przed ADR; +1 pelny scenariusz). Test: sprawa z dokumentem (zaindeksowanym: chunks+entities+graph), czatem, pamiecia brain, wpisem audytowym -> forgetCase -> wszystkie magazyny puste, brain pusty, projekt skasowany, audit_log nietkniety (count bez zmian).
- **LoC**: ~282 (forget.ts 113, forget.test.ts 127, rodo.ts 40, index.ts +2 mount).
- **Zero nowych zaleznosci npm**.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0061

- **Rozszerzenie rodo-delete.ts (per-user) o RAG/brain** dla trybu chmurowego -> rezerwacja (forgetCase pokrywa scenariusz desktop per-sprawa).
- **rodo-export.ts (art. 20 przenoszalnosc) o nowe magazyny** -> rezerwacja (eksport tez powstal przed RAG/brain).
- **UI "Zapomnij sprawe X"** z potwierdzeniem -> rezerwacja frontend.
- **Kasacja plikow storage** (bajty dokumentow w FS/R2) w forgetCase -> obecnie purguje rekordy + indeks; fizyczne pliki = rozszerzenie (deleteFile per storage_path).
- **Audit event `rodo.forget`** -> rezerwacja (whitelist event_type juz ma `rodo.delete`; doprecyzowanie per-sprawa = osobna migracja).
