# ADR-0114: Hygiena retrievalu - wersjonowanie embeddera, overlap chunkow, prefix-match PL

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON, batch P2 #8 + P3 #14 + P3 #15 (jakosc/robustnosc warstwy retrievalu).

## Decyzje

### P2 #8 - wersjonowanie wymiaru/modelu embeddera
`EMBED_DIM` byl staly, `vec_chunks` zakladane na ten wymiar. Zmiana `PATRON_EMBED_MODEL`/`PATRON_EMBED_DIM` na inny wymiar po cichu psula warstwe wektorowa (`create virtual table if not exists` NIE zmienia wymiaru istniejacej tabeli; inserty innego wymiaru leca bledem). Dodano tabele `retrieval_meta(key, value)` i `reconcileEmbedderMeta(conn, dim, model)` wolana w `setupRetrievalTables` PRZED utworzeniem `vec_chunks`:
- **niezgodnosc wymiaru** -> `drop table vec_chunks` + wyzerowanie `doc_chunks.embedding_model` (sygnal re-indeksu) + glosny log; BM25/graf dzialaja dalej, wektory odbudowuje re-index.
- **zmiana modelu (ten sam wymiar)** -> ostrzezenie (wektory nieporownywalne, zalecany re-index), bez dropu.
- zapis biezacego `(embed_dim, embed_model)`. Zamiast cichej korupcji - wykrycie z jasnym komunikatem.

### P3 #14 - overlap chunkow
Chunker byl zachlanny (~900 znakow) bez zakladki -> fakt na granicy chunka rozcinany na dwa nietrafialne fragmenty. `chunkText` dostal `overlapChars` (default 120, ~13%): post-process doklejajacy ogon poprzedniego chunku (z oryginalow, bez kompoundowania) na poczatek nastepnego, przyciety do granicy slowa. **Kontrakt `chunk <= maxChars` zachowany** - ogon doklejany tylko w ramach pozostalego budzetu (przy chunku pelnym brak zakladki). Pojedynczy chunk / pusty wynik bez zmian (zero regresji; testy `chunkLegalText === chunkText` przechodza, bo obie sciezki uzywaja tego samego `chunkText`).

### P3 #15 - prefix-match morfologiczny PL w FTS
BM25 (`unicode61 remove_diacritics 2`) bez stemmingu -> formy odmienione ("oskarzonego"/"oskarzonemu") to rozne tokeny, luki recall. `buildFtsMatch`: tokeny czysto literowe dlugosci >=7 dostaja prefix-term rdzenia (`rdzen*`); rdzen = truncacja do 3 znakow z konca, podloga 5 (polska fleksja jest sufiksalna, formy dziela rdzen prefiksowy). Krotkie tokeny, liczby i sygnatury (czp/iii/11) zostaja exact - krotki prefix = za duzo false-positive. Bez slownika sufiksow (jednolita, deterministyczna truncacja); wektor nadrabia reszte.

## Konsekwencje

- (+) Brak cichej korupcji wektorow przy zmianie embeddera; jasny komunikat + sciezka re-indeksu.
- (+) Fakt na granicy chunka trafialny z obu stron (overlap), bez naruszenia limitu maxChars.
- (+) Wyzszy recall dla odmienionych terminow PL (prefix-match) bez custom tokenizera FTS5.
- (-) Overlap zwieksza laczna objetosc indeksu (~do 13%); prefix-match moze podniesc recall kosztem precyzji (BM25 ranking + wektor lagodza). Stare chunki bez page_no/overlap do czasu re-indeksu.
- **Testy:** vitest 1159 pass / 0 fail / 5 todo. `hygiene.test.ts` (+10): overlap (zakladka/single/off), prefix-match PL (rdzen lapie formy, sygnatury exact, null), reconcileEmbedderMeta (fresh/unchanged/model-changed/dim-mismatch z dropem).
