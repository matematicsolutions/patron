# ADR-0063: Frontend Draft odpowiedzi (UI pipeline obrony)

**Status**: PROPONOWANY (2026-05-28). Wystawia pipeline obrony (ADR-0058) jako UI w czacie: prawnik klika jeden guzik "Draft odpowiedzi" przy wiadomosci asystenta, dostaje doskonalsza wersje pisma plus wglad w etapy. Zweryfikowane live w przegladarce (patrz Bramki).

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 6 - wiernosc faktom**: pipeline (ADR-0058) ma zakaz zmiany faktow, dat, kwot, sygnatur i przepisow. UI tego nie obchodzi - tylko prezentuje wynik. Disclaimer w stopce panelu ("AI moze sie mylic, to nie jest porada prawna") jest stala czescia widoku.
- **Art. 4 - prostota**: jeden guzik dla prawnika; trzy przebiegi LLM ukryte pod spodem (wzorzec "Invisible AI" - zlozonosc schowana, prawnik widzi jedno dzialanie). Sekcja "Jak powstal draft" daje transparencje na zadanie, domyslnie zwinieta.

**Powiazane ADR**: ADR-0058 (backend pipeline obrony - endpoint POST /draft/refine, ten ADR to jego lustro w UI), ADR-0062 (frontend tryb local - panel testowany w tym trybie), ADR-0059 (OpenRouter - wybor modelu to osobna jednostka, patrz "Co NIE jest").

---

## Kontekst

Backend ma gotowy lancuch Recenzent -> Adwokat diabla -> Pisz po ludzku (ADR-0058, endpoint POST /draft/refine zwraca `{ final, stages[] }`). Brakowalo wpiecia w UI - prawnik nie mial jak uruchomic pipeline'u z poziomu czatu. Backend dawal wynik tylko przez surowe HTTP; bez guzika w czacie funkcja jest niewidoczna dla uzytkownika, wiec pod soft-launch to luka miedzy gotowym kodem a wartoscia na ekranie.

## Decyzja

### 1. Klient API `refineDraft` (patronApi.ts)
`refineDraft({ text, stages?, adwokat_mode?, model?, context? })` przez istniejacy `apiRequest`. Typy `DefenseStage` / `AdwokatMode` / `DraftStageResult` / `DraftRefineResult` lustrzane do backendu (ADR-0058).

### 2. Komponent `DraftRefinePanel` (modal)
Wzorzec z `AssistantWorkflowModal` (createPortal, z-[200], backdrop, Esc zamyka). Zawiera: edytowalny textarea (prefilled tekstem zrodlowym), select trybu adwokata (3 opcje), guzik "Doskonal pismo" ze stanem ladowania, sekcje "Gotowy draft" (markdown + Kopiuj), zwijane bloki etapow "Jak powstal draft" (transparencja), obsluge bledu, disclaimer w stopce.

### 3. Guzik w stopce `AssistantMessage`
Obok przycisku Kopiuj, widoczny gdy `!isStreaming && !isError`. Otwiera panel z proza wiadomosci (`textContent`, jak handleCopy). Panel zamontowany lokalnie w komponencie wiadomosci (brak prop-drillingu callbacku przez drzewo).

### 4. i18n (pl.ts, sekcja `draft`)
Slownik przed komponentami (zasada repo). Etykiety etapow i trybow przez `t()` z kluczem dynamicznym (`draft.stage.${stage}`, `draft.mode.${mode}`).

---

## Alternatywy odrzucone

1. **Guzik w polu kompozytora (refine wlasnego wpisu) zamiast przy wiadomosci**. Odrzucone na v1: dlugie drafty pojawiaja sie jako wiadomosci asystenta, a textarea w panelu i tak jest edytowalny (prawnik moze wkleic swoj tekst). Trigger przy wiadomosci pokrywa oba przypadki bez zmian w kompozytorze.
2. **Osobna strona/route `/draft`**. Odrzucone: modal w kontekscie czatu jest blizej miejsca pracy, mniej nawigacji.
3. **Streaming postepu per-etap (SSE)**. Odrzucone na v1: backend zwraca komplet `{ final, stages }` jednym wywolaniem; pojedynczy spinner + ujawnienie wyniku wystarcza. Streaming = rezerwacja.
4. **Auto-wstawienie wyniku do kompozytora / zapis do dokumentu**. Odrzucone na v1: Kopiuj do schowka wystarcza; "wstaw do pola" wymaga przewlekania callbacku przez drzewo komponentow - rezerwacja.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** frontend (exit 0) i backend (exit 0).
- **Testy backend**: 704 pass / 5 todo (709), 45 plikow. Plus nowy test shim `.filter` cs (patrz Errata) - 10/10 w supabase-shim.test.ts.
- **Weryfikacja LIVE w przegladarce** (tryb local, backend sqlite/fs port 3099 + frontend port 3002, instancja Wieslawa na 3000/3001 nietknieta): guzik "Draft odpowiedzi" renderuje sie w stopce wiadomosci; panel otwiera z prefilled tekstem; realny refine przez Gemini Flash zwrocil ustrukturyzowana odpowiedz na pozew z powolaniami (art. 210 § 2, 230, 205(12) KPC, art. 6 KC, art. 232, 245 KPC); sekcja transparencji pokazala 3 etapy z etykietami Recenzent / Adwokat diabla - Strona przeciwna / Pisz po ludzku. Konsola czysta.
- **Zmiana**: ~5 plikow frontend (pl.ts, patronApi.ts, DraftRefinePanel.tsx nowy, AssistantMessage.tsx) + ~410 LoC, z czego panel ~290.
- **Marko-PL review PENDING** (2x runda przed merge).

## Errata do ADR-0053 (shim SQLite)

Weryfikacja live ujawnila, ze shim supabase-js (ADR-0053) nie implementowal metody `.filter(col, op, val)`, ktorej `projects.ts` uzywa z operatorem `cs` (contains) na kolumnie JSON-tablica `shared_with`. Skutek: wywolanie GET /projects rzucalo `TypeError: ...filter is not a function` jako nieobsluzony wyjatek i kladlo caly proces backendu. Wczesniej luka byla zamaskowana - przy zlym `FRONTEND_URL` CORS blokowal preflight, wiec zadanie nie dochodzilo do handlera. Fix: dodano `.filter` + obsluge `cs` (przez `json_each` z `coalesce` na NULL). To bugfix domykajacy kontrakt shim z ADR-0053, nie nowa decyzja architektoniczna.

## Co NIE jest w ADR-0063

- **Wstaw do kompozytora / zapis do dokumentu (Word)** -> rezerwacja.
- **Wybor etapow w UI** (toggle recenzent/adwokat/pisz-po-ludzku) - v1 ma tylko wybor trybu adwokata; pelny pipeline zawsze. Rezerwacja.
- **Wybor modelu** (Gemini/Bielik/Claude przez OpenRouter, ADR-0059) -> osobny "model picker" jako jednostka frontendowa.
- **Streaming postepu etapow** -> rezerwacja (alternatywa 3).
- **Panel pamieci Bibliotekarza / Folder Sprawy UI / graf** -> osobne jednostki frontendowe.
