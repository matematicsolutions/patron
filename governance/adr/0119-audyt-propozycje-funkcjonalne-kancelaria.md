# ADR-0119: Audyt PATRON - propozycje funkcjonalne pod kancelarie (workflow / weryfikacja cytatow / preset docx)

- **Status:** Proponowany. Branch `feat/kancelaria-proposals` (off main), NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora).
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON sekcja "Propozycje funkcjonalnosci" (#6/#7/#8) + Raport CTO sek. D/E/F. To FICZERY (nie usterki), reuzywajace istniejace silniki - dostarczane krok po kroku w tej galezi. Profil uzytkowniczki: adwokatka karnistka (cytat + sygnatura + strona; sprzecznosci/luki; art. 7/410/424/438/5§2/201/249/258 k.p.k.).

## Decyzje (per propozycja)

### #7 - Workflow "Analiza akt" (6-punktowy) [ZROBIONE]
Wbudowany workflow `builtin-analiza-akt-karne` w `lib/builtinWorkflows.ts` (czyste dane `{id,title,prompt_md}`, reuzywa silnik workflows - `buildWorkflowStore` seeduje builtiny, zero kodu). Strukturalny prompt PL: zarzut -> dowody -> wyrok I -> apelacja -> wyrok II -> wskazania.
Governance wbudowane w prompt: praca tylko na aktach sprawy, "brak w aktach" zamiast zmyslania (draft nie autopilot - Konstytucja), twarda dyscyplina cytatu (cytat + dokument + "str. N" - korzysta z proweniencji strony ADR-0113), obiektyw bieglych art. 201, ocena dowolnej oceny dowodow art. 7/410/424/5§2, podstawy odwolawcze art. 438, areszt art. 249/258. Dostarczenie inline (docx tylko na zadanie); na koncu sugeruje "Zweryfikuj cytaty".

### #8 - "Zweryfikuj cytaty" jako akcja [ZROBIONE]
Endpoint `POST /api/citations/verify` (`routes/citations.ts`, requireAuth) - wyeksponowanie biblioteki `lib/citation` (ADR-0005) jako akcji na gotowym pismie. Body `{ project_id, citations:[{ref,doc_id,quote}] }` -> werdykt per ref (ZWERYFIKOWANY/ZMODYFIKOWANY/NIEZWERYFIKOWANY/BRAK_ZRODLA) + summary + `blokada`. Deterministyczne, zero LLM, READ-ONLY. Reuzywa `groundCitationsByRef` (prefetch tekstu akt + `verifyCitations`) i `buildProjectDocContext`. **Kontrola dostepu do sprawy** (`checkProjectAccess`, 404 dla cudzej - inaczej cross-tenant wyciek tresci akt). Klient `patronApi.verifyCitations`. Przycisk w UI drafta = cienki follow-up (substancja = endpoint; czat i tak groundinguje inline, workflow #7 sugeruje akcje).

### #6 - Preset eksportu .docx "styl kancelarii" [PLANOWANE w tej galezi]
Bez tabel, srodtytul pogrubiony w osobnym wersie, konkluzje podkreslane, numeracja prawy-dolny rog (wzorzec "MS_zalacznik OSTATECZNY"). Patrz kolejny krok.

## Konsekwencje

- (+) Powtarzalne zadanie karnistki (analiza akt przez instancje) = gotowy obiektyw zamiast formulowania promptu za kazdym razem; spojny z dyscyplina cytatu i proweniencja strony.
- (+) Zero nowego kodu silnika (#7 to dane) - niskie ryzyko.
- (-) Jakosc analizy zalezy od modelu + kompletnosci akt; prompt wymusza "brak w aktach" i dostarczenie jako draft do redakcji.
- **Testy:** `builtinWorkflows.test.ts` (rejestracja + struktura 6 sekcji + dyscyplina cytatu + anty-zmyslanie). Reszta bundla dokladana w kolejnych krokach.
