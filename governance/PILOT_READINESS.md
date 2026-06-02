# PILOT_READINESS - stan gotowosci Patrona do testow

Dokument uziemiony w realnej weryfikacji repo z 2026-06-01 (commit po ADR-0090). Rozdziela to, co zweryfikowano jako dzialajace, od tego, co jeszcze blokuje test - i osobno bramy kodowe od bram ludzkich/prawnych (te ostatnie sa decyzja czlowieka, nie agenta). Komplementarny do [IMPLEMENTATION_PLAYBOOK.md](./IMPLEMENTATION_PLAYBOOK.md) (harmonogram 6-8 tyg) - playbook mowi JAK wdrazac, ten dokument mowi CZY jest gotowe i CO zostaje.

## Zweryfikowane jako dzialajace (z dowodem)

| Obszar | Status | Dowod (jak sprawdzono 2026-06-01) |
|---|---|---|
| Build backendu | zielony | `npm --prefix backend run build` (tsc) exit 0, `backend/dist/index.js` powstaje |
| Build frontendu | zielony | `npm --prefix frontend run build` (next, output standalone) exit 0, 16 tras |
| Build calosci | zielony | root `npm run build:all` exit 0 (backend + frontend jednym poleceniem) |
| Testy backendu | zielony | `vitest run` 1021 pass, 0 fail, 5 todo (71 plikow) |
| Smoke desktop (SQLite zero-cloud) | zielony | `npm run smoke:desktop` PASS: /health, upload docx 201, index w tle (doc_chunks + extracted_entities), folders/ingest, draft tracked-changes roundtrip |
| Blocker B1 (pseudonimizacja PII egress) | LIVE | ADR-0067; warstwa pseudonim/ wpieta w egress, fail-closed dla privileged |
| Blocker B2 (egress router data-residency) | LIVE | ADR-0067; decideRoute + guardEgress, per-call audit z kosztem do hash-chain |
| Bundle 6 konektorow MCP | gotowy | `scripts/bundle-mcp.cjs` (saos, nsa, isap, krs, eu-sparql, eu-compliance) |
| Konstytucja | v1.5.0 | `governance/CONSTITUTION.md`, 9 artykulow, obowiazujaca |

Wniosek: logika aplikacji i runtime (tryb desktop SQLite zero-cloud) sa sprawne. Artefakty buildu kompiluja sie czysto. Sciezka retrievalu (RRF + dual-similarity ADR-0087 + event-centric ADR-0090) domknieta.

## Aktualizacja po audycie 2026-06-02

Pelny audyt (workflow 93 agentow + agent bezpieczenstwa, patrz [docs/AUDYT_2026-06-02.md](../docs/AUDYT_2026-06-02.md)) wykryl i **naprawil 4 blokery P0** + kluczowe P1. Zweryfikowane live na **swiezo zbudowanym i zainstalowanym** instalatorze (NSIS 220 MB, exe 2026-06-02 18:54):
- `/skills` 404 -> **200** (biblioteka umiejetnosci dostepna; binarny 06-01 nie mial `skills.js`).
- `/api/security/mcp-status` 500 -> **200** (bug kolumny `created_at` -> `ts`).
- Egress guard wpiety w tabular (generate/regenerate-cell/chat) i generate-title - tresc akt nie wychodzi do chmury bez kontroli (ADR-0099).
- SSRF guard `OLLAMA_HOST`; `<html lang="pl">`; i18n stringow; dostepnosc; baza wiedzy [docs/BAZA_WIEDZY.md](../docs/BAZA_WIEDZY.md).
- Bramki: backend tsc 0 / vitest 1088 pass; frontend tsc 0; instalator exit 0.

Backlog P1/P2 (nie blokuje pierwszego testu, patrz AUDYT sekcja 5): rotacja sekretow lokalnych, at-rest encryption domyslnie off, CSP report-only, MCP gateway domyslnie off, testy integracyjne tras.

## Bramy kodowe (do zrobienia przed testem, w pasie agenta)

1. ~~**Pakowanie instalatora desktop (electron-builder)**~~ **ZAMKNIETE** (ADR-0091; re-weryfikowane 2026-06-02 - swiezy build niesie fixy P0). Pierwotny opis luki ponizej dla historii.

   **Pakowanie instalatora desktop (electron-builder)** - byl jedyny zidentyfikowany realny gap kodowy dla sciezki DESKTOP. `desktop/main.js` w produkcji odpala `npm run dev` (serwer deweloperski Next.js) i `node dist/index.js`, a `desktop/package.json` extraResources WYKLUCZA `node_modules` i `src` z obu paczek. Skutek: spakowany instalator dalby aplikacje, ktora nie wstaje (brak natywnego better-sqlite3 w backendzie, brak zrodel/zaleznosci frontu). Dodatkowo main.js spawnuje zewnetrzny `node`/`npm`, co wymaga toolchainu Node na maszynie klienta - sprzeczne z celem "jeden instalator". Wymaga przeprojektowania: serwowanie frontu produkcyjnie (standalone server.js) zamiast dev, bundling produkcyjnych zaleznosci backendu (w tym rebuild natywny better-sqlite3 pod runtime), uruchamianie procesow przez wbudowany node Electrona zamiast zewnetrznego. Weryfikacja wymaga zbudowania NSIS i instalacji na czystej maszynie Windows (GUI) - poza srodowiskiem agenta headless. Status: wydzielone do osobnego zadania.

Uwaga: sciezka SERWEROWA (Docker + Supabase + MinIO na VPS) z IMPLEMENTATION_PLAYBOOK Tydzien 1 jest dojrzala i nie ma tego gapa - jezeli pierwszy test idzie w trybie serwerowym, brama kodowa numer 1 nie dotyczy.

## Bramy ludzkie / prawne (decyzja czlowieka, nie agenta)

Te warunki NIE sa kodem i zostaja po stronie Administratora/Operatora (governance, [Konstytucja](./CONSTITUTION.md) role):

1. **Podpis Konstytucji v1.5.0** przez Administratora kancelarii (wymog krytyczny, playbook Tydzien 0). Pole podpisu w CONSTITUTION.md puste.
2. **Wybor modelu LLM** (bring-your-own: Gemini / Claude / Ollama lokalny / OpenRouter).
3. **Decyzja data-residency** - `ALLOW_US_PROVIDERS=true` albo tryb wylacznie lokalny/EU. Domyslnie fail-closed dla danych objetych tajemnica.
4. **NDA przed jakimkolwiek testem u klienta** - test/pilotaz bez umowy poufnosci moze zniszczyc nowosc patentowa i narusza tajemnice zawodowa. Wzor w drafts/IP. Bezwzglednie przed instalacja u klienta.
5. **Infrastruktura i bezpieczenstwo** (playbook Tydzien 1-2): provisioning, backup + test odtworzenia, rejestr czynnosci RODO art. 30, monitoring.

## Rezerwacje (nie blokuja testu pilotazowego)

- Detekcja imion w pseudonimizacji (B1): obecnie regex; fallback uczony to dlug FAZA 1. Mitygacja: egress router fail-close dane uprzywilejowane do trybu lokalnego, wiec nie wychodza do chmury niezaleznie od detekcji.
- OCR skanow (Tesseract pol + poppler): baseline udokumentowany, ale nie wpiety/udokumentowany w sciezce desktop - do potwierdzenia, jezeli pilot przetwarza skany papierowe.
- cost-caps i consensus model: rezerwacja ADR-0067.
- Instalator Linux / macOS: tylko Windows (NSIS) skonfigurowany; Linux szacowany na 3-5 dni przy potrzebie.
