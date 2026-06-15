# ADR-0012: Self-contained Document Viewer HTML (extends ADR-0010 T6)

**Status**: Proponowany (cherry-pick uzupelniajacy ADR-0010, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona v1.1.1, Art. 1 (lokalnosc - viewer dziala bez API, bez serwera, dane pozostaja na maszynie klienta), Art. 3 (audytowalnosc - viewer eksponuje hash-chain glowny eksportu w stopce do recznej weryfikacji), Art. 5 (tajemnica zawodowa - klient otwiera plik w przegladarce bez wysylania danych w gore)
**Powiazane ADR**: ADR-0006 (audit bundle AI Act art. 12 - viewer.html jest dodatkowym artefaktem zgodnosci obok JSON/CSV/manifest), ADR-0010 (contract review module - ten ADR rozszerza T6 Export o czwarty format dostawy), ADR-0011 (span-level offsets - viewer rendera komorki z cytatami uzywajac formatu z ADR-0011)
**Inspiracja cherry-pick**: [isaacus-dev/cookbooks/tabular-review/viewer.html](https://github.com/isaacus-dev/cookbooks/blob/main/cookbooks/tabular-review/viewer.html) (MIT, autor Isaacus, snapshot 2026-04-22 z `pushed_at`). **NIE forkujemy** - cherry-pick wzorca self-contained single-file HTML viewer z drag-drop JSON input. Implementacja Patrona pisze od zera pod polskie typy encji + integracja z audit bundle.

## Decyzja

Patron dostaje **czwarty format eksportu** modulu Contract Review (ADR-0010 T6): **self-contained `viewer.html`** - pojedynczy plik HTML z inline Vue 3 + Tailwind/Lucide z CDN, ktory:

1. Klient kancelarii (np. partner zarzadzajacy bez IT) otwiera plik dwukrotnym klikiem w Chrome/Edge/Firefox - bez instalacji oprogramowania, bez konta w Patronie.
2. Przeciaga JSON wyniku contract review na strone (drag-drop) **lub** plik HTML zostal pre-wstrzykniety z `window.__INLINE_DOC__` przed dostawa.
3. Widzi caly grid z kolorami pewnosci (ADR-0011), klika komorke -> popup z cytatem zrodlowym + highlight w tekscie segmentu.
4. Filtruje encje (osoby/organizacje/sygnatury/identyfikatory PL), nawiguje po segmentach drzewem.
5. Cala interakcja jest client-side - zadne dane nie sa wysylane do Patrona ani do dostawcy zewnetrznego po otwarciu pliku.

Viewer eksportujemy obok dotychczasowych formatow:
- `report.docx` (T6 ADR-0010) - sformatowany raport dla partnera
- `dataset.csv` (T6 ADR-0010) - raw grid dla analizy w Excelu
- `audit-bundle.tar.gz` (ADR-0006) - zgodnosc AI Act art. 12
- **`viewer.html` (NOWY)** - interaktywny artefakt dla klienta bez infrastruktury

## Kontekst

ADR-0010 T6 zdefiniowal eksport jako `.docx + .csv + audit bundle`. To wystarcza dla **kancelarii internej obrobki** (prawnik dostarcza partnerowi `report.docx`, archiwum trzyma `audit-bundle.tar.gz`).

**Brakuje formatu dla klienta zewnetrznego** - sytuacji typowych:

1. **Due diligence M&A**: kancelaria analizuje portfel 47 umow przejmowanej spolki na zlecenie kupujacego. Kupujacy chce zobaczyc wynik **interaktywnie** (filtrowac umowy z klauzula change of control, klikac cytaty), ale **nie ma dostepu do Patrona** (Patron jest u kancelarii). Wysylanie kupujacemu `.docx` z grid table jest niewygodne i traci interaktywnosc cytatow.

2. **Audyt IOD wewnetrzny**: IOD korporacyjny audytuje 120 umow powierzenia danych (art. 28 RODO) z pomoca zewnetrznej kancelarii. IOD chce zachowac wynik w swoich systemach, mowic z zarzadem przez przegladarke, **bez** zalogowania sie do Patrona klancelarii.

3. **Demo na konferencji KIRP/NRA**: prezentacja wyniku analizy bez VPN do serwera kancelarii, bez logowania do API, bez bezposredniego polaczenia z baza - artefakt dziala w przegladarce zlokalu konferencyjnego.

4. **Archiwizacja dlugoterminowa**: kancelaria po zakonczeniu sprawy archiwizuje cala dokumentacje na 10 lat (obowiazek wynikajacy z polityk kancelarii). **Postgres za 10 lat moze nie istniec** (migracja, upgrade, change of vendor). **Single-file HTML otwierany w przegladarce za 10 lat na pewno bedzie dzialal** (HTML jest backward compatible, CDN-free fallback do inline assets).

Isaacus viewer.html pokazuje, ze to da sie zrobic w ~10000 linii Vue 3 w jednym pliku (oszacowanie z minifikowanego HTML, do walidacji wlasna implementacja w T6.7) z drag-drop JSON i pelnym interactive viewer. Architektura jest czysta:
- 100% client-side (Vue 3 createApp, ref, computed, watch)
- Tailwind/Lucide/JSZip/Mammoth z CDN (z fallbackiem inline)
- Drag-drop `doc.json` ALBO `window.__INLINE_DOC__` jako entry point
- Bez backendu, bez API

**Pozycjonowanie**: konkurenci legal-tech (Kira, Luminance, Casetext) zamykaja wynik w swoim UI z licencja per-seat. Patron eksportuje wynik jako plik HTML, ktory klient kancelarii moze otworzyc bez konta i licencji - to argument sprzedazowy obok zgodnosci RODO i AI Act.

## Co bierzemy z isaacus viewer.html (cherry-pick)

1. **Architektura "single-file HTML + Vue 3 inline + CDN dla bibliotek"** - jeden plik, otwierasz w przegladarce, dziala.
2. **Drag-drop JSON jako primary input** (`./doc.json` fetch z cache-busting LUB `window.__INLINE_DOC__` LUB drag-drop file).
3. **Entity filtering UI** (osoby, lokalizacje, terminy, daty, external documents) - filtry z licznikami w sidebar.
4. **Hover popup z metadata** entitysu - cytaty z segmentow z highlightem.
5. **Span highlighting z color-coding per entity type** - osoby (niebieski), organizacje (zielony), sygnatury (fioletowy), kwoty (zolty).
6. **Resizable panes** (vertical split list/details, horizontal sidebar resize) - profesjonalny UX.
7. **Cross-reference links** (xref-style dotted underline) - klikalne odniesienia miedzy segmentami.

## Czego NIE bierzemy

1. **Wewnetrzny format wejsciowy isaacus** (skrot "ILGS" uzywany w README isaacus bez rozwiniecia w publicznej dokumentacji) - viewer Patrona przyjmuje **nasz JSON** (zgodny z modelem danych ADR-0010 + ADR-0011) zamiast formatu isaacus. Mapowanie pol:
   - isaacus `tokens[].type` -> nasze `entities[].type` z taxonomia polska (`PERSON`, `ORG`, `SYGNATURA_AKT`, `ART_USTAWY`, `NIP`, `PESEL`, `KRS`, `DZ_U_REF`, `CELEX`)
   - isaacus `segments[].id` z `parent_id` (hierarchia) -> nasze `documents[].segments[]` z Docling (akapity, punkty numerowane, sekcje wynikajace ze struktury dokumentu)
2. **Tailwind CDN bez fallback** - viewer Patrona MUSI dzialac **offline** (kancelaria w sadzie bez WiFi). Wbudowane CSS Tailwind subset (inline) jako fallback.
3. **External JSZip/Mammoth** - niepotrzebne dla Patron use-case (my nie konwertujemy DOCX w viewerze, robi to Patron backend).
4. **Brak audit bundle integration w isaacus viewer** - Patron viewer pokazuje link "Pobierz dziennik audytowy (zgodnosc AI Act)" w stopce (copy user-facing bez numerow ADR i bez cytatu artykulu); pod spodem implementacja generuje audit bundle z ADR-0006 razem z viewer.html podczas eksportu.

## Refactor pod architekture Patrona

| Element isaacus viewer.html | Refactor Patrona viewer.html |
|---|---|
| Single HTML 8-10k LOC Vue 3 | Single HTML ~6-8k LOC (mniej feature, krotszy, brand Patron) |
| Tailwind CDN | Tailwind subset inline (50 KB CSS) + CDN jako progressive enhancement |
| Lucide CDN | Lucide subset inline (20 KB SVG icons) + CDN jako progressive enhancement |
| Drag-drop `doc.json` | Drag-drop `patron-export-{project-id}.json` + walidacja schema |
| `window.__INLINE_DOC__` | Identycznie - dla `viewer.html` pre-wstrzyknieta z JSON podczas eksportu |
| ILGS entity types | Patron entity types (PERSON, ORG, SYGNATURA_AKT, ART_USTAWY, NIP, PESEL, KRS, DZ_U_REF, CELEX) z polskimi etykietami |
| Brak audit bundle link | Footer link "Pobierz dziennik audytowy (zgodnosc AI Act)" - copy user-facing bez numerow wewnetrznych ADR; pod spodem implementacja generuje audit bundle z ADR-0006 |
| Brak grid contract review | **NOWY KOMPONENT** - `<ContractReviewGrid>` z kolorami komorek (ADR-0011), per-cell citation popover, threshold slider |
| Brak hash-chain weryfikacji | Footer pokazuje hash glowny eksportu z ADR-0001 do recznej weryfikacji integralnosci |

## Plan migracji (uzupelnia plan ADR-0010 T6 Export)

- **T6.1 (3 dni) Foundation viewer skeleton**: HTML + Vue 3 mount + drag-drop input + walidacja JSON schema Patron export. Smoke test: otwiera sie w Chrome/Edge/Firefox + Brave + Safari.
- **T6.2 (3 dni) Grid komponent**: rendering grid z kolorami komorek (ADR-0011), popover na komorke z cytatem zrodlowym.
- **T6.3 (2 dni) Entity sidebar**: filtrowanie + lista entitiesow z licznikami, color coding per typ (polskie etykiety).
- **T6.4 (2 dni) Cytat highlight w tekscie segmentu**: gdy klient klika komorke -> popup z fragmentem segmentu zrodlowego + highlight span (start_char, end_char).
- **T6.5 (1 dzien) Audit bundle integration**: footer link, hash-chain glowny w widoku, walidacja integralnosci checkbox.
- **T6.6 (1 dzien) Brand Patron**: logo matematicsolutions, dark/light mode, polska lokalizacja (i18n pl-PL).
- **T6.7 (1 dzien) Build + minifikacja**: Vite SSG `viewer.html` z inline assets, target <500 KB single file, test na 100-komorkowym przykladzie performance.

Razem **~13 dni dev** dodanych do ADR-0010 T6 Export (oryginalnie 1 tydz).

Bramki:
- Po T6.2 - klient otwiera viewer.html w Chrome i widzi grid 20 umow z kolorami.
- Po T6.4 - klient klika komorke i widzi cytat z highlightem.
- Po T6.7 - viewer.html zarchiwizowany na S3 kancelarii otwiera sie poprawnie po 30 dniach (test stabilnosci CDN fallback).

## Konsekwencje

**Pozytywne:**

- Eksport bez vendor lock-in - klient otrzymuje plik HTML, ktory dziala bez konta w Patronie i bez licencji per-seat (rozni nas od Kira/Luminance/Casetext).
- Demo na konferencji KIRP/NRA - artefakt dziala w przegladarce zlokalu bez VPN do serwera kancelarii.
- Archiwizacja dlugoterminowa - HTML jest backward compatible, klient kancelarii moze otworzyc plik po latach niezaleznie od cyklu zycia Patrona.
- Klient zewnetrzny dostaje interaktywny artefakt - kupujacy w M&A, IOD korporacyjny, partner kupujacy raport - bez koniecznosci dostepu do systemu kancelarii.
- Brak infrastruktury po stronie klienta - nie wymaga konta, serwera ani klucza API; cala interakcja client-side.

**Negatywne / koszty:**

- ~13 dni dev dodanych do T6 Export (z 5 do 18 dni razem T6).
- Wieksza powierzchnia testowa - 5 przegladarek + Brave + offline mode + duze datasets (500+ umow + 50+ kolumn).
- `viewer.html` pliki size 300-500 KB - dla 47 umow + 12 kolumn = ~1-2 MB total z embedded JSON. Akceptowalne dla email, S3, archiwum.
- Brand viewer.html jest publiczny - klient widzi nasz HTML/CSS, moze inspect-elementem czytac kod (nic poufnego, ale konkurencja zobaczy implementacje).

**Ryzyka:**

- **Performance na 1000+ komorek** - Vue 3 reactivity moze wolnic. Mitigacja: virtual scrolling w grid (TanStack Virtual), lazy rendering popupow.
- **JavaScript wylaczony w przegladarce klienta** - rzadkie ale mozliwe (CISO kancelarii corporate). Mitigacja: `<noscript>` fallback ze statyczna tabela HTML (bez interaktywnosci, ale czytelna).
- **Embedding wrazliwych danych w HTML** - viewer.html zawiera caly JSON w `__INLINE_DOC__`. Jesli klient wysle plik na nieautoryzowany serwer, dane wyciekaja. **Mitigacja: footer ostrzezenie "Ten plik zawiera dane wrazliwe - nie udostepniac publicznie. Przechowuj jak akta klienta."** + opcjonalny `report.pdf` rendered bez interaktywnych danych dla publicznego sharowania.
- **CDN failure** (Tailwind/Lucide unreachable) - viewer dziala wciaz dzieki inline fallback (50 KB Tailwind subset + 20 KB Lucide subset). Progressive enhancement scheme.

## Atrybucja

Pattern self-contained single-file HTML viewer z Vue 3 + Tailwind/Lucide CDN +
drag-drop JSON input + entity filtering + span highlighting + resizable panes:
cherry-pick z [isaacus-dev/cookbooks/tabular-review/viewer.html](https://github.com/isaacus-dev/cookbooks/blob/main/cookbooks/tabular-review/viewer.html)
(MIT, autor Isaacus, snapshot 2026-04-22).

Implementacja viewer Patrona (polskie entity types, Tailwind/Lucide inline
fallback offline, integracja z audit bundle ADR-0006, grid contract review
ADR-0010/0011, brand matematicsolutions, hash-chain weryfikacja integralnosci
w stopce, i18n pl-PL) - **napisane od zera** pod architekture Patrona i
wymagania kancelarii polskich. NIE jest to fork ani tlumaczenie HTML.

Wpis do `THIRD_PARTY_INSPIRATIONS.md` przy commicie tego ADR - sekcja "isaacus-dev/cookbooks (MIT)".

## Decyzja oczekiwana od Wieslawa

1. **Czy viewer.html jest pierwszorzedowym deliverable kazdego eksportu Contract Review** (default ON) czy opcjonalnym checkboxem w UI eksportu (default OFF, prawnik wlacza)?
2. **Czy embedduje JSON inline** (`window.__INLINE_DOC__`) - sam plik HTML zawiera dane, czy **dwa pliki** (`viewer.html` + `data.json` w jednym ZIP) dla mniejszego pliku HTML i mozliwosci podmiany danych bez regenerowania viewer?
3. **Czy footer ma link "Powered by Patron / matematicsolutions"** (sprzedazowo TAK) czy white-label (kancelaria moze podstawic swoje logo)?
4. **Kiedy w roadmapie**: razem z T6 ADR-0010 (od poczatku jako 4. format eksportu) czy jako Faza 8 dla dopracowania UX po pilocie ADR-0010?
5. **wewnetrzny review 2x runda** ZAREZERWOWANE PRZED commitem.
