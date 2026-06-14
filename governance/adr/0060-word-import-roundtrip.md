# ADR-0060: Word import roundtrip - odczyt tracked changes + komentarzy-instrukcji

**Status**: PROPONOWANY (2026-05-28). Dodaje strone odczytu edytowanego DOCX wracajacego z Worda. Backend dziala (parser + endpoint), niewpiety jeszcze w UI ani w Bibliotekarza.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 2 / zero-cloud** - parsowanie deterministyczne, lokalne (jszip + fast-xml-parser), zero wywolan sieciowych i LLM. Plik nie opuszcza maszyny.
- **Art. 3 - Audytowalnosc** - odczyt tracked changes daje sciezke "kto co zmienil" (w:author, w:date, w:id). Reprodukowalny.
- **Art. 6 - Granica bledu** - komentarze [PATRON: ...] sa traktowane jako instrukcje dopiero gdy mecenas swiadomie je wstawi w Wordzie; PATRON ich nie zgaduje.

**Powiazane ADR**: ADR-0057 (Bibliotekarz - uczy sie stylu mecenasa z trackedChanges przez remember), ADR-0058 (pipeline obrony - instrukcje [PATRON: ...] moga zlecac doskonalenie fragmentu). Komplementarne do strony zapisu `docxTrackedChanges.ts` (applyTrackedEdits / resolveTrackedChange).

---

## Kontekst

Sedno integracji Word z roadmapy: Rumpole edytuje pismo w Wordzie (tracked changes + komentarze), wrzuca z powrotem do PATRON-a. Wymaga to odczytu edytowanego DOCX - strona zapisu juz istniala (docxTrackedChanges.ts wstawia w:ins/w:del i akceptuje/odrzuca po w:id), brakowalo parsowania tego co wraca.

Dwie rzeczy do wydobycia:
1. **Tracked changes** (w:ins/w:del) - co i kto zmienil. Material dla Bibliotekarza (uczenie stylu) i dla diffu.
2. **Komentarze-jako-instrukcje** - Rumpole zaznacza tekst i wstawia komentarz `[PATRON: rozwin ten argument]`. PATRON wykrywa prefiks i traktuje jako polecenie workflow, bez odrywania mecenasa od Worda.

## Decyzja

### 1. Parser `backend/src/lib/docxRoundtrip.ts`
- `parseTrackedChanges(bytes)` - walk word/document.xml, zbiera w:ins/w:del z `{kind, author, date, text, w_id}` (tekst z w:t / w:delText).
- `parseComments(bytes)` - word/comments.xml -> `{id, author, date, text, instruction}`.
- `detectPatronInstruction(text)` - pure, regex `[PATRON: tresc]` (case-insensitive, trim) -> tresc lub null.
- `parseDocxRoundtrip(bytes)` - komplet + lista `instructions`.

Parser ma `parseTagValue:false` - inaczej numeryczne w:t ("5000") staja sie liczbami i wypadaja z ekstrakcji.

### 2. Endpoint `POST /draft/roundtrip`
Multipart (pole "file"), requireAuth -> parseDocxRoundtrip -> `{ trackedChanges, comments, instructions }`. Czyste parsowanie; konsumpcja (Bibliotekarz remember, wykonanie instrukcji) nalezy do warstwy czatu.

---

## Alternatywy odrzucone

1. **Reuse prywatnych helperow z docxTrackedChanges.ts**. Odrzucone: tamte (createParser, elName...) sa module-private i skrojone pod zapis (preserveOrder + apply). Odczyt to osobny koncern; male, samodzielne helpery w docxRoundtrip.ts sa czystsze niz eksportowanie wnetrza modulu zapisu.
2. **Parsowanie kotwicy komentarza (commentRangeStart/End -> zaznaczony tekst)**. Odrzucone w v1: mapowanie referencji komentarza na zakres tekstu w document.xml jest zlozone. v1 zwraca tresc komentarza + instrukcje; powiazanie z konkretnym fragmentem = rezerwacja.
3. **Auto-wykonanie instrukcji [PATRON: ...] w endpoincie**. Odrzucone: endpoint tylko parsuje. Wykonanie (generacja v2 fragmentu, pipeline obrony) to decyzja modelu/mecenasa w czacie - separacja odczytu od dzialania.
4. **LLM do interpretacji zmian**. Odrzucone: zbedne i sprzeczne z Art. 1/3. Tracked changes sa strukturalne (OOXML), parsuja sie deterministycznie.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 702 pass / 5 todo / 0 fail (z 694 przed ADR; +8 w `docxRoundtrip.test.ts`). Test tracked changes domyka petle zapis->odczyt (applyTrackedEdits tworzy w:ins/w:del -> parseTrackedChanges odczytuje z autorem); parseComments na DOCX z wstrzynieta comments.xml; detectPatronInstruction pure. Bez sieci/LLM.
- **LoC**: ~310 (docxRoundtrip.ts 173, docxRoundtrip.test.ts 112, draft.ts +~25 endpoint).
- **Zero nowych zaleznosci npm** (jszip + fast-xml-parser juz w stacku).
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0060

- **Kotwica komentarza -> zaznaczony fragment** (commentRangeStart/End) -> rezerwacja.
- **Konsumpcja przez Bibliotekarza** (auto-remember stylu z trackedChanges) -> warstwa czatu/rezerwacja.
- **Wykonanie instrukcji [PATRON: ...]** (generacja v2 w miejscu komentarza) -> warstwa czatu/rezerwacja.
- **UI drag&drop edytowanego DOCX + widok diffu** -> rezerwacja frontend.
- **Roundtrip dla footnotes/headers/tabel** (obecnie document.xml body + comments.xml) -> rezerwacja.
- **Wpiecie w wersjonowanie dokumentu** (edytowany DOCX jako nowa document_versions) -> rezerwacja.
