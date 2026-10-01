# ADR-0166 - Nakladka konfiguracji konektorow MCP poza katalogiem instalacji

- **Status:** Proponowany (kod gotowy, testy + mutanty; pelnej aktualizacji instalatora nie przebiegnieto)
- **Data:** 2026-10-01
- **Galaz:** od `main` (linia publiczna)
- **Mapuje na:** ADR-0133 (picker konektorow), ADR-0027 (privilege rings), ADR-0028 (brama
  przy starcie), ADR-0157 (weryfikator powolan jako konektor 3rd-party), ADR-0158
  (zatwierdzenie `human_review`)

## Kontekst

Konfiguracja konektorow MCP to `mcp-servers.json` w katalogu backendu. W instalacji desktop
to katalog instalacji (`resources/backend`), a plik generuje instalator
(`prepare-resources.cjs`, `writeMcpManifest`). Do tego samego pliku pisza:

- Operator - dopisujac konektor spoza instalatora (np. weryfikator powolan, ADR-0157) wraz z
  `operatorApproved` i `gatewayApproval` (ADR-0158);
- picker konektorow (ADR-0133) - przelaczajac `enabled`.

Zmierzone u zrodla 2026-10-01: instalator NSIS electron-buildera przy aktualizacji wywoluje
`uninstallOldVersion` (`templates/nsis/include/installUtil.nsh`), a szablon wprost zaklada, ze
katalog instalacji "will be deleted". Kazda aktualizacja PATRONa kasowala wiec wszystkie
ustawienia Operatora i pickera - po cichu, bez komunikatu. Weryfikator powolan przestawal
dzialac po pierwszym update, a wylaczone przez mecenasa konektory wlaczaly sie z powrotem.

## Decyzja

**1. Nakladka Operatora w katalogu uzytkownika.** `~/.patron/mcp-servers.operator.json`
(zmienna `PATRON_MCP_OPERATOR_CONFIG` zmienia sciezke) - obok baseline bramy
(`~/.patron/mcp-drift-baseline.json`), ktory aktualizacje juz przezywa. Ksztalt jak
`mcp-servers.json`: tablica wpisow z `name`.

**2. Scalanie przy odczycie (`readMergedConfig`).** Konektory instalatora w ich kolejnosci,
potem nowe z nakladki.

- Konektor z instalatora: z nakladki bierzemy TYLKO `enabled` i `gatewayApproval`.
  `command`, `args`, `url`, `operatorApproved` pochodza wylacznie z instalatora - nakladka nie
  podmieni konektora zaufanego na inny proces ani nie podniesie mu uprawnien. Inne pola sa
  ignorowane z ostrzezeniem w logu. `gatewayApproval` jest bezpieczne, bo przypiete do hasha
  definicji (ADR-0158) - po zmianie konektora w nowej wersji wraca do przegladu.
- Konektor spoza instalatora: caly wpis z nakladki. Nadal Ring 2: brama przy starcie i
  ring-policy (`operatorApproved`) przy kazdym wywolaniu.
- Wpis bez nazwy, bez `transport` albo powtorzony: pominiety z ostrzezeniem, nie po cichu.
  Uszkodzona nakladka nie zabiera konektorow instalatora (ostrzezenie, odczyt instalatora dziala).

**3. Picker pisze do nakladki.** `setConnectorEnabledInConfig` robi upsert `{name, enabled}` w
nakladce (atomowo, tmp+rename), zostawiajac inne pola wpisu. Uszkodzonej nakladki nie
nadpisuje - moze niesc wpis Operatora. Plik instalatora nie jest juz modyfikowany przez aplikacje.

**4. Bez zmian:** `getMcpTools`, brama bezpieczenstwa, ring-policy, kontrakt pickera
(`connectors.ts`) i format `mcp-servers.json` instalatora.

## Weryfikacja

- Testy czystego scalania, odczytu i zapisu na plikach tymczasowych; scenariusz "aktualizacja
  podmienia plik instalatora" (konektor z nakladki, jego zatwierdzenie i przelacznik pickera
  zostaja, a nowe `args` z instalatora wchodza); wpiecie przez `listConnectorConfigs` /
  `setConnectorEnabledInConfig` z kontrola, ze plik instalatora jest nietkniety.
- Mutanty czerwone: picker piszacy do pliku instalatora; nakladka podmieniajaca `command`.
- NIE przebiegnieto pelnej aktualizacji spakowanego instalatora (build + instalacja dwoch
  wersji) - to przebieg do zrobienia przy najblizszym wydaniu.

## Konsekwencje

- Przelaczniki pickera zapisane przed ta zmiana zyja jeszcze w pliku instalatora i zgina przy
  najblizszej aktualizacji (jednorazowo). Migracji nie robimy: aplikacja nie odroznia
  wartosci domyslnej instalatora od zmiany mecenasa.
- Instrukcja dodania weryfikatora powolan (ADR-0157 pkt 7) wskazuje teraz nakladke.
