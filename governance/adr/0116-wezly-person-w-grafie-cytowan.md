# ADR-0116: Wezly PERSON w grafie cytowan - "pokaz dokumenty wspominajace osobe X"

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora). Domkniecie drugiej polowy P2 #11 (audyt).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P2 #11: "po wpieciu detektora osob - wezly PERSON w grafie". Dotad `EntityType` mial `OSOBA` i `relationForEntity` mapowal `OSOBA -> wspomina_osobe`, ale `PL_EXTRACTION_RULES` NIE mialo reguly OSOBA -> encje osob nigdy nie powstawaly. Nie dalo sie odpowiedziec "pokaz wszystkie dokumenty wspominajace swiadka X".

## Decyzja

Nowa regula `osoba-z-markerem` w `lib/pl-entities/regex.ts` (`PL_EXTRACTION_RULES`, kanoniczna biblioteka encji PL - AGENTS.md "nie forkuj struktury"). `extractEntitiesAndEdges` automatycznie tworzy z niej encje OSOBA (do `extracted_entities`) + krawedzie `wspomina_osobe` (do `citation_graph`), bez zmian w extractorze.

Detekcja deterministyczna (Konstytucja Art. 3), zakotwiczona na markerze (honoryfikator/tytul/rola procesowa: Pan/Pani/adw./mec./r.pr./sedzia/prokurator/swiadek/oskarzony/biegly/powod/pozwany/pokrzywdzony/obronca) + grupa (1) = sama nazwa (1-3 tokeny z wielkiej litery, polskie znaki + lacznik). Marker NIE wchodzi do encji (detectAll bierze `m[1]`, offset wskazuje nazwe). Pierwsza litera markera case-insensitive (`[xX]`) - role bywaja na poczatku zdania z wielkiej ("Świadek X"). Lookbehind Unicode (NIE `\b` ASCII - marker moze zaczynac sie od polskiej litery). baseConfidence 0.75 (>=0.6 -> krawedz powstaje).

Precyzja: BEZ markera NIE lapiemy goych bigramow z wielkich liter (inaczej "Sad Najwyzszy", nazwy ustaw -> falszywe osoby). Nawigacja "kto wspomina X" = zapytanie `extracted_entities WHERE entity_type='OSOBA' AND value_normalized=?` -> document_id (wspolny `value_normalized` laczy dokumenty).

## RODO / governance

- OSOBA to **PII** w `extracted_entities` - ta sama tabela i cykl retencji co inne encje (PESEL/NIP/FIRMA). Purga: `clearDocumentIndex` (per dokument) + `forgetCase` (RODO art. 17, per sprawa) kasuja `extracted_entities` po `document_id` - bez nowej luki retencji.
- Krawedzie `wspomina_osobe` celuja w encje (`to_entity_id`), NIE w dokument. `resolveToDocLinks` (ADR-0112) ograniczony do sygnatur, wiec NIE ustawia `to_doc_id` dla osob (osoba nie jest dokumentem) - poprawnie.
- To detekcja LOKALNA (graf/indexer = warstwa sqlite, desktop single-user), zero egress. NIE myli sie z maskowaniem PII przed chmura (`lib/pseudonim/plDetector.ts`, ADR-0110) - tam wyjscie do modelu, tu encje grafu. Logika markerow jest blizniacza; **konwergencja do wspolnego zrodla markerow/nazw = rezerwacja** (dzis swiadoma, udokumentowana duplikacja: rozne ksztalty wyjscia - span do maskowania vs encja z offsetem).

## Konsekwencje

- (+) Graf odpowiada "ktore dokumenty wspominaja osobe X" (wspolny `value_normalized`); osoby sa wezlami obok sygnatur/firm.
- (-) Marker-anchored: nazwisko bez markera (gole "Jan Kowalski") nie jest wezlem (precyzja > recall, jak w egress). Mozliwe false-positive po markerze ("Pani Prezes" -> OSOBA "Prezes") - confidence 0.75, akceptowalne dla nawigacji; twarde identyfikatory lapia osobne reguly.
- (-) Wiecej PII w `extracted_entities` - swiadome, objete istniejaca purga RODO.
- **Testy:** vitest 1174 pass / 0 fail / 5 todo (+5 `person-nodes.test.ts`: detekcja OSOBA, offset nazwy, brak osoby bez markera, encja+krawedz wspomina_osobe, wspolny value_normalized miedzy dokumentami). Istniejace testy pl-entities/extractor (44) bez zmian.
