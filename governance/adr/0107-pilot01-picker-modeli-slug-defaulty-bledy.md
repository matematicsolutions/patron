# ADR-0107: Pilot-01 - picker modeli (martwy slug, domyslne modele OpenRouter, dubel etykiet, surfacing bledu)

- **Status:** Zaakceptowany (pilot-driven). Branch `feat/tier-governance-envelope`, NIESCALONY do `main` (bramka: 2x review WM).
- **Data:** 2026-06-05
- **Kontekst pilota:** Pilot-01-Rumpole, runda 2. Po reinstalacji picker modeli sypal - klaster bugow "wybieram model a czesc nie dziala".

## Kontekst

Kilka defektow pickera modeli wykrytych na zywo (Rumpole na OpenRouter):

1. **Martwy slug:** kafelek "Gemini 3 Flash" mial `openrouter/google/gemini-3-flash` - slug NIE ISTNIEJE na OpenRouter. Poprawny: `google/gemini-3-flash-preview`. Kafelek byl martwy od poczatku.
2. **Domyslne modele backendu = Gemini-direct:** `DEFAULT_MAIN/TITLE/TABULAR_MODEL` (`models.ts`) byly `gemini-3-flash-preview` (direct, wymaga klucza Google). Czat na OpenRouterze dzialal, ale tytul czatu / przeglad tabelaryczny / fallback cicho padaly bez klucza Google.
3. **Dubel etykiet:** dwa wpisy "Claude Sonnet 4.6" (OpenRouter vs Anthropic-direct) z identyczna etykieta -> mecenas ladowal na wersji direct bez klucza -> "Stream error".
4. **"Stream error" maskowal realny powod:** staly string w `catch` (`chat.ts`) ukrywal DLACZEGO padlo (brak klucza, model not found, 401).
5. **Tabela zuzycia:** `overflow-hidden` ucinala dlugie wartosci.

**Technika weryfikacji (reuzywalna):** `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/models` = live katalog -> waliduj KAZDY slug OR z pickera.

## Decyzja

1. **Slug:** `google/gemini-3-flash` -> `google/gemini-3-flash-preview` (zwalidowany live call).
2. **Domyslne modele:** `DEFAULT_MAIN/TITLE/TABULAR_MODEL` -> `openrouter/google/gemini-3-flash-preview` (jeden klucz OR pokrywa czat+tytul+tabular+fallback). Frontend `DEFAULT_MODEL_ID` (`ModelToggle.tsx`) zsynchronizowany.
3. **Dubel etykiet:** modele direct oznaczone "(wlasny klucz Anthropic/Google/OpenAI)"; szerokosc triggera 104 -> 180px.
4. **Surfacing bledu (`chat.ts`):** `catch` zwraca `Blad generowania: <powod>` (240 znakow, infra-error nie PII) zamiast gluchego "Stream error".
5. **Tabela zuzycia:** `overflow-x-auto` + `break-all`.

## Konsekwencje

- (+) 4/4 kafelki samouczka odpowiadaja na domyslnym OpenRouter (test live runda 2). Modele Claude/Gemini przelaczaja sie poprawnie (potwierdzone na ekranie Beaty).
- (+) Realny powod bledu widoczny - koniec diagnozy "po omacku".
- (-) Domyslny model zalezy od klucza OpenRouter w env (`OPENROUTER_API_KEY`) - bez niego picker pokazuje modele, ale czat zwroci czytelny blad. Zgodne z bring-your-own-model (Konstytucja Art. 4).

## Bramki

ADR przed merge do `main`; 2x review WM. Zmiany wspolne z OCR/open-mode w jednym commicie rundy pilotowej.
