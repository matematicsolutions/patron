# ADR-0071: Hardening egress - allowlist Electron openExternal + zakaz cichego pobierania modelu

**Status**: Wdrozony 2026-05-29 (oba LIVE). Konstytucja v1.4.4.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 2 (zero-cloud), Art. 5 (ochrona danych),
RODO art. 44 (transfer poza EOG)
**Powiazane**: ADR-0067 (egress router - ten sam wzorzec opt-in: ALLOW_US_PROVIDERS),
ADR-0054 (embedder lokalny), ADR-0062 (Electron tryb local)

## Kontekst

Krytyk audytu FAZA 0 (poza 9 lanes, elevated) wskazal dwa niekontrolowane wektory egress:

- **Electron `shell.openExternal` bez walidacji schematu** (desktop/main.js): `setWindowOpenHandler`
  wolal `openExternal(url)` dla DOWOLNEGO url. Model przez prompt injection (tresc dokumentu lub
  odpowiedz) moze wstawic link `file://` / `javascript:` / inny - klik otwiera dowolny handler OS.
  Lancuch E2E (renderer -> openExternal -> handler systemowy).
- **Cichy download modelu embeddingow** (embeddings.ts): `multilingual-e5-small` byl pobierany z
  HF Hub (CDN w US) przy pierwszym uzyciu. Ukryty egress przy 1. starcie na czystej maszynie -
  metadane (IP / User-Agent / timestamp) wychodza poza EOG bez podstawy, lamiac zero-cloud.

## Decyzja

### openExternal - allowlist schematow + blokada nawigacji
`setWindowOpenHandler` waliduje `new URL(url).protocol` PRZED `openExternal`. Dozwolone tylko
`https:` / `http:` / `mailto:`; reszta (file/javascript/data/...) i niepoprawny URL -> log + brak
akcji. Dodatkowo `will-navigate` blokuje nawigacje glownego okna poza `localhost`/`127.0.0.1`
(renderer nie da sie przekierowac na zewnetrzny origin). Defense-in-depth nad istniejacym
contextIsolation + nodeIntegration:false.

### Embedder - fail-closed, pobieranie opt-in
`env.allowRemoteModels = PATRON_EMBED_ALLOW_DOWNLOAD === "true"` (default false). Domyslnie zero
zdalnych pobran wag modelu. Lokalny cache (`env.cacheDir`) i `PATRON_EMBED_MODELS_PATH`
(`env.localModelPath`) dzialaja dalej offline - instancje z juz zcache'owanym modelem bez zmian.
Jednorazowe pobranie to swiadoma zgoda Operatora (wzorzec ALLOW_US_PROVIDERS z ADR-0067). Gdy model
niedostepny lokalnie i pobieranie wylaczone - embedder rzuca, retrieval degraduje sie do BM25 +
grafu (fallback ADR-0007), aplikacja dziala.

## Konsekwencje

- Zamkniety lancuch E2E openExternal - klik w zlosliwy link nie otworzy handlera OS spoza http/mailto.
- Brak cichego transferu poza EOG przy 1. starcie - zero-cloud egzekwowane domyslnie (Art. 2, RODO 44).
- Spojny wzorzec opt-in dla wszystkich egress (US providerzy, download modelu) - swiadoma decyzja
  Operatora, nigdy domyslnie.

## Ograniczenia / dlug (FAZA 1)

- Pre-bundling modelu e5-small do obrazu/instalatora (zeby retrieval wektorowy dzialal od razu bez
  pobierania) = osobne zadanie pakowania. Do czasu: Operator bundluje model albo wlacza download raz.
- desktop/main.js bez testow automatycznych (proces Electron) - fix zweryfikowany przegladem kodu;
  wzorzec standardowy (allowlist schematu + will-navigate).

## Status weryfikacji

- Backend `tsc --noEmit` clean, 787 testow pass bez regresji (env.allowRemoteModels nie psuje
  testow retrievalu - cache/mocki).
- desktop/main.js: zmiana w jednym handlerze + nowy guard will-navigate. Commit chirurgiczny.
