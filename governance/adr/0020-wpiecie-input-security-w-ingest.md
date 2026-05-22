# ADR-0020: Wpiecie Input Security Pipeline w kontrakt ingestu dokumentow

> **Uwaga numeracja**: ostatni zajety ADR to 0019 (input-security skeleton, commit e23e444). Przed bumpem sprawdzono `ls governance/adr/`. Jezeli rownolegla sesja zajmie 0020, przenumerowac.

**Status**: Przyjety (2026-05-22 - Wieslaw zaakceptowal rekomendacje: ingest / sync; `human_review` odbiera Operator + Inspektor. Default-on jest decyzja PROJEKTOWA (warstwa istnieje i jest wlaczana w kodzie), ale BRAMA PRODUKCYJNA: default-on w produkcji dopiero po ukonczeniu T3 - regression set PL kalibrujacy progi)
**Data**: 2026-05-22

**Powiazane zasady** (Konstytucja Patrona v1.1.1, zweryfikowane wzgledem `governance/CONSTITUTION.md`):
- **Art. 5 - Tajemnica zawodowa** - skan wejscia chroni przed dokumentem, ktory probuje sklonic model do ujawnienia kontekstu innej sprawy. Wpiecie czyni te ochrone domyslna, nie opcjonalna.
- **Art. 6 - Granica bledu / human in the loop** - `human_review` i `blocked` zatrzymuja sciezke i oddaja decyzje czlowiekowi (Operator / Inspektor). Skan NIGDY nie kasuje dokumentu po cichu.
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - kazdy skan loguje zdarzenie `input_security_scan` do hash-chain audit logu (ADR-0001).
- **Art. 8 - Stalosc kontraktow** - to jest WLASNIE ten ADR. Zmieniamy zachowanie sciezki uploadu (`handleDocumentUpload`) - publiczna powierzchnia. Decyzja wymaga osobnego ADR (zgodnie z [[feedback_adr_granica_skeleton_vs_produkcja]]) i akceptacji Administratora kancelarii.

**Powiazane ADR**: ADR-0019 (skeleton input-security - bezposrednio wpinany), ADR-0001 (audit log - cel logowania), ADR-0003/0013 (pseudonimizacja - kolejnosc w potoku, patrz nizej), ADR-0007/0008 (RAG/graf - skan PRZED indeksacja).

---

## Kontekst - realne szwy w kodzie

Wyekstrahowany tekst dokumentu wchodzi do systemu w dwoch miejscach:

1. **Ingest** - `backend/src/routes/documents.ts:833` `handleDocumentUpload()` (uzywane tez przez `projects.ts:534`). Tu plik jest przyjmowany, konwertowany i utrwalany. To **jedyny punkt, przez ktory dokument wchodzi raz** - naturalne miejsce na skan.
2. **Read-time** - `backend/src/lib/chat/tool-dispatch.ts` narzedzie `read_document` (`extractPdfText` / `extractDocxBodyText`) - moment, w ktorym tresc dokumentu trafia do promptu modelu.

Dzis (ADR-0019) modul `input-security` istnieje i jest przetestowany, ale **nie jest wywolywany znikad**.

---

## Decyzja (rekomendacja - do akceptacji)

**Wpinamy skan w INGEST jako szew podstawowy**, read-time jako obrona w glab (faza 2).

### Gdzie i kiedy
W `handleDocumentUpload`, **po ekstrakcji tekstu, PRZED utrwaleniem w storage i PRZED indeksacja RAG** (ADR-0007/0008). Skan raz, na wejsciu - tresc zatruta nigdy nie dociera do indeksu ani do modelu.

### Kolejnosc w potoku
`ekstrakcja -> input-security (ADR-0020) -> [gate] -> persist + RAG-index -> (pozniej, w czacie) pseudonimizacja PII (ADR-0003)`. Skan bezpieczenstwa jest PRZED pseudonimizacja: pseudonimizacja chroni to, co wychodzi DO modelu; skan chroni przed wroga trescia na wejsciu. Inny cel, inny moment.

### Mapowanie akcji na zachowanie (Art. 6)
- `allowed` -> utrwal i indeksuj normalnie.
- `quarantined` -> utrwal, ale oznacz dokument flaga (np. `security_status='quarantined'`); NIE indeksuj w RAG do czasu redakcji/akceptacji.
- `human_review` -> NIE utrwalaj jako gotowy; zwroc uzytkownikowi status "skierowano do przegladu", powiadom Operatora/Inspektora.
- `blocked` -> odrzuc upload (HTTP 422 + powod), zaloguj, nie zapisuj bajtow.

### Synchronicznie czy asynchronicznie
**Rekomendacja: synchronicznie na ingescie.** Skan jest deterministyczny (regex/heurystyka, bez sieci, bez LLM) - rzedu milisekund dla typowego pisma. Blokujaca kontrola jest bezpieczniejsza dla produktu regulowanego niz "zapisz teraz, cofnij pozniej". Dla skrajnie duzych plikow (limit 100 MB) ustawiamy budzet czasu i przy przekroczeniu degradujemy do `human_review`, nie do cichego `allowed`.

### Default-on
**Rekomendacja: domyslnie wlaczone.** Art. 5 ma byc ochrona domyslna. Konfiguracja per kancelaria moze regulowac progi (T3 ADR-0019), nie samo istnienie skanu.

### Audyt
Kazdy skan (takze `allowed`) loguje `input_security_scan` z `reportId`, `riskScore`, `action`, skrotem pliku do hash-chain (ADR-0001). Zasila audit bundle (ADR-0006).

---

## Alternatywy odrzucone

1. **Skan tylko read-time** (w `read_document`) - odrzucone jako szew podstawowy: tresc trafilaby do indeksu RAG (zatrucie) zanim ktokolwiek ja przeczyta; skan powtarzalby sie przy kazdym odczycie. Read-time zostaje jako obrona w glab.
2. **Asynchronicznie po zapisie** - odrzucone jako domyslne: okno, w ktorym zatruty dokument jest juz w indeksie/dostepny, lamie duch Art. 5. Dopuszczalne tylko dla plikow przekraczajacych budzet czasu skanu sync.
3. **Opt-in** - odrzucone: ochrona tajemnicy nie moze byc domyslnie wylaczona.
4. **Twardy `blocked` dla kazdego finding** - odrzucone (Art. 6): tylko `critical` blokuje autonomicznie; reszta -> human_review/quarantine.

---

## Konsekwencje

**Pozytywne**: ochrona wejscia domyslna i audytowalna; RAG nigdy nie indeksuje niezbadanej tresci; jeden szew, jeden log.

**Negatywne / do pilnowania**:
- Zmiana kontraktu `handleDocumentUpload` - nowe kody odpowiedzi (422 blocked, status quarantined/review). Frontend musi je obsluzyc (i18n komunikatow).
- Skan sync dodaje latency do uploadu - akceptowalne dla skanu deterministycznego, do zmierzenia na realnych plikach.
- Schema: kolumna `security_status` / `security_report_id` na `documents` lub `document_versions` = migracja SQL (kontrakt Art. 8; RODO art. 32 - bezpieczenstwo przetwarzania).
- False-positive blokujace legalny dokument - dlatego progi z T3 (regression set PL) MUSZA byc skalibrowane PRZED default-on w produkcji.

---

## Plan wpiecia

- **W1 - Schema + audit**: kolumna statusu na `documents`/`document_versions`; typ zdarzenia `input_security_scan` w audit logu (ADR-0001). Migracja SQL + test.
- **W2 - Wpiecie sync w `handleDocumentUpload`**: wywolanie `analyzeInput()` po ekstrakcji, gate przed persist/RAG, mapowanie akcji na kody HTTP. Testy integracyjne (legalny PL przechodzi; spreparowany blokowany/review).
- **W3 - Frontend**: obsluga 422/quarantined/review + i18n (`frontend/messages/`), zgodnie ze standardem "slownik PRZED komponenty".
- **W4 - Read-time defense-in-depth**: skan w `read_document` (tool-dispatch) - lekki, bez ponownego pelnego raportu, tylko twarde sygnaly.
- **W5 - Konstytucja**: MINOR bump (Art. 5 dostaje punkt "kontrola wejscia dokumentow"). Osobna decyzja governance (moze byc ten sam PR co W2).

---

## Punkty decyzyjne (CZEKAJA na Wieslawa)

Rozstrzygniete przez Wieslawa 2026-05-22:

- [x] **Szew / Sync / Default-on** - przyjete w calosci: skan na ingescie, synchronicznie, domyslnie wlaczony.
- [x] **Gate `human_review`**: odbiera **Operator + Inspektor** (Konstytucja role 4.2 i 4.3).
- [x] **Kalibracja progow**: T3 (regression set PL) wymagany PRZED default-on w produkcji - TAK.
- [x] **Akceptacja ADR** -> ADR-0019 i 0020 = Przyjete, start W1.

---

## Status weryfikacji

- [x] Szwy wpiecia zlokalizowane w kodzie: `documents.ts:833` (ingest), `tool-dispatch.ts` (read-time).
- [x] Modul ADR-0019 gotowy i przetestowany (9/9), nie wywolywany - potwierdzone.
- [x] Artykuly Konstytucji (3/5/6/8) zweryfikowane gripem wzgledem v1.1.1.
- [ ] Akceptacja Punktow decyzyjnych przez Wieslawa.
