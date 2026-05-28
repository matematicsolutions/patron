# ADR-0055: Parytet skanu input-security na sciezce uploadu projektowego (doprowadzenie do zgodnosci z ADR-0020)

> **Uwaga numeracja**: ostatni zajety ADR to 0054 (hybrid retrieval na SQLite). Rezerwacje 0049-0052 sa atomowe i nieprzypisane jako pliki. Przed bumpem sprawdzono `ls governance/adr/` - 0055 wolny. Jezeli rownolegla sesja zajmie 0055, przenumerowac.

**Status**: Przyjety (2026-05-28) - doprowadzenie do zgodnosci z istniejaca decyzja ADR-0020, nie nowa regula governance. Nie wymaga bumpu Konstytucji (zachowanie jest juz wymagane przez ADR-0020; ten ADR usuwa odstepstwo - luke - na sciezce projektowej).
**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - upload dokumentu projektowego nie generowal zdarzenia `input_security_scan`. Dokumenty w projektach nie mialy sladu audytowego skanu. Ta zmiana przywraca wymog logowania kazdego skanu.
- **Art. 5 - Tajemnica zawodowa** - ochrona wejscia ma byc domyslna, nie zalezna od tego, czy dokument trafia do single-document czy do projektu.
- **Art. 6 - Granica bledu / human in the loop** - `human_review` / `blocked` na sciezce projektowej dzialaja teraz tak samo jak na single-document.
- **Art. 8 - Stalosc kontraktow** - sciezka projektowa zmienia kontrakt odpowiedzi (dochodza kody 202/422 oraz pole `security` i `security_status`). To rozszerzenie tej samej powierzchni co ADR-0020.

**Powiazane ADR**: ADR-0019 (skeleton input-security), ADR-0020 (wpiecie skanu w ingest - ten ADR domyka jego deklaracje), ADR-0001 (audit hash-chain), ADR-0054 (hybrid retrieval - gate `allowIndex` chroni indeks).

---

## Kontekst - deklaracja ADR-0020 byla nieprawdziwa

ADR-0020 (linia 22) zalozyl, ze `handleDocumentUpload()` to **jeden szew**, "uzywane tez przez `projects.ts:534`". W praktyce istnialy **dwie odrebne kopie** funkcji:

1. `backend/src/routes/documents.ts` - sciezka single-document. Po wpieciu ADR-0020 robila: `extractText -> analyzeInput -> resolveIngestOutcome -> appendAuditEvent(input_security_scan)` i gatowala persist / index po wyniku. Plus gate RAG z ADR-0054 (`outcome.allowIndex`).
2. `backend/src/routes/projects.ts` - sciezka dokumentow projektowych. **Wlasna kopia**, ktora NIGDY nie dostala wpiecia ADR-0020: utrwalala bajty od razu (`uploadFile` przed jakimkolwiek skanem), ustawiala `status: "ready"` na sztywno, nie wolala `analyzeInput`, nie logowala `input_security_scan`, nie ustawiala `security_status` / `security_report_id`, nie respektowala gate RAG.

**Skutek**: dokumenty wgrane do projektu omijaly detekcje prompt-injection / steganografii / homoglifow / evasion i nie mialy wpisu audytowego skanu. To realna luka bezpieczenstwa i compliance (AI Act art. 12, ADR-0020 obrona w glab). Sciezka projektowa to dominujacy sposob wgrywania dokumentow w produkcie (Folder Sprawy), wiec luka dotyczyla wiekszosci ruchu.

Przyczyna zrodlowa: **duplikacja kodu**. Dwie kopie funkcji rozjechaly sie, gdy ADR-0020 zmienil tylko jedna. Sama synchronizacja drugiej kopii nie usuwa klasy bledu - dwie kopie znow sie rozjada przy nastepnej zmianie.

---

## Decyzja

### 1. Parytet zachowania
Sciezka projektowa przechodzi przez identyczny potok co single-document: `ekstrakcja (extractPdfText / extractDocxBodyText) -> analyzeInput -> resolveIngestOutcome -> [gate] -> persist + RAG-index`. Mapowanie akcji na zachowanie wg ADR-0020:
- `blocked` -> 422, bajty NIE trafiaja do storage (return przed `uploadFile`).
- `human_review` -> 202, utrwalony, `status="review"`, NIE indeksowany.
- `quarantined` -> 201, utrwalony, oznaczony, NIE indeksowany.
- `allowed` -> 201, utrwalony, indeksowany (`outcome.allowIndex && scanText.trim()`).

Kazdy skan (takze `allowed`) loguje `input_security_scan` z `toAuditPayload` do hash-chain (ADR-0001). `documents.security_status` / `security_report_id` / `status` ustawiane z `outcome`.

### 2. Deduplikacja - jedno zrodlo prawdy
Logika zostaje **wyekstrahowana do `backend/src/lib/documentIngest.ts`** (`handleDocumentUpload` + prywatne helpery `countPdfPages`, `extractStructureTree`). Oba routery (`documents.ts`, `projects.ts`) importuja te jedna funkcje. Deklaracja ADR-0020 ("jeden szew") staje sie prawdziwa na poziomie kodu. To eliminuje klase regresji "dwie kopie sie rozjechaly".

---

## Alternatywy odrzucone

1. **Tylko zsynchronizowac kopie w projects.ts** (skopiowac blok skanu) - odrzucone: zostawia dwie kopie, ktore znow sie rozjada. Bug powstal wlasnie z tego powodu. Naprawia objaw, nie przyczyne.
2. **Skan async po zapisie na sciezce projektowej** - odrzucone z tych samych powodow co w ADR-0020 (okno, w ktorym zatruty dokument jest juz w indeksie/dostepny).
3. **Osobna, lzejsza kontrola dla projektow** - odrzucone: Art. 5 nie rozroznia, gdzie dokument zostal wgrany. Asymetria ochrony jest sama w sobie luka.

---

## Konsekwencje

**Pozytywne**: dokumenty projektowe maja domyslna, audytowalna ochrone wejscia; RAG nie indeksuje niezbadanej tresci niezaleznie od sciezki; jedna funkcja, jeden log, jeden punkt utrzymania; deklaracja ADR-0020 zgodna z kodem.

**Negatywne / do pilnowania**:
- Zmiana kontraktu odpowiedzi `POST /projects/:projectId/documents` - dochodza kody 202 (human_review) i 422 (blocked) oraz pole `security` w body i kolumna `security_status`. Frontend projektowy musi je obsluzyc tak samo jak single-document (i18n komunikatow - patrz ADR-0020 W3). Do zweryfikowania w UI Folder Sprawy.
- Skan sync dodaje latency do uploadu projektowego (jak w ADR-0020) - akceptowalne dla skanu deterministycznego (regex/heurystyka, bez sieci, bez LLM).
- Regresja przez duplikacje: zaadresowana strukturalnie (jedna funkcja). Nowe sciezki uploadu MUSZA importowac `lib/documentIngest`, nie kopiowac logiki.

---

## Status weryfikacji

- [x] Luka zlokalizowana: `projects.ts` `handleDocumentUpload` utrwalal bajty przed skanem, brak `analyzeInput` / audit / gate RAG.
- [x] Wspolna funkcja wyekstrahowana do `backend/src/lib/documentIngest.ts`; oba routery importuja.
- [x] Brak zewnetrznych / testowych importow starej kopii (tylko dwa routery) - ekstrakcja bez ryzyka po stronie testow.
- [x] `npm run build` - tsc clean.
- [x] `npm test` - 666 passed / 5 todo (671), 39 plikow testowych.
- [ ] Weryfikacja obslugi 202/422 + `security_status` w UI projektowym (Folder Sprawy) - osobny task frontend.
- [x] Review tresci ADR (marko-pl-content) PRZED merge - 2026-05-28, werdykt przecietne po poprawkach (usuniecie ukutego "konformacja", fix zniekształconego slowa).
