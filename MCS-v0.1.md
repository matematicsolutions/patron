# MateMatic Connector Standard (MCS) — v0.1

**Status:** v0.1 — otwarty standard (publiczny draft do recenzji i swobodnej implementacji)
**Cel:** spisać kontrakt cytowań, na którym praktycy już de facto budują, i uczynić z niego
standard de iure. **Publikujemy standard, nie tylko produkt.** PATRON jest jego
implementacją referencyjną.

## 1. Po co standard

Żeby konektor do dowolnego źródła prawa (orzeczenia, ustawy, rejestry, interpretacje)
wpinał się w warstwę weryfikacji cytatów PATRON-a i każdego zgodnego klienta **bez
przeróbek**. Jeden kontrakt cytowań = jedna warstwa zaufania = wymienne moduły wielu autorów.

## 2. Zakres

Standard definiuje: (a) kształt odpowiedzi narzędzia MCP zwracającego materiał prawny,
(b) semantykę znacznika wiarygodności (3 kolory), (c) test zgodności, (d) higienę i
bezpieczeństwo konektora. **Nie** narzuca języka implementacji ani modelu LLM.

## 3. Kontrakt cytowań (rdzeń)

Każde narzędzie MCP zwracające treść prawną **MUSI** dołączyć `structuredContent.citations`
(tablica). Każdy element:

| Pole | Wymagalność | Znaczenie |
|---|---|---|
| `source_id` | wymagane | stabilny identyfikator: sygnatura akt / ELI ustawy / numer KRS / ID interpretacji |
| `url` | wymagane jeśli istnieje | bezpośredni, działający odnośnik do źródła |
| `exact_quote` | wymagane | dosłowny fragment ze źródła, na którym oparta jest teza |
| `locator` | zalecane | strona / jednostka redakcyjna / paragraf / zakres znaków w bloku |
| `confidence` | wymagane | `verbatim` \| `paraphrase` \| `unverified` (sekcja 4) |
| `retrieved_at` | zalecane | znacznik czasu pobrania (świeżość) |

**Zasada twarda:** żadna teza prawna w odpowiedzi bez co najmniej jednego elementu
`citations`. Brak cytatu = `confidence: unverified`.

## 4. Gradient i znacznik 3-kolorowy (wyróżnik MCS)

Weryfikacja jest **trzypoziomowa, nie binarna**:

- 🟢 `verbatim` (ISTNIENIE + FRAGMENT) — cytat dosłownie obecny w źródle; sygnatura/akt istnieje.
- 🟡 `paraphrase` (ISTNIENIE + TREŚĆ) — źródło istnieje, ale to parafraza; wymaga sprawdzenia
  wierności tezy (ochrona przed „prawdziwy-cytat-fałszywa-teza").
- 🔴 `unverified` — brak potwierdzenia fragmentu w źródle; nie wypuszczać do pisma bez kontroli człowieka.

To odróżnia standard od samego „czy sygnatura istnieje" — sięga wierności parafrazy.

## 5. Test zgodności (conformance)

Konektor jest **MCS-compliant**, gdy przechodzi *citation roundtrip*: dla zapytania zwraca
`citations`, a każdy `exact_quote` da się odnaleźć w źródle wskazanym przez `url`/`source_id`
(string-match dla `verbatim`). Rekomendowany harness: lista zapytań kontrolnych
(`queries.yaml`) + automatyczny roundtrip. Implementacja referencyjna (PATRON) dostarcza
wzorcowy tester.

## 6. Higiena i bezpieczeństwo konektora (bramka)

- Ważny certyfikat SSL, bez wyłączania weryfikacji (`rejectUnauthorized:false` **zakazane**).
- Throttling zgodny z limitami źródła; timeout; czyste API zamiast scrapowania, gdy dostępne.
- Sanityzacja parametrów wejściowych (ID/sygnatury).
- Adnotacje read-only dla narzędzi tylko-odczyt.
- Shape-guard: gdy źródło zmieni strukturę i znikną pola, zwróć jasny komunikat „źródło
  zmieniło format", nie cichy pusty wynik.
- Brak sekretów/danych klienta w opisach narzędzi i instrukcjach (reguła zero-sekretów).

## 7. Licencja i atrybucja

Konektory referencyjne MateMatic: **MIT** (infrastruktura dla całego polskiego legaltechu).
Sam standard: otwarty do swobodnej implementacji. Niezależni praktycy budują już kompatybilne
konektory do źródeł prawa — autorom modułów należy się jawne uznanie autorstwa.

---

*MCS v0.1 jest częścią wydania open source PATRON (AGPL-3.0 powłoka + MIT konektory).
Referencyjna implementacja kontraktu cytowań: warstwa groundingu PATRON-a
(`backend/src/lib/citation/`, `backend/src/lib/chat/ground-citations.ts`).*
