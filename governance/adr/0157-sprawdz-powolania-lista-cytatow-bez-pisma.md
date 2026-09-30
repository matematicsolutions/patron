# ADR-0157 - "Sprawdz powolania": do weryfikatora idzie lista cytatow, nie pismo

- **Status:** Proponowany (kod gotowy; blocker bramy MCP rozwiazany opcja A w [ADR-0158](./0158-zatwierdzenie-human-review-bramy-mcp-przez-operatora.md); E2E na zywym Repertorium - po stronie Operatora)
- **Data:** 2026-09-30
- **Galaz:** od `main` (linia publiczna)
- **Mapuje na:** ADR-0005 (grounding cytatow), ADR-0027 (privilege rings), ADR-0028 (brama
  bezpieczenstwa MCP przy starcie), ADR-0133 (wybor konektorow), ADR-0146 (grounding cytatow MCP),
  Konstytucja Art. 1 i Art. 5 (tajemnica zawodowa), Art. 6 (czlowiek w petli)

## Kontekst

Prawnik chce sprawdzic, czy sygnatury i przepisy powolane w pismie istnieja i sa aktualne:
czy orzeczenie o tej sygnaturze jest w korpusie i ma te date, czy artykul jest w tekscie
jednolitym, czy przepis zmieniono po dacie zdarzenia. Korpus z osia nowelizacji i grafem
cytowan ma zewnetrzny serwer MCP Repertorium (narzedzie `verify_citations`). Samo pismo
niesie dane klienta i jest objete tajemnica zawodowa - nie moze opuscic komputera
kancelarii (Konstytucja Art. 1/5; w tym samym kierunku zasady etyki adwokackiej o
narzedziach AI i przewodnik techniczny CCBE z 2026 r. dla danych poufnych).

Narzedzie ma dwa tryby: `text` (cale pismo) i `citations` (lista cytatow wyciagnietych
u klienta, pozycja `{type, signature|act_id+article, date_in_text?, ref?}`, `ref` wraca 1:1).
Tryb listy istnieje wlasnie po to, zeby oprogramowanie kancelarii nie wysylalo pisma.

## Decyzja

**1. Ekstrakcja lokalnie, kopia ekstraktora z jednym domem.** `backend/src/lib/citation-check/
cytaty_pl.ts` to kopia 1:1 pliku `src/cytaty_pl.ts` z Repertorium (plik bez zaleznosci,
jawny z zalozenia - przewaga to korpus, nie wzorce). Obok przypiety `cytaty_pl.sha256`.
Test dryfu: (a) zawsze - sha kopii (LF) == przypiety; (b) gdy repozytorium Repertorium jest
obok (albo `REPERTORIUM_DIR`) - przypiety == biezacy w domu. Repertorium jest prywatne, wiec
w CI poziom (b) jest pomijany Z NAZWANYM powodem. Aktualizacja kopii = swiadomy commit pliku
i sha razem.

**2. Wysylamy biala liste pol, budowana od zera.** `buildVerifyItems` sklada kazda pozycje z
czterech pol: typ, sygnatura albo akt+artykul, data przy sygnaturze, `ref`. `ref` to
nieprzezroczyste `c1..cN` - NIE offset (offset mowilby cos o ukladzie pisma). Ustawa spoza
listy ekstraktora (`akt_nierozpoznany`) nie wychodzi - jej nazwa to tekst z pisma - i dostaje
lokalny stan "nierozpoznana, nie wyslano". Wyciek resztkowy, nazwany: sam ZBIOR powolan
(jakie przepisy i orzeczenia pismo cytuje) oraz `as_of`, jesli prawnik go poda.

**3. Offset zna tylko PATRON.** Wynik laczymy z lokalna lista po `ref`; podswietlenie idzie po
offsetach w TYM tekscie, ktory wyciagnela ta sama sciezka co grounding
(`getDocumentTextForGrounding`: biezaca wersja, PDF/DOCX, bramka input-security, odwrot do
OCR dla skanow). Dlatego widok pokazuje tekst wyciagniety przez PATRON, a nie render PDF -
offsety w renderze bylyby zgadywaniem. Zakres podswietlenia przepisu konczy sie na nowym
wierszu z wielka litera (okno ekstraktora ma do 160 znakow i celowo nie tnie na koncu linii).

**4. Wysylka jest widoczna.** Odpowiedz trasy niesie `sent` - dokladnie te tablice, ktore
poszly do konektora - a widok pokazuje je na zadanie i w raporcie. Obietnica "pismo nie
wychodzi" jest sprawdzalna na ekranie, nie deklaracja. Test bajtowy pilnuje, ze w argumentach
wywolania nie ma zadnego 10-znakowego fragmentu pisma spoza cytatow (z kontrola pozytywna).

**5. Nic nie wychodzi bez klikniecia.** Widok otwiera sie z polem daty i przyciskiem
"Sprawdz"; kazde sprawdzenie zjada limit wyszukiwan tokenu. Partie po 25 (limit narzedzia),
najwyzej 4 wywolania na pismo; nadwyzka ma stan `not_sent`, nie ginie.

**6. Stany uczciwe.** `not_in_corpus` jest kolorem "uwagi", nie bledu, z nota na ekranie i w
raporcie: brak w korpusie nie dowodzi, ze orzeczenie nie istnieje. Zgodna sygnatura z
niezgodna data schodzi z zielonego. Nieznany status serwera jest pokazany wprost. Brak
konektora = `not_configured` z lokalnie wyciagnietymi powolaniami ("wyciagnieto, NIE
sprawdzono"), nigdy cisza. Wywolanie nieudane albo odmowa limitu = `failed`/`partial`.

**7. Repertorium jako Ring 2, nie Ring 1.** To serwis zdalny (HTTP), nie konektor bundlowany
w instalatorze, wiec NIE trafia do `APPROVED_PATRON_CONNECTORS` ani do szesciu luster nazw.
Operator dopisuje go w lokalnym `mcp-servers.json` (`gatewayApproval` wpisuje PO przegladzie
findings bramy - hash podaje log pierwszego startu, ADR-0158):

```json
{
  "name": "repertorium",
  "transport": "http",
  "url": "<adres konektora z kluczem - tylko w lokalnym pliku>",
  "trustLevel": "untrusted",
  "operatorApproved": true,
  "approvedAt": "RRRR-MM-DD",
  "approvedBy": "<operator>",
  "gatewayApproval": { "hash": "<hash z logu startu>", "approvedAt": "RRRR-MM-DD", "approvedBy": "<operator>" }
}
```

Nazwe serwera zmienia `PATRON_CITATION_VERIFIER_SERVER` (domyslnie `repertorium`). Kazde
wywolanie przechodzi ring-policy i zostawia `ring_policy.decision` w lancuchu audytu (ADR-0027)
- bez nowego `event_type`. Trasa sama nie loguje tresci pisma, ALE reuzyta sciezka odczytu
(`readDocumentContent`, wspolna z czatem) wypisuje do lokalnego logu backendu pierwsze 120
znakow tekstu. Log nie wychodzi z komputera, lecz to fragment pisma w pliku, ktorego prawnik
sie nie spodziewa - naprawa tej linii to osobna zmiana (dotyka sciezki czatu).

**8. Raport lokalny.** HTML skladany w przegladarce (Blob), bez skryptow i zasobow
zewnetrznych, kazdy napis z pisma i z serwera escapowany; niesie fragmenty powolan (nie cale
pismo), stany, noty i dokladna liste wyslanych pozycji.

## Blocker (rozwiazany w ADR-0158): brama bezpieczenstwa MCP dawala Repertorium `human_review`

Zmierzone 2026-09-30 na definicjach narzedzi z `origin/main` Repertorium przez
`scanMcpRegistry`: **`human_review`, ryzyko 18.** Poza oczekiwanymi `typosquat/low`
(3rd-party) i `drift/low` (pierwszy load) sa cztery `tool-poisoning/medium`: opisy
`search_law`, `get_document`, `get_citations` i `verify_citations` wymieniaja nazwy pol
WYNIKU (np. `possible_typo_of`, `zywotnosc`), a detektor "schema mismatch" porownuje je
wylacznie z `inputSchema`. `human_review` blokuje rejestracje, a brama NIE MA dzis sciezki
zatwierdzenia przez operatora - `operatorApproved` dziala tylko w ring-policy (runtime), nie
przy starcie. Skutek: przy obecnym kodzie "Sprawdz powolania" zawsze pokaze `not_configured`.

Poluzowanie bramy bezpieczenstwa to decyzja wlasciciela produktu, nie tej zmiany. Opcje:

- **A. Zatwierdzenie `human_review` przez operatora przypiete do hasha definicji** (ADR-0028
  rozszerzony): operator akceptuje konkretny `currentHash`; kazda zmiana opisow (drift) wraca
  do przegladu. Zgodne z Art. 6 - `human_review` znaczy "czlowiek decyduje", a dzis czlowiek
  nie ma jak zdecydowac. Najmniejsza zmiana, ogolna dla kazdego konektora 3rd-party.
- **B. Detektor uwzglednia `outputSchema`**: nazwa pola zadeklarowana w schemacie wyniku nie
  jest niezgodnoscia. Wymaga, zeby Repertorium deklarowalo `outputSchema` z polami (dzis
  `additionalProperties: true`) - zmiana w dwoch repozytoriach.
- **C. Repertorium przepisuje opisy** bez nazw pol wyniku w postaci identyfikatorow.
  Najtansze technicznie, ale opisy traca informacje, z ktorej korzysta model.

Rekomendacja: A (jedna zmiana w PATRONIE, rozwiazuje klase problemu, a nie jeden przypadek).
**Wybrana A** (decyzja wlasciciela produktu 2026-09-30) - [ADR-0158](./0158-zatwierdzenie-human-review-bramy-mcp-przez-operatora.md).

## Czego ta decyzja NIE robi

- Nie ocenia, czy teza pisma zgadza sie z orzeczeniem (to `get_document` + osad czlowieka).
- Nie obejmuje aktow UE ani sygnatur TSUE/ETPC (poza zakresem ekstraktora).
- Tryb serwerowy: "komputer kancelarii" znaczy tam "infrastruktura kancelarii" - backend
  czyta pismo na serwerze kancelarii, na zewnatrz idzie ta sama lista.
- Podglad starszej wersji pisma nie ma przycisku - trasa czyta wersje biezaca.
