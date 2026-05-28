# ADR-0057: Bibliotekarz - pamiec PATRON (brain store) + narzedzia remember/recall

**Status**: PROPONOWANY (2026-05-28). Wprowadza trwala pamiec PATRON per sprawa/osobista, ktora model zapisuje agentowo w trakcie rozmowy. Backend dziala, niewpiety jeszcze w UI ani w warstwe auto-background.

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 2 - Tajemnica zawodowa / zero-cloud** - pamiec to pliki .md na dysku lokalnym (`PATRON_BRAIN_DIR` lub `%APPDATA%/PATRON/brain`), nie chmura. Scope per sprawa (projectId) izoluje dane spraw.
- **Art. 5 - Minimalizacja + RODO art. 17** - `forgetScope(scope)` usuwa caly brain sprawy ("zapomnij sprawe X"). Tool remember ma w opisie zakaz zapisywania pelnego tekstu dokumentow (to korpus RAG) i danych ulotnych.
- **Art. 3 - Audytowalnosc** - kazdy zapis zwraca `{action: created|updated, slug, scope}` (transparency: mecenas widzi co Bibliotekarz zmienil). Pliki .md sa czytelne i wersjonowalne.
- **Art. 4 - Prostota** - pamiec to zwykle pliki .md z frontmatter (mirror wzorca auto-memory), zero bazy, zero nowych zaleznosci.

**Powiazane ADR**: ADR-0054 (search_corpus - ten sam wzorzec narzedzia agentowego; korpus = tresc dokumentow, brain = wnioski/fakty/preferencje), ADR-0053 (tryb desktop), ADR-0008 (graf cytowan - encje twarde; brain trzyma wiedze miekka, ktorej regex nie zlapie).

---

## Kontekst

Roadmapa opisuje Bibliotekarza jako warstwe, ktora po kazdej akcji w tle decyduje co zapisac do pamieci kancelarii (preferencja stylu, fakt, decyzja, wniosek) i aktualizuje brain. Sedno wartosci: PATRON "uczy sie" sprawy i stylu mecenasa miedzy sesjami.

Dwie czesci problemu: (1) GDZIE i JAK zapisywac (deterministyczne), (2) CO zapisac (decyzja). Czesc (2) jest fuzzy i naturalnie nalezy do modelu jezykowego.

## Decyzja

### 1. Deterministyczny brain store (`backend/src/lib/brain/store.ts`)
Pliki .md z frontmatter pod `brain/<scope>/<slug>.md` + `INDEX.md` scope. `scope` = projectId (sprawa) lub `"personal"`. Funkcje: `saveMemory` (upsert po slug, zachowuje `created_at`, przebudowuje INDEX), `listMemories`, `readMemory`, `forgetScope` (RODO art. 17). Sanityzacja slug/scope (kebab, guard path traversal). Zero LLM, zero bazy - w pelni testowalne.

### 2. Model jako Bibliotekarz - narzedzia remember/recall (tool-based v1)
Zamiast osobnego pipeline'u podsumowania w tle, decyzje "co zapisac" podejmuje model w czacie przez narzedzia (wzorzec jak search_corpus z ADR-0054):
- `remember({type, title, body, slug?})` - zapis do brain biezacego scope.
- `recall({slug?})` - lista wpisow albo odczyt jednego w calosci.

Zalety: zero dodatkowych wywolan LLM (piggyback istniejacej tury czatu), spojnosc z architektura agentowa (model juz wola read_document / search_corpus), pelna transparentnosc (tool_result mowi co zapisano). Scope brany z `projectId` w dispatchu.

---

## Alternatywy odrzucone

1. **Automatyczne podsumowanie LLM po kazdej turze (background)**. Odrzucone w v1: dodatkowe wywolanie LLM per tura (koszt + latencja), fuzzy prompt "co jest warte zapisania", ryzyko szumu. Model w turze i tak ma kontekst - taniej, gdy sam zdecyduje przez remember. Auto-background jako wzmocnienie = rezerwacja (z progiem pewnosci + dedup).
2. **Pamiec w SQLite (tabela)**. Odrzucone: pliki .md sa czytelne dla mecenasa, wersjonowalne (git/backup), latwe do "zapomnij sprawe" (rm katalogu) i przenosne. Brain to wiedza ludzka, nie dane relacyjne.
3. **Jeden wspolny brain bez scope**. Odrzucone: mieszanie spraw lamie izolacje (Art. 2/5). Scope per projectId + personal jest minimalna poprawna granica.
4. **Reuse extractEntitiesAndEdges jako Bibliotekarz**. Odrzucone jako rownowaznik: graf (ADR-0008) lapie encje twarde (sygnatury, NIP, sady). Brain trzyma wiedze miekka (preferencje, decyzje, wnioski), ktorej regex nie wykryje. To uzupelniajace warstwy, nie zamienniki.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean** (`npm run build` exit 0).
- **Vitest**: 675 pass / 5 todo / 0 fail (z 669 przed ADR; +6 w `brain/store.test.ts` - upsert+created_at, INDEX+list, izolacja scope, sanityzacja+traversal, forgetScope, roundtrip remember/recall przez dispatch). Testy deterministyczne (FS w temp), bez LLM.
- **LoC**: ~479 (store.ts 213, store.test.ts 163, tools.ts +51, tool-dispatch.ts +52).
- **Zero nowych zaleznosci npm**.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0057

- **Auto-background Bibliotekarz** (analiza tury w tle, propozycje zapisu, prog pewnosci) -> rezerwacja. v1 jest tool-based (model decyduje).
- **Dedup / merge wpisow** (semantyczne scalanie podobnych pamieci, konsolidacja) -> rezerwacja.
- **UI panelu pamieci** (mecenas widzi/edytuje/usuwa wpisy, "Bibliotekarz zaktualizowal: ...") -> rezerwacja frontend.
- **Event transparency w streamie** (typ zdarzenia brain_updated do UI) -> obecnie tylko w tool_result; osobny event = rezerwacja.
- **Kancelaryjny brain wspoldzielony** (NAS, role) -> v0.2 lipiec/sierpien (decyzja z master summary - v1 tylko personal/per-sprawa).
- **Reczne `recall` przy starcie sprawy automatycznie** (wstrzykniecie pamieci do kontekstu bez wywolania modelu) -> rezerwacja; teraz model wola recall sam.
