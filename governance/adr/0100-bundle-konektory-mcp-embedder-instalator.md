# ADR-0100: Bundle 6 konektorow MCP + model embeddera do instalatora desktop

**Status**: Zaproponowany 2026-06-03. Domyka rezerwacje 3 i 4 z [ADR-0091](./0091-pakowanie-instalatora-desktop.md) ("Bundle embeddera" + "Bundle konektorow MCP do paczki desktop"). Zweryfikowany na zywej binarce NSIS: 6/6 konektorow wstaje jako dzieci `PATRON.exe`, realne wyroki (SN `I CSK 90/15` przez `saos`, NSA/WSA `I GSK 771/26` przez `nsa`), embedding offline 384 dims, testy mcp+mcp-security+ring-policy zielone, tsc 0. Setup.exe 230 MB -> 525 MB. **NIE merge bez 2x wewnetrznego review (WM)** - patrz bramki na koncu.

**Data**: 2026-06-03

**Powiazane zasady** (Konstytucja AI Patrona v1.5.0):
- **Art. 1/2 - Lokalnosc danych / zero-cloud**: konektory orzecznictwa i model embeddera jada W instalatorze, zero pobierania z sieci przy starcie na maszynie klienta. Embedder offline (`allowRemoteModels=false`, ADR-0071) - metadane (IP/UA/timestamp) nie wychodza poza EOG przy 1. uruchomieniu.
- **Art. 3 - Audytowalnosc / determinizm**: staging deterministyczny (`prepare-resources.cjs` - czyste kopie dist+node_modules z przypietych repo). Konektory dalej przechodza load-time Gateway (ADR-0028) i runtime ring-policy (ADR-0027) - bundling NIE omija bramek bezpieczenstwa.
- **Art. 4 - Neutralnosc wobec dostawcow**: 6 konektorow traktowanych jednolicie (Ring 1), zaden faworyzowany. Embedder lokalny (transformers.js) nie wprowadza zaleznosci od chmurowego providera.
- **Art. 7 - Minimalnosc / rzetelnosc**: brak wymogu zewnetrznego `node` u klienta (konektory odpalane pod Node wbudowanym w Electron). Decyzje ponizej poparte realna weryfikacja runtime, nie zalozeniem.

**Powiazane ADR**:
- **[ADR-0091](./0091-pakowanie-instalatora-desktop.md)** (pakowanie desktop): rodzic. Zarezerwowal bundle embeddera (pkt 3) i bundle konektorow (pkt 4) jako osobne kroki pilota. Ten ADR je realizuje. Wzorzec Node-wbudowany-w-Electron (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) rozszerzony z procesow backend/frontend na proces dziecka konektora MCP.
- **[ADR-0002](./0002-dual-license-agpl-shell-mit-connectors.md)** (dual-license): 6 konektorow `mcp-*` to MIT, powloka AGPL-3.0. Bundling MIT do dystrybucji AGPL jest kompatybilny (sekcja Licencje).
- **[ADR-0027](./0027-privilege-rings-mcp.md)** (privilege rings): `decideRing` klasyfikuje Ring 1 po stalej `APPROVED_PATRON_CONNECTORS`. Aktualizacja tej stalej (pkt D) jest WARUNKIEM, by realne `nsa/isap/eu-sparql` trafily do Ring 1 (allow), a nie Ring 2 (deny fail-closed).
- **[ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md)** (Gateway startup): detektor typosquat liczy Levenshtein nazwy vs `APPROVED_PATRON_CONNECTORS`. Ta sama stala zasila DWIE bramki (load-time typosquat + runtime ring) - rozjazd nazw psul obie naraz.
- **[ADR-0071](./0071-egress-hardening-openexternal-embeddings.md)** (egress embedder fail-closed): zarezerwowal pre-bundling e5-small do instalatora "zeby retrieval wektorowy dzialal od razu bez pobierania". Ten ADR to robi; runtime celuje w lokalny katalog przez `PATRON_EMBED_MODELS_PATH`.
- **[ADR-0007](./0007-hybrid-retrieval-vec-bm25-graph.md)** (hybrid retrieval): bez embeddera retrieval degraduje do BM25+graf. Bundle przywraca warstwe wektorowa w instalatorze.

---

## Kontekst

Po ADR-0091 instalator NSIS sklada backend + frontend i wstaje zero-cloud, ale komentarz w `prepare-resources.cjs` traktowal konektory i embedder jako "rezerwacje kroku pilota". Skutek na zainstalowanej binarce:

- **Zero orzecznictwa i legislacji.** Mecenas w czacie nie ma zadnego zrodla wyrokow (SAOS/NSA), aktow (ISAP/EUR-Lex), KRS ani korpusu compliance UE. Konektory MCP zyja w osobnych repo `mcp-*` (ADR-0002) i nigdy nie trafialy do paczki desktop - osobny `scripts/bundle-mcp.cjs` celowal w obraz dockera trybu serwerowego, nie w instalator.
- **Retrieval tylko BM25+graf.** Model `Xenova/multilingual-e5-small` byl pobierany z HF Hub przy 1. uzyciu; po ADR-0071 (fail-closed `allowRemoteModels=false`) to pobranie jest domyslnie zablokowane - wiec na czystej maszynie warstwa wektorowa po prostu nie wstawala (ADR-0007 degradacja).

Dodatkowo na czystej binarce wystepowaly dwa bledy maskujace, ktore ten ADR usuwa (sekcje Decyzja D i Bezpieczenstwo):

- Klient NIE MA zewnetrznego `node` - definicja konektora `command:"node"` nie miala czego uruchomic.
- Stala `APPROVED_PATRON_CONNECTORS` byla nieaktualna (`sn-orzeczenia`, `nsa-orzeczenia` zamiast realnych `nsa`, `eu-sparql`) - bramka typosquat blokowala WLASNY konektor jako podrobke (`nsa` vs `isap`, dist=2 -> critical -> denied).

Cel: instalator, ktory daje mecenasowi komplet zrodel prawa + retrieval wektorowy offline, bez wymogu toolchainu i bez egress przy starcie.

### Weryfikacja runtime (na zywej binarce NSIS)

- `saos__search` -> realne wyroki SN (`I CSK 90/15`); `nsa__search` -> NSA/WSA (`I GSK 771/26`).
- 6/6 konektorow rejestrowanych i zywych jako procesy-dzieci `PATRON.exe` (Node wbudowany w Electron).
- Embedding offline: 384 wymiary, zero zadan sieciowych (`allowRemoteModels=false`).
- Testy `mcp` + `mcp-security` + `ring-policy` zielone, `tsc --noEmit` exit 0.
- Auth bypass w trybie sqlite (`requireAuth -> LOCAL_USER`) - endpointy testowalne curlem bez tokenu. `userData` pod `%APPDATA%/patron-desktop` (klucz `name`, nie `productName`).

Nieweryfikowalne headless (krok build-na-celu, jak w ADR-0091): finalna kompilacja NSIS i instalacja na docelowej maszynie. Status zostaje **Zaproponowany** do 2x review WM.

---

## Decyzja

### A. Konektor MCP uruchamiany pod Node wbudowanym w Electron (`resolveStdioSpawn`)

Nowa funkcja `resolveStdioSpawn(cfg)` w `backend/src/lib/mcp/index.ts` przepuszcza kazda definicje stdio przed `loadConfig()`:

- **Podmiana command** - gdy `command === "node"` i `process.env.ELECTRON_RUN_AS_NODE === "1"`, podmieniamy na `process.execPath` (ten sam binarny Electrona, ktory uruchomil backend - main.js spawnuje go z `ELECTRON_RUN_AS_NODE=1`) i przekazujemy do dziecka pelny `process.env` + wymuszenie `ELECTRON_RUN_AS_NODE=1`. Konektor odpala sie jako `PATRON.exe .../dist/index.js`.
- **Rozwiazanie args wzglednych** - args konczace sie na `.js` i niebezwzgledne sa rozwiazywane wzgledem `BACKEND_ROOT` (`path.dirname(CONFIG_PATH)`), bo instalator nie zna absolutnej sciezki instalacji w czasie budowania.
- **No-op w dev/docker** - podmiana command na `execPath` jest bramkowana flaga Electrona, wiec w dev/docker `command` zostaje `"node"`. Rozwiazanie args wzglednych dziala we WSZYSTKICH trybach, ale jest praktycznie no-op w dev/docker, bo tamtejsze args sa absolutne (`mcp-servers.example.json` uzywa `/path/to/...`). Zero regresji dla developera i trybu serwerowego.

Wzorzec spojny z ADR-0091 (oba procesy aplikacji juz tak startuja); ten ADR rozszerza go na proces-dziecko konektora.

### B. Staging konektorow w instalatorze (`stageMcpConnectors`)

Nowa faza w `desktop/scripts/prepare-resources.cjs`. Z `MCP_REPOS_DIR` (default `..` od repo, realnie `C:/Users/Wieslaw/mcp-*`) dla kazdego z 6 konektorow kopiuje `dist/` + `package.json` + `node_modules/` (+ `data/` dla `eu-compliance`, ktory wozi lokalny korpus regulacji) do `dist-resources/backend/mcp-bundled/<name>/`. Generuje `mcp-servers.json` z `args` WZGLEDNYMI (`mcp-bundled/<name>/dist/index.js`, `enabled:true`) - rozwiazywanymi przez `resolveStdioSpawn` (pkt A). `mustExist` na dist/node_modules/(data) - brak zbudowanego konektora wywala build glosno (fail-loud), nie cicho.

Lista `MCP_SERVERS` w skrypcie (`saos, nsa, isap, krs, eu-sparql, eu-compliance`) MUSI byc zsynchronizowana z `APPROVED_PATRON_CONNECTORS` (pkt D) i `mcp-servers.example.json` - trzy miejsca, jedno zrodlo nazw.

### C. Staging modelu embeddera (`stageEmbedModel`) - best-effort

Pobiera wagi `Xenova/multilingual-e5-small` (przez `@huggingface/transformers` z node_modules backendu, `cacheDir = dist-resources/backend/models`) RAZ przy budowaniu. Layout cache jest identyczny z tym, czego runtime szuka przez `localModelPath`. Runtime (`main.js`, pkt ponizej) ustawia `PATRON_EMBED_MODELS_PATH` na ten katalog; `embeddings.ts` laduje offline (`allowRemoteModels=false`, ADR-0071).

**Best-effort**: gdy pobranie sie nie uda (brak sieci na maszynie buildu), build NIE pada - loguje ostrzezenie, instalator powstaje bez wektorow (retrieval degraduje do BM25+graf, ADR-0007). `SKIP_EMBED=1` pomija krok calkowicie. Skrypt pobierania zapisywany jest do PLIKU (`.embed-download.cjs`), nie `node -e` - wieloliniowy `-e` psuje sie pod `shell:true` na Windows.

### D. Aktualizacja `APPROVED_PATRON_CONNECTORS` na realne nazwy

`backend/src/lib/mcp-security/pipeline.ts`: lista zmieniona z nieaktualnej (`saos, eu-compliance, krs, isap, sn-orzeczenia, nsa-orzeczenia`) na realne 6 (`saos, nsa, isap, krs, eu-sparql, eu-compliance`). Ta sama stala jest jedynym zrodlem prawdy dla DWOCH bramek (sekcja Bezpieczenstwo). `mcp-servers.example.json` zaktualizowany rownolegle (6 wpisow stdio + komentarz ostrzegajacy o wymogu synchronizacji nazw).

### E. Runtime wskazuje zbundlowany model (`main.js`)

`desktop/main.js` (`backendLocalEnv`): gdy katalog `RES()/backend/models` istnieje, ustawia `PATRON_EMBED_MODELS_PATH` na niego. Ustawiane WARUNKOWO (tylko gdy katalog jest) - inaczej nie nadpisuje domyslnej sciezki, wiec build bez modelu (pkt C best-effort) nie psuje runtime.

### F. (przy okazji) Staging dokumentacji uzytkownika (`stageDocs`)

Ta sama zmiana w `prepare-resources.cjs` kopiuje `docs/BAZA_WIEDZY.md` + `docs/SAMOUCZEK.md` do `backend/docs/` (prompt systemowy onboardingu, commit 223755d, o nich wie). Niezalezne od konektorow/embeddera, ale jada w tym samym staging - odnotowane dla kompletnosci diffa.

---

## Bezpieczenstwo

**Bundling NIE omija bramek MCP.** Konektory zbundlowane jada przez te sama sciezke co konfiguracja recznie wpisana: load-time Gateway (ADR-0028: typosquat / drift / hidden-instructions / tool-poisoning) PRZED rejestracja toolow, oraz runtime ring-policy (ADR-0027: `decideRing` per call). Bundle zmienia tylko, SKAD biora sie pliki, nie KTOREDY przechodza.

**Jedno zrodlo prawdy, dwie bramki.** `APPROVED_PATRON_CONNECTORS` zasila zarowno detektor typosquat (`pipeline.ts`, load-time, `approvedNames`) jak i `decideRing` (`ring-policy.ts:70`, runtime Ring 1). Nieaktualna lista psula OBIE bramki naraz dla wlasnych konektorow:
- **Load-time**: `nsa` w odleglosci Levenshteina 2 od `isap` (jedyny bliski wpis na starej liscie po usunieciu prawdziwych nazw) -> typosquat `critical` -> `denied` -> tool NSA nigdy nie rejestrowany (cicho, mimo gateway mode=off).
- **Runtime**: nawet gdyby przeszedl load-time, `nsa` spoza listy -> `decideRing` Ring 2 -> `deny` (fail-closed, brak `operatorApproved`).

Naprawa (pkt D) wyrownuje obie: realne 6 nazw trafia do Ring 1 (allow + audit) i jest rozpoznawane jako zatwierdzone (dist=0, brak findingu). **Lekcja**: detektor z false-positive na WLASNYCH zasobach jest gorszy niz brak detektora - rozjazd canonical-list rozsadza caly model defense-in-depth. Procedura dodania konektora w przyszlosci: dopisac dokladna nazwe w 3 miejscach (`APPROVED_PATRON_CONNECTORS`, `MCP_SERVERS` w prepare-resources, `mcp-servers.example.json`) jednym commitem.

**Izolacja procesu konektora + least-privilege env.** Konektor to osobny proces-dziecko (stdio transport), nie kod w procesie backendu. `resolveStdioSpawn` NIE przekazuje pelnego `process.env` backendu do dziecka - tylko `ELECTRON_RUN_AS_NODE=1` (+ ewentualny `cfg.env` operatora). Bezpieczna baza OS (PATH/SystemRoot/APPDATA itd.) jest domieszywana przez sam SDK (`StdioClientTransport: { ...getDefaultEnvironment(), ...env }`). To swiadoma decyzja least-privilege (Konstytucja Art. 7 / RODO art. 32): konektor orzecznictwa NIE dostaje sekretow backendu (klucz szyfrowania bazy `PATRON_DB_ENCRYPTION_KEY`, sekret `USER_API_KEYS_ENCRYPTION_SECRET`, `DOWNLOAD_SIGNING_SECRET` wstrzykiwane w `main.js:backendLocalEnv`), bo ich nie potrzebuje, a bundlujemy ~294 MB tranzytywnych `node_modules` (powierzchnia supply-chain). Konektory `mcp-*` sa MIT, audytowane przez MateMatic (ADR-0002) - trusted set Ring 1. Konektor 3rd-party dodany przez Operatora dalej wpada w Ring 2 fail-closed (ADR-0027 bez zmian).

**Egress.** Embedder offline (`allowRemoteModels=false`) - zero pobierania wag przy starcie (ADR-0071). Konektory orzecznictwa lacza sie z PUBLICZNYMI zrodlami prawa (SAOS, CBOSA, ISAP/ELI, EUR-Lex, KRS) na zadanie mecenasa - to nie sa dane klienta kancelarii; tajemnica zawodowa dotyczy aktow sprawy (maskowanie PII przed LLM, ADR-0003), nie publicznych zapytan o sygnature wyroku. `eu-compliance` dziala w pelni offline z lokalnego korpusu (ADR-0022).

---

## Rozmiar instalatora

Setup.exe **230 MB -> 525 MB** (+295 MB). Glowny skladnik to `node_modules/` 6 konektorow (~294 MB) + korpus `eu-compliance` (~35 MB) + wagi embeddera (e5-small, dziesiatki MB).

**Dlug do rozwazenia: dedupe `node_modules` konektorow (~294 MB).** Kazdy z 6 konektorow wozi wlasna pelna kopie zaleznosci, a dziela duzo wspolnych (MCP SDK, zod, fetch/undici itd.). Opcje na pozniej (osobne zadanie, NIE w tym ADR):
- Hoisting do wspolnego `mcp-bundled/node_modules` z symlinkami/`node_modules/.bin` per konektor (ryzyko: roznice wersji miedzy repo, Windows symlink permissions).
- `npm dedupe` / pnpm content-addressable store przy budowaniu konektorow.
- `npm install --omit=dev` per konektor (jezeli ktorys wozi devDependencies w `node_modules`).
- esbuild bundle per konektor do pojedynczego `dist/index.js` (eliminuje `node_modules` calkowicie; ryzyko: natywne moduly, dynamiczne require).
Szacowana oszczednosc realna: 100-200 MB. **Decyzja: zostawiamy verbatim kopie w tej iteracji** (poprawnosc > rozmiar dla pilota), dedupe jako rezerwacja.

Korpus `eu-compliance` (35 MB) jest nieredukowalny - to lokalny dataset regulacji UE (ADR-0022), cena trybu offline.

---

## Licencje

| Skladnik bundla | Licencja | Uwagi |
|---|---|---|
| Powloka Patron (backend/frontend/desktop) | AGPL-3.0-only | ADR-0002, niezmienione |
| 6 konektorow `mcp-*` (dist + node_modules) | MIT | ADR-0002. MIT->AGPL kompatybilne; instalator AGPL moze zawierac MIT. |
| Korpus `eu-compliance` (`data/`) | Apache-2.0 | Korpus regulacji UE, ADR-0022. Apache-2.0 z patent grant; kompatybilny z AGPL-3.0 (Apache 2.0 -> GPLv3/AGPLv3 jest zgodne wg FSF). |
| Wagi `Xenova/multilingual-e5-small` | MIT (model) | e5 z licencja MIT; transformers.js Apache-2.0. Bundling wag do dystrybucji bez problemu. |

**Wniosek**: bundling nie tworzy konfliktu licencyjnego. Wszystkie komponenty (MIT / Apache-2.0) sa permissive i kompatybilne z dystrybucja AGPL-3.0 powloki. Tranzytywne licencje `node_modules` konektorow to standardowy ekosystem npm (przewaznie MIT/ISC/Apache-2.0) - **rezerwacja**: jednorazowy przeglad `license-checker` na zbundlowanych `node_modules` przed publiczna dystrybucja instalatora (nie bloker pilota, ale nalezna higiena przed GA). Atrybucje (NOTICE / THIRD_PARTY) aktualizowane gdy bundle staje sie czescia publikowanego artefaktu.

---

## Konsekwencje

**Pozytywne**:
- Mecenas dostaje komplet zrodel prawa PL/UE w czacie (6/6 konektorow zywych) + retrieval wektorowy offline - zweryfikowane realnymi wyrokami na binarce.
- Zero egress przy starcie (Art. 1/2): embedder offline, konektory startuja lokalnie. Konektor orzecznictwa laczy sie ze zrodlem publicznym dopiero na zadanie mecenasa.
- Defense-in-depth nietkniety: bundle przechodzi Gateway + ring-policy jak konfiguracja reczna. Naprawa canonical-list wyrownala load-time i runtime.
- Brak wymogu zewnetrznego `node` (Art. 7) - konektory pod Node wbudowanym w Electron. Dev/docker = no-op, zero regresji.
- `stageMcpConnectors` fail-loud (`mustExist`) - brak zbudowanego konektora wywala build zamiast wyprodukowac instalator-kaleke. `stageEmbedModel` best-effort - brak sieci nie blokuje buildu (graceful degradacja).

**Negatywne / koszt / caveaty**:
- Instalator +295 MB (230->525). Dedupe node_modules (~294 MB) zostaje rezerwacja - akceptujemy rozmiar dla poprawnosci pilota.
- Build instalatora wymaga 6 zbudowanych repo `mcp-*` obok patron/ (`npm install && npm run build`, plus `npm run fetch-corpus` dla eu-compliance) - udokumentowany warunek build-na-celu (jak rebuild ABI w ADR-0091).
- Synchronizacja nazw w 3 miejscach (`APPROVED_PATRON_CONNECTORS` / `MCP_SERVERS` / `mcp-servers.example.json`) - rozjazd = cicha blokada wlasnego konektora. Komentarze w kodzie ostrzegaja; brak automatycznego testu spojnosci 3 list (rezerwacja: test, ktory porownuje te trojke).
- Finalna kompilacja NSIS + instalacja na docelowej maszynie weryfikowalna tylko build-na-celu (ADR-0091). Status Zaproponowany do 2x review WM.
- NSIS niepodpisany (rezerwacja z ADR-0091 utrzymana).

**Aktualizacja AGENTS.md**: sekcja "Build i test" rozszerzona - bundling konektorow do instalatora desktop odbywa sie przez `prepare-resources.cjs` (`stageMcpConnectors` + `stageEmbedModel`), obok istniejacego `scripts/bundle-mcp.cjs` (ktory celuje w obraz dockera trybu serwerowego). Dopisana zasada: dodajac konektor, zsynchronizuj nazwe w `APPROVED_PATRON_CONNECTORS`, `MCP_SERVERS` (prepare-resources) i `mcp-servers.example.json`. Wpis do listy ADR (0001-0100).

---

## Co pozostaje zarezerwowane

1. **Dedupe `node_modules` konektorow** (~294 MB, szac. oszczednosc 100-200 MB) - hoisting / pnpm store / esbuild bundle. Poprawnosc > rozmiar w tej iteracji.
2. **Test spojnosci 3 list nazw** (`APPROVED_PATRON_CONNECTORS` == `MCP_SERVERS` == `mcp-servers.example.json`) - zeby rozjazd byl bledem testu, nie cicha blokada runtime.
3. **`license-checker` na zbundlowanych `node_modules`** + aktualizacja NOTICE/THIRD_PARTY przed publiczna dystrybucja instalatora (GA, nie pilot).
4. **Podpis instalatora NSIS** (rezerwacja przeniesiona z ADR-0091).
5. **Weryfikacja NSIS na docelowej maszynie Windows** - warunek flipu statusu na Wdrozony.
6. **CHANGELOG.md** - wpis o bundlu konektorow+embeddera dodac przy flipie na Wdrozony (catchup dokumentacji, AGENTS.md zaktualizowany w tym commicie).
7. **Konstytucja SEMVER** - ten ADR jest czysto pakujacy (zero nowej zasady governance), wiec NIE wymaga bumpa Konstytucji (zostaje v1.5.0). Gdyby przy flipie doszla zasada (np. polityka env least-privilege jako twarda regula), rozwazyc PATCH bump.

## Bramki przed flip na Wdrozony / przed merge

- Headless: `tsc --noEmit` exit 0 (backend), pelny suite vitest zielony (mcp + mcp-security + ring-policy bez regresji), `next build` exit 0 (frontend).
- Na zywej binarce (spelnione we wczesniejszej sesji): 6/6 konektorow zywych, realne wyroki przez saos/nsa, embedding offline 384 dims. **CAVEAT**: ta weryfikacja live byla na binarce sprzed naprawy env (least-privilege, sekcja Bezpieczenstwo) - konektor odpalal sie z pelnym `process.env`. Po naprawie konektor dostaje tylko bezpieczna baze OS + `ELECTRON_RUN_AS_NODE` (nie potrzebuje sekretow, wiec oczekiwany brak regresji), ale 6/6-live nalezy POWTORZYC na binarce z poprawka przed flipem na Wdrozony - nie ogłaszać post-fix jako live-verified bez tego.
- **2x wewnetrzny review tresci ADR + zmian (WM) PRZED merge** (AGENTS.md: "wewnetrzny review tresci 2x runda PRZED merge"). Galaz `feat/tier-governance-envelope`, brama private-remote przed push. NIE merge do main bez 2x review.
