# ADR-0104: Pilot-01 - menu Edytuj (wklejanie) + Bielik jako model lokalny

- **Status:** Zaakceptowany (pilot-driven). Branch `feat/tier-governance-envelope`, NIESCALONY do `main` (bramka: 2x review WM).
- **Data:** 2026-06-05
- **Kontekst pilota:** Pilot-01-Rumpole (pierwsza instalacja PATRON poza maszyna MateMatic, kancelaria karna „Rumpole & Loophole" (adw. H. Rumpole)).

## Kontekst

Dwa defekty wykryte na zywo podczas instalacji pilotowej:

1. **Brak menu "Edytuj" w Electron.** `desktop/main.js` budowal minimalne menu bez rol schowka. W Electronie akcje edycyjne (Ctrl+C/V/X/Z/A) sa podpiete przez role menu - bez nich skroty sa martwe, a prawy-klik nie daje "Wklej". Skutek krytyczny: **nie dalo sie wkleic klucza API** w Konto -> Modele (mecenas musial obejsc problem zmienna srodowiskowa `OPENROUTER_API_KEY` / `GEMINI_API_KEY`).

2. **Model lokalny zaszyty na sztywno jako `ollama/llama3.2:3b`.** 3B, slaby rejestr polski. Dla karnisty (tajemnica obroncza = najtwardsza kategoria, wymaga sciezki no-egress) potrzebny mocny polski model lokalny. `llama3.2:3b` nie nadaje sie do realnej pracy prawniczej PL.

## Decyzja

1. **Menu "Edytuj" + menu kontekstowe.** Do szablonu menu (`main.js`) dodano submenu `Edytuj` z rolami `undo/redo/cut/copy/paste/selectAll` oraz handler `webContents.on('context-menu')` budujacy menu prawego klawisza dla pol edytowalnych (wg `editFlags`). Polskie etykiety, akceleratory z domyslnych roli Electrona.

2. **Bielik jako model lokalny.** W pickerze (`frontend/.../ModelToggle.tsx`) wpis grupy `Lokalny` zmieniony z `ollama/llama3.2:3b` na `ollama/SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M` (etykieta "Bielik 11B (lokalny)"). **Backend bez zmian:** `stripOllamaPrefix` (ollama-provider.ts) zdejmuje prefiks `ollama/` i przekazuje natywna nazwe do Ollamy; `egress.ts` traktuje `ollama/*` jako `no-egress` (tajemnica zostaje na urzadzeniu).

## Konsekwencje

- (+) Wklejanie dziala - klucze API i teksty, mysza i Ctrl+V. Domyka glowne zrodlo frustracji pilota.
- (+) Lokalny model = Bielik 11B v2.3 Q4_K_M (polski-first, Apache 2.0, ~6.7 GB, no-egress). Benchmark MateMatic (Lenovo i7-1365U, CPU-only, slaby): **2.8 tok/s**, jakosc polszczyzny prawniczej solidna. Na CPU H-series (maszyna Beaty) szybciej.
- (+) To jest przewaga nad Libra: pelna tajemnica obroncza, zero internetu.
- (-) **Wymaga przebudowy instalatora + reinstalacji** (zmiany w buildzie, nie hot-patch).
- (-) Bielik musi byc pobrany lokalnie (`ollama pull SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M`). Gdy brak - "Lokalny" zwroci blad Ollamy. Przyszly ADR: komunikat w UI / asysta pobierania.
- (park) 7B fallback (szybszy) niewpiety w UI - dodac, jesli 11B za wolny na docelowym sprzecie.

## Bramki

ADR przed merge do `main`; 2x wewnetrzny review WM (AGENTS.md, Konstytucja Art. 7). Niescalony. Bez polskich znakow w commit message (konwencja repo).
