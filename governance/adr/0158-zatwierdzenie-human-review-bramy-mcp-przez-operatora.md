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
cztery `tool-poisoning/medium` - opisy narzedzi wymieniaja pola wyniku (`possible_typo_of`,
`zywotnosc`...), a detektor "schema mismatch" porownuje je tylko z `inputSchema`. To falszywy
alarm, ale bez sciezki decyzji nie da sie go rozstrzygnac, a ten sam wzorzec trafi kazdy
konektor 3rd-party z bogatym opisem wyniku.

## Decyzja

**1. Operator zatwierdza konkretna definicje.** W nakladce Operatora
(`~/.patron/mcp-servers.operator.json`, [ADR-0166](./0166-nakladka-konfiguracji-mcp-poza-katalogiem-instalacji.md);
`mcp-servers.json` z katalogu instalacji ginie przy aktualizacji) konektor dostaje:

```json
"gatewayApproval": { "hash": "<64 hex>", "approvedAt": "RRRR-MM-DD", "approvedBy": "<operator>" }
```

Przy `human_review` brama porownuje `hash` z hashem biezacej definicji. Zgodny - narzedzia
rejestrowane (skutek `audit`). Brak albo niezgodny - blokada jak dotad, a log podaje hash
biezacej definicji i gotowy fragment do wpisania po przegladzie zastrzezen bramy.

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

- Operator moze zatwierdzac bez czytania zastrzezen. Ograniczenie: przypiecie do hasha (kazda
  zmiana narzedzi wymaga nowej decyzji), `denied` poza zasiegiem, slad w audycie z autorem.
- Zatwierdzenie zyje w lokalnym pliku konfiguracji, jak `operatorApproved` - kto moze pisac do
  tego pliku, i tak kontroluje liste konektorow.

## Poza zakresem (znalezione przy okazji)

- **Detektor dryfu nie widzi zmian `inputSchema`** (`computeDefinitionHash` hashuje tylko
  nazwy i opisy). Dotyczy tez konektorow Ring 1 - osobna zmiana. Rozwiazane w
  [ADR-0159](./0159-detektor-dryfu-obejmuje-schemat-wejscia.md).
- **Tryb bramy w banerze to nie tryb bramy w kodzie:** `MCP_SECURITY_GATEWAY_MODE` (domyslnie
  `off`) czyta tylko `routes/security.ts` do banera; `getMcpTools` egzekwuje zawsze. Rozwiazane w
  [ADR-0160](./0160-baner-mcp-security-pokazuje-tryb-egzekwowany.md).
- **Detektor "schema mismatch" nie zna `outputSchema`** - opcja B z ADR-0157, porzadek na pozniej.

## Aktualizacja 2026-10-06 - nieznany konektor = `human_review`, jedno zatwierdzenie wystarcza (audyt 2026-09 B-08)

**Decyzja wlasciciela produktu:** konektor spoza `APPROVED_PATRON_CONNECTORS` NIE jest
rejestrowany automatycznie. Do tej pory detektor typosquat dawal mu finding `low`, scorer
mapowal `low` na `audit`, a `getMcpTools` rejestrowal `audit` jak `allowed` - opisy i schematy
narzedzi niezatwierdzonego serwera trafialy do listy narzedzi modelu (takze chmurowego), choc
ring-policy odrzucala kazde wywolanie. Teraz finding "nieznany 3rd-party" ma wage `medium`,
wiec werdykt to `human_review`: blokada do zatwierdzenia Operatora. Konektory z listy
(instalator) i pierwsze ladowanie znanego konektora (baseline dryfu) - bez zmian.

**Zmiana pkt 6 (uproszczenie).** Zgodne `gatewayApproval` (hash definicji + odcisk
pochodzenia) dopuszcza tez wywolania narzedzi w Ring 2 (ring-policy, powod
`operator-gateway-approval`). Jedno swiadome zatwierdzenie zamiast dwoch, bo:

- dwa kroki zostawialy stan posredni "narzedzia u modelu, kazde wywolanie odrzucone" - dokladnie
  to, co opisal B-08;
- `gatewayApproval` jest mocniejsze niz `operatorApproved`: przypiete do definicji i pochodzenia,
  wiec kazda zmiana narzedzi, komendy albo hosta wraca do przegladu; nieznany konektor ma przy
  kazdym starcie werdykt `human_review`, wiec zgoda na wywolania jest zawsze przypieta do hasha.
  `operatorApproved` to boolean, ktory przezywa kazda zmiane definicji;
- flage ustawia WYLACZNIE brama po skanie w biezacym procesie (`gatewayApproved` w
  `decideRing`), nigdy plik - pole o tej nazwie w nakladce niczego nie daje (test).

`operatorApproved: true` dalej dziala (istniejace wpisy, np. Repertorium wg ADR-0157, nie
wymagaja zmian), ale samo w sobie nie rejestruje nieznanego konektora - brama wymaga
zatwierdzenia przypietego do hasha. Nazwa z listy wpisana nakladka (Ring 2, B-06) zachowuje
sie jak dotad: werdykt bez `human_review` (np. `audit` przy pierwszym ladowaniu) nadal wymaga
`operatorApproved` do wywolan.

**Jak zatwierdzic (Operator):**

1. Dopisz konektor w nakladce Operatora `~/.patron/mcp-servers.operator.json` (ADR-0166) i
   uruchom PATRON.
2. W dzienniku startu brama wypisuje `[MCP-SECURITY] Server "<nazwa>" BLOCKED action=human_review`,
   liste zastrzezen i gotowy fragment `"gatewayApproval": { "hash": "...", "origin": "...", ... }`.
   Ten sam hash i odcisk pokazuje widok "Sprawdz powolania", gdy chodzi o weryfikator (ADR-0157).
3. Po przejrzeniu zastrzezen wpisz ten fragment (z `approvedAt` / `approvedBy`) we wpisie
   konektora w nakladce i uruchom PATRON ponownie. To wszystko - `operatorApproved` nie jest
   potrzebne.

Widocznosc stanu: baner MCP Security (admin) pokazuje nowy konektor czekajacy na zatwierdzenie
jako oczekiwanie (spokojny ton), a nie alarm - pod warunkiem, ze poza "nieznany 3rd-party" brama
nie zglosila nic powyzej `low` i nie bylo zatwierdzenia innej definicji (`hash_mismatch` zostaje
alarmem). Picker konektorow pokazuje plakietke "Czeka na zatwierdzenie". Bez nowego `event_type`
i bez migracji: stan bierze sie z istniejacego `mcp_security.gateway` (`operator_approval.status`,
findings) i ze skanu w biezacym procesie.

## Aktualizacja 2026-10-06 - zatwierdzenie z panelu konektorow

Po B-08 kazdy nowy konektor spoza zaufanego zestawu czeka na Operatora, a jedyna droga
zatwierdzenia byla reczna edycja JSON nakladki z hashem przepisanym z dziennika startu.
Dla kancelarii po aktualizacji to brak wykonalnej sciezki. Dodane:

- `GET /connectors/:name/gateway` i `POST /connectors/:name/gateway-approval`, obie z
  `requireAuth` + `requireAdmin` (straznik strukturalny w `gateway-approval.test.ts`);
- serwer przyjmuje tylko `hash` i `origin` rowne biezacemu skanowi w procesie (skan
  uruchamiany na zadanie, gdy panel otwarto przed pierwszym czatem) - inaczej 409
  `stale_definition`; `denied` i konektor niczego nieoczekujacy - 409;
- decyzja do lancucha audytu PRZED zapisem nakladki, fail-closed: istniejacy
  `mcp_security.gateway` z `operator_approval.source = "operator_ui"`, `approval_origin` i
  `actor_user_id` Operatora - bez nowego `event_type`, piec luster bez zmian;
- zapis przez `operator-overlay.ts` (ta sama procedura co przelacznik pickera: atomowo,
  `.bak`, tryb pliku); zatwierdzenie wchodzi w zycie po restarcie, a pozniejszy dryf
  definicji albo pochodzenia znow blokuje (`resolveOperatorApproval` przy starcie).

Reczny wpis `gatewayApproval` dalej dziala - panel zapisuje dokladnie ten sam ksztalt.
