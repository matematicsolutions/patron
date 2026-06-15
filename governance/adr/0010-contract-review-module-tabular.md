# ADR-0010: Contract Review Module - tabular review umow w Patronie

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady**: Konstytucja AI Patrona v1.1.1, Art. 1 (lokalnosc - umowy
nie wychodza poza serwer kancelarii), Art. 3 (audytowalnosc - kazda ekstrakcja
per komorka tabeli logowana w hash-chain), Art. 4 (neutralnosc dostawcow -
extraction worker uzywa konfigurowalnego LLM, nie Gemini hardcoded), Art. 5
(tajemnica zawodowa - umowy NDA/M&A to scisle zastrzezone tresci), Art. 7
(minimalnosc - prawnik definiuje kolumny, Patron nie wymysla pol)
**Powiazane ADR**: ADR-0001 (hash-chain audit trail - kazda ekstrakcja
ma event), ADR-0003 (pseudonimizacja PII - aktywna przed wyslaniem tresci do
LLM), ADR-0005 (citation grounding mechaniczny - klikalna komorka cofa do
fragmentu zrodlowego), ADR-0006 (audit bundle AI Act art. 12 - eksport raportu
contract review jako artefakt zgodnosci), ADR-0007 (hybrid retrieval - chat nad
datasetem korzysta z grafu cytowan)
**Inspiracja cherry-pick**: [jamietso/Tabular_Review](https://github.com/jamietso/Tabular_Review)
(MIT, 60 gwiazdek, FastAPI + React 19 + Docling + Google Gemini, autor
Jamie Tso, 10 commitow, v0.0.0). **NIE forkujemy** - cherry-pick patternu UX i
integracji Docling. Caly pipeline AI Patron pisze od zera pod multi-provider +
RODO-safe + Postgres persistence + audit trail.

## Decyzja

Patron dostaje nowy **modul "Contract Review"** - drugi pierwszoplanowy widok
obok istniejacego "Chat / Research" - skierowany na scenariusz **bulk audit
umow** (due diligence M&A, audyt portfela kontraktow, weryfikacja kontrahentow).

Modul oferuje:

1. **Excel-like grid** - kazdy wiersz to jedna umowa, kazda kolumna to pole do
   wyciagniecia (data, strona, kwota, klauzula limitacji odpowiedzialnosci,
   prawo wlasciwe, sad wlasciwy, klauzula MFN, klauzula change of control,
   tail period exclusive itp.).
2. **Dynamic schema** - Operator (lub prawnik z uprawnieniem) definiuje kolumny
   prompt natural-language ("Jakie jest prawo wlasciwe umowy?", "Czy jest
   klauzula change of control? Cytuj fragment.").
3. **Per-cell citation back-jump** - kliknij komorke -> Patron pokazuje fragment
   zrodlowy z dokumentu z highlightem (uses ADR-0005 citation grounding).
4. **Chat over dataset** - "Ktora umowa ma najbardziej dla nas niekorzystna
   klauzule MFN?" - chat dziala nad pelnym datasetem (uses ADR-0007 hybrid
   retrieval, scoped do tego projektu contract review).
5. **Export** - `.docx` summary report + `.csv` raw dataset + audit bundle
   (ADR-0006).

## Kontekst

Patron dzisiaj operuje **per sprawa pojedynczo** - prawnik otwiera sprawe,
Patron robi research, drafting, RAG po aktach. To pokrywa **80% pracy
prawnika transakcyjnego/sporowego**, ale **NIE pokrywa** scenariusza, gdy:

- Kancelaria dostaje pakiet 47 umow do audytu w 5 dni (due diligence przed
  przejeciem spolki).
- Klient korporacyjny prosi o "ranking ryzyka" w portfelu 120 kontraktow
  dostawczych (klauzule limitacji, koniecznosc renegocjacji).
- IOD audytuje wszystkie umowy powierzenia przetwarzania danych w kancelarii
  (compliance art. 28 RODO).

Te scenariusze wymagaja **macierzy** - jednego widoku gdzie kazda umowa jest
wierszem, kazde interesujace pole kolumna, a prawnik klika do zrodla zeby
zweryfikowac. Dzisiaj prawnicy robia to **recznie w Excel'u**, kopiujac
kawalki umow, marnujac 2-3 dni juniora.

**Tabular_Review pokazuje, ze to da sie zrobic w 360 liniach kodu** (89 lin
Python backend Docling wrapper + 245 lin TS Gemini service + 27 lin TS
documentProcessor + React grid component). Architektura jest czysta: backend
tylko konwertuje PDF do markdown, frontend trzyma cala logika AI i grid.

Problem: **Tabular_Review w obecnej formie jest NIE DO WDROZENIA w kancelarii** -
4 critical issues (patrz nizej "Czego NIE bierzemy").

Decyzja: **cherry-pick patternu UX + integracji Docling, caly pipeline AI
przepisujemy pod architekture Patrona** (multi-provider LLM, API key na
backendzie, Postgres persistence, audit trail per ekstrakcja, pseudonimizacja
PRZED ekstrakcja).

## Co bierzemy z Tabular_Review (cherry-pick)

1. **Pattern UX "Excel-like grid + dynamic schema columns"** - jest sprawdzonym
   UI dla bulk document review (uzywany w Kira Systems, Luminance, Casetext,
   Tabular_Review). Prawnicy znaja Excel, nie wymaga onboardingu.
2. **Pattern "per-cell citation back-jump"** - klikalna komorka cofa do
   fragmentu zrodlowego z highlightem. Implementacja ADR-0005 w nowym
   kontekscie (citation grounding mechaniczny dziala identycznie - cytat ma
   offset w dokumencie zrodlowym).
3. **Integracja z Docling** (IBM, MIT) - Tabular_Review uzywa
   `docling.document_converter.DocumentConverter` z opcja MPS dla Apple Silicon.
   Patron juz ma `backend/src/lib/preprocess/` (markitdown + opendataloader-pdf).
   **Dodajemy Docling jako trzecia opcje** dla umow (lepszy reading-order na
   tabelach klauzul niz markitdown). Patrz reference w MEMORY operacyjnej -
   ["Reading PDFs - drabinka decyzyjna"].
4. **Wzorzec backend ultra-czysty (89 lin)** - jako referencja prostoty.
   Patrona backend extraction worker ma byc rownie chudy - tylko orkiestracja,
   nie business logic.

## Czego NIE bierzemy (4 critical issues)

1. **Gemini-only out of the box** = naruszenie Konstytucji Art. 4 (neutralnosc
   dostawcow). Patron musi pozwolic kancelarii uzyc Ollama (lokalnie),
   Claude (Anthropic), Gemini (Google) **wymiennie** dla extraction worker.
   API key dostawcy lezy w bazie sekretow backendu, nie w frontendzie.
2. **`VITE_GEMINI_API_KEY` w frontendzie** = CRITICAL anti-pattern security.
   Tabular_Review bundluje klucz Gemini do `dist/` ktore serwuje przegladarce -
   kazdy uzytkownik widzi klucz w DevTools. Patron **MUSI** miec wszystkie
   wywolania LLM z backendu, frontend rozmawia z Patron API, nigdy
   bezposrednio z Google/Anthropic/Ollama.
3. **Brak persistence backendu** (v1 trzyma stan w pamieci frontu, PR #2 dodal
   localStorage). Patron pisze projekt contract review do **Postgres** -
   tabela `projects_contract_review`, `documents_contract_review`,
   `cells_contract_review` z RLS (Row Level Security) per kancelaria + audit
   trail per komorka (hash-chain ADR-0001).
4. **`mlx_vlm` w `server/requirements.txt`** = Apple Silicon only dependency,
   na Linux/Windows zlamie install. Patron stack jest Linux Docker - **NIE
   instalujemy `mlx_vlm`**, Docling dziala na CPU acceleration (lub na
   `AcceleratorDevice.AUTO`).

Plus drobne:
- Zero testow w upstreamie - my piszemy testy unit + integration od poczatku
  (Patron bramka jakosci pre-merge z `AGENTS.md` - "nie commituj jezeli testy
  fail").
- CORS `allow_origins=["http://localhost:..."]` hardcoded - Patron CORS jest w
  warstwie reverse proxy (Caddy), nie w aplikacji.
- Brak auth / multi-tenant - Patron juz ma role Administrator / Operator /
  Inspektor + RLS opisane w `governance/IMPLEMENTATION_PLAYBOOK.md` (rozdzial
  RACI); Art. 5 Konstytucji wymaga zachowania tajemnicy zawodowej takze przy
  podziale na role.
- Brak rate limiting - Patron ma rate limiter w warstwie API (LLM calls = drogi
  zasob).

## Refactor pod architekture Patrona

| Warstwa Tabular_Review | Refactor Patrona |
|---|---|
| `server/main.py` (89 lin FastAPI Docling wrapper) | `backend/src/lib/preprocess/docling.ts` - service owijajacy Docling przez child_process / Python subprocess. Dziala obok markitdown / opendataloader. |
| `services/geminiService.ts` (245 lin Gemini calls) | `backend/src/services/contract-review/extraction.ts` - extraction worker uzywajacy istniejacej warstwy LLM Patrona (multi-provider). Per komorka tabeli = jeden job w queue. Job loguje hash-chain. |
| `services/documentProcessor.ts` (27 lin) | Frontend `frontend/src/lib/contract-review/upload.ts` - upload do Patron API, kolejkuje Docling conversion. Frontend NIE widzi backendow ekstrakcji. |
| Frontend React grid (uncounted, w `components/`) | `frontend/src/views/contract-review/Grid.tsx` - React Table 8 + virtualized rows (TanStack Table) + per-cell citation popover (uses ADR-0005 citation back-jump w istniejacym CitationPopover komponencie). |
| Frontend chat | `frontend/src/views/contract-review/Chat.tsx` - reuse'uje istniejacy ChatPanel Patrona, scope filter na `project_id`. |
| `VITE_GEMINI_API_KEY` | Tabela `provider_keys` w Postgres (zaszyfrowane per kancelaria, dostepne tylko backendowi). |
| Brak persistence | Schema `contract_review` w `backend/schema.sql` - tabele projects/documents/columns/cells z RLS i audit FK. |

## Plan migracji (T1-T6, ~8 tygodni)

- **T1 (1 tydz) Foundation backend**: schema Postgres, Docling subprocess wrapper, pipeline preprocess umowy -> markdown -> chunked text. Testy unit Docling z 5 sample umowami (NDA, dostawa, M&A, najem, IT outsourcing).
- **T2 (1 tydz) Extraction worker**: per komorka = job w queue. Pseudonim PII (ADR-0003) PRZED wyslaniem do LLM. Multi-provider (Ollama default, Claude/Gemini opt-in z `provider_keys`). Audit log event `cell.extracted` z hash-chainem (ADR-0001).
- **T3 (1 tydz) Citation grounding**: extraction worker zwraca nie tylko wartosc komorki ale tez offset cytatu w dokumencie zrodlowym (uses ADR-0005). Test mechaniczny: 100% komorek ma cytat zwerifikowany w tekscie zrodlowym, inaczej `confidence: low`.
- **T4 (2 tyg) Frontend grid + dynamic schema**: TanStack Table + virtualization (1000 umow w widoku bez frame drop). Dynamic schema columns editor (prawnik dodaje kolumne prompt-em). Per-cell citation popover.
- **T5 (1 tydz) Chat over dataset**: scoped chat na `project_id`, hybrid retrieval (ADR-0007) ograniczony do dokumentow projektu. RAG zwraca cytaty z konkretnych umow.
- **T6 (1 tydz) Export + audit bundle**: `.docx` summary report z naglowkiem kancelarii, `.csv` raw dataset, audit bundle (ADR-0006) jako artefakt zgodnosci AI Act art. 12 dla projektu.
- **T7 (1 tydz) Pilot na zanonimizowanym portfelu** - 20-30 umow testowych (mix typow). Pomiar: czas vs reczna metoda (junior 2 dni vs Patron 20 min?), jakosc (recall na klauzule MFN/change of control - test set z pre-known answers).

Bramki:
- Po T2 - Operator moze wyciagnac jedna kolumne z jednej umowy w UI dev (sanity check).
- Po T4 - Operator moze stworzyc projekt z 5 umowami + 5 kolumnami i zobaczyc wypelniony grid.
- Po T7 - Patron Contract Review jest gotowy do pilotazu u jednego klienta (M&A boutique).

## Konsekwencje

**Pozytywne:**

- Patron pokrywa **kolejne 15% scenariuszy kancelarii** (bulk audit, due
  diligence M&A, portfela kontraktow IOD).
- Drabina sprzedazowa zyskuje argument: wdrozenie 30-150k nie tylko
  research/drafting jednej sprawy, ale tez "47 umow w 2h zamiast 2 tygodni
  juniora".
- Material edukacyjny: BW tom "Tabular contract review w kancelarii AI -
  pattern, ryzyka, RODO-safe wdrozenie".
- Cherry-pick czysty: bierzemy pattern UX i Docling, pipeline AI nasz wlasny,
  zero IP-risk.

**Negatywne / koszty:**

- Skala pracy ~8 tygodni dev, blokuje inne fazy roadmapy (po Fazie 6 pamieci
  z gbrain). Decyzja Wieslawa: kiedy.
- Nowy widok = nowy testing burden, nowe edge cases (extraction quality na
  roznych typach umow varies).
- Postgres schema rosnie - nowe tabele projects/documents/columns/cells z
  potencjalnie tysiacami komorek per projekt. Sprawdzic plan
  partitionowania / archiwizacji ukonczonych projektow.
- Dodatkowa zaleznosc Docling (Python) w stacku Patrona - cross-language
  subprocess overhead. Alternatywa: zostawic markitdown TS-native dla
  zwyklych dokumentow, Docling tylko dla contract review (heavier).

**Ryzyka:**

- **Extraction quality** - klauzule prawnicze sa subtelne ("limitacja
  odpowiedzialnosci do wartosci kontraktu" vs "limitacja do tej kwoty plus
  szkody umyslne" - nie kazdy LLM to chwyci). Mitigacja: test set z
  pre-known answers, A/B Ollama vs Claude vs Gemini, prawnik akceptuje
  komorki przed eksportem.
- **Confidence ratings** - false confidence to gorsze niz brak odpowiedzi.
  Mechaniczna walidacja cytatu (ADR-0005) jest minimum, dorzucic
  `confidence_score` od modelu.
- **Hallucination ryzyko** - LLM moze wyciagnac klauzule ktorej nie ma w
  umowie. Mitigacja: cytat MUSI byc fizycznie obecny w tekscie zrodlowym
  (mechaniczna weryfikacja po ekstrakcji), inaczej komorka `null` +
  `confidence: failed`.

## Atrybucja

Wzorzec architektoniczny (pattern UX Excel-like grid + dynamic schema +
per-cell citation + chat over dataset + ultra-czysty Docling wrapper):
cherry-pick z [jamietso/Tabular_Review](https://github.com/jamietso/Tabular_Review)
(MIT, autor Jamie Tso, 2025).

Implementacja pipeline AI Patrona, schema Postgres, audit trail per komorka,
multi-provider LLM, pseudonimizacja PRZED LLM, citation grounding mechaniczny -
**napisane od zera** pod architekture Patrona i wymagania kancelarii polskich.
NIE jest to fork ani tlumaczenie.

Wpis do `THIRD_PARTY_INSPIRATIONS.md` przy commicie tego ADR:

```markdown
### jamietso/Tabular_Review (MIT)

Snapshot 2026-05-21 (commit a2d01ee). Pattern UX "tabular contract review"
i integracja Docling jako referencja architektoniczna dla **ADR-0010 Contract
Review Module**. NIE forkujemy kodu - implementacja Patrona przepisana od
zera pod multi-provider LLM, Postgres persistence, audit trail per komorka,
RODO-safe (Ollama default).
```

## Decyzja oczekiwana od Wieslawa

1. **Czy idziemy z ADR-0010 jako Faza 7** (po Fazie 6 pamieci gbrain) - tak/nie?
2. **Priorytet vs inne kandydaty Fazy 7** (audit bundle UI? alerts module?
   drugi konektor MCP?).
3. **Wpiecie ADR** + bump Konstytucji v1.2.0 z dodatkiem sekcji "Modules"
   (uzupelnienie opisu architektury Patrona poza core research, bez
   modyfikacji 9 istniejacych artykulow Konstytucji v1.1.1) - tak/nie?
4. **wewnetrzny review 2x runda** ZAREZERWOWANE PRZED commitem (zgodnie z
   wewnetrznego review tresci w MEMORY operacyjnej).
