# ADR-0086: Dual-similarity case ranking

**Status**: Wdrozony 2026-05-31 (Faza B, biblioteka). Konstytucja v1.5.0. Funkcje czyste + helper DB gotowe, eksportowane, przetestowane; wpiecie w retrieve() = rezerwacja.

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: ranking jest deterministyczny, offline, zero wywolan LLM, zero egress. Pracuje na danych grafu (citation_graph, extracted_entities), ktore backend juz trzyma lokalnie w SQLite. Czysta arytmetyka zbiorow.
- **Art. 3 - Audytowalnosc / determinizm**: te same wejscie (kandydaci + profil referencyjny + alpha) daje ten sam ranking. Brak zegara, brak losowosci, stabilny tie-break. Re-ranking jest reprodukowalny, wiec kolejnosc cytowanych spraw da sie odtworzyc w audycie.
- **Art. 7 - Minimalnosc / rzetelnosc**: zero nowej zaleznosci npm, czysty TypeScript + Node 20 stdlib. Sygnal strukturalny poprawia trafnosc retrievalu (sprawy analogiczne nad tylko tematyczne) bez kosztu LLM.

**Powiazane ADR**:
- ADR-0007 / ADR-0054 (hybrid retrieval RAG + graf): ten ADR dodaje trzeci wymiar rankingu (podobienstwo strukturalne) obok tresci (wektor/BM25) i globalnej centralnosci backlink. Reuzywa kontraktu wynikow retrievalu jako wejscia.
- ADR-0008 (entity extraction + citation_graph, zero LLM): zrodlo profilu strukturalnego. loadStructuralProfile czyta dokladnie te tabele co graphRankCandidates w retrieval.ts (citation_graph.from_doc_id/to_entity_id, extracted_entities.value_normalized/document_id), nie duplikuje schematu.
- ADR-0083/0084/0085 (Faza A): rodzenstwo z tego samego zwiadu CN; ten ADR jest Faza B roadmapy.

Inspiracja: Ping An US12001466B2 (rodzina CN+US, brak czlonu EP wg zwiadu IP 2026-05-31, wiec wzorzec wolny do stosowania w EU; patent zywy w US). Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy wzorzec gwarancji (re-ranking laczacy podobienstwo tresci z podobienstwem strukturalnym grafu sprawy), nie kod ani model. Reimplementacja deterministyczna od zera.

---

## Kontekst

Hybrid retrieval (retrieval.ts, ADR-0054/0007) laczy trzy sygnaly przez reciprocal rank fusion: wektor (sqlite-vec, podobienstwo semantyczne), BM25 (FTS5, dokladne terminy: sygnatury, NIP, daty) oraz graf. Sygnal grafu (graphRankCandidates) szereguje kandydatow wedlug globalnej centralnosci backlink dokumentu: encja jest centralna, gdy cytuje ja wiele roznych dokumentow kancelarii, a wynik dokumentu to suma centralnosci jego encji. To mierzy waznosc dokumentu w korpusie w ogole, niezaleznie od konkretnego zapytania.

Brakuje sygnalu podobienstwa strukturalnego do zapytania albo do sprawy referencyjnej. Dwie sprawy moga byc tematycznie podobne (te same slowa, bliskie embeddingi), a mimo to strukturalnie rozne. I odwrotnie: sprawa o innym slownictwie, ale dzielaca z zapytaniem wzorzec cytowan i encji (te same przepisy podstawy, te same precedensy, ta sama konstrukcja podstawa-roszczenie-dowod), jest analogiczna i dla prawnika cenniejsza niz dopasowanie tylko leksykalne. Globalna centralnosc backlink tego nie lapie, bo nie jest funkcja zapytania.

Wzorzec dual-similarity (Ping An US12001466B2) rozwiazuje to przez re-ranking: do podobienstwa tresci dokladany jest drugi wymiar - podobienstwo strukturalne liczone na grafie sprawy. Patent jest zywy w US, wiec nie kopiujemy kodu; bierzemy sama idee laczenia dwoch podobienstw i realizujemy ja deterministycznie na istniejacym citation_graph Patrona.

Roznicowanie FTO. Sygnaly do pilnowania ze zwiadu IP: Baidu EP4086808A3 (contract knowledge-graph consistency check, pending EP) dotyczy sprawdzania spojnosci umow po grafie, nie re-rankingu wynikow wyszukiwania; Thomson Reuters WO2025085566A1 (RAG legal, pending EP) dotyczy generatywnego potoku RAG. Ten ADR to deterministyczne re-rankowanie kandydatow retrievalu po podobienstwie zbiorow encji grafu, bez generacji i bez sprawdzania spojnosci umow. Roznica zachowana swiadomie; recheck Espacenet przy wpieciu w request-path.

---

## Decyzja

Dodac modul `backend/src/lib/retrieval/dualSimilarity.ts` z deterministycznym rankingiem dual-similarity. Cala logika rankingu jest w funkcjach czystych (testowalnych bez bazy); jedyna warstwa DB to cienki helper wczytujacy profil strukturalny dokumentu.

### A. Profil strukturalny i podobienstwo

Profil strukturalny dokumentu (`StructuralProfile`) to zbior value_normalized encji, do ktorych dokument sie odwoluje: cele krawedzi citation_graph wychodzacych z dokumentu plus wlasne encje dokumentu (przepisy, sygnatury, kwoty-kotwice, strony). Podobienstwo strukturalne dwoch dokumentow w v1 to Jaccard ich profili: rozmiar przeciecia przez rozmiar sumy. Symetryczne, w [0,1]. Oba zbiory puste daje 0 (brak sygnalu, nie sztuczna jedynka).

### B. Re-ranking dual-similarity

`dualSimilarityRank(candidates, reference, opts)` laczy dwa sygnaly. Wynik tresci kazdego kandydata (RRF / wektor / BM25, dowolna skala) jest min-max normalizowany do [0,1] w obrebie zestawu. Podobienstwo strukturalne kandydata liczone jest wzgledem profilu referencyjnego (sasiedztwo sprawy-kotwicy albo agregat profili top dopasowan tresci). Wynik laczony to `alpha * contentNorm + (1 - alpha) * structuralScore`, gdzie alpha w [0,1] (default 0.6, lekko w strone tresci; wartosci spoza zakresu przycinane). Kandydaci zwracani sa best-first.

Brzegi bez regresji: alpha=1 daje czysty porzadek tresci (kolejnosc jak w wejsciowym rankingu retrievalu); pusty profil referencyjny daje structuralScore 0 dla wszystkich, wiec ranking takze sprowadza sie do tresci. Gdy graf jest pusty albo nie roznicuje, re-ranking nie psuje istniejacego porzadku.

Tie-break (deterministyczny, stabilny): score malejaco, potem wyzszy contentNorm, potem kolejnosc wejsciowa, na koncu porownanie id jako string. Brak stanu wspoldzielonego, brak losowosci (Konstytucja Art. 3).

### C. Warstwa DB (cienka)

`loadStructuralProfile(documentId)` czyta profil z SQLite: cele krawedzi citation_graph wychodzacych z dokumentu (join do extracted_entities po to_entity_id) plus wlasne encje dokumentu. Schemat identyczny z uzywanym przez graphRankCandidates w retrieval.ts - zero duplikacji schematu. Pusty wynik (brak danych grafu) propaguje sie jako pusty profil, co degraduje ranking do kolejnosci tresci.

### D. Granica (biblioteka, nie request-path)

Modul jest biblioteka. Funkcje czyste sa w pelni testowalne bez bazy. Wpiecie w `retrieve()` (wybor sprawy referencyjnej, strojenie alpha, ewentualna integracja z RRF) jest rezerwacja tego ADR - jak ADR-0084/0085, dostarczamy silnik i nie zmieniamy sciezki produkcyjnej retrievalu w tym kroku. Dzieki temu zmiana jest zero-ryzyka dla istniejacego retrievalu, a jej trafnosc da sie zmierzyc na korpusie pilotazu przed wpieciem.

---

## Konsekwencje

**Pozytywne**:
- Trzeci, query-zalezny wymiar rankingu: sprawy strukturalnie analogiczne (dzielace wzorzec cytowan i encji) wynoszone nad tylko tematycznie podobne. Bezposrednie wzmocnienie jakosci retrievalu (ADR-0054) dla pracy prawnika z precedensami.
- Zero nowej zaleznosci npm, czysty TypeScript + Node 20 stdlib. Deterministyczny, offline, zero egress, zero kosztu LLM (Konstytucja Art. 1, 3, 7).
- Brzegi bez regresji (alpha=1 oraz pusty profil referencyjny daja kolejnosc tresci), wiec wpiecie mozna wprowadzac stopniowo bez ryzyka pogorszenia obecnego rankingu.
- Reuzycie schematu grafu z ADR-0008 (citation_graph + extracted_entities) - jeden punkt utrzymania, brak duplikacji zapytan schematu.

**Negatywne / koszt**:
- Podobienstwo v1 to Jaccard sasiedztwa jednohopowego (zbior cytowanych encji). Nie rozroznia rol (podstawa kontra dowod kontra strona) ani sciezek wielohopowych. Bogatsze podobienstwo strukturalne (typowanie rol, walk glebszy niz 1) to rezerwacja, nakladajaca sie na Faza C (event-centric KG).
- Jakosc zalezy od gestosci citation_graph. Przy rzadkim grafie (malo dokumentow, malo cytowan) sygnal strukturalny jest slaby i ranking opiera sie na tresci. Realny zysk do potwierdzenia benchmarkiem na korpusie pilotazu.
- Wybor profilu referencyjnego (sprawa-kotwica vs agregat top dopasowan) wplywa na wynik i nie jest rozstrzygniety w v1 - to czesc rezerwacji wpiecia w request-path.
- Domyslna alpha 0.6 jest heurystyczna; strojenie nalezy do ewaluacji przed wpieciem.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` exit 0, zero `any` bez komentarza, zero `@ts-ignore`.
- Testy zielone: `src/lib/retrieval/dualSimilarity.test.ts` pokrywa jaccard (rozlaczne, identyczne, czesciowe, oba puste, jeden pusty, symetria), podobienstwo strukturalne, re-ranking (analogiczna nad tematyczna, alpha=1 czysta tresc, alpha=0 czysta struktura, pusty profil referencyjny bez regresji, determinizm, stabilny tie-break, przycinanie alpha, pusta lista i pojedynczy kandydat, score w [0,1]). Pelny backend bez regresji.
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
- Recheck FTO (Espacenet: Baidu EP4086808A3, TR WO2025085566A1) przy wpieciu modulu w request-path.

## Co pozostaje zarezerwowane

1. **Wpiecie w retrieve()**: wybor sprawy referencyjnej, strojenie alpha na ewaluacji, integracja z RRF albo jako osobny etap re-rankingu. v1 dostarcza silnik biblioteczny, nie zmienia request-path.
2. **Wazenie podobienstwa centralnoscia encji**: rzadka, specyficzna encja (np. niszowy precedens) powinna wazyc wiecej niz pospolita (art. 6 k.c.). v1 traktuje wszystkie encje profilu rowno (czysty Jaccard).
3. **Podobienstwo wielohopowe i typowanie rol** (podstawa/roszczenie/dowod): walk glebszy niz 1 i role krawedzi. Nakladka na Faza C (event-centric KG, ADR-C1).
4. **Strojenie progow i alpha per typ zapytania**: inny balans tresc/struktura dla wyszukiwania precedensow niz dla wyszukiwania faktow. v1 uzywa jednej alpha.
