# Weryfikacja desktop gałęzi `audyt/2026-09` (2026-10-06)

Niezależna weryfikacja na Windows 11 (Node 24, Python 3.13, Ollama lokalnie) tez z [AUDYT_2026-09.md](./AUDYT_2026-09.md), [PRZEGLAD_2026-10-02.md](./PRZEGLAD_2026-10-02.md) i [NAPRAWY_2026-10-02.md](./NAPRAWY_2026-10-02.md). Punkt wyjścia: `19a0670`, 52 commity nad `main` @ `40cea92`. Każdy werdykt ma dowód: komendę z wynikiem albo plik:linia. Deklaracje sesji chmurowej sprawdzane u źródła, nie przepisywane.

Werdykty: **OK** (zgodne, dowód), **UWAGI** (działa, ale z zastrzeżeniem), **BLOKADA** (nie działa albo przeczy deklaracji), **NIE SPRAWDZONO** (z powodem).

## Mianownik

| | Liczba |
|---|---|
| Punktów sprawdzanych (kroki 1-4 + przegląd GitHub; wiersze tabel niżej + krok 3) | 35 |
| OK (w tym 4 dopiero po poprawce narzędzi pomiaru na Windows) | 18 |
| UWAGI | 11 |
| BLOKADA | 2 |
| NIE SPRAWDZONO (z powodem) | 3 |
| NIE WYKONANO (czeka na decyzję WM) | 1 |

Rozjazdów z deklaracjami sesji chmurowej: 6 (lista niżej). Wszystkie środowiskowe albo w narzędziach pomiaru, żaden nie podważa naprawy w kodzie produktu. Obie BLOKADY leżą poza zmianami gałęzi audytu (e2e i osierocona naprawa na publicznym repo) i nie blokują jej scalenia.

## Krok 1 - bramki repo

| # | Bramka | Deklaracja | Wynik na desktopie | Werdykt |
|---|---|---|---|---|
| 1.1 | backend `npm ci` / `tsc --noEmit` | czysty | exit 0 / exit 0 | OK |
| 1.2 | backend `npm test` | 2071 / 1 skip / 5 todo, 160 plików | Pierwszy przebieg: 1 plik czerwony, `tool-result-masking.test.ts` - `beforeAll` przekracza 10 s (zimny import `./stream` w pełnej suicie; w izolacji 3/3 zielone w ~3 s). Po `hookTimeout` 30 s (wzór `5beae93`): **2071 / 1 skip / 5 todo, 160 plików** | OK po poprawce (rozjazd R1) |
| 1.3 | frontend `npm ci` / `tsc` / `npm test` | 257 pass, 33 pliki | 257 pass, 33 pliki | OK |
| 1.4 | runner audytu backend | 7 czerwonych (A-02 x3, A-11, B-01 x3), 105 zielonych | Pierwszy przebieg: **13 czerwonych**. 6 nadmiarowych to harness nieprzenośny na Windows: `symlinkSync(...,"dir")` = EPERM (R-TI-01 x5), `spawn(.bin/tsx)` = ENOENT (C-05, A-22, D-12), `import()` po gołej ścieżce = ERR_UNSUPPORTED_ESM_URL_SCHEME (D-12), sprzątanie przed wyjściem procesu = EPERM (D-12). Po naprawie harnessu: **7 czerwonych, wszystkie `AssertionError`** (A-02 x3, A-11, B-01 x3), 104 zielone, 1 pominięty (R-MCP-05, uprawnienia 0600 - z założenia nie na Windows) | OK po poprawce (rozjazd R2) |
| 1.5 | runner audytu frontend | 1 czerwony (A-21) | 1 czerwony A-21 (`AssertionError: brak egzekwowanego naglowka CSP`), 10 zielonych | OK |
| 1.6 | `publication_gate.py .` | PASS | 0 hard, 71 warn, 675 plików, PASS | OK |
| 1.7 | `publication_gate_selftest.py` / `pre_push_gate_selftest.py` | OK / OK | **3 i 1 błędy** na Windows: `unlink()` obiektu gita tylko-do-odczytu (PermissionError) i nazwa z tabulatorem/cudzysłowem niemożliwa na NTFS. Po poprawce: 46/46 i 26/26 OK | OK po poprawce (rozjazd R3) |
| 1.8 | sondy pre-push (`backend/audit-2609/sondy/`) | 7 z 7 zatrzymanych | Pierwszy przebieg wywrócił się na S4 (ten sam `unlink`). Po poprawce: **7 z 7 zatrzymanych**, `pushurl`: oba zatrzymane. Przy okazji: obie sondy kończyły się kodem 0 niezależnie od wyniku - dodany kod wyjścia z werdyktu, kontrola pozytywna: `[True,False]` i `[]` dają 1 | OK po poprawce (rozjazd R4) |
| 1.9 | `adr_number_gate.py .` | PASS, licznik pominięty | Z prywatnym rejestrem (kopia tymczasowa, usunięta): PASS, 151 ADR (max 0166), 24 migracje (max 025). Gałąź nie dodaje ADR ani migracji (`git diff --diff-filter=A` pusty) | OK |
| 1.10 | `agents_md_receipt_gate.py --samotest` + bramka | OK | OK / OK (paragony żywe, mianownik pominięć wypisany) | OK |
| 1.11 | `egress-defaults-gate.test.cjs` | - | OK (tajemnica domyślnie tylko lokalnie; znane-złe wykryte) | OK |
| 1.12 | historia: `publication_gate.py --history --public-ref "refs/public/*" --candidate origin/audyt/2026-09` | - | 52 commity do publikacji, 0 hard, PASS | OK |

Na desktopie wykonał się też test, którego chmura nie mogła uruchomić: `cytaty_pl.drift.test.ts` - przypięty sha kopii ekstraktora zgadza się z bieżącym w domu Repertorium (`Repertorium znalezione`, zielony).

## Krok 2 - weryfikacje, których chmura nie mogła zrobić

| # | Punkt | Wynik | Werdykt |
|---|---|---|---|
| 2a.1 | `npm run build:dir` + `npm run e2e:smoke` | build exit 0, e2e PASS (edycja pl: 20 konektorów, 7 ON zgodnie z oczekiwaniem; OCR obecny; backend i frontend wstają). Wymagało jawnych `MCP_REPOS_DIR` i `MCP_PY_REPOS_DIR` - domyślne ścieżki zakładają repo PATRON w katalogu domowym | OK |
| 2a.2 | **Izolacja profilu w e2e** | `e2e-smoke.cjs` przekierowuje `APPDATA`/`LOCALAPPDATA`, ale Electron na Windows bierze `userData` z systemu (FOLDERID_RoamingAppData), nie ze zmiennej. Spakowana aplikacja zapisała do rzeczywistego `%APPDATA%\patron-desktop\patron.db`, nie do profilu tymczasowego. Zdanie „czysty profil” w `e2e-smoke.cjs` i w AGENTS.md (DON'T #2) jest nieprawdziwe; każdy przebieg e2e uruchamia migracje na profilu roboczym maszyny budującej. Propozycja niżej (P2) | **BLOKADA** |
| 2a.3 | Tajemnica + model chmurowy, domyślnie | Spakowana aplikacja, bez kluczy chmurowych w env: `GET /api/config/egress` → `privileged_cloud.allowed=false`; nowa sprawa ma domyślnie klasyfikację tajemnicy (`schema.sqlite.ts:70`); czat z modelem chmurowym → SSE `egress_blocked`: „Ta sprawa jest oznaczona jako objeta tajemnica zawodowa. Dozwolony jest wylacznie model lokalny...” | OK |
| 2a.4 | Zgoda per sprawa i ślad | `PATCH /projects/:id/cloud-consent` → 200; następny czat przechodzi przez strażnika (dalej pada lokalnie na braku klucza Gemini, `gemini.ts:33`, zanim powstanie klient - nic nie wyszło do sieci); w `audit_log` jest `project.cloud_consent` i dwa `llm_route`. Uwaga UX: po zgodzie, bez klucza, użytkownik widzi tylko „Stream error” zamiast „brak klucza Gemini” | UWAGI |
| 2a.5 | Karty zatwierdzeń domyślnie | Domyślna wartość potwierdzona w kodzie (`desktop/main.js:221` `PATRON_MUTATION_APPROVAL ?? 'true'`) i testami B-02/B-04 (zielone). Przebieg z czatu wymaga modelu wywołującego narzędzia; ścieżka Ollama celowo nie przekazuje narzędzi (`ollama.ts:95`, `toolCalling=false`), model chmurowy wymaga zgody WM | NIE SPRAWDZONO (powód: brak lokalnego modelu z narzędziami; chmura tylko za zgodą) |
| 2b | A-21 CSP | Spakowany front wysyła tylko `Content-Security-Policy-Report-Only`. Polityka ma `connect-src 'self'` (= `http://localhost:3000`), a każde wywołanie API idzie na `http://localhost:3001` (`frontend/src/lib/apiBase.ts:22`, `desktop/main.js:486`). Samo przełączenie na tryb egzekwowany odcięłoby backend. Propozycja niżej (P1) | UWAGI |
| 2c | `smoke:surfaces` na Ollamie | Uruchomione z `ollama/llama3.2:3b` i usuniętymi z env kluczami chmurowymi (domyślny model skryptu to chmurowy Gemini, a skrypt przekazuje backendowi całe `process.env`). Upload+indeks OK, workflows OK. Tabular w skrypcie FAILED „0/8 w 0 s” - **defekt skryptu, nie produktu**: tabular bierze model z profilu (`tabularModel`), nie z ciała `/generate`, więc skrypt mierzył domyślny model chmurowy (422 `missing_api_key`; tak samo na `main`). Sonda z modelem ustawionym w profilu: 200, komórka „86.5 m2”, flaga zielona, 22 s. DOCX z czatu i research z MCP: z założenia niedostępne na modelu lokalnym (`ollama.ts:95`). Draft/refine: 200 w 90 s, 3 etapy, model 3B zgubił fakty (jakość modelu). Skrypt poprawiony (model przez profil; przerwana powierzchnia wlicza się do mianownika) | UWAGI |
| 2d | Obszar B na Ollamie | Wymaga wywołań narzędzi (edycja jako karta, argumenty MCP); ścieżka Ollama ich nie ma. Pokrycie tylko testami B-02/B-11 (fake-LLM, zielone) | NIE SPRAWDZONO (powód jak 2a.5) |
| 2e | B-08 komunikat | Tekst jest uczciwy (oczekiwanie, nie alarm; „nic nie wyszło do sieci”), ale **nie wskazuje, co kliknąć - bo nie ma czego**: prawnik ma znaleźć hash w dzienniku startu, ręcznie dopisać JSON `gatewayApproval` do `.patron/mcp-servers.operator.json` i zrestartować. Propozycja niżej (P3) | UWAGI |
| 2f | RODO: `rodo-delete.ts` → eksport → `verify.py` kod 3 | `rodo-delete.ts` działa wyłącznie z klientem Supabase: na SQLite (domyślny desktop) kończy się `FATAL: brak SUPABASE_URL` i kodem 2. Testy repo podmieniają klienta na shim SQLite i wtedy ścieżka anonimizacja → eksport → `verify.py` kod 3 jest zielona (`audit-export-integrity.test.ts:324,351`), HTML/Python/produkcja zgodne (`audit-verifier-assets.test.ts`). Na desktopie Operator nie ma narzędzia RODO art. 17 dla użytkownika - zostaje `forget-case` per sprawa | UWAGI |
| 2g | A-11 (OpenAI `store:false`) | Nie ruszane (wymaga płatnego API). Czerwony test potwierdzony (`expected undefined to be false`) | NIE SPRAWDZONO (decyzja WM) |

## Krok 3 - `fix/kurs-aies-fala1` wobec `audyt/2026-09`

12 commitów kursu bez odpowiednika na `main` (2026-09-24). Wspólne pliki: 35. `git merge-tree` zgłasza konflikt tekstowy w **15 plikach**, m.in. `chat/stream.ts`, `chat/mutation-approval-executor.ts`, `mutation-approval.ts`, `pipeline/defense.ts`, `routing/auditLlmRoute.ts`, `routes/chat.ts` i 8 komponentach frontu. `tool-dispatch.ts`, `mcp-security/` i `pseudonim/egress.ts` bez konfliktu tekstowego.

**Kolizja semantyczna, której merge-tree nie pokaże:** detektor z kursu (`pl-entities/`, `pseudonim/plDetector.ts`) nałożony tymczasowo na gałąź audytu zamyka 2 z 3 czerwonych A-02 (osoba bez markera roli, dalsze wystąpienie nazwy spółki; zostaje telefon bez +48), ale **łamie kontrolę negatywną A-03** w `pseudonim/egress.test.ts` („brak kotwicy nigdzie -> bez propagacji”). Zestawy A-02 są spalone, więc to sygnał, nie pomiar.

Werdykt kroku 3: **UWAGI** (konflikty do rozwiązania ręcznie, jedna kolizja semantyczna).

Rekomendacja kolejności: (1) scalić `audyt/2026-09` (bezpieczeństwo, szerszy zakres); (2) przenieść kurs na nowy `main`, rozwiązać 15 konfliktów i świadomie rozstrzygnąć, co ma znaczyć kontrola negatywna A-03 przy detektorze bez kotwic; (3) pomiar A-02 na NOWYM zestawie przygotowanym przez kogoś innego niż autor poprawki.

## Krok 4 - `feat/design-system-2-0` (repo prywatne)

| # | Punkt | Wynik | Werdykt |
|---|---|---|---|
| 4.1 | Czy gałąź ma coś, czego brak na `main` | 11 commitów bez odpowiednika (cherry-pick). Linie dodane przez każdy z nich porównane z całym drzewem `main`: braki to wyłącznie przepisane komentarze, dokumentacja i liczniki testów; elementy kodu z braków są na `main` (ścieżki `soffice` w `convert.ts`, `ORDER_PL/ORDER_EN` w teście parytetu, `appendLlmRouteEvent` w `tabular.ts`, `EVENT_TYPES` w `metrics.ts`/`audit-log-query.ts`). Plik tylko na gałęzi: `.mcp.json` oraz 45 plików prywatnego warsztatu (`.matematic/`, `.claude/`). Lokalna kopia gałęzi = zdalna (0/0) | OK |
| 4.2 | Archiwum | `git bundle create` + `git bundle verify`: OK, pełna historia, głowica `20ab9be` zgodna ze zdalną. Archiwum poza repo, nie publikować (zawiera prywatny warsztat) | OK |
| 4.3 | Usunięcie zdalnej gałęzi | Czeka na zgodę WM | NIE WYKONANO (decyzja WM) |
| 4.4 | Skan historii jak w CI | Dziś: 3 hard (`denied_path` + 2x `denylist_hash`), wszystkie wyłącznie w `ae7875a` i `429f8d9`, osiągalnych tylko z `origin/feat/design-system-2-0`. Po usunięciu gałęzi oczekiwane 0 hard - do potwierdzenia po kroku 4.3 | UWAGI |

## Przegląd tego, co jest publiczne na GitHubie (`matematicsolutions/patron`)

| # | Punkt | Wynik | Werdykt |
|---|---|---|---|
| G.1 | Publiczny `main` vs prywatny | Identyczne (`40cea92`), 0/0. Gałąź audytu nie jest publiczna | OK |
| G.2 | CI publiczne | Cotygodniowy `publication-gate` 2026-10-05: success; CodeQL, CI: success | OK |
| G.3 | **Naprawa pamięci osierocona na gałęziach publicznych** | `claude/zen-pascal-f32559` (PR #58, otwarty od 2026-09-09, CONFLICTING) i `claude/bold-jennings-9d003b`: limit paczki embeddera (ADR-0153, test `embeddings.batch.test.ts`) i kolejka indeksacji z limitem równoległości (ADR-0154/0156). Na `main`, na gałęzi audytu i na żadnej innej: 2-7% linii. Na `main` brak ADR 0153-0156 w ogóle; `embeddings.ts` od tamtej pory niezmieniony. Propozycja niżej (P4) | **BLOKADA** |
| G.4 | Alerty CodeQL | 24 otwarte (23 high), najstarszy 2026-05-20: m.in. `js/clear-text-logging` (tool-dispatch.ts x3, documents.ts, chat.ts), `js/path-injection` (storage.ts x2, folders.ts, documentIngest.ts), `js/tainted-format-string` (x5), `js/redos` (cytaty_pl.ts), `js/insecure-helmet-configuration`. Bez triage | UWAGI |
| G.5 | Secret scanning | Wyłączony na repo publicznym (API: „Secret scanning is disabled”) | UWAGI |
| G.6 | Higiena PR i gałęzi | PR #59 otwarty, a jego treść jest na `main` (0 commitów unikalnych). `feat/mutation-approval-cards` porzucona od 2026-06-29. PR #54 od zewnętrznego kontrybutora bez odpowiedzi od 2026-08-26. 8 PR Dependabota otwartych, najstarsze od 2026-08-24 | UWAGI |
| G.7 | Konwencja commitów gałęzi audytu | 52/52 bez polskich znaków, 52/52 z `Co-Authored-By`. Inaczej niż na `main`: autor `Claude <noreply@anthropic.com>` (na `main` konto WM) i stopka `Claude-Session: <URL sesji>` (na `main` 0 wystąpień). Przy scaleniu przez merge commit obie trafią do publicznej historii | UWAGI |

## Rozjazdy z deklaracjami sesji chmurowej

- **R1** - backend „zielony”: na Windows 1 plik pada na limicie `beforeAll` w pełnej suicie. Naprawione (`hookTimeout` 30 s).
- **R2** - runner audytu „7 czerwonych”: na Windows 13; 6 to nieprzenośny harness. Naprawione w 4 plikach testów.
- **R3** - selftesty bramek „OK / OK”: na Windows 3 + 1 błędy. Naprawione.
- **R4** - sondy pre-push „7 z 7”: na Windows wywrotka na S4; kod wyjścia sond nie niósł werdyktu. Naprawione.
- **R5** - „zdarzenie RODO zweryfikowane”: `rodo-delete.ts` nie działa na SQLite; zielone są testy ze shimem.
- **R6** - `smoke:surfaces` deklarowany jako pomiar modelu z `PATRON_SMOKE_MODEL`: tabular mierzył model z profilu. Naprawione w skrypcie (zweryfikowane sondą z tymi samymi wywołaniami, bez ponownego pełnego przebiegu smoke).

## Poprawki wniesione tą weryfikacją (drobne, w narzędziach pomiaru)

- `backend/src/lib/chat/tool-result-masking.test.ts` - `beforeAll` z limitem 30 s.
- `backend/audit-2609/{R-TI-01,C-05,A-22,D-12}*.test.ts` - junction zamiast symlinku na Windows, `npx` przez powłokę, `tsx` przez `node` + `cli.mjs`, `import()` przez `pathToFileURL`, sprzątanie po wyjściu procesu.
- `scripts/publication_gate_selftest.py`, `scripts/pre_push_gate_selftest.py` - zdjęcie atrybutu tylko-do-odczytu przed `unlink`; nazwy niemożliwe na NTFS commitowane przez indeks (`core.protectNTFS=false` tylko w sztucznym repo testu).
- `backend/audit-2609/sondy/probe_pre_push.py`, `probe_pushurl.py` - to samo + kod wyjścia z werdyktu.
- `backend/scripts/smoke-surfaces.ts` - model tabular przez profil; przerwana powierzchnia w mianowniku.

Kod produktu: bez zmian.

## Propozycje (bez wdrożenia)

> **Stan po tej samej sesji (2026-10-06, decyzja WM „masz zielone”):** P1, P2 i P3 wdrożone na `audyt/2026-09` z testami (commity `2f90a9b`, `164e158`, `37bb4bd`); dodatkowo `rodo:delete` na SQLite (`3e48661`) i komunikat błędu czatu sprawy (`51f5c15`). P1 sprawdzona na spakowanej aplikacji na izolowanym profilu: e2e 7/7, zero naruszeń CSP na czacie, sprawach, przeglądach, konektorach, kartach, audycie i podglądzie DOCX/PDF; profil roboczy nietknięty (sha256 przed i po). P4 i scalenie `fix/kurs-aies-fala1` - osobne gałęzie po scaleniu tej (uwagi sesji chmurowej). Opisy poniżej zostają jako zapis stanu z chwili weryfikacji.

**P1 - A-21, CSP egzekwowana.** Przed przełączeniem dopisać origin API do `connect-src`, inaczej front traci backend:

```diff
--- a/frontend/next.config.ts
+++ b/frontend/next.config.ts
@@
     async headers() {
+        const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").origin;
         const csp = [
@@
-            "connect-src 'self'",
+            `connect-src 'self' ${apiOrigin}`,
@@
-                    { key: "Content-Security-Policy-Report-Only", value: csp },
+                    { key: "Content-Security-Policy", value: csp },
```

Do sprawdzenia przed wdrożeniem: konsola spakowanego Electronu na profilu, który NIE jest roboczy (zob. P2), przejście po czacie, tabular, podglądzie PDF/DOCX i eksporcie. `script-src 'unsafe-inline' 'unsafe-eval'` zostaje osobnym długiem.

**P2 - e2e na naprawdę czystym profilu.** `desktop/main.js` przed `app.whenReady()`: gdy ustawione `PATRON_USER_DATA_DIR` i `!app.isPackaged || process.env.PATRON_E2E === "1"`, wywołać `app.setPath("userData", ...)`; `e2e-smoke.cjs` ustawia obie zmienne na katalog tymczasowy i po starcie sprawdza, że baza powstała właśnie tam (kontrola pozytywna). Do tego czasu e2e i każda sonda spakowanej aplikacji piszą do profilu roboczego maszyny.

**P3 - B-08 jednym kliknięciem.** W panelu konektorów przycisk „Zatwierdź” przy konektorze `human_review`, pokazujący zastrzeżenia bramki i zapisujący `gatewayApproval` (hash + origin) do nakładki Operatora przez istniejący zapis pickera, z wpisem do `audit_log`.

**P4 - przenieść naprawę pamięci z PR #58** na prywatną linię (port, rozwiązanie konfliktu z CHANGELOG, numery ADR 0153-0156 są wolne na `main`), potem zamknąć PR #58 i usunąć obie gałęzie publiczne.

## Decyzje WM

1. Projekt zmiany Art. 5 Konstytucji ([PROJEKT_KONSTYTUCJA_ART5_2026-10.md](./PROJEKT_KONSTYTUCJA_ART5_2026-10.md)) - akceptacja i ponowny podpis.
2. A-02 - osobny projekt; nowy zestaw ewaluacyjny od kogoś innego niż autor poprawki (zestawy 2-5 spalone). Uwaga z kroku 3: część pracy jest już na gałęzi kursu.
3. Merge `audyt/2026-09` do `main` - i sposób: squash (autor WM, bez `Claude-Session`) czy merge commit (52 commity z autorem „Claude” i URL sesji w publicznej historii).
4. Usunięcie zdalnej `feat/design-system-2-0` (archiwum gotowe i zweryfikowane).
5. A-11 - test na żywym API OpenAI (płatne).
6. Publiczne repo: włączenie secret scanning i push protection; triage 24 alertów CodeQL; zamknięcie PR #59; odpowiedź na PR #54; porządek w PR Dependabota.
7. P1-P4.
