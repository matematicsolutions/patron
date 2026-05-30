# ADR-0079: Komentarz i redline na tym samym spanie (zniesienie bramki nakladania)

**Status**: PROPONOWANY 2026-05-30. Konstytucja v1.4.6.

**Data**: 2026-05-30

**Powiazane zasady** (Konstytucja Patrona v1.4.6):
- **Art. 1 - Lokalnosc danych**: zmiana dotyczy wylacznie mechaniki bajtow .docx w pamieci backendu. Zero egress.
- **Art. 7 - Minimalnosc**: komentarz na spanie objetym tracked change to mniejsza ingerencja niz zmuszanie recenzenta do drugiego redline tylko po to, by cos oznaczyc.

**Powiazane ADR**: ADR-0077 (silnik `applyDocxComments` - ten ADR znosi jego bramke z sekcji C), ADR-0078 (warstwa serwisu `add_comments`), `docxTrackedChanges.ts` (silnik `w:ins`/`w:del`, wspoldzielony matcher i `flattenParagraph`).

---

## Kontekst

ADR-0077 sekcja C swiadomie postawila bramke konserwatywna: komentarz, ktorego zakotwiczony span nachodzi na istniejacy `w:ins`/`w:del` lub inny markup nie-run, jest **pomijany z bledem** ("overlaps"), zamiast ryzykowac korupcje tego markupu. Powod byl techniczny: `insertCommentRanges` (docxComments.ts) przebudowuje runy w spanie (`emitNormal` dzieli i sklada `w:r` na nowo), a `flattenParagraph` daje widok zaakceptowany, w ktorym runy wewnatrz `w:ins` mapuja `childIndex` na wrapper `w:ins`. Przebudowa takiego spanu zniszczylaby slad zmiany.

To realne ograniczenie produktowe. Typowy przebieg recenzji: klauzula zostala juz zredlinowana (`w:ins` wstawil nowe brzmienie), a Recenzent / Adwokat diabla chce ten sam fragment **dodatkowo oflagowac** uwaga ("rozwaz czy to nie jest abuzywne"). Dzis dostaje blad "overlaps" i traci zakotwiczenie. Word natywnie pozwala na komentarz na zakresie obejmujacym tracked change - my nie.

Przyczyna jest waska: bramka odrzuca, bo strategia przebudowy runow obsluguje tylko czyste `w:r`. Markery `w:commentRangeStart`/`End` to elementy-kamienie milowe (puste, punktowe). Wedlug schematu OOXML naleza do `EG_RangeMarkupElements` i sa dozwolone zarowno na poziomie paragrafu, jak i wewnatrz `w:ins`/`w:del` (przez `EG_ContentRunContent` -> `EG_RunLevelElts`). Nie trzeba wiec przebudowywac runow, zeby je polozyc - wystarczy wstawic je na **granicy dzieci paragrafu**, nie dotykajac wnetrza `w:ins`/`w:del`.

---

## Decyzja

Zniesc bramke "overlaps" dla dominujacego przypadku przez wstawianie markerow na granicy dzieci paragrafu zamiast przebudowy runow. `w:ins`/`w:del` traktowane sa jako jednostki atomowe - pozostaja bajtowo nietkniete.

### A. Dwie sciezki w `insertCommentRanges`, wybierane po skladzie spanu

1. **Span w calosci na czystych `w:r`** (kazde dziecko w `[startChildIdx, endChildIdx]` to `w:r`): zachowana **bez zmian** dotychczasowa sciezka przebudowy runow (precyzja pod-runowa, 14 testow ADR-0077 zostaje zielonych).
2. **Span dotyka markupu nie-run** (`w:ins`/`w:del`/hyperlink/wczesniejszy commentRange): nowa sciezka **wstawiania na granicy dzieci** (sekcja B). Gdy ktorykolwiek komentarz w paragrafie jest "mieszany", caly paragraf idzie ta sciezka - nie miksujemy dwoch strategii w jednej przebudowie.

### B. Wstawianie na granicy dzieci (sciezka mieszana)

Dla spanu `[startChildIdx, endChildIdx]`:
- `w:commentRangeStart` wstawiany **przed** `paraChildren[startChildIdx]`. Jezeli `startChildIdx` to czysty `w:r` a offset startu jest w srodku runa - run jest dzielony na granicy znaku (`[pre][Start][post]`), zeby zachowac precyzje. Jezeli `startChildIdx` to element nie-run (`w:ins` itd.) - Start idzie przed cala jednostka (komentarz bracketuje od poczatku tej jednostki).
- `w:commentRangeEnd` + run referencyjny wstawiany **po** `paraChildren[endChildIdx]`, symetrycznie: podzial gdy to `w:r` z offsetem w srodku, w przeciwnym razie po calej jednostce.
- Wszystkie dzieci scisle miedzy `startChildIdx` a `endChildIdx` kopiowane sa **doslownie** (`w:ins`/`w:del` nietkniete).
- Wiele komentarzy w jednym paragrafie: markery to punkty, wiec budujemy nowa tablice dzieci jednym przejsciem, z listami markerow start/end per granica dziecka (analogicznie do dotychczasowego zbioru `boundaries`, ale w granulacji dzieci). Konce + run referencyjny emitowane przed startami na tej samej granicy, by sasiadujace komentarze zagniezdzaly sie czysto.

### C. Co pozostaje zarezerwowane (NIE w 0079)

- **Precyzja pod-runowa wewnatrz `w:ins`/`w:del`** (dzielenie runa tracked change). v1 traktuje tracked change atomowo - komentarz bracketuje cala jednostke zmiany, ktora dotyka. Swiadomy kompromis: podswietlony zakres moze siegnac granic calego `w:ins`, nie dokladnie wpisanego `find`. To zachowuje integralnosc sladu zmiany, ktora jest wazniejsza niz piksel zakresu.
- **Kotwica w calosci w tekscie usunietym** (`w:del`): tekst `w:del` nie istnieje w widoku zaakceptowanym (`paraText`), wiec nie moze byc celem `find` - poza zakresem z definicji.

---

## Konsekwencje

**Pozytywne**:
- Domkniecie luki: komentarz i redline wspolistnieja na tym samym fragmencie. Recenzent flaguje zredlinowana klauzule bez utraty zakotwiczenia.
- `w:ins`/`w:del` pozostaja bajtowo nietkniete - slad zmiany (autor, data, id) zachowany, bo nie przebudowujemy ich wnetrza.
- Sciezka czysta `w:r` bez zmian - zero ryzyka regresji precyzji i 14 testow ADR-0077 zostaje.
- Zero nowej zaleznosci, zero egress. Ten sam stack i matcher.

**Negatywne / koszt**:
- Na spanie z trackiem komentarz moze bracketowac wiecej niz dokladny `find` (cala jednostka `w:ins`). Udokumentowane jako swiadomy kompromis v1; pod-runowa precyzja w tracku to rezerwacja.
- Dwie sciezki w jednej funkcji - wieksza zlozonosc `insertCommentRanges`. Mitygacja: sciezka mieszana wydzielona do osobnego helpera z wlasnymi testami; sciezka czysta nietknieta.

**Bramki PRZED merge**:
- TSC clean (backend).
- Testy zielone przez `node node_modules/vitest/vitest.mjs run` (NIE npx). Nowe przypadki w `docxComments.test.ts`: (1) komentarz na spanie pokrywajacym istniejacy `w:ins` -> sukces, komentarz round-trip przez `parseComments`, a `w:ins` (autor/id) nietkniety; (2) komentarz na spanie obejmujacym `w:del`; (3) komentarz dokladnie na granicy `w:ins` + drugi komentarz na czystym `w:r` w tym samym paragrafie; (4) regresja: span na czystych `w:r` nadal idzie sciezka precyzyjna. Cel: nie mniej niz 4 nowe testy, 0 fail.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
