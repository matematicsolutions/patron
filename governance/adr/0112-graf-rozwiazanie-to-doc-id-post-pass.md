# ADR-0112: Graf cytowan - rozwiazanie krawedzi dokument->dokument (to_doc_id)

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P2 #11. `lib/graph/extractor.ts` zawsze ustawia `toDocId: null` (przy ekstrakcji nie wiadomo, czy cytowana encja ma swoj dokument). Kolumna `citation_graph.to_doc_id` byla faktycznie martwa; powiazanie dokument->dokument liczono dopiero przy zapytaniu (centralnosc po wspolnej `value_normalized`, `retrieval.ts`). Brakowalo trwalej krawedzi "dokument X cytuje wyrok bedacy dokumentem Y".

## Decyzja

Nowy `lib/graph/crossDocLinks.ts` - `resolveToDocLinks(db)`: deterministyczny post-pass (zero LLM, Konstytucja Art. 3) liczacy `to_doc_id`. Krawedz cytowania celuje w encje w dokumencie CYTUJACYM (`to_entity_id`), ktorej `value_normalized` to cytowana sygnatura V. "Dokument, ktory NIA JEST" = INNY dokument korpusu z encja o tym samym (typ, `value_normalized`).

Regula jednoznacznosci: `to_doc_id` ustawiany TYLKO gdy taki dokument jest **dokladnie jeden**. Gdy zero albo wielu (encja generyczna typu "Sad Najwyzszy" wspoldzielona przez wiele akt) -> `null`; centralnosc query-time i tak to obsluguje. Ograniczone do sygnatur (`SYGNATURA_ORZECZENIA` / `SYGNATURA_AKTU`) - tam pojecie "dokument bedacy cytowana sygnatura" ma sens.

Wpiety w `indexDocument` po zapisie grafu/zdarzen - przelicza caly graf (idempotentnie, tanio dla korpusu desktop single-user), bo nowy dokument moze byc wlascicielem sygnatury cytowanej przez starsze (i odwrotnie).

**Korekta `clearDocumentIndex` (spojnosc z ADR-0109 P3 #13):** wczesniej dodany `delete from citation_graph where to_doc_id = ?` przy martwej kolumnie nigdy nie matchowal; gdy `to_doc_id` ozyl, kasowalby cudze cytaty przy usuwaniu dokumentu-celu. Zmieniono na `update ... set to_doc_id = null` - cytujacy nadal cytuje sygnature, znika tylko rozwiazany cel (re-resolve przy nastepnej indeksacji).

## Konsekwencje

- (+) Kolumna `to_doc_id` przestaje byc martwa - mozliwa nawigacja "ktore dokumenty cytuja dokument Y" trwale w grafie, nie tylko przy zapytaniu.
- (+) Zachowawcze: query-time centralnosc (`graphRankCandidates`) nietknieta - `to_doc_id` to DODATKOWY sygnal, nie zmiana rankingu.
- (-) Nierozstrzygniete "cytuje vs JEST" przy >1 wlascicielu -> null (swiadomie, zeby nie tworzyc mylacych krawedzi w dokumentacji prawnej, gdzie falszywe "X cytuje Y" jest gorsze niz brak krawedzi).
- **Poza zakresem (follow-up):** wezly PERSON w grafie - wymaga wpiecia detekcji osob (mamy `plEntityDetector` w warstwie pseudonim, ADR-0110) w sciezke ekstrakcji grafu z obsluga offsetow; osobny krok.
- **Testy:** vitest 1144 pass / 0 fail / 5 todo. `crossDocLinks.test.ts` (+4): rozwiazanie przy jednoznacznym wlascicielu (obie strony), null przy >1, idempotencja, `clearDocumentIndex` zeruje to_doc_id bez kasowania cytatu.
