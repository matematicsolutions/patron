# Audyt kodu - PATRON (main, scalona linia) - 2026-08-18

**Scope:** cale repo `C:\Users\Wieslaw\PATRON-Desktop`, galaz `main` @ `229ef49` (linia rozwojowa
2.0 + scalony publiczny snapshot; pierwszy audyt tej linii przed pushem na publiczne
`matematicsolutions/patron` i przed planem 2.0.0). Skill: `audyt-kodu-25-wymiarow-pl`
(adaptacja XiNian-dada/Fuck_My_Shit_Mountain - struktura, nie kod). Audytor: agent, sesja
fd97d235. **Zero modyfikacji kodu w ramach audytu** (naprawy = osobne commity po decyzji WM).

**Stack wykryty:** Node 20+/TypeScript strict - Express backend (SQLite single-user via
better-sqlite3 + tryb Postgres/Supabase), Next.js frontend, Electron desktop (NSIS, electron-updater),
7 konektorow MCP Node (osobne repo MIT) + 10 konektorow Python (uv/py-runtime), pipeline
input-security / mcp-security / audit hash-chain + Merkle. Wagi podniesione (uzasadnienie:
LLM-facing backend + produkt regulowany + REPO PUBLICZNE): 2 Bezpieczenstwo, 13 Prywatnosc,
15 Supply chain, 8 Release, 17 AI safety, 12 Integralnosc danych, 5/19 Testy.

**Bramki uruchomione PRZED audytem (ten sam commit):** backend `tsc` OK, vitest **1444 pass / 0
fail / 5 todo** (106 plikow); frontend `tsc` OK, vitest 12/12, eslint 39 err / 69 warn
(= baseline z 07-2026, zero nowych); `smoke:desktop` PASS; spakowana apka `build:dir` +
`e2e:smoke` PASS; **`smoke:surfaces` 5/5 ok** (tabular 8/8 komorek z groundingiem 8/8,
workflows, generate_docx PK-valid, draft/refine 3 etapy, fakty zachowane);
`scripts/publication_gate.py .` -> **PASS (0 hard, 49 warn = publiczne sygnatury w ADR)**.

## Score dashboard (0.0-10.0 per wymiar, tylko wymiary uruchomione)

| # | Wymiar | Score | Coverage | Crit | High | Med | Low |
|---|---|---|---|---|---|---|---|
| 1 | Architektura | 8.0 | Medium | 0 | 0 | 0 | 1 |
| 2 | Bezpieczenstwo | 8.0 | High | 0 | 0 | 1 | 1 |
| 3 | Stabilnosc | 8.5 | Medium | 0 | 0 | 0 | 0 |
| 5 | Testy | 6.5 | High | 0 | 0 | 1 | 0 |
| 8 | Release | 6.0 | High | 0 | 1 | 1 | 0 |
| 9 | Dokumentacja | 7.0 | Medium | 0 | 0 | 1 | 1 |
| 11 | Konfiguracja | 7.5 | Medium | 0 | 0 | 1 | 0 |
| 12 | Integralnosc danych | 7.5 | Medium | 0 | 0 | 1 | 0 |
| 13 | Prywatnosc | 8.5 | High | 0 | 0 | 0 | 1 |
| 15 | Supply chain | 5.5 | High | 0 | 2 | 0 | 0 |
| 17 | AI safety | 7.0 | High | 0 | 1 | 0 | 0 |
| 18 | Fallback behavior | 8.5 | Medium | 0 | 0 | 0 | 0 |
| 19 | Autentycznosc testow | 8.0 | Medium | 0 | 0 | 0 | 0 |
| 20 | Type safety | 7.5 | Low | 0 | 0 | 0 | 1 |
| 4,6,7,10,14,16,21,22,23,24,25 | - | n/a | **Not assessed** | - | - | - | - |

**Overall (srednia wazona uruchomionych): 7.4 / 10.** Werdykt: **gotowy do pushu na publiczne
repo po 2 poprawkach S (sekcja "Przed pushem")**; pozostale = plan 2.0.0.

## Top ryzyka (Confirmed przed Suspected)

1. **[High/Confirmed] Supply chain: runtime desktop na podatnym `electron-updater` 6.8.9 i `electron` 35.7.5** - 1.1.0 wlasnie WLACZYLO auto-update; audit wskazuje w electron-updater "cross-origin redirect leaks PRIVATE-TOKEN" i "uncontrolled search path", w Electron 3x high (fix 43.4.0 = skok o 8 major). Naprawa dostepna, ale to zmiana ryzykowna przed 1.09 - do planu 2.0.0 z osobnym przebiegiem e2e.
2. **[High/Confirmed] AI safety: cytaty z konektorow MCP omijaja kaskade groundingu** (`stream.ts` - `groundCitationsByRef` liczy tylko `<CITATIONS>` z dokumentow kancelarii; `mcp_citations` ida osobno bez werdyktu). Zmierzone 08-17: blockquote "doslowny cytat KIS" - 0/4 zdan w zrodle, UI milczy. Wymaga ADR (juz na liscie 2.0.0 jako #1).
3. **[High/Confirmed] Release: instalatory NIEPODPISANE** (`"sign": null`, 9/9 NotSigned) - SmartScreen na kazdej instalacji; code signing = decyzja zakupowa WM (koszyk B).
4. **[Medium/Confirmed] Konfiguracja/Prywatnosc repo: `.claude/settings.json` sledzone w publicznym repo z hookami uruchamiajacymi `code-review-graph` i sciezka `C:/Users/Wieslaw/PATRON-Desktop`** - kazdy klon dostaje hook z cudza sciezka bezwzgledna (Claude Code pyta o zgode na hooki projektu, ale to smiec i wyciek srodowiska). Naprawa S.
5. **[Medium/Confirmed] Testy: frontend 111 komponentow `.tsx` vs 3 pliki testow (12 testow)** - powierzchnie demo (tabular UI, approvals inbox) bez testow jednostkowych; pokrycie e2e tylko "wstaje".

## Coverage matrix

| Obszar | Coverage | Jak |
|---|---|---|
| Sekrety w drzewie git (761 tracked) | High | grep wzorcow kluczy (sk-/AIza/ghp_/xox/AKIA/JWT), literalne password/secret/token, `.env*` sledzone (tylko `.example`, bez wartosci) - **0 trafien** |
| PII / dane klienta / sciezki lokalne | High | grep nazwisk ze scruba (0), maili prywatnych (0), PESEL-podobnych (0 poza komentarzem maski), sciezek `Users/Wieslaw` (**4 pliki skryptow + settings.json + 3 ADR**) |
| Kotwice dowodowe (eval/exec/shell/SQL-concat/pickle) | High | 0 x eval/new Function; `shell:true` 2x w `desktop/main.js` (tylko galaz dev, stale argumenty); OCR `spawn` bez shell, argv z env template; SQL sklejany: 0; pusty `catch {}` w backend/src: 0 (multiline grep) |
| Zaleznosci (npm audit) | High | backend 0C/13H/4M/1L (transformers/onnxruntime/sharp bez fixa, adm-zip); frontend 0C/13H (xmldom, brace-expansion - fix dostepny); desktop **1C** (tar via electron-builder - build-time) /18H (electron, electron-updater - fix dostepny) |
| CI | Medium | ci.yml, codeql.yml, publication-gate.yml, eval.yml, code-review-graph.yml; dependabot 3 ekosystemy |
| Migracje / schemat dualny | Medium | SQLite = migrate.sqlite.test (rebuild CHECK z zachowaniem hash-chain); pg `schema.sql` whitelist ~21 wartosci vs literaly sqlite 51 (nie 1:1 porownanie - roznica to inne literaly, NIE zmierzono parytetu whitelist automatycznie) |
| Powierzchnie produktu | High | smoke:surfaces 5/5, smoke:desktop, e2e spakowanej apki |
| a11y, wydajnosc, concurrency, observability, koszt, dependency weight, spojnosc, frontend state, backend API design | **Not assessed** | poza budzetem tej rundy; wagi niskie dla celu (push publiczny) |

## Szczegolowe findings

### Wymiar 15 - Supply chain

### [High] Runtime desktop na podatnym electron-updater 6.8.9 / electron 35.7.5
- **Wymiar:** 15 - Supply chain (+8 Release)
- **Lokalizacja:** `desktop/package.json` (deps), `npm audit` w `desktop/`
- **Confidence:** Confirmed
- **Dowod:**
  ```
  high electron | <=40.10.2 | fix: electron 43.4.0
  high builder-util-runtime | via electron-updater: Cross-origin redirect leaks PRIVATE-TOKEN | fix dostepny
  high app-builder-lib | via electron-updater: Uncontrolled search path elements | fix dostepny
  zainstalowane: electron 35.7.5, electron-updater 6.8.9, electron-builder 25.1.8
  ```
- **Scenariusz awarii:** kanal auto-update (od 1.1.0 aktywny per edycja) na podatnym updaterze; przy przekierowaniu cross-origin token moglby wyciec (u nas feed = publiczny GitHub bez tokena - ekspozycja ograniczona, ale nie zerowa); electron 35 = brak lat poprawek Chromium.
- **Impact:** kazda instalacja 1.1.0.
- **Naprawa (minimalna):** `electron-updater` -> najnowsza 6.x z fixem; `electron-builder` 26.x (usuwa tez critical `tar` build-time); Electron bump do LTS-owego majora **z pelnym e2e + smoke:surfaces**, nie na tydzien przed demo.
- **Test regresyjny:** `npm audit --omit=dev` w desktop = 0 high; e2e:smoke PASS.
- **Wysilek:** M (updater/builder) / L (electron major)
- **Status:** Open

### [High] Critical `tar` w toolchainie buildu (electron-builder 25)
- **Wymiar:** 15 - Supply chain
- **Lokalizacja:** `desktop/` devDependencies -> `@electron/rebuild` -> `node-gyp` -> `tar <=7.5.20`
- **Confidence:** Confirmed
- **Dowod:** `critical tar | node-tar Arbitrary File Overwrite via Hardlink | fix: electron-builder 26.15.3`
- **Scenariusz awarii:** zlosliwy tarball w lancuchu buildu na maszynie buildujacej (nie u klienta).
- **Impact:** maszyna WM/CI. **Naprawa:** razem z poprzednim (electron-builder 26). **Wysilek:** M. **Status:** Open

### Wymiar 17 - AI safety

### [High] Cytaty z konektorow MCP bez kaskady groundingu w odpowiedzi czatu
- **Wymiar:** 17 - AI safety (+2)
- **Lokalizacja:** `backend/src/lib/chat/stream.ts:580-620`
- **Confidence:** Confirmed (pomiar 08-17)
- **Dowod:**
  ```ts
  const grounding = await groundCitationsByRef(citations, docStore, docIndex, db, {...});   // tylko <CITATIONS>
  ...
  if (mcpCitations.length > 0) { write(`data: ${JSON.stringify({ type: "mcp_citations", citations: mcpCitations })}`) }  // bez werdyktu
  ```
- **Scenariusz awarii:** model podaje blockquote jako doslowny cytat interpretacji KIS; sygnatura/data prawdziwe, tekst nie wystepuje w zrodle (0/4 zdan, string-match na pelnym dokumencie z API) - UI pokazuje karty zrodel, zero ostrzezenia.
- **Impact:** kazde uzycie SAOS/NSA/EUREKA/EU w czacie; sprzeczne z haslem produktu.
- **Naprawa (minimalna):** ADR: `mcp_citations` z `snippet`/`text` przechodza przez `groundCascade` (istnieje `citation/cascade.ts` + judge lokalny) -> `verdict` green/yellow/red na karcie MCP; brak tekstu zrodla = `yellow` ("nie zweryfikowano"), nigdy cicho.
- **Test regresyjny:** e2e z fixture: odpowiedz z niedoslownym cytatem -> verdict red w SSE. **Wysilek:** M. **Status:** Open (plan 2.0.0 #1)

### Wymiar 8 - Release

### [High] Instalatory niepodpisane (SmartScreen)
- **Wymiar:** 8 - Release; **Lokalizacja:** `desktop/package.json` `build.win.sign: null`; `Get-AuthenticodeSignature` 9/9 NotSigned (08-17)
- **Confidence:** Confirmed. **Scenariusz:** kazda instalacja u klienta = "Windows protected your PC". **Naprawa:** cert OV/EV + `PATRON_CODE_SIGNING=on` (sciezka w `build-locale.cjs` istnieje, sha512 przeliczany po podpisie). **Wysilek:** S kod / decyzja zakupowa. **Status:** Open (koszyk B, WM)

### [Medium] Skrypty release z twardymi sciezkami maszyny WM
- **Wymiar:** 8 - Release / 11 - Konfiguracja
- **Lokalizacja:** `backend/scripts/eval-judge-pl.ts:13,33`, `scripts/run-eval.cjs:27`, `desktop/assets/make_icon.py:110`
- **Confidence:** Confirmed
- **Dowod:** `"C:/Users/Wieslaw/Projects/legal-eval-harness/judge-pl/corpus-pl.json"` jako default; `"C:/Users/Wieslaw/patron/desktop/assets/icon.ico"` (sciezka juz nieistniejaca)
- **Scenariusz:** kontrybutor odpala `run-eval` / `make_icon` -> ENOENT bez czytelnego komunikatu; wyciek struktury dysku dewelopera do publicznego repo.
- **Naprawa:** env `PATRON_EVAL_CORPUS` (fail-loud gdy brak) i sciezka relatywna do `__dirname` w make_icon. **Wysilek:** S. **Status:** Open

### Wymiar 11 - Konfiguracja (+13 Prywatnosc)

### [Medium] `.claude/settings.json` sledzone w publicznym repo z hookami i sciezka absolutna
- **Wymiar:** 11 - Konfiguracja / 13 - Prywatnosc
- **Lokalizacja:** `.claude/settings.json:12,24`
- **Confidence:** Confirmed
- **Dowod:**
  ```json
  "command": "... code-review-graph update --skip-flows --repo \"C:/Users/Wieslaw/PATRON-Desktop\" || true"
  "command": "... code-review-graph status --repo \"C:/Users/Wieslaw/PATRON-Desktop\" || ..."
  ```
- **Scenariusz:** kazdy klon publicznego repo niesie hooki PostToolUse/SessionStart z obca sciezka; u kontrybutora bez `code-review-graph` = szum przy kazdej sesji Claude Code; wyciek sciezki srodowiska.
- **Naprawa (minimalna):** przeniesc do `.claude/settings.local.json` (gitignored) albo usunac `--repo` (narzedzie wykrywa cwd) i zostawic hooki jako opt-in w dokumentacji. **Wysilek:** S. **Status:** Open - **PRZED PUSHEM**

### Wymiar 5 - Testy

### [Medium] Frontend: 111 komponentow, 3 pliki testow
- **Wymiar:** 5 - Testy; **Lokalizacja:** `frontend/src/**` (`git ls-files` tsx=111, `*.test.*`=3)
- **Confidence:** Confirmed. **Scenariusz:** regresja UI tabular/approvals niewykryta do e2e recznego. **Naprawa:** testing-library na 5 powierzchniach demo (ChatView, TR panel, approvals inbox, connector picker, workflow modal). **Wysilek:** M. **Status:** Open (2.0.0)

### Wymiar 12 - Integralnosc danych

### [Medium] Parytet whitelist `event_type` SQLite vs Postgres nie jest testowany automatycznie
- **Wymiar:** 12 - Integralnosc danych
- **Lokalizacja:** `backend/schema.sql` (whitelist CHECK, ~21 wartosci) vs `backend/src/lib/db/schema.sqlite.ts` + `migrate.sqlite.ts`
- **Confidence:** Suspected (nie zmierzono rozjazdu; zmierzono BRAK testu parytetu - `migrate.sqlite.test.ts` testuje rebuild, nie porownanie z pg)
- **Scenariusz:** nowy `event_type` dodany po jednej stronie (5 mirrorow wg AGENTS.md) -> CHECK violation w drugim trybie po cichu na produkcji.
- **Naprawa:** test jednostkowy: zbior wartosci z `schema.sql` == zbior z `schema.sqlite.ts` (parser regex). **Wysilek:** S. **Status:** Open

### Wymiar 9 - Dokumentacja

### [Medium] README EN vs AGENTS.md PL na publicznym repo; README nie wspomina o paczkach wiedzy i edycji demo
- **Wymiar:** 9; **Lokalizacja:** `README.md` (EN, 07-2026 + fakty 1.1.0), `AGENTS.md` (PL, reguly release 08-17)
- **Confidence:** Confirmed. **Naprawa:** AGENTS.md EN (bramka reviewer-en) albo dwujezyczny naglowek; sekcja "Knowledge packs" po decyzji o edycjach. **Wysilek:** M. **Status:** Open (2.0.0)

### [Low] 3 ADR-y z lokalna sciezka `Users/Wieslaw` w tresci
- **Wymiar:** 9/13; `spec/010`, `adr/0021`, `adr/0100`. Kosmetyka. **Wysilek:** S. **Status:** Open

### Wymiar 2 - Bezpieczenstwo

### [Medium] Zaleznosci frontend/backend z high bez fixa (transformers/onnxruntime/sharp, adm-zip) i z fixem (xmldom, brace-expansion)
- **Confidence:** Confirmed (npm audit). **Naprawa:** `npm audit fix` tam gdzie fix dostepny + test; embedder (transformers) = ADR-0071, ocena czy wersja z fixem istnieje. **Wysilek:** S/M. **Status:** Open

### [Low] `shell: true` w spawn backend/frontend (galaz dev `desktop/main.js:325,371`)
- Stale argumenty (`node dist/index.js`), brak wejscia uzytkownika - ryzyko teoretyczne; w paczce uzywana galaz `ELECTRON_RUN_AS_NODE` bez shell. **Naprawa:** usunac `shell:true` (niepotrzebne na win32 dla `node`). **Wysilek:** S.

### Wymiar 20 - Type safety
### [Low] 11 x `@typescript-eslint/no-explicit-any` we froncie (w baseline 39) - **Status:** Open (2.0.0)

### Wymiar 1 - Architektura
### [Low] Numeracja ADR wymaga rejestru - kolizje 0109/0110 (rozwiazane dzis -> 0144/0145) i 0141/0142 miedzy liniami pokazuja, ze `.matematic/releases/<wydanie>/README.md` "Rejestr wolnych numerow" nie byl uzywany na galeziach rownoleglych. **Naprawa:** bramka CI: duplikat prefiksu numeru w `governance/adr` = fail. **Wysilek:** S.

## Triage monotoniczny

- Weszlo: **14** findings. Obnizono: **1** (`shell:true` -> Low: dowod = stale argumenty, brak user input; kotwica "subprocess shell=True" dotyczy Pythona/`os.system` - tu Node z literalem, obnizenie dozwolone i uzasadnione). Odrzucono: **0**. Prob obnizenia zablokowanych kotwica: **0**.
- Findings pozytywne (nie sa findingami, ale sa dowodem coverage): sekrety 0, PII 0, `.env` niesledzone, publication-gate PASS, input-security + mcp-security + ring-policy + audit hash-chain obecne i testowane, RODO export/delete CLI, PII mask w audycie.

## Statystyki
Findings: 14 (Critical 0, High 4, Medium 6, Low 4). Confirmed 13, Suspected 1. Wymiarow uruchomionych 14/25.

## Przed pushem na publiczne (2 x S, bez ryzyka)
1. `.claude/settings.json` -> `.claude/settings.local.json` (gitignore) albo usunac `--repo` ze sciezka.
2. Sciezki `C:/Users/Wieslaw` w 4 skryptach -> env/relative (make_icon wskazuje nieistniejacy katalog).

## Do planu 2.0.0 (kolejnosc wg ryzyka)
1. Grounding cytatow MCP (ADR) - High. 2. electron-updater/builder bump + e2e - High. 3. Cert code signing - decyzja WM. 4. Test parytetu whitelist pg/sqlite - S. 5. Testy frontend 5 powierzchni - M. 6. `npm audit fix` z fixem + test. 7. AGENTS EN / README paczki. 8. Bramka duplikatow ADR w CI.

## Metadata
project=patron, scope=full-repo main@229ef49, overall=7.4, timestamp=2026-08-18T18:10:00+02:00
