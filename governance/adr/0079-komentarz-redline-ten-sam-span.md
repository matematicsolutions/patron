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

1. **Span w calosci na czystych `w:r`** (kazde dziecko w `[startChildIdx, endChildIdx]` to `w:r`): zachowana **bez zmian** dotychczasowa sciezka przebudowy runow (precyzja pod-runowa; testy sciezki czystej z ADR-0077 zostaja zielone).
2. **Span dotyka markupu nie-run** (`w:ins`/`w:del`/hyperlink/wczesniejszy commentRange): nowa sciezka **wstawiania na granicy dzieci** (sekcja B). Gdy ktorykolwiek komentarz w paragrafie jest "mieszany", caly paragraf idzie ta sciezka - nie miksujemy dwoch strategii w jednej przebudowie.

### B. Wstawianie na granicy dzieci (sciezka mieszana)

Markery to elementy punktowe, wiec sciezka mieszana NIE przebudowuje runow - operuje wylacznie na granicach dzieci paragrafu. Dla spanu `[startChildIdx, endChildIdx]` (te same indeksy co dzis, z `flat.runs[...].childIndex`):
- `w:commentRangeStart` wstawiany **przed** cale `paraChildren[startChildIdx]`.
- `w:commentRangeEnd` + run referencyjny wstawiany **po** calym `paraChildren[endChildIdx]`.
- Wszystkie dzieci scisle miedzy `startChildIdx` a `endChildIdx` (wlacznie z granicznymi) kopiowane sa **doslownie** - zaden `w:r`, `w:ins` ani `w:del` nie jest dzielony ani przebudowywany.
- Wiele komentarzy w jednym paragrafie: budujemy nowa tablice dzieci jednym przejsciem, z listami markerow start/end per indeks dziecka (`startsBeforeChild[ci]`, `endsAfterChild[ci]`). Konce + run referencyjny emitowane przed startami na tej samej granicy, by sasiadujace komentarze zagniezdzaly sie czysto.

Bracketowanie calych dzieci granicznych jest swiadomym uproszczeniem: na sciezce mieszanej zakres komentarza obejmuje cale graniczne runy `w:r`, a nie dokladny pod-runowy `find`. Sciezka czysta (sekcja A.1) zachowuje precyzje pod-runowa, wiec dotyczy to tylko spanow realnie nachodzacych na track.

### C. Co pozostaje zarezerwowane (NIE w 0079)

- **Precyzja pod-runowa na sciezce mieszanej** (dzielenie runa granicznego lub runa wewnatrz `w:ins`/`w:del`). v1 bracketuje cale dzieci graniczne - komentarz na spanie nachodzacym na track moze siegnac granic calego runa/`w:ins`, nie dokladnie wpisanego `find` (over-bracket o najwyzej tekst czesciowego runa granicznego). To zachowuje integralnosc sladu zmiany i pozwala uniknac kruchego dzielenia runow przy wielu komentarzach. Sciezka czysta `w:r` zachowuje pelna precyzje.
- **Kotwica w calosci w tekscie usunietym** (`w:del`): tekst `w:del` nie istnieje w widoku zaakceptowanym (`paraText`), wiec nie moze byc celem `find` - poza zakresem z definicji.

---

## Konsekwencje

**Pozytywne**:
- Domkniecie luki: komentarz i redline wspolistnieja na tym samym fragmencie. Recenzent flaguje zredlinowana klauzule bez utraty zakotwiczenia.
- `w:ins`/`w:del` pozostaja bajtowo nietkniete - slad zmiany (autor, data, id) zachowany, bo nie przebudowujemy ich wnetrza.
- Sciezka czysta `w:r` bez zmian - zero ryzyka regresji precyzji; testy sciezki czystej z ADR-0077 zostaja.
- Zero nowej zaleznosci, zero egress. Ten sam stack i matcher.

**Negatywne / koszt**:
- Na spanie z trackiem komentarz moze bracketowac wiecej niz dokladny `find` (cala jednostka `w:ins`). Udokumentowane jako swiadomy kompromis v1; pod-runowa precyzja w tracku to rezerwacja.
- Dwie sciezki w jednej funkcji - wieksza zlozonosc `insertCommentRanges`. Mitygacja: sciezka mieszana wydzielona do osobnego helpera z wlasnymi testami; sciezka czysta nietknieta.

**Bramki PRZED merge**:
- TSC clean (backend).
- Testy zielone przez `node node_modules/vitest/vitest.mjs run` (NIE npx). Zmiany w `docxComments.test.ts`: dotychczasowy test odrzucenia nakladania **odwrocony** na asercje zalozenia komentarza (span na `w:ins` -> sukces, round-trip przez `parseComments`, `w:ins`/`w:del` i `w:author` nietkniete, tracked change nadal parsowalny przez `parseTrackedChanges`); dodane: komentarz na spanie obejmujacym `w:del`, oraz dwa komentarze w jednym paragrafie (jeden na `w:ins`, drugi na czystym `w:r`). Regresja sciezki czystej `w:r` pokryta istniejacymi testami round-trip. Realizacja: 16 testow w pliku (z 14), pelny backend 873 pass / 0 fail, TSC clean.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
