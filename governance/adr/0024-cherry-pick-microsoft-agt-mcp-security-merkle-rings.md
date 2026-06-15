# ADR-0024: Cherry-pick wzorcow z microsoft/agent-governance-toolkit - MCP Security Gateway, Merkle audit chain, privilege rings

> **Uwaga numeracja**: ostatni zajety ADR to 0023 (wpiecie mcp-eu-compliance). Sprawdzono `Get-ChildItem governance/adr/` 2026-05-24 - 0024 wolne. Jezeli rownolegla sesja zajmie 0024, przenumerowac (regula sesji rownoleglych).

**Status**: PROPONOWANY (ADR-research). Nie zaimplementowany - definiuje trzy patterny do adopcji w odrebnych PR-ach/ADR-ach implementacyjnych. Cherry-pick **patternow** ze wzoru, NIE wpiecie zaleznosci Microsoft AGT do Patrona (regula pattern-zrodlo vs domena wykonania).

**Data**: 2026-05-24

**Powiazane zasady** (Konstytucja Patrona v1.2.0, zweryfikowane grepem - weryfikacja grepem Konstytucji przed cytatem):
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - GLOWNA zasada tego ADR. Microsoft AGT pokazuje, ze SHA256 per artefakt (nasz obecny standard, ADR-0001) ma upgrade-path do Merkle-chain. Pattern tamper-evident silniejszy niz hash-per-plik, bo modyfikacja jednego eventu lamie chain calej historii, nie tylko jednego rekordu.
- **Art. 8 - Stalosc kontraktow** - MCP Security Gateway dotyczy WALIDACJI definicji narzedzi (tool poisoning, description drift, typosquatting, hidden instructions) PRZED ich zaladowaniem do kontraktu. Wzmacnia stalosc kontraktow nie zmieniajac ich.
- **Art. 4 - Neutralnosc wobec dostawcow** - Microsoft AGT to wzor, nie dostawca. Cherry-pickujemy patterny, NIE wpinamy AGT jako zaleznosci. Patron pozostaje vendor-neutral.
- **Art. 2 - Weryfikowalnosc zrodel** - Decision BOM (Microsoft AGT) jako pattern: kazda decyzja AI rekonstruowalna ze sladu observability. To rozszerzenie istniejacego citation contract Patrona o pelny lancuch decyzji, nie tylko cytatu.

**Powiazane ADR**:
- **ADR-0001** (hash-chain audit) - bezposredni rodzic. Nasz hash-chain jest fundamentem, ten ADR proponuje uzupelnienie o Merkle-chain w osobnej tabeli weryfikacji.
- **ADR-0019/0020** (input-document-security pipeline) - rownoleglosc z MCP Security Gateway. Jeden chroni dokumenty wchodzace, drugi chronilby definicje narzedzi.
- **ADR-0022/0023** (mcp-eu-compliance) - dotyczy naszych 6 konektorow MCP. MCP Security Gateway scanuje je przed zaladowaniem.

---

## Decyzja

Patron adoptuje **trzy patterny** ze wzoru [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, Microsoft Corp., 2026-03-02, 1904 star, 992 testow conformance, OWASP Agentic Top 10 10/10). Wzor zostal sklasyfikowany jako TRAFIONE warunkowo - patrz rejestr ocen narzedzi MateMatic, pozycja #67.

**Pattern 1 - MCP Security Gateway** (skanowanie definicji narzedzi MCP):
- Detekcja **tool poisoning** (zmodyfikowane opisy narzedzi proszace o dodatkowe uprawnienia).
- Detekcja **description drift** (porownanie hash opisu z poprzednim ladowaniem).
- Detekcja **typosquatting** (nazwa narzedzia myli sie z popularnym - `slcak_search` vs `slack_search`).
- Detekcja **hidden instructions** (instrukcje w opisie narzedzia kierowane do LLM, niewidoczne dla operatora).
- Domena implementacji: `backend/src/lib/mcp-security/` (analogicznie do `input-security/`).
- Wejscie: definicje 6 konektorow MCP Patrona z `mcp-servers.json` przy starcie kontenera.
- Wyjscie: raport `mcp-security-report.json` + decyzja allow/deny per konektor; deny blokuje start backendu.

**Pattern 2 - Merkle audit chain** (uzupelnienie istniejacego hash-chain ADR-0001):
- Nasz aktualny audit (ADR-0001): kazdy event ma `prev_hash` -> linked list hash-chain. To dziala dla integralnosci lancuchowej, ale weryfikacja n-tego eventu wymaga przejscia calego lancucha.
- Upgrade: dorzucic **Merkle tree** nad blokami eventow (np. blok = 1024 eventy). Root Merkle zapisywany w osobnej tabeli `audit_merkle_roots` co N eventow. Pozwala na proof-of-inclusion w O(log n) zamiast O(n).
- Wartosc dla audyta AI Act art. 12: audytor moze zweryfikowac integralnosc dowolnego eventu bez czytania calego loga (rok dzialania kancelarii = setki tysiecy eventow). Hash-chain zostaje (wymagany dla detekcji modyfikacji), Merkle dodany dla efektywnej weryfikacji.
- Domena: nowa migracja Postgres + skrypt verifier.

**Pattern 3 - Privilege rings dla wywolan narzedzi MCP**:
- Microsoft AGT definiuje 4 ringi (kernel/supervisor/user/untrusted) z hardware-style isolation.
- Adaptacja Patrona: **3 ringi** (nie 4, kancelaria nie potrzebuje "kernel"):
  - **Ring 0 - System**: tylko skrypty wewnetrzne Patrona (audit, healthcheck). LLM nigdy nie wywoluje.
  - **Ring 1 - Trusted MCP**: 6 konektorow Patrona (polskie prawo + EU compliance). Wywolania allowed by default, audytowane.
  - **Ring 2 - Untrusted**: jakikolwiek narzedzie nie z naszej listy 6 (np. uzytkownik doda 3rd-party MCP). Default deny, wymaga explicit allow przez Operatora kancelarii.
- Domena: `backend/src/lib/mcp/ring-policy.ts` - decyzja allow/deny PRZED `tool-dispatch.ts`.
- Fail-closed: jezeli ring policy nie wie do ktorego ringa narzedzie nalezy, domyslnie Ring 2 (deny).

### Co robimy w tym ADR
- Akceptujemy trzy patterny jako kierunek rozwoju Patrona w nastepnych dwoch sprintach.
- NIE implementujemy w tym ADR - kazdy pattern dostaje osobny ADR implementacyjny (planowane: ADR-0025 MCP Security Gateway, ADR-0026 Merkle upgrade, ADR-0027 Privilege rings).

### Czego NIE robimy (granica)
- **NIE wpinamy `agent-governance-toolkit` jako zaleznosci npm/pip**. Wzor jest "Public Preview - may have breaking changes before GA"; Patron nie bierze breaking changes z trzeciej strony do core. Cherry-pickujemy **patterny** (pisane od zera w naszym kodzie), nie kod.
- **NIE adoptujemy `agent-governance-claude-code`** (plugin Claude Code z `.mcp.json`/hooks/server) bez audytu RODO przez skill `legal-ai-plugin-governance`. Plugin moze wysylac telemetrie do Microsoft - to byloby naruszenie Art. 1 (lokalnosc). Audyt do wykonania PRZED ewentualnym dopuszczeniem.
- **NIE adoptujemy Zero-Trust Identity (Ed25519 + ML-DSA-65)** Microsoft AGT. Patron jest **single-tenant per kancelaria**, agent-to-agent trust scoring nie ma uzasadnienia ekonomicznego dla naszej skali.
- **NIE adoptujemy Shadow AI Discovery** w Patronie. To pattern dla skilla `matematic-konstytucja-ai` (audyt klienta "ile macie nieautoryzowanych agentow AI"), nie dla samego produktu Patron.

---

## Kontekst

### Co rozpoznano we wzorze

Microsoft Corp. opublikowal 2026-03-02 toolkit, ktory pokrywa **dokladnie** te same wymiary co Patron: deterministic policy engine, audit log, sandboxing, agent lifecycle, OWASP Agentic Top 10, EU AI Act mapping. Skala: 1904 star w 2.5 mc, 352 forki, 992 testow, OpenSSF Scorecard, 25 ADR z RFC 2119 specs.

To strategicznie wazne dla MateMatic:
1. **Uzasadnienie ceny produktu** - jezeli Microsoft uznal, ze warto zbudowac osobny toolkit governance, kancelarie nie kwestionuja ze Patron + Konstytucja AI to fundamentalna potrzeba, nie fanaberia.
2. **Benchmarking** - 992 testow conformance Microsoft AGT vs nasze 389/394 (po wdrozeniu mcp-security ADR-0025) to roznica skali, ale architektonicznie idziemy w te sama strone. Walidacja kierunku.
3. **Cherry-pick wzorca pomysl** - trzy pomysly wyzej sa konkretne i podnosza nasza dojrzalosc bez zerwania kontraktow.

### Dlaczego nie pelne wpiecie

- **Public Preview** - breaking changes przed GA. Patron jest produktem regulowanym, kancelaria musi miec stabilna baze.
- **Python-first** - rdzen AGT to Python; nasz backend to Node/TypeScript. TS SDK istnieje, ale jest cienki.
- **Vendor gravity** - mimo MIT, dependency na MS to orbita (Azure auth opcjonalne, Semantic Kernel native). Patron pozycjonuje sie vendor-neutral (Art. 4 Konstytucji).
- **Ekonomika** - pelna adopcja = utrzymanie zaleznosci 250+ tys. LoC, ktora rozwija sie poza naszym wplywem. Cherry-pick patternow = ~1-2 tys. LoC pisanych od zera, ktorymi sterujemy.

---

## Alternatywy rozwazane

**A. Pelne wpiecie agent-governance-toolkit jako zaleznosci**
- Odrzucone z 4 powodow wyzej (Public Preview, Python, vendor gravity, ekonomika).

**B. Cherry-pick wszystkich 9 modulow** (policy engine, identity, hypervisor, SRE, audit, MCP gateway, lightning, framework adapters, wire protocol)
- Odrzucone - przeskalowane. Patron nie jest platforma agentowa dla 1000 agentow; jest jednym agentem dla jednej kancelarii. Ringi/trust scoring/RL governance ekonomicznie nie domykaja.

**C. Cherry-pick tylko 1 patternu (Merkle)**
- Odrzucone - zbyt wask. MCP Security Gateway jest realnym ryzykiem (6 konektorow, kancelaria moze dodac 7-my 3rd-party), privilege rings to maly koszt i pelny upside dla scenariusza "uzytkownik dodal narzedzie z internetu".

**D. Cherry-pick 3 patternow (wybrane)** - **przyjete**
- Trzy patterny, kazdy stoi sam, kazdy ma osobny ADR implementacyjny. Pelny koszt rozlozony.

---

## Konsekwencje

### Pozytywne
- Pattern MCP Security Gateway domyka znana luke (3rd-party MCP wpiety przez uzytkownika).
- Merkle upgrade audit'u podnosi efektywnosc weryfikacji bez zamiany dotychczasowego hash-chain.
- Privilege rings dostarczaja prosty fail-closed model dla wywolan narzedzi.
- Material edukacyjny dla MateMatic - LI post "co Microsoft buduje dla AI governance" w pozycji eksperta.

### Negatywne / kosztowe
- Trzy nowe ADR implementacyjne (0025, 0026, 0027) do napisania.
- Migracja Postgres dla Merkle roots = bramka jakosci (test 233/238 musi zostac zielony).
- Dodatkowa warstwa `mcp-security/` zwieksza powierzchnie do utrzymania o ~500-800 LoC.
- Ring 2 = deny by default dla 3rd-party MCP moze zaskoczyc uzytkownikow ktorzy juz dodali wlasne narzedzia - migracja wymaga komunikatu Operatorowi.

### Bramki przed implementacja
- **[ZAMKNIETE 2026-05-24]** `legal-ai-plugin-governance` audit pluginu `agent-governance-claude-code` v3.6.0 - werdykt 🟢 ZIELONY, dopuszczony do PATRON dev environment z pin wersji + .agt/ w gitignore. Pelny raport w memory: `audit_agent_governance_claude_code_2026-05-24.md`. Zero HTTP/telemetrii w hooks+lib+server (zweryfikowane grepem), SDK deps czyste (@noble/* + js-yaml), hash-chain audit lokalny. NIE dopuszczony do maszyn kancelarii klienckich bez osobnego DPA z Microsoft.
- 2x runda wewnetrznego review tresci przed merge kazdego z ADR-0025/0026/0027.
- Testy: kazdy nowy modul (mcp-security, merkle-verifier, ring-policy) z testem przed wpieciem do prod path.

---

## Atrybucja

Patterny zainspirowane przez [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, Microsoft Corp., 2026). Adopcja zgodna z kanonem cherry-pick MateMatic (kanon cherry-pick MateMatic):
- Snapshot licencji: MIT, commit pushedAt `2026-05-24T17:02:19Z`, star count `1904`.
- Patron pisze trzy moduly od zera w TypeScript pod swoje realia (Postgres, MCP stdio, Node 20+).
- Atrybucja: ten ADR + wpis w `THIRD_PARTY_INSPIRATIONS.md` (do dopisania razem z ADR-0025) + komentarz naglowkowy w kazdym nowym module.
