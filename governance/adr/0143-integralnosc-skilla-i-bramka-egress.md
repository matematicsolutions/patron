# ADR-0143: Integralnosc skilla w audycie i egzekwowanie jego deklaracji egress

**Status**: Wdrozony 2026-08-04. Konstytucja v1.7.2.
**Data**: 2026-08-04
**Powiązane zasady**: Konstytucja AI Patrona, Art. 2 (zero-cloud), Art. 3
(audytowalnosc), Art. 5 (tajemnica zawodowa), AI Act art. 12 (record-keeping)
**Powiązane**: ADR-0094 (kontrakt paczki skilla), ADR-0096 (skille jako etapy
pipeline obrony), ADR-0068 (audyt `defense.pipeline.run`), ADR-0142
(kanonikalizacja i suma kontrolna - ten sam mechanizm), ADR-0014 (rejestr egress)

## Problem

Przy ocenie wzorca "rzadzonego lancucha dostaw skilli" z `b1rdmania/legalise`
sprawdzilismy, co Patron faktycznie zapisuje o skillach. Poczatkowa teza brzmiala
"audyt nie wie, ktory skill uksztaltowal prompt" - i okazala sie ZA MOCNA:
`defense.pipeline.run` juz logowal `custom_skills`. Pomiar kodu przesunal problem
w dwa wezsze i powazniejsze miejsca.

### 1. Audyt zapisywal tozsamosc, nie integralnosc

`custom_skills` bylo lista samych identyfikatorow. Tymczasem `importSkill`
(`lib/skills/store.ts`) robi **upsert po `id`**, a manifest nie jest podpisany
(`signature` to rezerwacja od ADR-0094). Wynika z tego, ze para `(id, version)`
NIE identyfikuje tresci: reimport pod tym samym identyfikatorem i ta sama wersja
podmienia prompt, a zapis w dzienniku wyglada identycznie.

Konsekwencja jest scisle prawna. Na pytanie "jak powstala ta analiza" dziennik
odpowiadal "uruchomil sie skill `recenzent-pl` 1.0.0" - co po podmianie tresci
nie dowodzi niczego o tym, jaka instrukcja faktycznie uksztaltowala pismo.

### 2. Deklaracja egress skilla nie byla egzekwowana

Manifest deklaruje `egress: no-egress | cloud-allowed` - **plaszczyzne egress
samego skilla** (tresc promptu, know-how autora), rozlaczna od egressu danych
klienta, ktory pokrywa maskowanie PII w pipeline. Deklaracja byla walidowana przy
imporcie (`validateManifest`), zapisywana w kolumnie `installed_skills.egress`
i pokazywana w UI (`SkillEntry.egress`).

I na tym sie konczyla. `CustomStageSpec` przekazywany do `runDefensePipeline`
mial wylacznie `{ id, name, system, user }` - pole `egress` bylo **porzucane
przed uruchomieniem**. Prompt skilla oznaczonego `no-egress` jechal do modelu
chmurowego tak samo jak kazdy inny. Pole istnialo, bylo widoczne i nie robilo nic.

## Decyzja

Nowy modul `lib/skills/integrity.ts` (czyste funkcje, zero IO):

- **`skillPromptSha256(prompt)`** - suma kontrolna tresci `{ system, user }`,
  liczona **przy odczycie**, nie z kolumny. Odzwierciedla to, co faktycznie
  pojdzie do modelu, nawet gdy skill podmieniono po instalacji. Uzywa
  `canonicalSha256` z ADR-0142: jedna kanonikalizacja w projekcie i jedno
  wyjasnienie dla kancelarii.
- **`partitionSkillsByEgress(skille, egressModelu)`** - rozdziela na `allowed`
  i `skipped` z powodem. Regula jednostronna: skill `no-egress` nie idzie do
  modelu opuszczajacego maszyne; `cloud-allowed` moze dzialac lokalnie.

`loadEnabledDraftStageSkills` zwraca teraz `LoadedSkillStage` (wersja, egress,
zrodlo, wydawca, `signed`, `promptSha256`). `routes/draft.ts` przepuszcza skille
przez bramke przed uruchomieniem i loguje:

- `custom_skills` - rekordy `{ id, version, prompt_sha256, source, egress, publisher, signed }`
- `skipped_skills` - to samo plus `reason`

Bez nowej kolumny, bez migracji, bez nowego `event_type` - a wiec bez piatki
luster z precedensu `connector.toggle`. Suma kontrolna w lancuchu hashy wystarcza,
bo **lancuch przechowuje historie**: da sie wykazac, ktora tresc dzialala ktorego
dnia, porownujac sumy miedzy wpisami.

## Dlaczego NIE admission flow z legalise

Model zagrozenia jest inny. W legalise skille importuje uzytkownik do
wspoldzielonego serwera, wiec pytanie brzmi "czy ten obcy skill jest zlosliwy" -
stad przeplyw zatwierdzen z rolami. W Patronie (desktop, jednoosobowy) adwokat
**jest** organem zatwierdzajacym; karta zatwierdzenia dla samego siebie to
ceremonia, nie kontrola. Realne pytania to "czy skill jest tym, co zainstalowano"
i "czy wolno mu bylo wyjsc poza maszyne" - i oba zamyka ten ADR.

## Konsekwencje

### Plusy

- Dziennik odpowiada na pytanie regulatora o TRESC, nie tylko o nazwe.
- Podmiana skilla pod tym samym identyfikatorem staje sie wykrywalna bez
  podpisywania paczek (ADR-0049 nadal potrzebny do dowodu AUTORSTWA).
- Pole `egress` przestalo byc martwa deklaracja w UI.
- Skill pominiety przez bramke jest zapisany JAWNIE - nie znika po cichu.
- Zero nowych zaleznosci, zero migracji, zero zmian schematu.

### Minusy i ograniczenia

- **`egress` to deklaracja skilla o samym sobie, nie dowod.** Bramka egzekwuje
  to, co autor zadeklarowal; skill deklarujacy `cloud-allowed` nadal moze robic
  w promptcie co chce. To wykrywalnosc i zapis, NIE izolacja. Prawdziwa izolacja
  wymagalaby ograniczenia narzedzi dostepnych w trakcie dzialania skilla -
  osobna i duzo wieksza praca.
- **Suma kontrolna nie dowodzi pochodzenia.** Wykrywa zmiane, nie wskazuje, kto
  ja wprowadzil. Podpis paczki = rezerwacja ADR-0049, wspolna z ADR-0142.
- **Bramka pomija skill CICHO dla uzytkownika** - zapis idzie do audytu, ale UI
  nie mowi jeszcze "pominieto skill X, bo wybrales model chmurowy". To dlug UI,
  swiadomy: lepiej pominac i zapisac niz wyslac wbrew deklaracji.
- **Zakres = `surface: draft-stage`.** Jedyna dzis istniejaca powierzchnia.
  Nowa powierzchnia musi przejsc przez te sama bramke - inaczej luka wroci.
- Skille WBUDOWANE (`recenzent`, `adwokat`, `pisz-po-ludzku`) nie maja sumy
  kontrolnej: ich tresc siedzi w `defense.ts`, wiec jest wersjonowana z kodem
  i objeta podpisem instalatora. Osobna kwestia po ich wyniesieniu do paczek.

### Wymagane MAJOR/MINOR konstytucji

- **v1.7.1 -> v1.7.2** - PATCH. Wzbogacenie istniejacego wpisu audytowego o pola
  integralnosci oraz egzekwowanie deklaracji, ktora juz byla czescia kontraktu
  manifestu (ADR-0094). Bez zmiany schematu bazy, kontraktow rol i API. Zmiana
  zachowania dotyczy wylacznie przypadku sprzecznego z deklaracja skilla, ktory
  wczesniej przechodzil wbrew niej.

## Status weryfikacji

- [x] `lib/skills/integrity.ts` - `skillPromptSha256` + `partitionSkillsByEgress`
- [x] `loadEnabledDraftStageSkills` zwraca wersje, egress i sume kontrolna
- [x] `routes/draft.ts` - bramka przed uruchomieniem, `custom_skills` + `skipped_skills`
- [x] 13 testow (stabilnosc sumy, czulosc na zmiane tresci, polskie znaki,
      niezaleznosc od kolejnosci kluczy, kierunek bramki, kolejnosc instalacji)
- [x] backend 1440 pass / 0 fail, tsc czysty
- [ ] UI: komunikat "pominieto skill X" w widoku pisma
- [ ] Podpis paczki skilla (ADR-0049) - dowod autorstwa, nie tylko zmiany
- [ ] Suma kontrolna dla skilli wbudowanych po wyniesieniu ich z `defense.ts`
- [ ] Bramka dla przyszlych powierzchni innych niz `draft-stage`

## Licencja

Wzorzec "rzadzony lancuch dostaw skilli" zaobserwowany w
[b1rdmania/legalise](https://github.com/b1rdmania/legalise) (MIT) i **swiadomie
niezaadoptowany w calosci** - patrz sekcja "Dlaczego NIE admission flow".
Implementacja MateMatic od zera. Patrz THIRD_PARTY_INSPIRATIONS.md.
