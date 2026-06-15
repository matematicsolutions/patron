# ADR-0074: Silnik konwersji dokumentow -> Markdown + OCR (warstwa wejscia)

**Status**: Proposed -> In progress 2026-05-29 (decyzje zablokowane; implementacja w krokach). Konstytucja: bump MINOR przy wpieciu (nowy akceptowany format wejscia = zmiana kontraktu produktu).
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 2 (zero-cloud), Art. 5 (kontrola wejscia),
AI Act art. 12; wizja Patron Desktop ("Wszystkie formaty, lokalnie, bez grzebu")
**Powiazane**: ADR-0055/0019/0020 (kanoniczny ingest + input-security - tu wpinamy sie PRZED skanem),
ADR-0054 (RAG - konwersja zasila indeks), ADR-0056 (Folder Sprawy - auto-pipeline OCR),
ADR-0071 (zero-cloud: model OCR BUNDLOWANY, nie pobierany), ADR-0070 (H5 skan wersji)

## Kontekst

To jest powod powstania Patron Desktop. Najwiekszy bol kancelarii (Rumpole, dzisiejszy stack Libra):
konwersja dokumentow - zdjecia, skany papierowe, PDF bez warstwy tekstu - z limitami rozmiaru/liczby
plikow i recznym OCR. Patron ma przyjac *cokolwiek* bez limitu i lokalnie zamienic na tekst (Markdown),
ktory zasila reszte pipeline (RAG + graf + analiza + marko/humanizer + Word).

Stan zastany: ingest (`documentIngest.ts`) akceptuje TYLKO `pdf/docx/doc`, ekstrakcja przez pdfjs/mammoth,
ZERO OCR. Obrazy odrzucane, skan-bez-warstwy-tekstu wchodzi pusty. Konwersja, ktora wygrala z Libra
(40 stron vs 14), zyla po stronie Claude + skille Python (markitdown / opendataloader-pdf / Chandra) -
NIE w spakowanym buildzie. Ten ADR wnosi ja do pakietu.

## Decyzja

Warstwa konwersji->Markdown PRZED istniejacym ingestem. Drabinka jakosc-najpierw (wybor Wieslawa:
"bierzemy najlepsze, potem rozwijamy"):

| Wejscie | Silnik | Uwaga |
|---|---|---|
| DOCX/DOC | mammoth / istniejaca sciezka | juz dziala |
| PDF z warstwa tekstu | pdfjs (extractPdfText) -> opcjonalnie opendataloader dla tabel | juz dziala |
| PDF-skan bez warstwy tekstu | **Chandra OCR** (detekcja: malo/zero tekstu) | lokalny |
| Obraz (jpg/png/tiff) | **Chandra OCR** | lokalny |
| PDF z tabelami/kolumnami | opendataloader-pdf (Java) | reading order + tabele |

**Silnik OCR: ENGINE-AGNOSTIC przez env `PATRON_OCR_CMD`** - wybor silnika to config + bundle,
ZERO zmian kodu. Runner dwutrybowy (stdout / katalog-out) obsluguje rozne silniki.

### Bramka licencji silnika OCR (KRYTYCZNA - do decyzji przy bundlu)

Wieslaw wskazal Chandre (jakosc PL 85.3%). Recon licencji (2026-05-29, github.com/datalab-to/chandra):
- **Kod Chandry: Apache 2.0** (OK). **MODEL: modified OpenRAIL-M** - "free for research, personal use,
  and startups under $2M funding/revenue, **cannot be used competitively with our API**".
- **PROBLEM:** Patron to produkt KOMERCYJNY sprzedawany kancelariom (setup 5-10k + retainer). OCR
  dokumentow moze byc uznany za konkurencyjny wobec API OCR Datalab; dodatkowo zakladamy prog
  przychodowy. Dla produktu, ktorego value-prop to ZGODNOSC, zbundlowanie modelu z restrykcyjna
  antykonkurencyjna licencja = ryzyko prawne i wizerunkowe. Trafia w bramke licencji Konstytucji
  (whitelist MIT/Apache/BSD/AGPL; OpenRAIL-M poza nia).
- **CLI Chandry (gdyby wybrana):** `chandra {input} {outdir} --method hf` -> katalog z `<plik>.md`;
  offline przez `HF_HUB_OFFLINE` + zbundlowane wagi; backend HF wymaga torch (ciezki, GPU/CPU).

**Rekomendacja CTO:** dla bundla komercyjnego silnik z czysta licencja - **Tesseract** (Apache 2.0,
lekki, `pol` traineddata; `tesseract {input} stdout -l pol`) albo **PaddleOCR** (Apache 2.0, lepszy
na uklad/tabele). Chandra tylko jesli (a) uzyskamy komercyjna licencje od Datalab albo (b) potwierdzimy
ze mieszczemy sie w wyjatku i nie jest to uzycie konkurencyjne - decyzja prawna Wieslawa. Architektura
engine-agnostic czyni te zmiane jednolinijkowa (PATRON_OCR_CMD + bundle), wiec NIE blokuje to kodu.

**Architektura:** moduł `lib/convert/toMarkdown.ts` - czysta detekcja typu + routing, a wywolanie konwerterow
przez **subprocess** (`spawn`) za WSTRZYKIWANYM runnerem (wzorzec `defense.ts` z injected llm -> testy bez
binariow). Wynik (Markdown + uzyty silnik + flaga ocrUsed) wpada w istniejacy ingest: input-security scan ->
utrwalenie -> RAG/graf. Zero duplikacji ingestu (AGENTS.md).

**Subprocess omija blokade junction node_modules->~/patron** (inaczej niz natywny sterownik) - konwertery to
zewnetrzne procesy (Python/Java), nie npm deps. Sciezki binarek z env (`PATRON_OCR_CMD`,
`PATRON_MARKITDOWN_CMD`, ...) - decyzja pakowania nie blokuje rdzenia kodu.

**Zero-cloud (spojne z ADR-0071):** model Chandry BUNDLOWANY w instalce, NIGDY pobierany przy starcie
(zaden ukryty egress). Inferencja lokalna - tresc aktu nie opuszcza maszyny.

## Packaging (decyzja Wieslawa)

**Wszystko w jednej instalce.** Rozmiar nieistotny (nawet 20 GB - mecenasi maja sprzet). Python + Java +
wagi Chandry pakowane jako **bundled sidecar** (embeddable Python / PyInstaller + JRE + model). Rumpole:
next->next->finish, zero zewnetrznych instalacji. Instalacja osobnych narzedzi - ODRZUCONA. Zasada:
"prawnika interesuje uzytecznosc, nie technologia" - technologia niewidzialna.

## Konsekwencje

- Patron przyjmuje *kazdy* format (zdjecie/skan/PDF/DOCX/folder) bez limitu - rdzen value-prop z wizji
  i headline opublikowanego posta pilotazowego, dostarczony w pakiecie (nie Claude-w-petli).
- Konwersja zasila to, co juz dziala: RAG, graf cytowan, citation grounding, pipeline obrony.
- Spina sie z Folder Sprawy (ADR-0056): watcher -> convert -> ingest automatycznie.
- Zachowane zero-cloud + input-security (skan przechodzi ten sam gate co upload).

## Ograniczenia / dlug (FAZA 1, "potem rozwijamy w lepsze")

- Packaging sidecar (embeddable Python + JRE + wagi Chandry) - osobna robota build/instalator.
- OCR duzych skanow wolny -> async w workerze z paskiem postepu (jak C3 Docxodus), nie blokuje UI.
- Tabele: pelna struktura przez opendataloader; w MVP placeholder + tekst.
- Podpisy/pieczatki/wykresy: szczebel 5 drabinki (multimodal vision) - poza OCR tekstu.
- Walidacja jakosci OCR na realnych skanach sadowych Beaty (content-blind, jak VERDICT-REAL Docxodus).

## Status weryfikacji (plan)

- `lib/convert/toMarkdown.ts`: czysty routing + detekcja warstwy tekstu + injected runner -> testy bez Chandry.
- Rozszerzenie ALLOWED_TYPES (+jpg/png/tiff) w ingest + frontend `accept`. Wpiecie skanu w istniejacy gate.
- tsc clean, testy zielone. Walidacja na realnym skanie = przed instalacja u Beaty.
