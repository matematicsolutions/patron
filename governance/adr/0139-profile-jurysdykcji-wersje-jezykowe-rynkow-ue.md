# ADR-0139: Profile jurysdykcji dla wersji jezykowych rynkow UE (IT/DE/ES/FR)

**Status**: Proponowany (2026-07-03) — wymaga 2x wewnetrznego review + akceptacji WM.
Kierunek zatwierdzony przez WM ustnie ("6 wersji jezykowych z lokalnym kolektorem,
zaczynamy od rynku wloskiego"); zakres techniczny do potwierdzenia na tym ADR.

Aneks do [ADR-0132](./0132-locale-selection-jeden-jezyk-per-instalacja.md) i
[ADR-0135](./0135-jezyk-agenta-locale-metoda-substancja.md) — rozszerza locale
z pary PL/EN na 6 rynkow: **PL, EN, IT, DE, ES, FR**.

## Kontekst

PATRON jest dystrybuowany jako instalator per jezyk (PL i EN, GitHub Releases,
przycisk POBIERZ na matematicsolutions.com). Cel biznesowy: wersje dla najwiekszych
rynkow LegalTech UE — wloskiego, niemieckiego, hiszpanskiego i francuskiego — kazda
z **wlaczonym lokalnym konektorem prawa** (linia eu-legal-mcp: it/de/es/fr-eli).

ADR-0135 rozstrzygnal granice metoda/substancja dla pary PL/EN, gdzie EN to
"miedzynarodowe UI nad jurysdykcja PL+UE" — substancja (drafting pism, dyscyplina
SAOS) zostala polska. Rynek wloski czy niemiecki to INNA sytuacja: substancja
jurysdykcyjna musi byc krajowa (wloski ustroj sadow, dyscyplina Normattiva,
konwencje cytowania Gazzetta Ufficiale), a polskie bloki bylyby szumem i ryzykiem
merytorycznym.

Audyt 2026-07-03 wykryl przy okazji **blad wersji EN**: `desktop/main.js` nie
przekazywal backendowi zadnego `PATRON_LOCALE`, wiec agent w instalatorze EN
odpowiadal po polsku (default), mimo UI EN i samouczka EN.

## Decyzja

1. **Locale = profil rynku.** `AgentLocale`/`Locale` rozszerzone do
   `"pl" | "en" | "it" | "de" | "es" | "fr"`. Kazde locale niesie:
   slownik UI (`frontend/src/i18n/<locale>.ts`), profil jurysdykcji w promptach
   (`backend/src/lib/chat/prompts.ts`, rejestr `PROFILES`), zestaw i kolejnosc
   konektorow (`desktop/scripts/prepare-resources.cjs`) oraz samouczek
   (`docs/SAMOUCZEK_<LOCALE>.md`).
2. **Rejestr profili zamiast if-ologii.** `buildSystemPrompt(locale)` sklada
   [METHOD_BLOCK, langDirective, courts, discipline, drafting, capabilities]
   z `PROFILES[locale]`. PL i EN odtwarzaja sklad sprzed zmiany BAJT-W-BAJT
   (zero regresji, testy ADR-0135 pozostaja zielone).
3. **Substancja rynkow (IT/DE/ES/FR) jest krajowa i w jezyku rynku:**
   - ustroj sadownictwa (IT: ordinaria/Cassazione/TAR-Consiglio di Stato/Corte
     Costituzionale; DE: ordentliche + 4 Fachgerichtsbarkeiten + BVerfG;
     ES: 4 ordenes + TC; FR: dwa ordres + Conseil constitutionnel),
   - dyscyplina lokalnego konektora z JAWNYMI granicami pokrycia (IT: Normattiva
     legislacja + WYLACZNIE Corte Costituzionale, bez Cassazione — odsylamy do
     italgiure; DE: NeuRIS prawo federalne, bez Landesrecht; ES: BOE
     skonsolidowana legislacja, bez orzecznictwa — odsylamy do CENDOJ;
     FR: Legifrance LODA/kody + JURI, klucz PISTE wymagany, administracyjne
     — ArianeWeb),
   - konwencje cytowania i ZASADA DRAFTU (nigdy nie podpisuj za prawnika)
     w jezyku rynku.
   - **Pelne struktury pism procesowych (odpowiednik DRAFTING_PL) = na pull,
     po recenzji prawnika-native danego rynku.** Bloki v1 celowo lekkie:
     konwencje cytowania + granice + zasada draftu.
4. **Konektory per rynek** (prepare-resources): macierzysty konektor pierwszy
   i **ON**, `eu-sparql`/`eu-compliance` ON, pozostale krajowe obecne ale OFF,
   PL na koncu OFF; `fr-eli` zawsze OFF do podania klucza PISTE (NEEDS_KEY).
   `it-eli` dolaczony do bundla (3-sync + mirror: pipeline.ts APPROVED,
   prepare-resources MCP_SERVERS_PYTHON, mcp-servers.example.json,
   connectors.ts JURISDICTION_BY_CONNECTOR).
5. **Most locale desktop->backend (naprawa bledu EN):** prepare-resources
   zapisuje `backend/patron-locale.json`; `main.js` czyta go i ustawia
   `PATRON_LOCALE` dla backendu (jawny env Operatora ma pierwszenstwo).
6. **Fallback slownika lancuchowy** `<locale> -> en -> pl` (index.ts) — brakujacy
   klucz na rynku UE lepiej pokryc angielskim niz polskim; PL pozostaje zrodlem
   kluczy i ostatnia deska ratunku.
7. **Build per rynek jedna komenda:** `npm run build:it` (analogicznie pl/en/de/
   es/fr) — `desktop/scripts/build-locale.cjs` ustawia locale, jezyk NSIS (LCID)
   i kanoniczna nazwe artefaktu `PATRON-Setup-Windows[-XX].exe` + SHA256 do
   `dist/CHECKSUMS.txt`.
8. **Indeks Corte Costituzionale w buildzie IT:** best-effort ingest przy
   prepare (open data, 1956->dzis) do `backend/data/it-eli-caselaw/cost.sqlite`;
   main.js wskazuje go przez `IT_ELI_CASELAW_DB`. Brak indeksu = it_case_*
   zglasza brak wprost (fail-loud), legislacja dziala.

### Kolejnosc wdrozenia rynkow (decyzja WM)

IT (pierwszy: EN/IT/PL w pickerze POBIERZ) -> DE -> ES -> FR (ostatni z powodu
klucza PISTE w onboardingu). Slowniki UI wszystkich 4 rynkow powstaja od razu
(614 kluczy kazdy); release rynku wymaga dodatkowo: samouczek w jezyku rynku,
recenzja terminologii przez prawnika-native (bramka jakosci), build + smoke test.

## Konsekwencje

**Pozytywne:**
- Rownanie rynku: nowy rynek = slownik + profil + wpis konektora + build
  jedna komenda; architektura przestaje byc para PL/EN ze specjalnymi ifami.
- Naprawiony blad jezyka agenta w EN (dotychczas: UI EN, agent PL).
- Granice pokrycia zrodel nazwane wprost w promptach = mniejsze ryzyko
  halucynacji "wloskiej Cassazione z Normattivy" (spojne z citation-grounding).

**Koszt / dlug:**
- prompts.ts rosnie o 4 profile (cena jawnej substancji per rynek, jak w ADR-0135).
- Slowniki DE/ES/FR i bloki substancji wymagaja recenzji native-prawniczej przed
  releasem rynku (bramka, nie opcja) — do tego czasu buildy DE/ES/FR sa "gotowe
  technicznie, niewydane".
- Ingest Corte Cost wydluza build IT (jednorazowo, best-effort).

## Alternatywy odrzucone

| Alternatywa | Powod odrzucenia |
|---|---|
| Rynki na wzorcu EN (substancja PL wszedzie) | Wloski adwokat dostalby dyscypline SAOS i drafting polskich pozwow — szum + ryzyko merytoryczne |
| Jeden instalator z przelacznikiem jezyka w runtime | Sprzeczne z ADR-0132 (jeden jezyk per instalacja); rozjazd zestawu konektorow i samouczka; wiekszy instalator |
| Osobny fork repo per rynek | Drift 6 kopii powloki; wszystko poza slownikiem/profilem jest wspolne |
| Czekac z DE/ES/FR az IT sie sprzeda | Slowniki i plumbing sa tanie teraz (jedna sesja); DECYZJA wydania i tak pozostaje per rynek |

## Powiazania

- [ADR-0132](./0132-locale-selection-jeden-jezyk-per-instalacja.md) — jeden jezyk per instalacja
- [ADR-0135](./0135-jezyk-agenta-locale-metoda-substancja.md) — granica metoda/substancja (PL/EN bez zmian)
- [ADR-0133](./0133-wybor-konektorow-mcp-picker.md) / [ADR-0134] / [ADR-0136] — picker, polyglot runtime, bundlowany CPython
- Boutique/www: picker 6 wersji na /pobierz (www-matematic), liczniki KV per jezyk
