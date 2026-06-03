# ADR-0101: Swiadoma zgoda Operatora na model chmurowy dla spraw objetych tajemnica

**Status**: Zaproponowany 2026-06-03. **NIE merge bez 2x wewnetrznego review (WM) + aktualizacji Konstytucji** (Art. 2 - patrz Konsekwencje). Zweryfikowany na zywej binarce: sprawa oznaczona `attorney_client_privileged` + model chmurowy odpowiada bez blokady, bez zadnych flag w konsoli (zgoda wbudowana w `main.js`); decyzja egress trafia do audytu z reason `privileged-cloud-by-operator`.

**Data**: 2026-06-03

**Powiazane zasady** (Konstytucja AI Patrona):
- **Art. 2 - Tajemnica zawodowa / kontrola egresu**: dotad interpretowana jako TWARDY zakaz chmury dla tajemnicy (tylko model lokalny). Ten ADR zmienia interpretacje: w trybie desktop single-user adwokat JEST Operatorem na wlasnej maszynie, a jego wybor modelu chmurowego jest swiadoma zgoda na egress. Granica governance przesuwa sie z "blokady wyboru modelu" na "audyt + maskowanie PII + decyzja czlowieka". Wymaga zapisu w Konstytucji (sekcja podpisow / Art. 2).
- **Art. 3 - Audytowalnosc**: zgoda zdejmuje BLOKADE, nie AUDYT. Kazdy egress nadal laduje w hash-chain (event `llm_route`) z jawnym, odrebnym reason `privileged-cloud-by-operator` - audytor widzi, ze tajemnica zostala przetworzona w chmurze za zgoda Operatora.
- **Art. 4 - Neutralnosc wobec dostawcow**: zgoda dotyczy DOWOLNEGO modelu chmurowego (kazda strefa egress), nie faworyzuje zadnego dostawcy. "Kazdy model", nie tylko jeden.
- **Art. 7 - Minimalnosc / rzetelnosc**: PII jest maskowane przed wyslaniem (pipeline pseudonimizacji) niezaleznie od zgody - zgoda nie wylacza maskowania.

**Powiazane ADR**:
- **[ADR-0014](./0014-data-residency-router.md)** / straznik data-residency: `decideRoute` to czysta funkcja decyzyjna. Ten ADR dodaje wejscie `allowPrivilegedCloud` i galaz "tajemnica + zgoda -> allow".
- **[ADR-0067](./0067-egzekwowanie-egress-guard.md)** (egzekwowanie egress): punkt wpiecia (`guard.ts` / `enforceEgress.ts` -> czat i pipeline obrony) czyta zgode z env i przekazuje do `decideRoute`. Audyt `llm_route` bez zmian (nowy reason).
- **[ADR-0091](./0091-pakowanie-instalatora-desktop.md)** (pakowanie desktop): `main.js` ustawia zgode jako domyslna dla instalatora desktop (single-user); tryb serwerowy/fabryczny jej NIE ustawia (rygor domyslny).

---

## Kontekst

Twardy blok `decideRoute` (`attorney_client_privileged` -> tylko `no-egress`, kazda chmura = block `privileged-requires-local`, bez wyjatku - flaga `ALLOW_US_PROVIDERS` NIE odblokowywala tajemnicy) okazal sie w praktyce ZA OSTRY:

- Blokowal realna prace. Polscy prawnicy pracuja dzis na modelu chmurowym (Libra = Anthropic to glowne narzedzie), a wybor mecenasa to swiadoma, odpowiedzialna decyzja - nie naruszenie. Decyzja wlasciciela produktu (WM, 2026-06-03): "nie Libra - KAZDY model; Beata to odpowiedzialny adwokat, wie co robi; nie badzmy swietsi od papieza".
- Blokowal nawet demonstracje i testy na realnych sprawach (sprawa pilota domyslnie klasyfikowana `attorney_client_privileged`, fail-closed).
- Sprzeczny z faktem, ze to instalacja jednoosobowa na maszynie kancelarii: dane i tak sa na sprzecie Operatora, ktory sam decyduje o ich przetwarzaniu.

Reguly desktop single-user: gospodarzem danych jest adwokat-Operator; rola "Administrator" z Konstytucji i Operator to ta sama osoba.

## Decyzja

1. `decideRoute` przyjmuje opcjonalne `allowPrivilegedCloud` (default `false` = zachowanie dotychczasowe, fail-closed). Gdy `true` i klasyfikacja `attorney_client_privileged`:
   - `no-egress` -> allow `local-no-egress` (jak dotad);
   - dowolna strefa chmurowa (`eu-only`, `us-with-dpa`) -> allow `privileged-cloud-by-operator` (nowy, stabilny reason; NIE wymaga osobno `allowUsProviders` - zgoda na chmure dla tajemnicy jest najmocniejsza decyzja i obejmuje lokalizacje dostawcy).
   - Gdy `false` -> blok `privileged-requires-local` jak dotad.
   Klasyfikacje nizsze (`internal`, `client_general`, `public`) bez zmian (US nadal pod `allowUsProviders`).
2. `guard.ts`: `allowPrivilegedCloud()` czyta `process.env.PATRON_ALLOW_PRIVILEGED_CLOUD === "true"`; przekazane do `decideRoute`. `enforceEgress.ts` (czat + `/draft/refine`) dziedziczy przez `guardEgress`.
3. `desktop/main.js` (`backendLocalEnv`): ustawia `PATRON_ALLOW_PRIVILEGED_CLOUD` i `ALLOW_US_PROVIDERS` domyslnie `'true'` (z mozliwoscia nadpisania z env operatora). Tryb serwerowy/docker ich nie ustawia -> rygor domyslny.

## Konsekwencje

- **Pozytywne**: kazdy model dziala na kazdej sprawie w desktopie; demo i praca pilota bez tarcia; audyt daje pelny, jawny dowod (kto/kiedy/jakim modelem/jaka klasyfikacja/`privileged-cloud-by-operator`).
- **Do domkniecia (WARUNEK merge)**: aktualizacja **Konstytucji Art. 2** (zapis: tajemnica + chmura dozwolona za swiadoma zgoda Operatora w trybie single-user, z audytem i maskowaniem) - inaczej kod rozjedzie sie z dokumentem podpisywanym przez kancelarie. Rozwazyc widoczna w UI informacje "ta sprawa przetwarzana w chmurze za Twoja zgoda" + ewentualny przelacznik per-sprawa.
- **Rygor opcjonalny**: kancelaria moze przywrocic tryb "tajemnica tylko lokalnie" ustawiajac `PATRON_ALLOW_PRIVILEGED_CLOUD=false` (np. polityka wewnetrzna, sprawy szczegolnie wrazliwe).

## Bezpieczenstwo

- Zgoda NIE wylacza: hash-chain audytu (`llm_route` z reason), maskowania PII przed egressem, klasyfikacji sprawy, Gateway/ring-policy dla narzedzi MCP.
- Reason `privileged-cloud-by-operator` jest odrebny od `us-allowed-by-administrator` - audytor odroznia "chmura na danych nieobjetych tajemnica za zgoda Admina" od "chmura na tajemnicy za zgoda Operatora".

## Bramki (przed merge)

- [x] `decideRoute.test.ts` - 4 nowe przypadki (domyslnie blok / zgoda->kazdy model / lokalny zawsze / nizsze klasyfikacje nietkniete); routing testy zielone (22 pass).
- [x] tsc backend 0; testy zmienionych obszarow (routing, mcp, mcp-security, prompts, audit-merkle) zielone.
- [x] Weryfikacja na zywej binarce: privileged + chmura bez flag w konsoli = odpowiedz; audyt `privileged-cloud-by-operator`.
- [ ] 2x wewnetrzny review (WM).
- [ ] Aktualizacja Konstytucji Art. 2 (WARUNEK).
- [ ] Pelny `vitest run` + `next build` przed merge.
