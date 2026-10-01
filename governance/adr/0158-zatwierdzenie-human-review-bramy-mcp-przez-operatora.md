# ADR-0158 - Zatwierdzenie werdyktu `human_review` bramy MCP przez Operatora, przypiete do hasha definicji

- **Status:** Proponowany (kod gotowy, E2E na atrapie serwera MCP)
- **Data:** 2026-09-30
- **Galaz:** od `main` (linia publiczna)
- **Rozszerza:** [ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md) (brama przy starcie)
- **Mapuje na:** ADR-0025 (brama), ADR-0027 (privilege rings), ADR-0033 (propagacja do audytu),
  ADR-0142 (kanonikalizacja), ADR-0157 ("Sprawdz powolania" - tu wyszedl problem),
  Konstytucja Art. 6 (czlowiek w petli)

## Kontekst

Brama bezpieczenstwa MCP (ADR-0028) daje kazdemu konektorowi przy starcie jeden z werdyktow:
`allowed`, `audit`, `human_review`, `denied`. Dwa pierwsze rejestruja narzedzia, dwa ostatnie
blokuja. `human_review` znaczy z nazwy "czlowiek decyduje" - ale PATRON nie mial zadnej
sciezki tej decyzji. `operatorApproved` z ADR-0027 dziala tylko w ring-policy (per wywolanie),
nie przy starcie. W praktyce `human_review` dzialal jak `denied`.

Zmierzone 2026-09-30 (ADR-0157): konektor Repertorium dostaje `human_review` (ryzyko 18) za
cztery `tool-poisoning/medium` - opisy narzedzi wymieniaja pola WYNIKU (`possible_typo_of`,
`zywotnosc`...), a detektor "schema mismatch" porownuje je tylko z `inputSchema`. To falszywy
alarm, ale bez sciezki decyzji nie da sie go rozstrzygnac, a ten sam wzorzec trafi kazdy
konektor 3rd-party z bogatym opisem wyniku.

## Decyzja

**1. Operator zatwierdza KONKRETNA definicje.** W `mcp-servers.json` konektor dostaje:

```json
"gatewayApproval": { "hash": "<64 hex>", "approvedAt": "RRRR-MM-DD", "approvedBy": "<operator>" }
```

Przy `human_review` brama porownuje `hash` z hashem biezacej definicji. Zgodny - narzedzia
rejestrowane (skutek `audit`). Brak albo niezgodny - blokada jak dotad, a log podaje hash
biezacej definicji i gotowy fragment do wpisania po przegladzie findings.

**2. Hash zatwierdzenia obejmuje schematy wejscia.** `computeApprovalHash` liczy
`canonicalSha256` (ADR-0142) z nazwy serwera i pelnych definicji narzedzi: nazwa, opis,
`inputSchema`; narzedzia sortowane po nazwie. Bez schematu serwer moglby po zatwierdzeniu
dopisac narzedziu parametr (np. `token`) i zatwierdzenie by go przepuscilo. Pierwotnie byla to
osobna formula, bo hash detektora dryfu pomijal `inputSchema`; od
[ADR-0159](./0159-detektor-dryfu-obejmuje-schemat-wejscia.md) dryf liczy te sama formule, a
`computeApprovalHash` deleguje do `computeDefinitionHash` (wartosci hashy bez zmian - test
przypina je). Adres konektora do hasha nie wchodzi - moze niesc klucz dostepu.

**3. `denied` nie jest do zatwierdzenia.** Poziom krytyczny zostaje blokada bez wyjatkow, nawet
gdy w pliku wpisano poprawny hash. `allowed` i `audit` zatwierdzenia nie czytaja.

**4. Zatwierdzenie o zlym ksztalcie = brak** (fail-closed): hash nie-hex, zla dlugosc, wielkie
litery, brak pola.

**5. Slad w istniejacym zdarzeniu, bez nowego `event_type`.** `mcp_security.gateway` dostaje
opcjonalne `operator_approval: { status, gateway_action, approval_hash, approved_at?,
approved_by? }` przy kazdym werdykcie wymagajacym decyzji (`missing`, `approved`,
`hash_mismatch`, `not_overridable`). `action` w payloadzie to skutek (zatwierdzony = `audit`),
`gateway_action` - werdykt skanera. Bez decyzji payload ma ksztalt sprzed tej zmiany. Brak
nowego typu zdarzenia = brak zmian w pieciu lustrach whitelisty.

**6. Niezaleznie od ring-policy.** `gatewayApproval` (start: czy narzedzia w ogole wchodza) i
`operatorApproved` (wywolanie: czy Ring 2 moze byc wolany) to dwie decyzje. Konektor 3rd-party
z werdyktem `human_review` potrzebuje obu.

## Weryfikacja

- Testy czystej decyzji (10) i payloadu audytu (2); trzy celowe mutanty (brak porownania
  hasha, zatwierdzalny `denied`, hash bez `inputSchema`) - kazdy czerwony z wlasciwego powodu.
- E2E na lokalnej atrapie serwera MCP (stdio), pelna sciezka "Sprawdz powolania": bez
  zatwierdzenia - blokada + hash w logu; z tym hashem - rejestracja, ring-policy `allow`,
  wynik `ok`; po zmianie opisu narzedzia na serwerze - blokada `hash_mismatch`. Lancuch audytu
  (baza testowa) zapisal `missing` -> `approved` -> `hash_mismatch`.

## Konsekwencje i ryzyko

- Operator moze zatwierdzac bez czytania findings. Ograniczenie: przypiecie do hasha (kazda
  zmiana narzedzi wymaga nowej decyzji), `denied` poza zasiegiem, slad w audycie z autorem.
- Zatwierdzenie zyje w lokalnym pliku konfiguracji, jak `operatorApproved` - kto moze pisac do
  tego pliku, i tak kontroluje liste konektorow.

## Poza zakresem (znalezione przy okazji)

- **Detektor dryfu nie widzi zmian `inputSchema`** (`computeDefinitionHash` hashuje tylko
  nazwy i opisy). Dotyczy tez konektorow Ring 1 - osobna zmiana. Zalatwione w
  [ADR-0159](./0159-detektor-dryfu-obejmuje-schemat-wejscia.md).
- **Tryb bramy w banerze to nie tryb bramy w kodzie:** `MCP_SECURITY_GATEWAY_MODE` (domyslnie
  `off`) czyta tylko `routes/security.ts` do banera; `getMcpTools` egzekwuje zawsze. Zalatwione w
  [ADR-0160](./0160-baner-mcp-security-pokazuje-tryb-egzekwowany.md).
- **Detektor "schema mismatch" nie zna `outputSchema`** - opcja B z ADR-0157, porzadek na pozniej.
