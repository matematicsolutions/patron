# ADR-0081: Polskie presety kolumn tabular review

**Status**: Wdrozony 2026-05-31. Konstytucja v1.5.0. (merge 1b6fa23 do main, push na prywatny origin)

**Data**: 2026-05-31

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: zmiana dotyczy wylacznie statycznej konfiguracji frontendu (lista presetow). Zero egress, zero nowej zaleznosci.
- **Doktryna skladania**: mechanizm dopasowania presetu jest odziedziczony; wartoscia jest jurysdykcja PL, nie komponent.

**Powiazane ADR**: ADR-0080 (grounding komorek - razem skladaja sie na "tabular review po polsku, ugruntowany"). Inspiracja mechanizmu: `isaacus/tabular-review` przez `willchen96/mike` (THIRD_PARTY_INSPIRATIONS.md).

---

## Kontekst

`frontend/src/app/components/tabular/columnPresets.ts` dostarcza presety kolumn tabular review: gdy prawnik nadaje kolumnie nazwe pasujaca do wzorca (`matches`), dostaje gotowy prompt ekstrakcji i format. Mechanizm (`getPresetConfig`) odziedziczylismy z `isaacus/tabular-review`.

Problem: caly zestaw 13 presetow byl common-law angielski - "Governing Law" z odpowiedziami "New York Law", "Change of Control", "Force Majeure", "Indemnity", przyklad strony '"ABC Corp, a Delaware corporation"'. Dla polskiej kancelarii zaden z tych 13 wzorcow `matches` nie dopasowuje sie do polskiego tytulu kolumny (lapia angielskie slowa-klucze typu "governing law", "indemnity"), prompty odwoluja sie do instytucji common law, a przyklady do spolek z Delaware. Preset, ktory sie nie dopasowuje do "Kara umowna" albo "Wlasciwosc sadu", nie istnieje z punktu widzenia uzytkownika.

To dokladnie miejsce, gdzie moat Patrona to prawo PL, nie harness: mechanizm jest generyczny i wspolny dla rodzica i rodzenstwa (`mike`, `emilie`), a roznica jest w tresci dostrojonej do jurysdykcji.

---

## Decyzja

Zastapic angielski zestaw `PROMPT_PRESETS` zestawem dostrojonym do polskiej praktyki umownej i Due Diligence. Interfejs (`ColumnPreset`, `getPresetConfig`, `getPresetPrompt`) bez zmian - to czysta wymiana danych.

### A. Zestaw presetow (16)

Strony umowy, Prawo wlasciwe, Wlasciwosc sadu, Data zawarcia, Okres obowiazywania, Wypowiedzenie, Kara umowna, Ograniczenie odpowiedzialnosci, Poufnosc, Zakaz konkurencji, Ochrona danych (RODO), Cesja praw, Zabezpieczenia, Wynagrodzenie i platnosc, Sila wyzsza, Zmiana umowy.

Dobor pod realne pola przegladu polskich umow: kara umowna (art. 483 KC), wlasciwosc sadu / zapis na sad polubowny, umowa powierzenia (art. 28 RODO), zabezpieczenia (weksel/poreczenie/zastaw/hipoteka), zakaz konkurencji. Prompty pisane po polsku z wlasciwa terminologia; przyklady z polskimi formami prawnymi (sp. z o.o., KRS/NIP, "x zl netto").

### B. Wzorce dopasowania tolerancyjne na ogonki

Regexy `matches` dopuszczaja zarowno polskie znaki, jak i wersje zlozona bez ogonkow (np. `/poufno[sś][cć]/i` lapie "poufnosc" i "poufnosc"), bo uzytkownik moze wpisac tytul kolumny dowolnie. Kolejnosc presetow ma znaczenie (`find` zwraca pierwsze trafienie) - bardziej szczegolowe wzorce przed ogolnymi.

### C. Co pozostaje zarezerwowane (NIE w 0081)

- **Presety per typ umowy** (gotowy zestaw kolumn dla "Przeglad umowy najmu" / "DD spolki" jednym kliknieciem). v1 to presety pojedynczych kolumn po nazwie; pakiety kolumn to osobna funkcja UX.
- **Internacjonalizacja presetow** (przelaczanie PL/EN wedlug locale). v1 jest PL-only zgodnie z rynkiem docelowym; angielskie presety mozna przywrocic warstwa i18n, gdy pojawi sie potrzeba.

---

## Konsekwencje

**Pozytywne**:
- Presety realnie sie dopasowuja do polskich tytulow kolumn - funkcja przestaje byc martwa dla docelowego uzytkownika.
- Prompty w polskiej terminologii prawnej daja lepsza ekstrakcje na polskich dokumentach niz prompty common law.
- Zero ryzyka dla rdzenia: czysta wymiana danych frontendu, interfejs niezmieniony, brak nowej zaleznosci, zero egress.

**Negatywne / koszt**:
- Utrata angielskich presetow (swiadoma - rynek docelowy to polskie kancelarie). Przywracalne przez i18n (rezerwacja C).
- Wzorce `matches` heurystyczne - mozliwe niedopasowanie nietypowego tytulu. Mitygacja: gdy preset nie pasuje, dziala dotychczasowy fallback (`POST /tabular-review/prompt` generuje prompt z LLM), wiec brak presetu nie blokuje - degraduje do generowania.

**Bramki PRZED merge**:
- TSC clean (frontend). Zrealizowane: `tsc --noEmit` EXIT 0. Frontend nie ma runnera testow jednostkowych (bramka to tsc + build).
- Marko 2x na tym ADR przed merge.
- Merge na osobnej galezi, bramka private-remote przed push.
