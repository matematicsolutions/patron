# ADR-0075: Wlasny OCR Patrona na bazie GLM-OCR (MIT) - pipeline + sciezka fine-tune

**Status**: Proposed 2026-05-29 (kierunek zatwierdzony przez Wieslawa: "zbudujmy wlasny na tej
architekturze"). Decyzja silnika bazowego + zakres "wlasnego". Implementacja w fazach.
**Data**: 2026-05-29
**Powiazane**: ADR-0074 (silnik konwersji engine-agnostic - GLM-OCR wpina sie przez PATRON_OCR_CMD),
ADR-0071 (zero-cloud, model bundlowany nie pobierany), ADR-0008 (pl-entities - post-processing),
ADR-0054 (RAG - OCR zasila indeks), wizja "Wszystkie formaty, lokalnie, bez grzebu"

## Kontekst

OCR to powod powstania Patron Desktop (bol Beaty: skany/zdjecia/PDF bez warstwy tekstu). Recon
silnikow (2026-05-29):
- **Chandra** (datalab): SOTA, ale MODEL na OpenRAIL-M - restrykcja komercyjna + klauzula
  antykonkurencyjna. OK na faze TESTOW (research/personal/maly startup), BLOKER na komercje (ADR-0074).
- **GLM-OCR** (zai-org / Z.ai): **wagi modelu na MIT** (komponent layoutu PP-DocLayoutV3 Apache 2.0) -
  czysty komercyjnie. 0.9B params (~3.6GB BF16), SOTA OmniDocBench V1.5 94.62, output Markdown + JSON
  (tryb information-extraction ze schematem), local przez transformers / vLLM / SGLang / **Ollama**
  (`ollama run glm-ocr`), offline po pobraniu. Architektura: PP-DocLayoutV3 (layout) -> CogViT encoder
  -> cross-modal connector -> GLM-0.5B decoder; dwuetapowo: analiza layoutu -> rownolegly OCR regionow.

GLM-OCR rozwiazuje JEDNOCZESNIE problem licencji (MIT > OpenRAIL-M Chandry), jakosci (SOTA), wagi
(lekki 0.9B) i integracji (Ollama - Patron juz ma te infrastrukture lokalna).

## Decyzja

**Silnik bazowy OCR = GLM-OCR (MIT).** Budujemy WLASNY OCR na tej architekturze w 3 poziomach
(swiadomie NIE poziom 3):

1. **Poziom 1 - wlasny PIPELINE (`patron-ocr`):** owijka GLM-OCR (przez Ollama/transformers) +
   nasze post-processing pod polskie prawo: normalizacja sygnatur (reuse lib/pl-entities), sanity-check
   dat (znany problem "OCR rok 3013"), flagi pewnosci, nasz kontrakt Markdown -> RAG/graf, tryb
   JSON-schema GLM-OCR -> ekstrakcja encji PL (PESEL/NIP/sygnatury). To jest "nasz OCR" - owny,
   brandowany, dostrojony, czysta licencja, na SOTA bazie. Wpina sie w PATRON_OCR_CMD (ADR-0074).

2. **Poziom 2 - wlasny MODEL przez fine-tune (FAZA 2, moat):** LoRA na GLM-OCR 0.9B na labeled polskich
   skanach sadowych. MIT pozwala. 0.9B + LoRA = tanio (1 GPU, godziny). Daje realny moat: "OCR ktory
   czyta polskie pisma najlepiej". Wymaga labeled datasetu (mamy realne pisma - budowa zbioru
   content-blind / syntetyczny). Walidacja jak VERDICT-REAL Docxodus (content-blind na realnych skanach).

3. **Poziom 3 - model fundacyjny od zera: ODRZUCONY.** Multi-$M, klaster GPU, miesiace, zero moatu.
   OCR scommoditizowany; nasz moat to pipeline prawny + governance, nie OCR. Pulapka srodkow.

## Bramki / caveaty (do walidacji przed produkcja)

- **Polski:** GLM-OCR wymienia "8 jezykow", polski NIE potwierdzony nominalnie. TWARDA bramka:
  content-blind eval jakosci PL na realnych skanach Beaty PRZED uznaniem za kanon. Jesli slaby na PL -
  poziom 2 (fine-tune) staje sie obowiazkowy, nie opcjonalny.
- **GPU:** BF16 rekomenduje GPU CUDA; CPU dziala ale wolno (~0.9B). Wplyw na "next-next-finish" u Beaty -
  spina sie z pakietami sprzetowymi z wizji (Start CPU / Pro+Sovereign GPU). Do decyzji przy packagingu.
- **Faza testow vs komercja:** na pilotaz mozna uzyc Chandry (licencja OK na test) ALBO od razu GLM-OCR
  (MIT, czysto i na test, i na komerce - rekomendacja: od razu GLM-OCR, jeden silnik na obie fazy).

## Konsekwencje

- Czysta licencja (MIT) na komercje - zdjeta bramka licencji Konstytucji vs Chandra.
- "Wlasny OCR" realny i obronny (pipeline + fine-tune), bez pulapki modelu fundacyjnego.
- Integracja przez Ollame - ta sama infra lokalna co modele LLM Patrona, zero-cloud naturalne.
- Engine-agnostic runner (ADR-0074) juz gotowy - GLM-OCR to config + bundle, nie przepisywanie.

## Nastepne kroki (gdy model zainstalowany + realne skany)

1. Zainstalowac GLM-OCR (Ollama lub transformers), ustawic PATRON_OCR_CMD, test OCR end-to-end.
2. Content-blind eval jakosci PL na realnych skanach (bramka polski).
3. `patron-ocr` wrapper + post-processing PL (sygnatury/daty/confidence/JSON->encje).
4. FAZA 2: labeled dataset PL + LoRA fine-tune + walidacja content-blind.

## Proces (insight Wieslawa, do utrwalenia)

Regularnie skanowac GitHub pod katem NASZYCH potrzeb - sa tam genialnie proste rozwiazania (GLM-OCR
to przyklad: w tydzien od premiery rozwiazal nasz problem licencja+jakosc+waga). Rejestr ocen narzedzi
+ rytm przegladu.
