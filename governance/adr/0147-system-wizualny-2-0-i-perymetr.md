# ADR-0147 — System wizualny 2.0: kroje dokumentowe, trojstan jako tokeny, perymetr na powierzchni

- **Status:** Zaproponowany (wdrozony czesciowo 2026-08-21, galaz `feat/design-system-2-0`)
- **Data:** 2026-08-21
- **Galaz:** `feat/design-system-2-0` (z `main`)
- **Zrodlo:** pomiar 9 konkurencyjnych interfejsow 2026-08-21 (`getComputedStyle` na zywych
  stronach produktowych, probka do 3000 elementow), nie hipoteza estetyczna
- **Mapuje na:** ADR-0146 (grounding cytatow MCP), ADR-0143 (bramka egress skilli),
  ADR-0101 (swiadoma zgoda Operatora), ADR-0132 (jeden jezyk per instalacja),
  Konstytucja Art. 1 i Art. 5

## Kontekst

### Kategoria zbiegla sie do jednego wygladu

Pomiar 2026-08-21 na Harvey, Legora, Hebbia, Wexler (+ Linear jako referencja rzemiosla)
pokazuje cztery cechy powtarzajace sie na KAZDYM produkcie swiatowej czolowki:

- cieply monochrom — nikt nie uzywa czystej czerni ani bieli (Harvey nazywa tokeny wprost:
  `--color-gray-950-ink`, `--color-gray-50-ivory`),
- waskie pasmo wag — nic powyzej 500; **Legora ma 543 z 543 elementow w wadze 400**,
- zero cieni — elewacja na wloskowatej kresce (Harvey: ani jednego realnego `box-shadow`),
- ujemny tracking, promienie 4-8 px.

Do tego wspolny sygnal statusu: **wlasny albo butikowy krój** (Harvey zamowil dwa kroje pod
siebie, Wexler kupil Reckless, Hebbia Selecte). Krój jest w tej kategorii dowodem budzetu.

Wniosek operacyjny: zrobienie "nowoczesnego, wyrafinowanego" wygladu wprost daje ekran
**nieodroznialny od Harveya**, a jednego z dwoch sygnalow statusu (wlasny krój) nie kupimy.

### Polska i srodkowoeuropejska stawka gra w innej lidze wizualnej

Ten sam pomiar na Libra (Wolters Kluwer, wdrozona w PL), Omnilexia (dystrybucja przez benefit
KIRP) i Beck-Noxtua (C.H.Beck + Noxtua, przed startem): Inter / Plus Jakarta Sans / DM Sans,
wagi do 900, cienie, promienie niespojne, akcenty nasycone. To zwykly, porzadny B2B SaaS.

**Na rynkach docelowych sam rejestr swiatowej czolowki jest juz wyroznikiem** — pod warunkiem,
ze dolozymy warstwe, ktorej nie powtorzy ani czolowka (nie ma tytulu), ani stawka lokalna
(nie gra na tym boisku).

### Stan Patrona przed zmiana

- `.dark` bylo **domyslka shadcn** (`oklch(0.145 0 0)`, chroma 0) — w dzien produkt pergaminowy,
  wieczorem inny produkt,
- `--color-azure: 0,136,255` (spadek po forku `mike`) na odsylaczach do zrodla — jaskrawy blekit
  w jedynym miejscu, gdzie oko szuka autorytetu,
- 143 linie CSS prawa USA (`.usc-section`, `.cfr-section`) — zero odwolan we froncie i backendzie,
- `cubic-bezier(0.34, 1.56, 0.64, 1)` na przyciskach — przeskok ponad wartosc docelowa czyta sie
  jako aplikacja konsumencka; cala zmierzona konkurencja uzywa wygaszania bez odbicia,
- rampa neutralna niemonotoniczna (`gray-900` zrownalo sie jasnoscia z `gray-950`).

### Governance siedzial w ustawieniach

Lancuch skrotow (ADR-0001), Merkle (ADR-0026), bramka egress (ADR-0143), gateway MCP
(ADR-0025/0028), karty zatwierdzen (ADR-0137) — **to jedyne rzeczy, ktorych nie ma zaden z
dziewieciu zmierzonych konkurentow**. Zyly pod `/admin/audit` i `/account/connectors`.

Osobno: `EgressConfigBanner` renderuje sie **tylko gdy jest zle**. Brak banera jest wiec
dwuznaczny — nie wiadomo, czy jest bezpiecznie, czy baner padl. To ten sam wzorzec awarii,
ktory w tym projekcie juz raz kosztowal: monitor obserwujacy sukces nie wykryje awarii.

## Decyzja

**1. Trzy kroje o rodowodzie dokumentowym.** Lato (interfejs), Bona Nova (display),
Brygada 1918 (dlugi tekst prawniczy). Wszystkie SIL OFL 1.1, wszystkie przez `next/font`
(pobierane przy buildzie, serwowane z wlasnego origin — zero zapytan w runtime, warunek
zero-cloud). Wszystkie z `latin` + `latin-ext`.

Os marki jest **globalna, nie narodowa**: skladamy prawo pismem zaprojektowanym do dokumentow,
nie do landing page'a. Polski rodowod (Brygada 1918 = krój Kancelarii Prezydenta RP od 2018;
Bona Nova = digitalizacja kroju Andrzeja Heidricha, tworcy polskich banknotow) jest **dowodem
lokalnym** na rynek PL, nie globalnym haslem — Patron celuje w Brazylie, USA i Europe.

**2. Trojstan groundingu jako tokeny systemu.** `--grounded` / `--unverified` / `--ungrounded`
plus warianty tla, w obu motywach, wystawione jako kolory Tailwinda. Semantyka werdyktu jest
**osobna skala i nie miesza sie z akcentem marki**. Zolty znaczy "nie potwierdzam" i nigdy nie
awansuje na zielony (ADR-0146).

**3. Pasek perymetru zawsze obecny.** `PerimeterBar` w `(pages)/layout`, pod cala aplikacja:
postawa egress, model, gateway MCP, decyzje z 24 h, liczba zablokowanych. Trojstan jak przy
cytacie — **brak odpowiedzi z `/api/config/egress` daje `unknown`, nie `local`**. Pasywny:
czyta stan, nie loguje wejscia i niczego nie zmienia.

**3a. Korekta 2026-08-24: postawa i plakietka opisuja STAN W UZYCIU, nie zawartosc env.**
Pierwsza wersja paska liczyla postawe wylacznie z flag egresu, a plakietke `(lokalny)` wieszala
na `local_model_configured` z `/api/config/egress`. To pole znaczy "gdzies w konfiguracji
ustawiono `PATRON_LOCAL_MODEL`", a NIE "model widoczny obok jest lokalny". Zmierzony efekt na
profilu demo: `Dane nie opuszczaja urzadzenia | MODEL openrouter/google/gemini-3-flash-preview
(lokalny)` — nazwa modelu chmurowego z USA opisana jako lokalna, obok zielonego zapewnienia
o danych. To ten sam mechanizm co przy OCR w ADR-0151: powierzchnia konczy sukcesem, a tresc
jest nieprawdziwa.

Obowiazuje od tej korekty:

- plakietka `(lokalny)` zalezy WYLACZNIE od wyswietlanego modelu (prefiks `ollama/`,
  `frontend/src/lib/modelEgress.ts` — lustro `backend/src/lib/routing/egress.ts`, pilnowane
  bramka o picker modeli). Fail-closed: model nierozpoznany nie jest lokalny;
- zielone `Dane nie opuszczaja urzadzenia` jest KONIUNKCJA: polityka egresu zamknieta **oraz**
  model w uzyciu lokalny. Zamknieta polityka przy modelu chmurowym to nowy stan
  `cloud-blocked` z wlasnym napisem (`perimeter.cloudBlocked`, "Chmura zablokowana - wybrany
  model nie jest lokalny") w barwie ostrzezenia — router zablokuje wyjscie, ale o danych nie
  obiecujemy niczego, czego nie widac. Cisza jest tu gorsza od ostrzezenia;
- otwarta flaga egresu daje `cloud` takze wtedy, gdy model glowny jest lokalny: model glowny
  to nie caly ruch (tytul czatu i przeglad tabelaryczny ida na `DEFAULT_TITLE_MODEL`).

Nowy klucz `perimeter.cloudBlocked` wchodzi do 7 slownikow z tym samym zastrzezeniem, co reszta
`perimeter.*` (patrz Koszty i ryzyka): tlumaczenie autora, do przeczytania przez prawnika rynku.

**Nierozstrzygniete (poza zakresem korekty).** Pasek stoi w `(pages)/layout`, czyli nie zna
sprawy, a `projects.cloud_consent` (ADR-0128) zdejmuje blokade chmury per sprawa niezaleznie od
flag env. W sprawie ze zgoda per-sprawa `local` moze wiec nadal byc zbyt mocnym zdaniem dla
ruchu pomocniczego. Wymaga osobnej decyzji: albo pasek staje sie swiadomy sprawy, albo
`/api/config/egress` przestaje byc jedynym zrodlem postawy.

`EgressConfigBanner` **zostaje**. Czesciowo dubluje pasek, ale to powierzchnia zgodnosciowa
(ADR-0101) i jej zdjecie ma byc osobna decyzja, nie efektem ubocznym refaktoru designu.

**4. Cieply tryb ciemny, uporzadkowane tokeny.** Grafit hue ~58 zamiast chromy 0; inkaust to
kosc sloniowa, nie biel; promienie `0.625rem` -> `0.375rem`; ruch bez odbicia
(`cubic-bezier(.2,0,0,1)`); rampa neutralna monotoniczna.

## Konsekwencje

**Pozytywne**

- Patron przestaje wygladac jak fork `mike` z podmieniona paleta, a zaczyna jak narzedzie
  kancelaryjne w rejestrze swiatowej czolowki — na rynkach docelowych to samo w sobie rozni.
- Jedyna realna przewaga produktu (aparat dowodowy) przestaje byc niewidoczna.
- Cisza przestaje byc informacja: pasek istnieje w kazdym stanie, wiec padniety endpoint nie
  udaje bezpieczenstwa.
- Przy okazji zamkniety realny wyciek: `global-error.tsx` ciagnal krój z zewnetrznego CDN
  **w runtime**, w produkcie zero-cloud, na ekranie awarii.

**Ustalenie z 2026-08-21 (po wdrozeniu) i jego ROZWIAZANIE tego samego dnia**

Pomiar po zmianie palety pokazal, ze punkt 4 tej decyzji byl **poprawny, ale martwy**:
klasa `.dark` nie byla w repo nigdzie zakladana (brak przelacznika), przemapowanie skali
neutralnej w `@theme` bylo statyczne, a kolory siedzialy na sztywno w komponentach
(`bg-white` w 68 plikach, `bg-gray-50/100` w 70, `border-gray-200` w 57).

Rekomendowalem wtedy wypisanie trybu ciemnego z zakresu przed demo, szacujac koszt na
migracje ~250 klas, ktorej nie wolno robic bez weryfikacji wizualnej.

**To oszacowanie bylo bledne** i zostalo obalone tego samego dnia. Zamiast migrowac klasy,
cala skala neutralna zostala przekierowana na zmienne `--n-*` przelaczajace sie z motywem
(`@theme inline`; bez `inline` Tailwind rozwiazuje wartosci statycznie i przelaczanie
przestaje dzialac). Kazde istniejace `bg-white` dziala wieczorem bez tykania komponentow.
Doszedl przelacznik system/jasny/ciemny z ustawieniem motywu przed pierwszym malowaniem.

Cena tego rozwiazania jest jedna i trzeba ja znac: **odcien bez mapowania po cichu spada
na domyslna palete Tailwinda**, zaprojektowana pod jasne tlo. Zdarzylo sie od razu -
`text-stone-800` dal w trybie ciemnym kontrast 1.57 przy braku jakiegokolwiek bledu.
Dlatego mapowane sa pelne rampy 5 rodzin x 11 odcieni, a bramka `theme-coverage.test.ts`
czyta zrodla komponentow i wywala sie na kazdym nieobslugonym odcieniu. Audyt kontrastu
na zywo: 6 kategorii ponizej progu 3.2 przed poprawka, 0 po.

**Koszty i ryzyka****Koszty i ryzyka**

- Zmiana kroju dotyka kazdego ekranu. Bramki maszynowe (tsc, build, 50/50 testow) nie mowia,
  ze **wyglada** dobrze — weryfikacja wizualna w dzialajacej aplikacji jest warunkiem wydania
  i na dzien ADR NIE zostala wykonana.
- Klucze `perimeter.*` w 7 slownikach sa tlumaczeniem maszynowym autora ADR. Terminologia
  fachowa (`mandatsgeschützte Sachen`, `segreto professionale`, `sigilo profissional`) wymaga
  czytania przez prawnika z danego rynku **przed** wejsciem na ten rynek.
- Dublowanie perymetru i banera egress jest swiadomym dlugiem do rozstrzygniecia.

## Alternatywy odrzucone

- **Zamowic wlasny krój, jak Harvey.** Odrzucone: nie przelicytujemy ich budzetem, a krój bez
  rodowodu nie niesie zadnego znaczenia poza "stac nas". Wygrywamy znaczeniem, nie cena.
- **Polskosc jako globalna os marki.** Odrzucone po korekcie zakresu rynkow: w São Paulo i
  Nowym Jorku Kancelaria Prezydenta RP nie jest argumentem. Rodowod zostaje dowodem lokalnym.
- **Zostawic tryb ciemny na domyslce shadcn.** Odrzucone: prawnik pracuje wieczorem i widzi
  wtedy inny produkt niz w dzien. Spojnosc marki nie moze zalezec od pory dnia.
- **Zdjac `EgressConfigBanner` jako zdublowany.** Odrzucone w tym ADR: to powierzchnia
  zgodnosciowa, a usuwanie takich w ramach zmiany wizualnej jest dokladnie tym mechanizmem,
  ktory kasuje kontrole "przy okazji".
- **Pokazywac pasek tylko przy ryzyku** (jak istniejacy baner). Odrzucone: wtedy brak sygnalu
  znowu znaczy dwie rzeczy naraz. Sens paska bierze sie z tego, ze jest zawsze.
- **Przebudowa architektury informacji w tym samym kroku.** Odrzucone: podzial Sprawy /
  Warsztat dotyka slownika produktu, dokumentacji i dziewieciu jezykow UI. Osobny ADR.
