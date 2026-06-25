# ADR-0133: Wybor konektorow MCP przez mecenasa (jurysdykcja) + rozszerzenie zaufanego zestawu o UE

**Status**: Proponowany (2026-06-24) — wymaga 2x wewnetrznego review tresci + akceptacji WM przed merge (AGENTS.md). Dotyka warstwy bezpieczenstwa MCP — review szczegolny.

## Kontekst

Ekspansja europejska (i18n UI = ADR-0132). Sama dwujezycznosc UI nie wystarcza:
anglojezyczny mecenas potrzebuje **prawa swojej jurysdykcji**. W PATRONie
substancja prawna idzie wg jurysdykcji, a **wybor konektora MCP = wybor prawa**.

Stan zastany (recon 2026-06-24):
- `mcp-servers.json` ma per-konektor flage `"enabled"` ("absent = enabled"),
  czytana **przy starcie** (`backend/src/lib/mcp/index.ts`). Brak UI — dzis edycja
  pliku / generacja w instalatorze.
- `APPROVED_PATRON_CONNECTORS` (pipeline.ts) = allowlista 6 (saos, nsa, isap, krs,
  eu-sparql, eu-compliance). Bramka typosquat (Levenshtein <=2) blokuje nazwy spoza.
- **Ring-policy (ADR-0027)**: Ring 1 = zaufane konektory PATRONa (allow+audit);
  Ring 2 = cokolwiek poza, w tym 3rd-party MCP -> **default DENY (fail-closed)**,
  allow tylko gdy Operator wpisze `operatorApproved=true`.
- Repo konektorow UE (de/at/es/fi/ie/nl/se/fr/lu-eli, MIT) istnieja obok PATRONa
  (`~/Projects/*-eli-mcp`), gotowe do bundla.

## Decyzja

1. **Mecenas wybiera konektory przez UI — ale TYLKO z zaufanego zestawu (Ring 1).**
   Picker pokazuje konektory z `APPROVED_PATRON_CONNECTORS`, pozwala wlaczyc/wylaczyc
   (`enabled`). Pogrupowane wg **jurysdykcji** (PL / DE / AT / ES / ...), bo to jest
   realne znaczenie wyboru.
2. **Rozszerzamy zaufany zestaw o konektory UE.** Dodanie konektora = (a) pelny skan
   przez **MCP Security Gateway** (typosquat / drift / hidden-instructions /
   tool-poisoning) — decyzja inna niz `allowed-clean` blokuje; (b) dopisanie nazwy w
   **TRZECH** miejscach (pipeline.ts `APPROVED_PATRON_CONNECTORS`, prepare-resources.cjs
   `MCP_SERVERS`, mcp-servers.example.json) — rozjazd = bramka typosquat blokuje wlasny
   konektor; (c) bundlowanie repo.
3. **3rd-party / dowolny MCP z internetu NIE jest udostepniony mecenasowi.** Zostaje
   Ring 2 fail-closed, allow tylko przez Operatora (`operatorApproved=true`). Decyzja
   WM 2026-06-24. To chroni tajemnice zawodowa i RODO — nieufny serwer MCP = potencjalny
   wyciek akt + tool-poisoning. W pickerze 3rd-party albo nieobecne, albo widoczne jako
   "tylko Operator".
4. **Kazda zmiana enabled jest audytowana** (zmiana powierzchni narzedzi dostepnych
   agentowi — istotne dla AI Act art. 12). Nowy `event_type` (np. `connector.toggle`)
   w audit hash-chain.
5. **Wejscie w zycie**: MVP — zmiana flagi `enabled` + reload konektorow / restart
   (konektory czytane przy starcie). Dynamiczna re-rejestracja (z ponownym przejsciem
   gateway) = ewentualnie pozniej (NEEDS CLARIFICATION w spec 002).

### Granica (czego picker NIE robi)

- NIE dodaje ani nie usuwa konektorow spoza zaufanego zestawu.
- NIE omija MCP Security Gateway ani ring-policy (ADR-0025/0027/0028).
- NIE zmienia trustLevel ani operatorApproved (to rola Operatora, nie mecenasa).

## Konsekwencje

**Pozytywne:**
- Domyka ekspansje EU: EN UI (ADR-0132) + wybor jurysdykcji = PATRON dla kancelarii DE/AT/...
- Wykorzystuje istniejaca architekture (enabled flag, ring-policy) — picker to gl. UI + API.
- Nowe klucze UI pickera trafiaja do `pl.ts` + `en.ts` — synergiczne z ADR-0132.

**Koszt / ryzyko:**
- Kazdy nowy konektor UE = praca packagingowa + skan bezpieczenstwa + sync 3 miejsc.
- Konektory UE z kluczem/korpusem (FR-PISTE OAuth, eu-compliance korpus) wymagaja
  per-konektor setupu — picker musi pokazac stan "wymaga konfiguracji".
- Rozszerzenie allowlisty rozszerza powierzchnie zaufania — dlatego kazdy przez gateway.

## Powiazania

- ADR-0132 (i18n) — komplementarna os: jezyk UI vs jurysdykcja prawa.
- ADR-0025/0028 (MCP Security Gateway), ADR-0027 (ring-policy) — niezmienione, picker
  dziala NAD nimi.
- ADR-0002 (dual-license) — konektory UE = MIT, bundlowane do powloki AGPL (juz pokryte).
- Spec: `.matematic/spec/002-mcp-connector-picker/`.
