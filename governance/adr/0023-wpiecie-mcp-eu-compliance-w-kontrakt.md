# ADR-0023: Wpiecie konektora mcp-eu-compliance w kontrakt MCP Patrona

> **Uwaga numeracja**: ostatni zajety ADR to 0022 (warstwa compliance UE). Sprawdzono `ls governance/adr/` 2026-05-22 - 0023 wolne. Jezeli rownolegla sesja zajmie 0023, przenumerowac (regula sesji rownoleglych).

**Status**: ZREALIZOWANY (2026-05-22). Realizuje odlozone wpiecie z ADR-0022. Wpiecie wykonane i zweryfikowane: `mcp-servers.json` (local) + `mcp-servers.example.json` + `bundle-mcp.cjs` (SERVERS + kopiowanie `data/`). Bundle Docker przetestowany end-to-end - zbundlowany konektor otwiera korpus ze spłaszczonej sciezki (`/app/mcp-bundled/eu-compliance/data/regulations.db`). Przechodzi przez 2x runde wewnetrznego review tresci przed commitem.
**Data**: 2026-05-22

**Powiazane zasady** (Konstytucja Patrona, zweryfikowane grepem - weryfikacja grepem Konstytucji przed cytatem):
- **Art. 8 - Stalosc kontraktow** - GLOWNA zasada tego ADR. Dodanie konektora do `mcp-servers.json` rozszerza kontrakt MCP. Dodanie jest wstecznie kompatybilne (nowy serwer, zadne istniejace narzedzie sie nie zmienia) - to MINOR, nie MAJOR. Kazda kancelaria moze konektor wylaczyc (`enabled: false`).
- **Art. 4 - Neutralnosc wobec dostawcow** - mcp-eu-compliance to osobny proces stdio, wymienialny/wylaczalny jak kazdy z 5 istniejacych. Konstytucja wprost wymienia EUR-Lex jako konektor.
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - wywolania narzedzi konektora ida przez istniejaca sciezke audytu MCP (hash-chain ADR-0001, event z nazwa toola). Wpiecie NIE wymaga nowego kodu audytu - dziedziczy istniejacy.
- **Art. 2 - Weryfikowalnosc zrodel** - kazde narzedzie konektora zwraca `structuredContent.citations` (CELEX + URL EUR-Lex + snapshot), zgodnie z kontraktem citation Patrona.
- **Art. 7 - Minimalnosc danych** - konektor odpytuje publiczny korpus prawa UE; zero danych klienta kancelarii (jak pozostale konektory prawa).

**Powiazane ADR**:
- **ADR-0022** - bezposredni rodzic. Tam: decyzja o warstwie + skeleton + implementacja v0.1.0. Tu: wpiecie zaimplementowanego konektora w kontrakt.
- ADR-0001 (hash-chain audit) - wywolania konektora dziedzicza istniejacy audit path.
- ADR-0014 (multi-provider) - konektor pre-provider, niezalezny od LLM.

---

## Decyzja

mcp-eu-compliance (v0.1.0, repo osobne, MIT) zostaje **6. konektorem** Patrona, rejestrowanym jak pozostale piec.

### Co robimy
1. **`backend/mcp-servers.example.json`** - dodajemy wpis `eu-compliance` (stdio, `enabled: false` jak inne przyklady) - to wersjonowany szablon w repo.
2. **`backend/mcp-servers.json`** (gitignored, config lokalny) - dodajemy wpis wlasny do dev/testu.
3. **`scripts/bundle-mcp.cjs`** - dodajemy `eu-compliance` do listy `SERVERS` (repoDir `mcp-eu-compliance`) ORAZ rozszerzamy kopiowanie o opcjonalny katalog `data/` (konektor wymaga `data/regulations.db` obok `dist/`). Bundle generuje `mcp-servers.docker.json`.
4. **Provisioning korpusu** - przed bundlem repo konektora musi miec `data/regulations.db` (skrypt `npm run fetch-corpus`). To prerequisite bundla, analogiczny do `npm run build`.

### Czego NIE robimy (granica)
- **NIE zmieniamy zadnego istniejacego kontraktu** (SSE eventy, schema, pozostale konektory) - wpiecie jest czysto addytywne.
- **NIE dodajemy kodu audytu** - wywolania ida przez istniejacy MCP audit path (ADR-0001).
- **NIE wpinamy konektora "na sztywno" jako wymaganego** - `enabled` per kancelaria; domyslnie w przykladzie wylaczony.

---

## Kontekst

ADR-0022 zbudowal konektor jako skeleton i swiadomie odlozyl wpiecie w kontrakt (Art. 8). Konektor jest gotowy (v0.1.0, smoke PASS, 5 toolow). Wpiecie to rejestracja w configu - mechanicznie proste, ale dotyka kontraktu MCP, stad osobny ADR zgodnie z granica skeleton vs produkcja.

Roznica wzgledem 5 istniejacych konektorow: mcp-eu-compliance niesie lokalny korpus (`data/regulations.db`, ~36 MB, poza repo - pobierany skryptem). To wymagalo rozszerzenia bundla Docker o kopiowanie `data/` obok `dist/` - wczesniej `bundle-mcp.cjs` kopiowal tylko dist + package.json + node_modules (zmiana w sekcji Decyzja, weryfikacja w Ryzyka).

---

## Ryzyka i bramki

- **Provisioning korpusu w obrazie Docker - ROZWIAZANE 2026-05-22.** `bundle-mcp.cjs` rozszerzony: flaga `needsData` na konektorze + kopiowanie `data/` do `mcp-bundled/<name>/data/`. Konektor szuka bazy przez `__dirname/../data/regulations.db` -> w kontenerze `/app/mcp-bundled/eu-compliance/data/`. Zweryfikowane: pelny bundle kopiuje korpus (36 MB) + licencje, zbundlowany `dist/index.js` startuje i otwiera baze z tej sciezki. Bramka: przed bundlem repo konektora musi miec pobrany korpus (`npm run fetch-corpus`) - walidator bundla zglasza blad gdy `data/` brak.
- **Rozmiar obrazu** - +36 MB korpusu w obrazie backendu. Akceptowalne (jednorazowo, offline, bez zaleznosci sieciowej w runtime - zgodne z Art. 1).
- **Swiezosc korpusu** - snapshot; delegacja aktualnosci do mcp-eu-sparql (live) - jak w ADR-0022. Rebuild obrazu = nowy snapshot.

---

## Konsekwencje

**Pozytywne**: Patron zyskuje verbatim warstwe prawa UE + analize compliance (6 regulacji) jako natywny konektor, bez zmiany istniejacych kontraktow, z audytem przez istniejacy hash-chain.

**Negatywne / koszt**: +36 MB obraz; bundle rozszerzony o kopiowanie `data/` i prerequisite `fetch-corpus` przed buildem.

**Neutralne**: 6. konektor w bundlu; `mcp-servers.docker.json` regenerowany przy deployu.
