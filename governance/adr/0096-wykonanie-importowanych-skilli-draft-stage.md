# ADR-0096: Wykonanie importowanych skilli w pipeline obrony (custom draft-stage)

**Status**: Zaproponowany 2026-06-02 (krok 2 rozszerzalnosci). Konstytucja v1.5.0. Domyka kontrakt z [ADR-0094](./0094-kontrakt-paczki-skilla.md): zaimportowane skille o powierzchni `draft-stage` realnie URUCHAMIAJA sie w pipeline obrony, a nie tylko widnieja na liscie. Trojka wbudowana (Recenzent/Adwokat/Pisz po ludzku) pozostaje rdzeniem bez zmian zachowania.

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: custom etapy plyna przez TEN SAM przeplyw maskowania PII (wrapInto/unwrap, H14/ADR-0068) i przez TEGO SAMEGO straznika data-residency (enforceEgressGuard, ADR-0067) co etapy wbudowane. Zaimportowany skill nie omija ani maskowania, ani bramki egress.
- **Art. 3 - Audytowalnosc**: uruchomienie loguje id uzytych skilli w istniejacym zdarzeniu `defense.pipeline.run` (pole `custom_skills`). Bez nowego event_type (whitelist ADR-0035 nietknieta).
- **Art. 5 - Czlowiek decyduje**: uruchamiane sa wylacznie skille WLACZONE przez mecenasa.
- **Art. 7 - Minimalnosc**: zmiana additive - built-in bez `customStages` zachowuje sie identycznie (regresja zerowa, pelny suite zielony).

**Powiazane ADR**: ADR-0094 (kontrakt paczki), ADR-0058 (pipeline obrony), ADR-0067 (egress guard w /draft), ADR-0068 (maskowanie PII), ADR-0019 (input-security / anty-injection).

---

## Kontekst

ADR-0094 dal kontrakt paczki, loader i panel - skille mozna importowac, wlaczac, wylaczac. Brakowalo ostatniego ogniwa: zeby zaimportowany skill cos ROBIL. Bez tego biblioteka jest atrapa.

Ustalenie produktowe (2026-06-02): trojka obrony to RDZEN (zawsze aktywny, jednakowy w kazdej instalacji) - nie wynosimy jej do paczek. Pierwszym wykonywalnym SKU jest umiejetnosc NOWA, dodatkowa (np. "Streszczenie do klienta"). Dzieki temu sciezka wykonania jest udowodniona bez ruszania dzialajacego rdzenia.

## Decyzja

### A. Custom etap jako rozszerzenie runnera (additive)

`runDefensePipeline` przyjmuje opcjonalne `customStages: CustomStageSpec[]` (id, name, system, user). Budowane jest jedno zadanie-list: wbudowane etapy w kolejnosci, a PO nich custom etapy. Petla jest wspolna - kazde zadanie idzie przez ten sam `current` (zamaskowany draft) i to samo `unwrap`. Build-in buildery promptow sa nietkniete; gdy `customStages` puste, zachowanie jest identyczne jak dotad.

### B. Prompt custom skilla pochodzi z manifestu

`buildCustomPrompt` uzywa `system` z manifestu w calosci (autor skilla kontroluje zachowanie - NIE doklejamy BASE_RULES, bo np. skill streszczajacy celowo skraca). Draft doklejany do user-promptu jak w etapach wbudowanych; kontekst sprawy tym samym separatorem `<kontekst_sprawy>` (dane, nie instrukcje). Gwarancja "bez PII na zewnatrz" plynie z maskowania pipeline, nie z tresci promptu.

### C. Anty-injection jako bramka IMPORTU (silniejsza niz przy uruchomieniu)

Skan `analyzeInput` (input-security, ADR-0019) liczy sie przy `POST /skills/import`: jezeli `action !== "allowed"`, paczka jest odrzucana (400) i nie wchodzi do biblioteki. Zlosliwy prompt ("ignoruj poprzednie instrukcje...") nie zostaje zainstalowany. To mocniejsze niz skan przy kazdym wywolaniu - wadliwy skill nie istnieje w systemie, zamiast byc cicho pomijany w runtime.

### D. Audyt bez nowego event_type

Lista id uruchomionych skilli (`custom_skills`) dochodzi do payloadu istniejacego zdarzenia `defense.pipeline.run`. Metering uzycia per skill (podstawa rozliczen marketu) zbuduje sie nad tym samym sladem - rezerwacja.

## Konsekwencje

**Pozytywne**
- Zaimportowany skill realnie dziala - kontrakt ADR-0094 udowodniony end-to-end.
- Rdzen obrony nietkniety; zmiana czysto additive (regresja zerowa).
- Maskowanie PII i egress guard obejmuja custom etapy automatycznie (dziedzicza z runnera).
- Zlosliwa paczka odrzucona u bramy importu, nie w runtime.

**Negatywne / rezerwacje**
- Kolejnosc/wybor custom etapow: na razie wszystkie wlaczone draft-stage ida po wbudowanych, wg kolejnosci instalacji. UI do wyboru per-uruchomienie = rezerwacja.
- Podpis Ed25519 (zaufanie wydawcy) wciaz rezerwacja ADR-0094 - import opiera sie na skanie + zaufanym zrodle pliku.
- Metering=billing per skill = rezerwacja (slad juz jest w audycie).
- `surface` egzekwowany dla `draft-stage`; kolejne powierzchnie (tabular, analiza) pozniej.
