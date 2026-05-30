# ADR-0077: Emisja komentarzy DOCX - strona zapisu recenzji (Recenzent / Adwokat diabla)

**Status**: PROPONOWANY 2026-05-30. Konstytucja v1.4.6.

**Data**: 2026-05-30

**Powiazane zasady** (Konstytucja Patrona v1.4.6):
- **Art. 1 - Lokalnosc danych**: emisja komentarzy dziala lokalnie na bajtach .docx w pamieci backendu (JSZip + fast-xml-parser). Zero egress, zero uslugi zewnetrznej. Dokument klienta nie opuszcza maszyny.
- **Art. 4 - Neutralnosc wobec dostawcow**: prymityw silnika jest niezalezny od modelu. Dowolny LLM (Gemini/Claude/Ollama/OpenRouter) moze wypelnic `find` + `text`; emisja markupu jest czysto mechaniczna.
- **Art. 7 - Minimalnosc**: komentarz to adnotacja przy fragmencie, nie modyfikacja tresci. Recenzent moze oflagowac zapis bez ingerencji w pismo - mniej zmian niz wymuszony redline.

**Powiazane ADR**: ADR-0060 (Word import roundtrip - strona ODCZYTU komentarzy `parseComments`; ten ADR domyka petle zapis<->odczyt), `docxTrackedChanges.ts` (silnik redline `w:ins`/`w:del` - dzieli z nim matcher kotwic), ADR-0010 (contract review - komentarz jako forma flagi recenzenta tabelarycznego).

**Inspiracja zewnetrzna** (ocena #83, `anylegal-ai/anylegal-oss`, MIT + Additional Terms): tamten harness deklaruje `edit_document` z "redlines, comments, accept/reject". Konfrontacja z naszym kodem pokazala, ze nasz silnik redline jest mocniejszy (czysty TypeScript, bez natywnej zaleznosci, wielostopniowe kotwiczenie), ale brakowalo nam JEDNEJ rzeczy z ich listy: emisji komentarzy. Wziety **wzorzec**, nie kod - klauzula AI-mediated reproduction w ich licencji wyklucza kopiowanie, wiec implementacja jest clean-room na naszej maszynerii kotwic.

---

## Kontekst

Patron umie ODCZYTAC komentarze Worda od 0060: `parseComments` (docxRoundtrip.ts) czyta `word/comments.xml` i wykrywa protokol instrukcji `[PATRON: ...]`. Strony ZAPISU nie bylo. Silnik `docxTrackedChanges.ts` potrafi wyrazic recenzje wylacznie jako `w:ins`/`w:del`, czyli przepisanie tekstu.

To jest realna luka produktowa. Recenzja prawnicza flaguje czesciej niz przepisuje. "Rozwaz czy ten zapis nie jest abuzywny", "brak klauzuli RODO", "sprawdz sygnature" to obserwacje O fragmencie, nie edycje fragmentu. Dotad Recenzent / Adwokat diabla musieli kazda uwage ubrac w redline (sztuczne przepisanie) albo zostawic poza dokumentem (utrata kontekstu zakotwiczenia). Komentarz na marginesie jest natywna forma tej pracy w Wordzie i tego oczekuje prawnik.

Dane wejsciowe od modelu sa identyczne jak dla redline: zakotwiczenie przez `find` + `context_before` + `context_after`. To pozwala reuzyc sprawdzony matcher zamiast budowac drugi.

---

## Decyzja

### A. Prymityw silnika `applyDocxComments` (czysty, bez warstwy serwisu)

Nowy modul `backend/src/lib/docxComments.ts`, symetryczny do `docxTrackedChanges.ts`. Funkcja `applyDocxComments(bytes, comments[], opts)` przyjmuje liste `{find, context_before, context_after, text}` i zwraca `{bytes, comments, errors}` - ten sam ksztalt kontraktu co `applyTrackedEdits`.

Kotwiczenie reuzuje czyste helpery wyeksportowane addytywnie z `docxTrackedChanges.ts` (`flattenParagraph`, `normalizeWs`, `findUniqueAnchor`, `mapNormRangeToOriginal` i prymitywy drzewa/zip). Zachowanie `applyTrackedEdits` jest niezmienione - dodano tylko eksporty. Strategia kotwiczenia jest ta sama: pelny kontekst -> pol kontekstu -> sam `find` jesli globalnie unikalny. Matcher dziala na widoku zaakceptowanym, wiec komentarz mozna polozyc na dokumencie ktory ma juz tracked changes gdzie indziej.

### B. Pelny plumbing OOXML (komentarz otwiera sie w Wordzie, nie tylko parsuje)

Emisja czterech czesci pakietu, nie tylko `comments.xml`:
1. `word/comments.xml` - tresc komentarzy (tworzona albo rozszerzana; id startuje powyzej istniejacego max).
2. `word/document.xml` - `w:commentRangeStart` / `w:commentRangeEnd` + run referencyjny bracketujace zakotwiczony fragment.
3. `[Content_Types].xml` - Override dla czesci comments (idempotentny - nie dubluje).
4. `word/_rels/document.xml.rels` - relacja document.xml -> comments.xml (idempotentna, kolejny wolny `rId`).

Test domyka petle przez nasz wlasny `parseComments` (emit -> odczyt -> assert) plus asserty obecnosci markerow, content-type i relacji.

### C. Bramka nakladania (fail-loud, nie cicha korupcja)

Komentarz, ktorego zakotwiczony span nachodzi na istniejacy `w:ins`/`w:del` lub inny markup nie-run (hyperlink, bookmark, wczesniejszy commentRange), jest **pomijany z czytelnym bledem**, a nie wstawiany kosztem korupcji tego markupu. Rebuild paragrafu dotyka wylacznie czystych `w:r`. Powod: flatten dziala w widoku zaakceptowanym (runy `w:ins` mapuja `childIndex` na wrapper), wiec przebudowa spanu z trackiem w srodku zniszczylaby slad zmiany.

---

## Konsekwencje

**Pozytywne**:
- Domkniecie petli recenzji: Recenzent / Adwokat diabla moga flagowac bez przepisywania (ADR-0060 czytal, 0077 pisze).
- Zero nowej zaleznosci. Ten sam stack (JSZip + fast-xml-parser) i ten sam matcher co redline.
- Zero egress, zero natywnego procesu. Calosc w pamieci backendu (Art. 1).
- Symetria z `parseComments` - co emitujemy, to czytamy z powrotem; protokol `[PATRON: ...]` round-trip dziala w obie strony.
- 868 testow pass (5 todo, 0 fail), TSC clean. 11 nowych testow obejmuje round-trip, plumbing, wiele komentarzy, bledy kotwiczenia, wspolistnienie z trackiem, rozszerzanie istniejacych komentarzy.

**Koszty / ryzyka**:
- Mala duplikacja: ~25-liniowa petla wielostrategiczna `locate` jest powielona z `applyTrackedEdits` (tam inline w domknieciach). Rezerwacja: lift na wspolny `docxOoxml.locateUniqueAnchor` (patrz ANTY-ZAKRES).
- Bramka nakladania jest konserwatywna - odrzuca komentarz na fragmencie zawierajacym hyperlink/bookmark, nie tylko track. Wiekszosc kotwic recenzenta to czysty tekst, ale ostrzezenie musi byc jasne dla operatora.
- Run referencyjny uzywa stylu `CommentReference`, ktory moze nie byc zdefiniowany w `styles.xml` dokumentu. Word toleruje brak (uzywa domyslnego), ale komentarz nie ma wlasnego stylowania.

---

## ANTY-ZAKRES (rezerwacje - osobne ADR)

To ADR laduje **wylacznie prymityw silnika**. Poza zakresem, do osobnej iteracji z review:

- **Warstwa serwisu** (`runAddComments` na wzor `runEditDocument`): persystencja wersji, wiersze w bazie, annotacje do frontendu, rejestracja toolu w chatTools. Wymaga migracji (tabela `document_comments`) i renderu w panelu. Rezerwacja ADR-0078.
- **Frontend**: render komentarzy w `DocxView` (docx-preview gubi komentarze, trzeba je nalozyc jak tracked-change ids w ADR-0060).
- **Komentarz + redline na TYM SAMYM spanie**: dzis bramka odrzuca. Surgijne wstawienie markerow bez przebudowy runow (split runa na granicy bez naruszenia `w:ins`/`w:del`) - rezerwacja ADR-0079.
- **Wspolny `docxOoxml.ts`**: lift helperow drzewa + `locateUniqueAnchor` z obu modulow, usuniecie duplikacji petli strategii. Refaktor proven kodu redline - osobno, pod pelnym zielonym pakietem.
- **Odpowiedzi na komentarze / resolve komentarza** (`w:comment` threading, status done): poza MVP.

---

## Weryfikacja

```bash
cd backend && node node_modules/vitest/vitest.mjs run src/lib/docxComments.test.ts
# 11 passed

node node_modules/typescript/bin/tsc --noEmit   # clean
node node_modules/vitest/vitest.mjs run          # 868 passed, 5 todo, 0 fail
```
