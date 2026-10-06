# ADR-0137: Karty zatwierdzenia mutacji (mutation approval cards) - zapis agenta za bramka czlowieka

**Status**: Przyjety - ship ZA FLAGA (2026-06-29, akceptacja WM). Wzorzec jak ADR-0101/0102 (Konstytucja v1.6.0/v1.6.1): implementacja wjezdza za flaga `PATRON_MUTATION_APPROVAL` (domyslnie OFF = zero zmiany zachowania; **od 2026-10-06 domyslnie ON - patrz sekcja "Aktualizacja 2026-10-06"**), a **FLIP flagi na ON oraz merge do `main` pozostaja bramkowane: review round 2 + eval** (Sec 6.1). Review round 1 PRZESZEDL (matematic-patron-pr-review-pl na pelnym diffie Phase 2-4: 0 blockerow; 3 should-fix naprawione - parytet edits staged/inline, RODO art. 17/20 dla `mutation_approvals` w rodo-delete/rodo-export; mikro-race approve w trybie serwerowym udokumentowany, desktop single-user niewrazliwy). Konstytucja bump 1.7.0 (MINOR - nowy wpis audit_log `mutation.approval.decision`, Sec 6.1). US1+US2 zaimplementowane i zademonstrowane E2E. Dotyka sciezki wykonania narzedzi (tool-dispatch) i audit_log. Inspiracja architektoniczna: open-mercato (MIT, `prepareMutation` + `confirm-required` + pending approval + approval-card), zaadaptowana do prymitywow PATRONa - NIE port kodu.

## Kontekst

PATRON jest agentem human-in-the-loop dla kancelarii, ale dzis narzedzia agenta o skutkach ubocznych wykonuja sie **natychmiast**, bez jawnego zatwierdzenia: `edit_document` (tracked changes), `generate_docx`, `add_comments`, `resolve_tracked_change`, eksport. Decyzja agenta o zapisie nie jest bramkowana przez czlowieka ani odrebnie audytowana jako akt zatwierdzenia.

To luka governance wzgledem **AI Act art. 14 (nadzor czlowieka)**: dla aktow nieodwracalnych / na zewnatrz (zlozenie pisma, wyslanie, eksport, delete) parytet agent-native KONCZY sie na granicy - tool przygotowuje draft, czlowiek wykonuje (zasada z CLAUDE.md MateMatic). Brakuje mechanizmu, ktory tej zasadzie nadaje pierwszorzedny ksztalt w produkcie.

Istniejace prymitywy (recon 2026-06-29):
- **`cell-review.ts`** (ADR-0126): per-komorka `action: approved|rejected|corrected` + `reviewedBy/reviewedAt`, fail-closed (tylko czlowiek), historia w audit_log. Najbardziej dojrzaly wzorzec human-in-the-loop.
- **`operatorApproved`** (ring-policy, ADR-0027): statyczna zgoda per-konektor, NIE per-akcja - **nie nadaje sie** do kolejki staging.
- **`document_edits.status`** (`pending|accepted|rejected`): istniejacy enum statusu dla mutacji dokumentu.
- **audit_log** (ADR-0035): hash-chain, whitelist `EVENT_TYPES`, payload bez PII.

## Decyzja

1. **Nowy, pierwszorzedny mechanizm: tabela `mutation_approvals`** (kolejka akcji oczekujacych). Per-akcja staging (jak cell-review semantyka), NIE statyczny flag (jak operatorApproved). Stany: `pending -> approved | rejected`; po `approved` wykonanie i znacznik `executed_at` / `execution_error`.
2. **Bramka przed wykonaniem w `tool-dispatch.ts`.** Czysta funkcja `stageMutationApproval()` (wzorzec jak `enforceEgressGuard` z `routing/guard.ts`) decyduje, czy akcja idzie do stagingu. Jezeli tak - zapis `pending`, odpowiedz do klienta z id karty + komunikat "oczekuje na zatwierdzenie"; akcja NIE wykonuje sie.
3. **Zatwierdzenie/odrzucenie tylko przez czlowieka** (`requireAuth`, fail-closed jak cell-review). `approve` wykonuje oryginalne narzedzie; `reject` zamyka z powodem.
4. **Audyt: nowy `event_type "mutation.approval.decision"`** w hash-chainie (kto/kiedy/typ/decyzja, bez pelnego payloadu - jak defense.pipeline). Dodany do whitelist wg precedensu `connector.toggle` (ADR-0133): `audit.ts` + `schema.sqlite.ts` CHECK + `schema.sql` CHECK + migracja SQLite rebuild + migracja Postgres.
5. **Scoping** przez `user_id` (jak `projects`/`documents`); dual schema SQLite (desktop) + Postgres (serwer).
6. **Granica:** architektura gateway/ring-policy/cell-review NIEZMIENIONA - approval-cards dziala NAD sciezka narzedzi, nie zastepuje istniejacych bramek. Inbound (input-security) bez zmian; to mechanizm dla OUTBOUND skutkow.

## Konsekwencje

**Pozytywne:** domkniecie AI Act art. 14 jako ficzer produktu (rozniconik sprzedazowy); slad zatwierdzen w hash-chainie (art. 12); reuzycie sprawdzonych wzorcow (cell-review, audit, requireAuth, patronApi) bez duplikacji; back-compat (low-risk mutacje moga zostac natychmiastowe wg konfiguracji).

**Koszty/ryzyka:** dotyka tool-dispatch (sciezka krytyczna) - wymaga testow regresji czatu; SQLite CHECK zmienia sie tylko przez rebuild (12-krokowy, precedens connector.toggle v3) - ryzyko migracji, mitygacja: 6 testow jak przy connector.toggle (swieza baza + rebuild starej + przejscie CHECK + przezycie wiersza = hash-chain ok); UX kolejki approvali (osobna strona) - kolejne US.

**Odrzucone alternatywy:** (a) reuzycie `operatorApproved` - to statyczny per-konektor flag, nie kolejka per-akcja; (b) inline-subscriber blocking (model open-mercato "19-step pipeline") - PATRON nie ma event-bus subscriberow dla mutacji dokumentow, a synchroniczne blokowanie nie daje kolejki do asynchronicznego zatwierdzenia przez czlowieka; (c) rozszerzenie `document_edits.status` - dotyczy tylko tracked-changes, nie generycznych akcji (generate/comments/export).

**Powiazania:** ADR-0027 (ring-policy), ADR-0126 (cell-review), ADR-0035 (audit whitelist), ADR-0133 (precedens dodania event_type). Spec: `.matematic/spec/004-mutation-approval-cards/`.

## Aktualizacja 2026-10-06

**Decyzja wlasciciela produktu: karty zatwierdzen sa WLACZONE DOMYSLNIE.** Powod: audyt 2026-09, znalezisko B-02 - w domyslnej konfiguracji posluszny model wykonywal polecenie wstrzykniete w tresc akt (edycja pisma, zapis pamieci trwalej) bez czlowieka w petli, a input-security w trybie OPEN niczego nie wstrzymuje. Flip zastepuje warunek "review round 2 + eval przed FLIPEM" z naglowka tego ADR - podjety swiadomie przez wlasciciela produktu.

Semantyka `PATRON_MUTATION_APPROVAL` (`mutationStagingMode()` w `backend/src/lib/mutation-approval.ts`):

| Wartosc | Tryb |
|---|---|
| brak, pusta, `true`, `all`, kazda nierozpoznana | `all` - kazda akcja agenta o skutkach ubocznych czeka na karcie |
| `high-stakes` | `high-stakes` - fail-closed (bez metadanych deliverable dziala jak `all`) |
| `false`, `off`, `0`, `no` | `off` - swiadome wylaczenie, zapis inline jak przed 2026-10-06 |

Wartosc nierozpoznana (literowka) daje `all`, nie `off`: bramka zapisu jest fail-closed, a nieczytelna konfiguracja nie moze jej po cichu wylaczyc. Desktop ustawia zmienna jawnie (`desktop/main.js`, `?? 'true'`), a Operator moze ja nadpisac.

Zakres bramki (`StagedToolName`): `edit_document`, `generate_docx`, `add_comments`, `replicate_document`, `remember` (dwa ostatnie od audytu B-04).

Czat mowi o wstrzymaniu wprost: tura emituje zdarzenie SSE `mutation_staged` (`tool`, `approval_id`, bez argumentow mutacji). Zdarzenie jest utrwalane w `events` wiadomosci, a UI pokazuje "akcja czeka na zatwierdzenie" z linkiem do skrzynki kart (`/account/approval-cards`). Bez tego sygnalu wstrzymana akcja byla w czacie niewidoczna.

Bez nowego `event_type` i bez migracji: wstrzymanie i decyzja ida dalej jako `mutation.approval.decision` (`phase: "staged"` / decyzja).

**Konsekwencje:** kazda edycja, wygenerowanie lub kopia dokumentu, komentarz i zapis pamieci agenta wymaga teraz klikniecia w skrzynce kart. To wiecej pracy dla prawnika, ale zadna z tych akcji nie wykona sie juz na polecenie ukryte w aktach. Kryterium odbioru: `backend/audit-2609/B-02-doc-injection-obedient-model.test.ts` zielony w obu wariantach (domyslnym i utwardzonym).

