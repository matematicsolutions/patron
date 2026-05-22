# ADR-0021: Time-travel nowelizacji - deterministyczny diff przepisu w czasie (wzorzec z korean-law-mcp)

> **Uwaga numeracja**: ostatni zajety ADR to 0020 (wpiecie input-security w ingest). Przed bumpem sprawdzono `ls governance/adr/` - brak rownoleglej rezerwacji, zgodnie z [[feedback_sesje_rownolegle_semver]]. Jezeli rownolegla sesja zajmie 0021, przenumerowac na pierwszy wolny.

**Status**: Przyjety (2026-05-22 - decyzja architektoniczna; NIE zakodowany - implementacja jako narzedzie w `mcp-isap`). Marko 2x przeszedl (r1 slabe -> 6 poprawek, r2 przecietne -> 1 poprawka, [[feedback_marko_2x_runda_pattern]]). 4 rozstrzygniecia zakresowe podjete na delegacje Wieslawa (sekcja "Rozstrzygniecia"). Bramka walidacyjna (historia wersji w ELI) ZWALIDOWANA 2026-05-22 - patrz sekcja Ryzyka i bramki.
**Data**: 2026-05-22

**Powiazane zasady** (Konstytucja Patrona, zweryfikowane grepem wzgledem `governance/CONSTITUTION.md` - [[feedback_grep_constitution_pre_cite]]):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - diff liczony LOKALNIE na dwoch tekstach pobranych z ELI; zero wysylki tresci do chmury. Operacja deterministyczna, bez modelu w sciezce.
- **Art. 2 - Weryfikowalnosc zrodel** - to jest GLOWNA zasada tego ADR. Diff cytuje DWIE konkretne wersje aktu po identyfikatorze ELI (publisher/year/position + data obowiazywania) oraz akt nowelizujacy. Uzytkownik moze odtworzyc kazda zmiane do zrodla, nie wierzy modelowi "na slowo".
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - wynik diffu (dwa ELI + lista zmian) trafia do hash-chain audit logu (ADR-0001) jako zdarzenie typu `legal_version_diff`. Zasila audit bundle (ADR-0006).
- **Art. 4 - Neutralnosc wobec dostawcow** - diff jest deterministyczny (porownanie tekstu), agnostyczny wobec dostawcy LLM. Wzorzec korean-law-mcp realizuje to samo (anti-halucynacja przez mechaniczna weryfikacje, nie przez model).
- **Art. 8 - Stalosc kontraktow** - ten ADR celowo NIE wpina diffu w `streamChatWithTools` ani w UI. Skeleton: rozszerzenie konektora ISAP + warstwa diff. Wpiecie w kontrakt rozmowy to osobna decyzja (przyszly ADR), zgodnie z [[feedback_adr_granica_skeleton_vs_produkcja]].
- **Art. 9 - Dostepnosc wiedzy** - "jak zmienil sie art. X po nowelizacji" to pytanie, na ktore dzis odpowiedz wymaga recznego porownania tekstow jednolitych. Diff udostepnia te wiedze.

**Powiazane ADR**:
- ADR-0005 (citation-grounding mechaniczny) - **komplementarny**. Tamten weryfikuje, czy cytat istnieje w zrodle. Ten pokazuje, jak zrodlo zmienialo sie w czasie. Wspolna filozofia: mechaniczna weryfikacja zamiast zaufania do modelu.
- ADR-0007 (hybrid retrieval vec+bm25+graph) i ADR-0016 (multi-hop graph traversal) - patrz "Co odrzucamy": `impact_map` z korean-law-mcp NIE dostaje osobnego ADR, bo graf zaleznosci przepisow to rozszerzenie istniejacego grafu, nie nowy mechanizm.
- ADR-0008 (entity extraction zero-LLM) - **respektowane**: diff jest deterministyczny (porownanie tekstu), bez modelu w sciezce obliczenia.
- ADR-0001 (hash-chain audit) i ADR-0006 (audit bundle art. 12) - wynik diffu jako zdarzenie i artefakt zgodnosci.
- ADR-0014 (multi-provider) - diff jest pre-provider, niezalezny od dostawcy.

**Inspiracja cherry-pick**: [chrisryugj/korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp) (`MIT`, snapshot **2026-05-22**, 1806 gwiazdek, v4.0.4, TypeScript). **NIE forkujemy.** Bierzemy KONCEPT narzedzia `time_travel` (auto-diff przepisu miedzy dwiema datami). Kod od zera na polskim ELI (`api.sejm.gov.pl/eli`). Korea opakowuje panstwowe API koreanskie (wg opisu repo - 41 API legislacyjnych KR); my mamy wlasny konektor ISAP. Atrybucja w 3 miejscach (THIRD_PARTY_INSPIRATIONS.md + ten ADR + CHANGELOG przy commicie), zgodnie z [[feedback_format_cherry_pick_kanon]].

---

## Decyzja

Patron dostaje warstwe **Time-travel nowelizacji** - na zadanie "pokaz, jak zmienil sie [przepis]" pobiera z ELI dwie opublikowane wersje aktu (oryginal / tekst jednolity / ujednolicony), liczy deterministyczny diff i wskazuje akt nowelizujacy. Daty wejsciowe mapuja sie na najblizsze opublikowane wersje; tekst na dowolny punkt miedzy republikacjami to zakres v1b (patrz Ryzyka).

### Co bierzemy (koncept, nie kod)
1. **Model "dwa punkty w czasie -> diff"** - wejscie: identyfikator aktu/przepisu + dwie daty (lub dwie wersje). Wyjscie: roznica brzmienia + ktora nowelizacja ja wprowadzila.
2. **Filozofia anti-halucynacji przez mechanike** - diff jest faktem z dwoch zrodel, nie streszczeniem modelu. Ta sama zasada, ktora korean-law-mcp realizuje w swoich narzedziach: weryfikacja mechaniczna zamiast zaufania do modelu (u nas pokryta tez ADR-0005).

### Co budujemy od zera
Audyt wbudowanego konektora ISAP (`backend/mcp-bundled/isap`, 2026-05-22) pokazal, ze dzis wystawia: wyszukiwanie aktow (tytul/rok/typ/DU-MP, flaga `onlyInForce`), pobranie szczegolow po ELI, pobranie tekstu HTML. **Brak narzedzia "lista wersji/republikacji" i "diff".** Stad:

1. **Rozszerzenie konektora ISAP o liste wersji** - ELI Sejmu (`api.sejm.gov.pl/eli`) wystawia akty zmieniajace i info o republikacjach tekstu jednolitego (zwalidowane - patrz Ryzyka). Dobudowujemy narzedzie: lista opublikowanych wersji aktu (oryginal + teksty jednolite + ujednolicone) z datami. Tekstu na dowolny punkt MIEDZY republikacjami ELI nie renderuje - to zakres v1b (patrz Ryzyka).
2. **Deterministyczny diff tekstu jednolitego** - porownanie na poziomie jednostek redakcyjnych (artykul / ustep / punkt), nie surowych linii HTML. Normalizacja przed diffem (usuniecie znacznikow, ujednolicenie bialych znakow). Wynik: dodane / usuniete / zmienione jednostki.
3. **Mapowanie zmiany na akt nowelizujacy** - "art. X zmieniony przez DU/RRRR/PPP, wszedl w zycie DD.MM.RRRR". Kazda pozycja diffu z odnosnikiem ELI do nowelizacji.
4. **Markery pewnosci** - tam, gdzie ELI nie ma tekstu jednolitego na dana date, wynik oznaczony `[DO WERYFIKACJI: brak tekstu jednolitego w ELI na te date - prawnik potwierdza recznie]`, bez zgadywania (spojne z ADR-0005).

### Co odrzucamy (z korean-law-mcp)
- **`impact_map`** (graf wplywu przepisu) - NIE osobny ADR. Graf zaleznosci przepisow to rozszerzenie istniejacego grafu (ADR-0007/0016), nie nowy mechanizm. Jesli zajdzie potrzeba - osobny ADR z konkretnym uzasadnieniem (analogicznie do PLGS pominietego przy isaacus, [[project_patron_tabular_review_isaacus]]).
- **`citation-verification`** - juz pokryte mechanicznie przez ADR-0005, nie dublujemy.
- **`action_plan`** (5-stopniowy przewodnik obywatelski) - to segment access-to-justice ([[project_pomoc_prawna_pl_2026-05-22]]), nie kancelaryjny Patron.

### Rola w architekturze
Time-travel to **narzedzie konektora + warstwa diff** miedzy ELI a odpowiedzia. Wynik loguje sie do hash-chain (ADR-0001) jako `legal_version_diff` i zasila audit bundle (ADR-0006). Naturalne wpiecie record-keepingu pod AI Act art. 12.

---

## Kontekst

Pytanie "co dokladnie zmienila nowelizacja w art. X" jest codzienne w pracy kancelarii (sprawy w toku przy zmianie stanu prawnego, ocena ktora wersja przepisu obowiazywala w dacie czynu/czynnosci). Dzis odpowiedz wymaga recznego zestawienia dwoch tekstow jednolitych z ISAP - zmudne i podatne na blad. Model jezykowy "z pamieci" jest tu szczegolnie zawodny (halucynacja brzmienia historycznego).

ELI Sejmu rozwiazuje czesc problemu (metadane nowelizacji, teksty jednolite), ale wymaga obrobki: nasz konektor dzis nie wystawia ani historii wersji, ani diffu. Korea (korean-law-mcp) pokazala wzorzec produktowy - `time_travel` jako narzedzie MCP. Wzorzec dobry, implementacja - polska, od zera, na ELI.

---

## Ryzyka i bramki

- **BRAMKA make-or-break: ZWALIDOWANA 2026-05-22 (probe `api.sejm.gov.pl/eli`).** Ustalenie:
  - ELI **NIE** renderuje "tekstu na dowolny dzien X" jednym wywolaniem.
  - ELI **wystawia** dla utrzymywanych aktow (zweryfikowane na DU/2015/1255 ustawa o npp): pole `references."Akty zmieniajace"` (lista nowelizacji z ELI+datami), `references."Inf. o tekscie jednolitym"` (republikacje), oraz teksty w typach H/O/I/T/U (HTML / oryginal / ujednolicony / tekst jednolity).
  - Akt oryginalny (DU/1974/24 KP) ma `status: NOT_IN_FORCE` i tylko tekst oryginalny - bo teksty jednolite republikowane sa jako OSOBNE pozycje Dz.U.
  - **Wniosek:** time-travel wykonalny przez REKONSTRUKCJE, nie przez gotowy endpoint.
- **Zakres v1 podyktowany walidacja** (rekomendacja, do potwierdzenia w pytaniu otwartym 2):
  - **v1a (pewne, wprost ze zrodla):** diff miedzy dwiema OPUBLIKOWANYMI wersjami (oryginal / teksty jednolite / ujednolicone) + lista `Akty zmieniajace` miedzy dwiema datami. Oba pola wspierane przez ELI.
  - **v1b (trudniejsze, pozniej):** tekst na dowolny punkt MIEDZY republikacjami - wymaga aplikowania kolejnych nowelizacji; oznaczany `[DO WERYFIKACJI]` albo poza zakresem v1.
- Ten sam caveat dotyczy skilla `diff-przepisu-pl` ([[project_nowe_skille_legaltech_2026-05-22]]) - walidacja wspolna.
- **Stabilnosc API** `api.sejm.gov.pl/eli` - obsluga bledow/limitow, cache lokalny (Art. 1).
- **Jednostka diffu** - diff na poziomie redakcyjnym (art./ust./pkt) wymaga parsera struktury tekstu jednolitego; surowy diff HTML da szum.

## Rozstrzygniecia (delegacja Wieslawa, 2026-05-22)
1. **Zakres v1 = ustawy** (kryterium: typ aktu, nie publikator - ustawy i rozporzadzenia sa w tym samym Dz.U.). Rozporzadzenia i akty wykonawcze w v1.1 po walidacji. Uzasadnienie: najczestszy use-case kancelarii (KC/KP/KPC/KSH), najlepiej utrzymane teksty jednolite w ELI, maly zakres = szybka walidacja groundingu (grounding-first).
2. **Diff na poziomie jednostki redakcyjnej** (art./ust./pkt) - parser struktury tekstu jednolitego, z fallbackiem akapitowym + `[DO WERYFIKACJI]` gdy parser zawiedzie. Uzasadnienie: diff redakcyjny to przewaga (Art. 2 - wskazuje KONKRETNY artykul); diff akapitowy bylby szumem nieodroznialnym od grep.
3. **Narzedzie w konektorze `mcp-isap`** (osobne repo MIT, `C:/Users/Wieslaw/mcp-isap`), nie modul w powloce AGPL. Uzasadnienie: Art. 4 + architektura MCP; konektor MIT = reuzywalny publiczny asset open-source (lead-gen jak pozostale `mcp-*`), moze zyc poza Patronem (analogicznie korean-law-mcp jako npm). Spojne z ADR-0002.
4. **Osobny samodzielny strumien, priorytet sredni** ("quick win" po pilocie). Uzasadnienie: nie blokuje i nie jest blokowany przez otwarte ADR (input-security/tabular); niski blast radius; wysoka wartosc content/demo (BW + LinkedIn temat "diff nowelizacji"), ale niekrytyczny dla pilota kancelarii.

## Zadania (po decyzjach)
- T1: rozszerzenie `mcp-isap` o narzedzie `lista_wersji_aktu` (oryginal + teksty jednolite/ujednolicone + daty z `references`).
- T2: parser struktury tekstu jednolitego (art./ust./pkt) + deterministyczny diff redakcyjny z fallbackiem akapitowym.
- T3: mapowanie pozycji diffu na akt nowelizujacy (ELI + data wejscia w zycie).
- T4: zdarzenie audit `legal_version_diff` do hash-chain (ADR-0001) + zasilenie audit bundle (ADR-0006).
- T5: smoke na realnym akcie (ustawa o npp DU/2015/1255, KP) PRZED deklaracja gotowosci.

## Atrybucja
Koncept `time_travel` zaobserwowany w chrisryugj/korean-law-mcp (MIT, snapshot 2026-05-22). Wlasna implementacja na polskim ELI, kod i tresc od zera. Wpis w THIRD_PARTY_INSPIRATIONS.md. Rejestr ocen: [[reference_narzedzia_oceny_2026-05-14]] #61.
