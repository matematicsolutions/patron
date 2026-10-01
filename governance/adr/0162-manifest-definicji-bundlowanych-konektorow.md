# ADR-0162 - Manifest definicji konektorow wozonych przez instalator: aktualizacja nie blokuje, podmiana plikow tak

- **Status:** Proponowany (kod gotowy, testy + mutanty, E2E na zasobach instalatora 1.3.0)
- **Data:** 2026-10-01
- **Galaz:** na galezi ADR-0158/0159/0160, linia publiczna
- **Rozszerza:** [ADR-0159](./0159-detektor-dryfu-obejmuje-schemat-wejscia.md) (dryf z formula v2),
  [ADR-0028](./0028-wpiecie-mcp-security-gateway-w-startup.md) (brama przy starcie)
- **Mapuje na:** ADR-0100 / ADR-0136 (bundlowanie konektorow Node i Python), ADR-0158
  (zatwierdzenie Operatora), bramka artefaktu `desktop/scripts/connectors-gate.cjs`

## Kontekst

Detektor dryfu porownuje definicje narzedzi konektora z baseline z poprzedniego startu. Dla
konektora 3rd-party to wlasciwe pytanie: definicja zmienila sie bez wiedzy kancelarii. Dla
konektora, ktory wozi nasz instalator, pytanie jest zle postawione. Jego definicja zmienia sie
razem z wydaniem PATRONa, wiec pierwsza aktualizacja, ktora poprawia opis albo doklada parametr
narzedzia, daje kazdemu uzytkownikowi `drift/high`, czyli `human_review` = konektor zablokowany
do recznego zatwierdzenia (ADR-0158). Od ADR-0159 dryf widzi tez schematy, wiec taka zmiana jest
bardziej prawdopodobna.

Pomiar 2026-10-01: 7 konektorow Node zbudowanych z obecnych zrodel ma ten sam hash definicji co
w instalatorze 1.3.0. Dzis problemu nie ma - pojawi sie przy pierwszej zmianie narzedzi.

## Decyzja

**1. Build zapisuje manifest definicji.** `desktop/scripts/definition-manifest.cjs` uruchamia
kazdy konektor z `mcp-servers.json` paczki (takze wylaczone - uzytkownik moze je wlaczyc), pyta
o `tools/list` i zapisuje `bundled-definitions.json` (`{ version: 1, definitions: { nazwa: hash } }`).
Hash liczy `computeDefinitionHash` z `dist` stagowanego backendu - ta sama funkcja, ktorej brama
uzywa przy starcie, bez kopii formuly. Wpiete w `prepare-resources.cjs` zaraz po zapisie
`mcp-servers.json`.

**2. Fail-loud w buildzie.** Konektor, ktorego nie da sie uruchomic albo zapytac, przerywa
build; pusta lista konektorow tez. Czesciowego manifestu nie zapisujemy.

**3. Brama ufa definicji zgodnej z manifestem.** Przy starcie `getMcpTools` laduje manifest
(`PATRON_MCP_BUNDLED_DEFINITIONS_PATH` nadpisuje sciezke) do kontekstu skanu. Dla konektora z
wpisem w manifescie:
- definicja == manifest - pochodzi z naszego wydania; gdy baseline jest inny (aktualizacja,
  migracja v1, pierwszy start), finding `low` i baseline v2 przestawiony; gdy taki sam - cisza;
- definicja != manifest - pliki konektora zmieniono po instalacji; `drift/high` bez wzgledu na
  baseline. Operator rozstrzyga jak przy kazdym `human_review` (ADR-0158).
Konektor bez wpisu (3rd-party, dodany recznie) - zwykly dryf.

**4. Brak albo zly manifest nigdy nie poszerza zaufania.** Brak pliku (dev, tryb serwerowy),
nieznana wersja, zly JSON = pusta mapa = zwykly dryf. Wpis z hashem o zlym ksztalcie jest
pomijany.

**5. Bramka artefaktu pilnuje, ze manifest jedzie w paczce.** `connectors-gate.cjs` (uruchamiany
na spakowanej paczce w `build:<locale>` i w `e2e:smoke`) wymaga `bundled-definitions.json`, ktory
pokrywa w obie strony dokladnie konektory z `mcp-servers.json`. Bez tej kontroli paczka bez
manifestu "dzialalaby", a runtime po cichu wracalby do zwyklego dryfu i blokad po aktualizacji.

## Rozwazone alternatywy

- **Bramka wydania porownujaca hashe z poprzednim wydaniem.** Ostrzega budujacego, ale
  uzytkownik i tak dostaje blokade - samo ostrzezenie nie usuwa skutku.
- **Wylaczyc dryf dla konektorow Ring 1.** Traci wykrywanie podmiany plikow po instalacji, ktore
  manifest daje za darmo.
- **Zaufanie po samej nazwie i katalogu `mcp-bundled/`.** Nazwa i sciezka nie mowia nic o
  definicji; manifest wiaze zaufanie z konkretnym hashem.

## Weryfikacja

- Backend: 6 testow detektora (aktualizacja = `low`; ta sama zmiana bez manifestu = `high`;
  podmiana plikow = `high` mimo zgodnego baseline; cisza przy aktualnym baseline; `low` przy v1 i
  pierwszym starcie; konektor spoza manifestu = zwykly dryf) i 4 testy loadera.
- Mutanty, kazdy czerwony z wlasciwego powodu: podmiana przepuszczona; manifest ignorowany;
  loader przyjmujacy dowolna wersje pliku.
- Generator na zasobach instalatora 1.3.0 (`--hash-from` = backend z tej galezi): 20/20
  konektorow (7 Node + 13 Python z `py-runtime`); 7 hashy Node identycznych z wpisami baseline,
  ktore brama zapisala przy starcie. Negatywnie: zepsuty konektor i pusta lista - exit 1, bez pliku.
- Brama na zywo (7 konektorow 1.3.0, baza i baseline w katalogu tymczasowym): aktualizacja
  (baseline z "poprzedniego wydania") - `low`, konektor zarejestrowany; podmieniony manifest -
  `high`, blokada; ta sama aktualizacja bez manifestu - `high`, blokada.
- `connectors-gate.test.cjs`: 4 nowe znane-zle (brak pliku, brak wpisu, wpis obcy, zly format).
  Na prawdziwej paczce 1.3.0 bramka jest czerwona (brak manifestu), na tej samej paczce z
  wygenerowanym manifestem - zielona.

## Konsekwencje i ryzyko

- Manifest lezy w katalogu instalacji obok kodu konektorow. Kto moze pisac do tego katalogu,
  moze zmienic jedno i drugie - ale wtedy kontroluje tez sam kod bramy. Manifest nie obiecuje
  wiecej niz integralnosc instalacji wzgledem zmian w samych plikach konektora.
- Build trwa dluzej o uruchomienie kazdego konektora (sekundy na konektor) i wymaga, zeby kazdy
  wstawal przy `tools/list` na maszynie budujacej - dzis wstaje 20/20 (zmierzone z
  dostepem do sieci; build bez sieci nie byl sprawdzany).
- Pierwsza aktualizacja z 1.3.0 do wydania z manifestem: zgodne konektory dostaja jednorazowo
  `low` (baseline przestawiony), bez blokad.
