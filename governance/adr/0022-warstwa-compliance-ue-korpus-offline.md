# ADR-0022: Warstwa compliance UE - offline korpus EUR-Lex (verbatim FTS5) + narzedzia compliance (wzorzec z EU_compliance_MCP)

> **Uwaga numeracja**: ostatni zajety ADR to 0021 (time-travel diff nowelizacji). Przed bumpem sprawdzono `ls governance/adr/` 2026-05-22 - 0022 wolne, brak rownoleglej rezerwacji, zgodnie z regula sesji rownoleglych. Jezeli rownolegla sesja zajmie 0022, przenumerowac na pierwszy wolny.

**Status**: ZAIMPLEMENTOWANY v0.1.0 (2026-05-22) - osobny konektor `mcp-eu-compliance` (repo ~/mcp-eu-compliance, MIT), 5 toolow, smoke test PASS. NIE wpiety w `mcp-servers.json` ani w kontrakt rozmowy (Art. 8 - to osobna decyzja/przyszly ADR). 2x runda wewnetrznego review tresci na ADR zaliczona (ok). Cztery pytania rozstrzygniete - patrz "Rozstrzygniecia". Bramka licencji ZWALIDOWANA 2026-05-22.
**Data**: 2026-05-22

**Powiazane zasady** (Konstytucja Patrona, zweryfikowane grepem wzgledem `governance/CONSTITUTION.md` - weryfikacja grepem Konstytucji przed cytatem):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - korpus to offline SQLite na infrastrukturze kancelarii. Zero wywolan sieciowych w runtime, zero zaleznosci od hostowanego gateway dostawcy. To wzmacnia lokalnosc wzgledem konektora eu-sparql (ktory odpytuje Cellar na zywo).
- **Art. 2 - Weryfikowalnosc zrodel** - GLOWNA zasada tego ADR. Snippety FTS5 sa **verbatim** z bazy (zero LLM w sciezce retrievalu), kazdy z identyfikatorem CELEX + URL do EUR-Lex. Prawnik klika i otwiera oryginal. Konstytucja wprost wymienia EUR-Lex jako konektor objety ta zasada.
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - wywolanie narzedzia compliance (compare/applicability/evidence) trafia do hash-chain audit logu (ADR-0001) jako zdarzenie typu `eu_compliance_query`; zasila audit bundle (ADR-0006).
- **Art. 4 - Neutralnosc wobec dostawcow** - retrieval deterministyczny (FTS5 BM25), agnostyczny wobec LLM. Konektor jak kazdy inny: osobny proces, wymienialny/wylaczalny (Konstytucja Art. 4 wprost wymienia EUR-Lex).
- **Art. 7 - Minimalnosc danych** (RODO art. 5 ust. 1 lit. c) - korpus to publiczne prawo UE, ZERO danych klienta. Snippety 64-token zamiast ladowania calego aktu (niektore art. = 70k tok).
- **Art. 8 - Stalosc kontraktow** - ten ADR celowo NIE wpina narzedzi w `streamChatWithTools` ani UI. Skeleton: konektor + korpus + narzedzia MCP. Wpiecie w kontrakt rozmowy to osobna decyzja (przyszly ADR), zgodnie z granica skeleton vs produkcja.
- **Art. 9 - Dostepnosc wiedzy** - "ktora regulacja UE dotyczy sektora X", "porownaj obowiazki incydentowe DORA vs NIS2" to pytania dzis wymagajace recznego zestawiania PDF-ow z EUR-Lex. Warstwa compliance je udostepnia.

**Powiazane ADR**:
- **Konektor eu-sparql (istniejacy, `backend/mcp-bundled/eu-sparql`)** - KOMPLEMENTARNY, nie zastepowany. eu-sparql = live discovery prawa UE/CJEU przez SPARQL Cellar (CELEX, metadane, swieze akty). Ten ADR = offline korpus pelnotekstowy + narzedzia compliance (applicability/compare/evidence). Podzial: eu-sparql znajduje akt, korpus offline daje verbatim tekst + analize compliance bez zaleznosci sieciowej.
- ADR-0005 (citation-grounding mechaniczny) - **wspolna filozofia**: snippet verbatim z bazy to fakt ze zrodla, nie streszczenie modelu. Grounding cytatow UE wprost.
- ADR-0021 (time-travel diff nowelizacji) - **siostrzany wzorzec**: tam ISAP (prawo PL) w czasie, tu EUR-Lex (prawo UE) w przekroju compliance. Oba: mechaniczna weryfikacja zamiast zaufania modelowi.
- ADR-0007 (hybrid retrieval vec+bm25+graph) - korpus UE moze docelowo zasilic warstwe retrievalu, ale v1 to czysty FTS5 BM25 (bez wektorow) - prostszy, deterministyczny.
- ADR-0008 (entity extraction zero-LLM) - **respektowane**: ingest i retrieval bez modelu w sciezce.
- ADR-0001 / ADR-0006 - zdarzenie i artefakt zgodnosci.

**Inspiracja cherry-pick**: [Ansvar-Systems/EU_compliance_MCP](https://github.com/Ansvar-Systems/EU_compliance_MCP) (`Apache-2.0`, snapshot **2026-05-22**, 16 gwiazdek, TypeScript). **NIE forkujemy.** Bierzemy WZORZEC architektoniczny (offline korpus EUR-Lex -> SQLite FTS5 -> snippet verbatim -> MCP) oraz KONCEPTY narzedzi compliance (`compare`, `check_applicability`, `evidence`). Schematy danych (applicability/guide/evidence) jako szablon JSON. Implementacja od zera na stacku Patrona. Atrybucja w 3 miejscach (THIRD_PARTY_INSPIRATIONS.md + ten ADR + CHANGELOG przy commicie), zgodnie z kanon cherry-pick MateMatic. Pelny blueprint: blueprint eu-compliance MCP z 2026-05-22.

---

## Decyzja

Patron dostaje **warstwe compliance UE**: offline, pelnotekstowy korpus regulacji UE (EUR-Lex) w SQLite FTS5, z narzedziami MCP zorientowanymi na compliance, komplementarny do istniejacego konektora `eu-sparql` (live SPARQL).

### Co bierzemy (wzorzec/koncept, nie kod)
1. **Architektura "offline korpus verbatim"**: `EUR-Lex HTML -> parse -> SQLite -> FTS5 snippet() -> odpowiedz MCP`. Snippet zwracany BEZ przetwarzania LLM. Identyczna filozofia anti-halucynacji co ADR-0005.
2. **Koncepty trzech narzedzi compliance**:
   - `eu_compare` - porownanie obowiazkow miedzy regulacjami (np. zgloszenie incydentu DORA vs NIS2 vs CRA).
   - `eu_check_applicability` - "ktore regulacje UE dotycza [sektor/podsektor]" na bazie regul applicability.
   - `eu_evidence` - artefakty dowodowe / audit hints per regulacja (zasila audit bundle ADR-0006).
3. **Schematy danych jako szablon** (Apache-2.0, do adaptacji): `applicability {regulation, sector, subsector, applies, confidence, basis_article, notes}`; `guide {celex_id, effective_date, proportionality, pitfalls, cross_regulation, key_structures, evidence_hint, ...}`.

### Co budujemy od zera / decyzja o korpusie (Pytanie otwarte 1)
Dwie sciezki pozyskania korpusu - decyzja Wieslawa:
- **Sciezka A (szybka):** adoptujemy gotowa `regulations.db` Ansvar (Apache-2.0, 36 MB, 61 regulacji) jako warstwe danych, wycinajac CTA/branding gateway. Atrybucja Ansvar + EUR-Lex. Ryzyko: zaleznosc od ich modelu danych i swiezosci.
- **Sciezka B (czysta):** wlasny ingest z EUR-Lex/Cellar przez istniejacy eu-sparql + pobranie tekstu, do wlasnego schematu FTS5. Wiecej pracy, pelna kontrola, spojnosc z reszta stacku.

(Rozstrzygniecie 2026-05-22: A teraz, B docelowo - patrz sekcja "Rozstrzygniecia".)

### Co odrzucamy (z EU_compliance_MCP)
- **Hostowany Ansvar Gateway** + wstrzykniety CTA w README - sprzeczne z Art. 1 (lokalnosc) i Art. 4 (neutralnosc). Bierzemy tylko Apache-2.0 kod/dane, zero zaleznosci od ich infrastruktury.
- **Mapowania ISO 27001 / NIST CSF** w v1 - przydatne, ale to osobny segment (security compliance), nie core prawa UE. Jezeli zajdzie potrzeba - osobny ADR. Uwaga: tekst normy ISO jest chroniony; wolno trzymac tylko numery kontroli <-> artykul (praca pochodna), nie tresc normy.
- **`freshness` jako codzienny cron** - swiezosc realizuje eu-sparql (live); offline korpus republikujemy przy aktualizacji, nie pollingiem.

### Rola w architekturze
Warstwa compliance to **rozszerzenie warstwy prawa UE** obok eu-sparql (podzial obowiazkow opisany w sekcji "Powiazane ADR"). Wynik narzedzi loguje sie do hash-chain (ADR-0001) i zasila audit bundle (ADR-0006).

---

## Kontekst

Konstytucja Patrona wprost wymienia EUR-Lex jako jeden z konektorow MCP (Art. 2, 4, 7). Dzis realizuje go `eu-sparql` - dobry do odkrywania aktow (CELEX, metadane, CJEU), ale: (a) wymaga sieci w runtime, (b) nie daje gotowej analizy compliance ("ktora regulacja dotyczy mojego sektora", "porownaj obowiazki X vs Y"), (c) pelny tekst aktu trzeba pobierac i obrabiac osobno.

Praca kancelarii nad RODO/AI Act/DORA/NIS2 to codzienne pytania o stosowalnosc i porownanie obowiazkow miedzy regulacjami. Model jezykowy "z pamieci" jest tu zawodny (halucynacja brzmienia artykulu, mylenie terminow zgloszen). Ansvar (EU_compliance_MCP) pokazal wzorzec produktowy: offline korpus verbatim + narzedzia compliance. Wzorzec dobry, implementacja - wlasna, na stacku Patrona, spojna z ADR-0005/0021.

---

## Ryzyka i bramki

- **BRAMKA make-or-break: licencja korpusu UE - ZWALIDOWANA 2026-05-22.** Ustalenia:
  - Tresc legislacji UE: reuzywalna **komercyjnie** z podaniem zrodla (Decyzja Komisji 2011/833/EU; legal notice EUR-Lex). Editorial/consolidated = CC BY 4.0 (atrybucja + indicate changes). Metadane = CC0.
  - Wyjatki (logo EUR-Lex, International Accounting Standards, monety euro) NIE dotycza tekstu 61 regulacji.
  - Tylko Dziennik Urzedowy UE = wersja autentyczna -> kazda odpowiedz z disclaimer "snapshot, nie zrodlo autentyczne" (spojne z ADR-0005 markerami pewnosci).
  - Kod Ansvar = Apache-2.0; `regulations.db` jest w repo (sciezka A wykonalna). Mapowania ISO/NIST = praca pochodna Ansvar, ale NIE redystrybuowac tekstu normy ISO.
  - **Wniosek: korpus uzywalny, obie sciezki (A/B) legalne** przy atrybucji EUR-Lex (+ Ansvar dla sciezki A).
- **Ryzyko swiezosci** - offline korpus to snapshot. Mitygacja: data republikacji w metadanych + delegacja "czy akt obowiazuje / najnowsza wersja" do eu-sparql (live). Marker `[snapshot z DD.MM.RRRR - sprawdz aktualnosc w EUR-Lex]`.
- **Ryzyko zakresu danych** - applicability/guide to oceny eksperckie Ansvar (pole `confidence`). NIE traktowac jako pewnik prawny; oznaczac jako wskazowke (Art. 6 human-in-the-loop). Polskie realia (PKD, sektory) moga wymagac wlasnej warstwy applicability.
- **Ryzyko rozdzielczosci jezykowej** - korpus EN; polska kancelaria moze chciec PL. EUR-Lex ma 24 jezyki - wybor jezyka korpusu to parametr ingestu (Pytanie otwarte 3).

---

## Rozstrzygniecia (decyzja Wieslawa 2026-05-22)

1. **Korpus: A teraz, B docelowo.** v1 adoptuje gotowa `regulations.db` Ansvar (Apache-2.0, licencja zwalidowana) jako proof-of-value, wycinajac gateway/CTA. Wlasny ingest (sciezka B) dopiero gdy A sprawdzi sie w realnej rozmowie z kancelaria. Uzasadnienie: zero ryzyka licencyjnego, natychmiastowa wartosc, decyzja o B z danymi a nie w ciemno.
2. **Zakres v1: podzbior 6 regulacji** - RODO, AI Act, DORA, NIS2, eIDAS 2.0, CRA. Reszta z korpusu dociagana na zadanie. Uzasadnienie: pokrywa ICP MateMatic (AI governance + LegalTech); 61 regulacji rozmywa pozycjonowanie i wydluza kontrole jakosci.
3. **Jezyk: EN w v1, PL jako parametr ingestu w v2.** Korpus Ansvar jest EN; polska kancelaria czyta regulacje UE po angielsku, tekst autentyczny i tak wielojezyczny. PL = dodatkowy ingest z EUR-Lex, nie blocker dla v1.
4. **Osobny konektor `mcp-eu-compliance`** (nie rozszerzenie eu-sparql). Uzasadnienie: inne zrodlo (offline SQLite vs SPARQL live), Art. 4 wymaga osobnych wymienialnych procesow, separacja trzyma eu-sparql czystym (discovery) a nowa warstwe czysta (compliance offline).

Wniosek spojny: szybki start na gotowym korpusie, waski zakres pod ICP, EN najpierw, czysta separacja architektoniczna - minimalizuje koszt do pierwszej wartosci bez zamykania drog rozwoju.

---

## Konsekwencje

**Pozytywne**: verbatim grounding prawa UE (Art. 2), offline (Art. 1), gotowa analiza stosowalnosci i porownania obowiazkow bez recznego zestawiania PDF-ow, spojnosc z ADR-0005/0021.

**Negatywne / koszt**: utrzymanie snapshotu korpusu, ryzyko rozjazdu z aktualnym stanem prawa (mitygowane delegacja do eu-sparql), praca ingestu (sciezka B).

**Neutralne**: kolejny konektor MCP w bundlu - bez zmiany kontraktu rozmowy w v1 (Art. 8).
