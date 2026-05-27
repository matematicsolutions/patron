# ADR-0015: In-place session branching JSONL dla audit trail i eksploracji wariantow

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-21
**Powiazane zasady** (Konstytucja Patrona v1.1.1, zweryfikowane wzgledem `governance/CONSTITUTION.md`):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - sesje JSONL skladowane lokalnie w MinIO/Postgres, nigdy nie ida do chmury bez decyzji Operatora
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - **rdzen ADR**. Sesja JSONL z hash-chain entry per wiadomosc to ARTEFAKT zgodnosci. Drzewo wariantow pokazuje pelna historie decyzji prawnika (nie tylko ostateczna sciezke)
- **Art. 6 - Granica bledu** (human in the loop) - branching pozwala prawnikowi **wrocic** do wczesniejszego punktu decyzyjnego i sprobowac innego wariantu. Bez branching jedyna opcja to "od poczatku" - co zniecheca do eksploracji alternatyw
- **Art. 7 - Minimalnosc danych** (RODO art. 5 ust. 1 lit. c) - TTL na sesje JSONL (domyslne 90 dni dla sesji konsultacji, dluzej dla sesji powiazanej z aktem sprawy zgodnie ze standardem archiwizacji akt kancelaryjnych - **konkretny termin oraz wlasciwe podstawy korporacyjne do ustalenia w T1 z compliance officerem kancelarii**; jako twardy zakres dolny zwykle przyjmuje sie ogolny termin przedawnienia roszczen majatkowych z art. 118 Kodeksu cywilnego (6 lat - od nowelizacji z 2018 r.), nakladajacy sie z regulacjami korporacyjnymi obu samorzadow prawniczych dotyczacymi zachowania tajemnicy zawodowej i archiwizacji akt)

**Powiazane ADR**:
- ADR-0001 (hash-chain audit trail) - **kazda wiadomosc w sesji JSONL** ma odpowiedni `audit_event_id` w hash-chain. Sesja JSONL to widok user-facing tej samej prawdy co audit log
- ADR-0006 (audit bundle AI Act art. 12) - eksport sesji JSONL → HTML to **piaty artefakt zgodnosci** obok deliverable + debate transcript + verification + cost log
- ADR-0009 (overnight memory consolidation) - **compaction sesji JSONL** (gdy sesja > N wiadomosci, podsumowuj starsze) korzysta z patternu konsolidacji gbrain
- ADR-0010 (contract review module) - sesje per kontrakt z wariantami "ten sam kontrakt, dwa rozne uklady kolumn" beda branchami tej samej sesji
- ADR-0011 (span-level offsets) - cytaty w wiadomosciach sesji uzywaja tego samego formatu offsetow

**Inspiracja cherry-pick**: [earendil-works/pi](https://github.com/earendil-works/pi) (MIT, 52.3k gwiazdek, v0.75.4 z 20.05.2026). **NIE forkujemy** - cherry-pick patternu storage sesji. Caly kod Patrona w `backend/src/lib/sessions/` napisany od zera.

## Decyzja

Patron przechowuje sesje uzytkownika (Chat / Contract Review / Research) jako pliki **JSONL** (jedna wiadomosc per linia) w nastepujacym formacie:

```jsonl
{"id":"01HX...","parentId":null,"role":"system","content":"...","ts":"2026-05-21T10:00:00Z","audit_event_id":"evt_001","provider_id":"anthropic","model_id":"claude-opus-4-7","tokens_in":120,"tokens_out":0,"case_id":"CASE_2026_47","pseudonim_session_id":"ps_xyz"}
{"id":"01HX...","parentId":"01HX...","role":"user","content":"...","ts":"2026-05-21T10:00:15Z","audit_event_id":"evt_002",...}
{"id":"01HX...","parentId":"01HX...","role":"assistant","content":"...","ts":"2026-05-21T10:00:45Z","audit_event_id":"evt_003",...}
```

`parentId` tworzy **drzewo**, nie liste. To pozwala:

1. **In-place branching** - prawnik klika "rozwidlc tutaj" na wczesniejszej wiadomosci, dostaje nowa galaz bez utraty oryginalu.
2. **Audit trail completness** - audit bundle (ADR-0006) zawiera CALE drzewo, nie tylko sciezke do ostatecznej decyzji.
3. **Cofniecie w czasie** - "wrocmy do momentu zanim Patron zaproponowal klauzule MFN" = klik na ten wezel.
4. **Eksport do HTML** - drzewo sesji renderowane jako interaktywny dokument (zwijane galezie, highlight aktywnej sciezki).
5. **Compaction** - stare galezie nieaktywne > 30 dni podsumowywane przez ADR-0009 worker, oryginal w archive.

## Kontekst

**Stan dzisiaj** (2026-05-21):
- Patron przechowuje sesje w Postgres `messages` table (forka willchen96/mike). Format: linear list per `conversation_id`.
- Nie ma branching. Prawnik chcacy sprobowac innej decyzji albo nadpisuje historie (tracimy oryginalna sciezke) albo zaklada nowa konwersacje (tracimy kontekst do wczesniejszego punktu).
- ADR-0001 (audit log) loguje kazda interakcje LLM, ale **nie ma 1:1 wiazania** miedzy wiadomoscia user-facing a audit event. Trzeba szukac po timestamp + user_id.
- ADR-0006 (audit bundle) eksportuje "transcript" jako rendered Markdown - traci strukture decyzji (drzewo).

**Problem operacyjny**:
- **Due diligence M&A** - prawnik analizuje 47 umow, na 12. odkrywa wzorzec → chce wrocic do umowy 5. i przeanalizowac z nowej perspektywy. Dzisiaj: nowa konwersacja od zera albo recznie kopiowanie.
- **Audit AI Act art. 12** - audytor pyta "pokaz cala historie decyzji ktora doprowadzila do tego draftu pozwu". Linear log nie pokazuje rozwidlen ("Patron proponowal klauzule A, prawnik odrzucil, sprobowal B, zaakceptowal").
- **Verification AI Act art. 6 (human in the loop)** - dowod ze prawnik faktycznie eksplorowal warianty wymaga zachowanego drzewa, nie wyglandowanej historii.

**Pi pokazuje, ze JSONL z `id` + `parentId`** w jednym pliku jest sprawdzonym sposobem na drzewa sesji. 52.3k gwiazdek + v0.75.4 = pattern boja zweryfikowany. Pi eksportuje sesje do HTML standalone - to dokladnie czego Patron potrzebuje dla audit bundle.

Decyzja: **cherry-pick formatu JSONL i patternu in-place branching, caly kod Patrona pisze od zera** pod polskie wymogi (case_id, pseudonim_session_id, hash_chain integration, TTL per typ sesji, retencja URP-zgodna).

## Co bierzemy z pi (cherry-pick)

1. **Format JSONL one-message-per-line** - append-only, latwo backup, latwo diffowac, latwo streamowac do storage.
2. **Pole `parentId` budujace drzewo** - prosta struktura, brak osobnych tabel "branches" w bazie. Drzewo wynika z relacji `parentId`.
3. **In-place branching** - branch zyje w tym samym pliku co parent (nie osobny plik per branch). Calosc sesji = 1 plik JSONL.
4. **Standalone HTML export** - calosc drzewa renderowana jako 1 plik HTML (Vue 3 + Tailwind inline / CDN fallback, jak w ADR-0012 viewerze).
5. **Compaction-aware tree** - wezel moze byc "skompaktowany" (podsumowanie zamiast pelnej tresci) z odsylaczem do archiwum oryginalu.

## Czego NIE bierzemy

- **Brak `case_id` i `pseudonim_session_id` w formacie pi** - dla pi to single-user dev tool, dla Patrona to **regulowany produkt prawny**. Patron rozszerza format o pola obligatoryjne: `case_id`, `pseudonim_session_id`, `audit_event_id`, `data_classification`.
- **Session sharing pi** (export do udostepniania OSS) - **RODO red flag**. Patron eksportuje sesje TYLKO jako audit bundle (artefakt zgodnosci, nie do publikacji).
- **Pi compaction algorithm** - Patron uzywa wlasnej polskiej logiki podsumowywania (ADR-0009 overnight consolidation z gbrain wzorem) - inne pole strategii decyzji niz pi.
- **Pi message queuing UI** (Enter steer / Alt+Enter follow-up) - to pattern terminal UI. Patron ma frontend Next.js z innym UX. **Watch list** - moze zaadoptowac pattern w przyszlosci jako osobny ADR UI.
- **Brand "pi" / "earendil"** - amerykanski projekt, my robimy polski legal product. Atrybucja w `THIRD_PARTY_INSPIRATIONS.md`.

## Konsekwencje

**Pozytywne**:
- Audit bundle (ADR-0006) dostaje **piaty artefakt** - drzewo sesji JSONL + HTML viewer. AI Act art. 12 compliance pelne, nie czesciowe.
- Prawnik moze eksplorowac warianty bez utraty oryginalu = wieksza wartosc Patrona w due diligence M&A i contract review (ADR-0010).
- Compaction (ADR-0009) ma jasna jednostke do podsumowania (galaz drzewa > N dni nieaktywna).
- Eksport HTML standalone = klient kancelarii / sad / regulator moga obejrzec sesje **bez instalacji Patrona** (tylko przegladarka).
- TTL per typ sesji jasno mapuje na URP art. 5 (retencja akt sprawy 6 lat) i Konstytucje Art. 7 (minimalnosc).

**Negatywne / koszty**:
- **Migracja istniejacych danych** - sesje w Postgres `messages` (linear) → JSONL z `parentId` (drzewo). ~2 tygodnie z testami migracji.
- **Zmiana modelu danych** - Postgres staje sie indexem nad JSONL (metadata, search), JSONL w MinIO staje sie source of truth. Dual write podczas migracji.
- **Refactor frontend** - widok historii konwersacji w Next.js musi obslugiwac drzewo, nie liste. ~1-2 tygodnie.

**Ryzyka**:
- Drzewo moze byc duze i kosztowne do renderowania (np. 500 wiadomosci, 20 branchow). **Mitigation**: virtualizacja w UI, lazy loading galezi nieaktywnych.
- Branching moze byc nadmiernie uzywany (prawnik branchuje co druga wiadomosc, drzewo eksploduje). **Mitigation**: UI sugerowanie compaction po N branchach, soft warning.
- Kolizja z ADR-0001 (audit log linear) - jak pogodzic drzewo sesji z linear hash-chain? **Decyzja**: hash-chain pozostaje linear (chronologiczny porzadek wywolan LLM), sesja JSONL ma drzewo (logiczna struktura decyzji). 1:1 mapping przez `audit_event_id`.

## Plan implementacji

| Faza | Zakres | Czas |
|---|---|---|
| **T1** | Schema sesji JSONL (`backend/src/lib/sessions/schema.ts`) z `zod`. Pole obligatoryjne + opcjonalne. Tests dla schema. ADR pol-typu (`session_type: chat | przeglad_tabelaryczny | research | audyt_umow`). | 4 dni |
| **T2** | Storage layer (`SessionStore`) - append-only JSONL w MinIO + metadata index w Postgres. Atomic append (single writer per session). Tests integration. | 1 tydzien |
| **T3** | In-place branching API - `branchFrom(messageId)` zwraca nowy `messageId` z `parentId = source`. Tests dla edge-cases (branch na branch, cykl, race). | 4 dni |
| **T4** | Migracja istniejacych `messages` Postgres → JSONL. Dual write podczas migracji (Postgres + MinIO 30 dni), w okresie dual-write **codzienny job reconcile** porownuje counts i hash content per session - rozjazd > 0 = alert do Administratora + automatyczny pause cutover. Cutover na JSONL jako SoT dopiero po 30 dniach **zero-rozjazd day-by-day**. Rollback: gdy w pierwszych 30 dniach po cutover wykryta luka, jeden `.env` flag `SESSION_SOT=postgres` przywraca Postgres jako SoT, JSONL zostaje archiwalnie. Skrypt migracji + rollback + dashboard reconcile. | 2 tygodnie |
| **T5** | Standalone HTML viewer (companion do ADR-0012). Vue 3 + Tailwind inline / CDN fallback. Drag-drop JSONL, renderowanie drzewa z collapsing, highlight aktywnej sciezki, eksport jako PDF dla archiwum. | 2 tygodnie |
| **T6** | Frontend refactor (Next.js) - widok historii konwersacji obsluguje drzewo. Lazy loading galezi. UI branching button na hover. | 1-2 tygodnie |
| **T7** | Integration z ADR-0006 audit bundle - JSONL + HTML jako piaty artefakt. Update bundle exporter. Tests regresji audit bundle. | 4 dni |
| **T8** | Integration z ADR-0009 overnight consolidation - compaction galezi > 30 dni nieaktywnych. Tests. | 1 tydzien |
| **T9** | TTL policy (default 90 dni / 6 lat dla `case_id != null`). Cron purge. Audit log dla purge events. | 3 dni |

**Lacznie**: ~8-10 tygodni dev. Rownoleglenie mozliwe (T1-T2-T3 sekwencyjnie, T5 mozna robic rownolegle z T6, T7-T8 rownolegle, T9 na koniec).

**Najlepsze okno**: po zamknieciu ADR-0014 (multi-provider). ADR-0014 dotyka warstwy LLM, ADR-0015 dotyka warstwy storage - nie wchodza sobie w paradne, ale logicznie ADR-0014 idzie pierwszy (audit log w sesji JSONL juz musi zawierac `provider_id`).

**Bumpa Konstytucji**: NIE. Ten ADR **wzmacnia** Art. 3 i Art. 6 ktore juz sa w v1.1.1, nie zmienia tresci. Po implementacji T1-T9 dopisujemy w `governance/CONSTITUTION.md` § "Implementacja Art. 3 i Art. 6" wskaznik do ADR-0015 - PATCH v1.1.3 (lub razem z ADR-0014 jako v1.1.2).

## Scope review (przed merge)

ADR-0015 dostaje **2x runda wewnetrznego review** (regula wewnetrzny review tresci). Zakres review:

1. Czy format JSONL z `parentId` faktycznie obsluguje wszystkie use-cases Patrona (chat, contract review, research, due diligence)?
2. Czy migracja Postgres → JSONL ma rollback? Co jak po 30 dniach okaze sie ze JSONL ma luki?
3. Czy hash-chain ADR-0001 + drzewo JSONL nie tworza dwoch source-of-truth dla tej samej prawdy? Jak rozumiec konflikty?
4. Czy TTL 90 dni / 6 lat pokrywa wszystkie wymogi URP/RODO? Czy nie ma luki dla sesji "research bez case_id ale powiazane z konsultacja"?
5. Czy compaction (ADR-0009) na drzewie nie traci istotnej informacji dla audytu AI Act art. 12?
6. Czy HTML viewer (T5) wymaga osobnego ADR (jak ADR-0012 wymagal dla tabular review), czy mozna w tym?

## Zalaczniki

- [pi session format docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md) (do walidacji w T1)
- [Konstytucja v1.1.1 Art. 3 i Art. 6](../CONSTITUTION.md) - tekst zasad
- [ADR-0001](./0001-hash-chain-audit-trail.md) - audit log (linear) z ktorym ADR-0015 (tree) musi sie pogodzic
- [ADR-0006](./0006-audit-bundle-art12.md) - audit bundle dostaje piaty artefakt
- [ADR-0012](./0012-self-contained-viewer-html.md) - precedens dla standalone HTML viewer (Vue 3 + Tailwind)
