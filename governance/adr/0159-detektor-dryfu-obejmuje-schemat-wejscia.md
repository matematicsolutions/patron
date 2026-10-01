# ADR-0159 - Detektor dryfu bramy MCP obejmuje schemat wejscia; wersjonowany baseline i jednorazowa migracja

- **Status:** Proponowany (kod gotowy, testy + mutanty, E2E na zywym starcie)
- **Data:** 2026-09-30
- **Galaz:** na galezi ADR-0158 (wymaga jego sciezki zatwierdzenia), linia publiczna
- **Rozszerza:** [ADR-0025](./0025-mcp-security-gateway-wdrazenie.md) (detektor dryfu),
  [ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md) (baseline przy starcie)
- **Mapuje na:** ADR-0033 (propagacja do audytu), ADR-0142 (kanonikalizacja),
  ADR-0158 (hash zatwierdzenia Operatora - ta sama formula; tam zgloszone jako "poza zakresem")

## Kontekst

Detektor dryfu (ADR-0025) liczy SHA256 z nazwy serwera oraz nazw i opisow narzedzi i
porownuje go z baseline w `~/.patron/mcp-drift-baseline.json`. `inputSchema` do hasha nie
wchodzi. Konektor - takze bundlowany konektor Ring 1 - moze wiec dopisac narzedziu parametr
wejscia (np. `token`), a dryf milczy. Model zaczyna wysylac do narzedzia pole, ktorego przy
ustalaniu baseline nie bylo, i nikt tego nie zatwierdzal.

ADR-0158 wyszedl na to samo z drugiej strony: hash zatwierdzenia Operatora musial objac
`inputSchema`, bo inaczej zatwierdzenie przepuszczaloby dopisany parametr. Jego test pokazuje
oba hashe obok siebie i zapisuje luke wprost: detektor dryfu tego nie widzi.

Sama zmiana formuly jest prosta. Trudne jest to, ze baseline trzyma hashe starej formuly.
Gdyby zamienic formule bez migracji, po aktualizacji KAZDY konektor mialby przy pierwszym
starcie `drift/high`, czyli `human_review` = blokade. Na `main` nie ma sciezki decyzji dla
`human_review` (dochodzi dopiero z ADR-0158), wiec aktualizacja wylaczylaby wszystkie
konektory do recznego skasowania pliku baseline.

## Decyzja

**1. Formula v2 = pelna definicja narzedzi.** `computeDefinitionHash` liczy `canonicalSha256`
(ADR-0142 - jedna kanonikalizacja w projekcie) z
`{ server: nazwa, tools: [{ name, description, inputSchema }] }`, narzedzia sortowane po nazwie,
brak opisu = `""`, brak schematu = `null`. To bajt w bajt formula `computeApprovalHash` z
ADR-0158. Adres i komenda konektora do hasha nie wchodza (URL moze niesc klucz). Kolejnosc
narzedzi przestaje byc dryfem - nie niesie znaczenia.

**2. Wpisy baseline sa wersjonowane.** Nowe wpisy maja postac `v2:<64 hex>`. Goly 64-hex to
wpis v1 sprzed tej decyzji. Ksztalt pliku sie nie zmienia (dalej `nazwa -> string`), wiec
`loadBaseline` / `saveBaseline` i `lib/mcp/index.ts` zostaja bez zmian: `currentHash` w wyniku
skanu jest od teraz gotowym wpisem baseline.

**3. Jednorazowa migracja v1 -> v2, sprawdzona starym hashem.** Dla wpisu v1 detektor liczy
hash STARA formula (zachowana jako `computeLegacyDefinitionHash`, bit w bit, separator NUL):

- zgodny - nazwy i opisy sie nie zmienily; wynik to finding `drift/low` z komunikatem
  "Migracja baseline v1->v2", akcja `audit` (narzedzia rejestrowane), a baseline zapisuje
  wpis v2. Finding `low` przy akcji `audit` idzie istniejaca droga do lancucha audytu
  (`mcp_security.gateway`, ADR-0033) - migracja zostawia slad per konektor (zapis
  fire-and-forget, jak kazda decyzja bramy: porazka zapisu nie blokuje startu);
- niezgodny - to prawdziwy dryf nazw lub opisow; `drift/high` jak dotad. Migracja formuly
  NIE polyka zmiany, ktora zbiegla sie w czasie z aktualizacja.

**4. Wpis w nieznanym formacie = `drift/high` (fail-closed).** Dotyczy m.in. `v3:...` z
przyszlej wersji, uszkodzonego hex, pustego napisu i wielkich liter.

**5. Bez nowego `event_type`.** Migracja to zwykly finding detektora `drift` w istniejacym
zdarzeniu - pieciu luster whitelisty nie ruszamy.

## Rozwazone alternatywy

- **Twarda zamiana formuly.** Kazdy konektor zablokowany po aktualizacji - odrzucone (patrz
  Kontekst).
- **Cichy re-baseline wszystkiego przy pierwszym starcie.** Tanio, ale polyka prawdziwy dryf
  nazw i opisow z okna aktualizacji i nie zostawia sladu - odrzucone.
- **Dwa hashe w pliku (obiekt `{ v1, v2 }` per konektor).** Zmienia ksztalt pliku i typy
  `loadBaseline`, a nie daje nic ponad prefiks wersji - odrzucone.
- **Dryf importuje `computeApprovalHash` z ADR-0158.** Odwrotny kierunek jest czystszy:
  detektor dryfu jest starszy i ogolniejszy (dotyczy kazdego konektora przy kazdym starcie),
  zatwierdzenie to jeden z jego konsumentow - wiec to zatwierdzenie deleguje do dryfu.

## Polaczenie z ADR-0158

Ta zmiana stoi na ADR-0158, bo bez jego sciezki zatwierdzenia kazdy `human_review` (a zmiana
schematu jest teraz dryfem) bylby blokada do recznej edycji pliku baseline.

1. `computeApprovalHash` deleguje do `computeDefinitionHash` - jedna formula; zatwierdzenie i
   baseline v2 pokazuja ten sam hash. Wartosc hasha zatwierdzenia jest przypieta testem do
   wyniku kodu ADR-0158 sprzed delegacji: zatwierdzenia juz wpisane w `mcp-servers.json` dalej
   pasuja.
2. Test ADR-0158 "dopisany parametr wejscia ... czego NIE widzi hash detektora dryfu" po
   nalozeniu tej zmiany zaczerwienil sie sam (sprawdzone) - asercja odwrocona: dryf widzi
   dopisany parametr. Komentarz w `operator-approval.ts` i akapit 2 ADR-0158 poprawione.
3. `lib/mcp/index.ts` bez zmian. Konektor zatwierdzony przez Operatora zapisuje
   `result.currentHash`, czyli wpis v2 - nastepny start jest czysty (E2E, faza 6).

## Weryfikacja

- `mcp-security.test.ts`: 10 nowych testow - dopisany parametr zmienia hash v2 (a v1 nie);
  niezaleznosc od kolejnosci narzedzi i adresu; formula v1 przypieta do wartosci policzonej
  ORYGINALNYM kodem; baseline v2 + dopisany parametr = `high`/`human_review`; wpis wersjonowany;
  migracja zgodnego v1 = `low`/`audit` i cisza na drugim starcie; v1 + zmieniony opis = `high`;
  v1 + zmieniony tylko schemat = `low` (znane ograniczenie, ponizej); nieznany format = `high`;
  parser wpisow. Istniejace testy przestawione na wpisy `v2:`.
- Cztery celowe mutanty, kazdy czerwony z wlasciwego powodu: hash v2 bez `inputSchema`
  (2 testy), separator v1 spacja zamiast NUL (3), migracja bez porownania starego hasha (2),
  nieznany format przepuszczony (1).
- Piaty mutant: `computeApprovalHash` na formule v1 - 3 testy czerwone (w tym przypieta wartosc).
- E2E na zywym starcie (`getMcpTools`, baza SQLite i baseline w katalogu tymczasowym, prawdziwy
  plik baseline nietkniety - hash przed i po ten sam):
  1. kopia realnego baseline v1 + 7 bundlowanych konektorow Node z instalatora 1.3.0 - kazdy
     dostaje `drift/low` "Migracja baseline v1->v2", akcje `audit`, narzedzia zarejestrowane,
     7 zdarzen w audycie, plik baseline przepisany na `v2:`;
  2. drugi start - zero findingow, zero nowych zdarzen;
  3. atrapa serwera MCP - pierwszy load (`low`, `audit`);
  4. atrapa dopisuje parametr `token` - `drift/high`, `human_review`, narzedzia NIE
     zarejestrowane, log podaje hash do zatwierdzenia, audyt `approval=missing`;
  5. hash z logu wpisany jako `gatewayApproval` - `approved`, rejestracja, wpis baseline atrapy
     = hash zatwierdzenia;
  6. kolejny start - dryf czysty.
  Lancuch audytu bazy testowej przeliczony od nowa produkcyjnym `computeAuditHash`: spojny.

## Znalezione przy weryfikacji: rozwidlenie lancucha audytu

Pierwszy przebieg E2E dal lancuch audytu z rozwidleniem: siedem zdarzen z jednego startu mialo
ten sam `prev_hash`. Przyczyna nie lezy w tej zmianie, tylko w `appendAuditEvent`: rownolegle
wywolania (fire-and-forget bramy MCP per konektor, rownolegle wywolania narzedzi w ring-policy)
czytaly ten sam ostatni hash. Komentarz obiecywal, ze wyscig wylapie `hash unique`, ale hash
obejmuje `ts` i payload, wiec ogniwa o wspolnym poprzedniku maja rozne hashe - kolizji nie ma.
Rozwidlenia tego typu wystepuja tez na realnej instalacji, przy rownoleglych wywolaniach
narzedzi. Migracja z tej decyzji wywolalaby je u kazdego aktualizujacego.

Naprawa w tej samej linii prac (osobny commit): zapisy audytu w obrebie procesu ida przez
kolejke, test 7 rownoleglych zapisow (czerwony przed naprawa, zielony po). Drugi przebieg E2E:
lancuch spojny. Poza zakresem, do osobnej decyzji: straznik na poziomie bazy dla wielu procesow
(tryb serwerowy), weryfikator lancucha dla SQLite (`scripts/verify-audit-chain.ts` obsluguje
tylko Supabase) oraz sposob traktowania rozwidlen juz zapisanych w istniejacych bazach.

## Konsekwencje i ryzyko

- **Okno zaufania przy migracji (TOFU dla schematow).** Wpis v1 nie zawieral schematu, wiec
  zmiany `inputSchema` wprowadzonej MIEDZY ostatnim startem na starej wersji a pierwszym na
  nowej nie da sie wykryc - migracja ustala schemat jako baseline. Okno jest jednorazowe i
  kazdy konektor dostaje w audycie wpis o migracji. Test to dokumentuje.
- **Powrot do starszej wersji PATRONa.** Starszy kod widzi wpis `v2:...` jako inny hash, czyli
  `drift/high` dla kazdego konektora. Downgrade wymaga skasowania pliku baseline.
- **Wiecej `human_review` przy aktualizacji konektorow.** Zmiana samego schematu (takze
  kosmetyczna, np. opis wlasciwosci) jest teraz dryfem. Dotyczy tez konektorow Ring 1
  aktualizowanych razem z instalatorem. To zamierzone; Operator rozstrzyga przez
  `gatewayApproval` (ADR-0158) po przegladzie findings.
