# ADR-0164 - Pola wchodzace do hasha audytu maja jednego pisarza; przerwanie lancucha z mocy prawa jest nazwane

> **Numer:** na linii feat/design-system-2-0 ten ADR nosil numer 0150, ktory na linii
> publicznej zajal juz ADR o upgradzie Electrona. Przy scaleniu linii dostal 0164
> (ADR-0163). Komunikaty commitow tej linii nadal mowia "ADR-0150" - historii nie
> przepisujemy.

- **Status:** Zaakceptowany (WM 2026-09-09, "zgadzam sie z twoja rekomendacja - lecisz")
- **Data:** 2026-09-09
- **Galaz:** `feat/design-system-2-0`
- **Zrodlo:** bramka `backend/src/lib/audit-hash-inputs-have-one-writer.test.ts`, postawiona
  2026-09-03 przy czytaniu deeplethe/utopia; czerwona do dnia tej decyzji
- **Mapuje na:** ADR-0001 (hash chain), ADR-0026 (Merkle), ADR-0038 (format migracji),
  ADR-0142 (kanonikalizacja), [CONSTITUTION](../CONSTITUTION.md) Art. 1 i Art. 5

## Kontekst

`computeAuditHash` (`backend/src/lib/audit.ts`) liczy hash z szesciu pol: `ts`,
`event_type`, `actor_user_id`, `chat_id`, `document_id`, `payload`. Trzy z nich byly
jednoczesnie kolumnami klucza obcego z `on delete set null` w `backend/schema.sql`.

Skutek, zmierzony 2026-09-03: **zwykle usuniecie dokumentu przez
`DELETE /single-documents/:id` przepisywalo `document_id` na NULL w kazdym wierszu audytu
dotyczacym tego dokumentu - bez przeliczenia hasha.** To samo robilo kasowanie czatow
w `lib/rodo/forget.ts`. Lancuch pekal, a `scripts/verify-audit-chain.ts` raportowal to
slowo w slowo tak samo jak celowa modyfikacje wpisu: "tresc wpisu zostala zmodyfikowana
po wstawieniu". Dowod z AI Act art. 12 stawal sie nieodroznialny od sladu ataku.

Dlaczego zaden istniejacy test tego nie widzial:

- `audit.test.ts` sprawdza ALGORYTM na fixture'ach w pamieci. Matematyka byla poprawna;
  problem byl w tym, KTO pisze do tabeli.
- test ADR-0061 dla `forgetCase` asercjonuje "audit_log count bez zmian" - i count byl
  bez zmian. Zaden wiersz nie znikal. Zmienialy sie wejscia do hasha w wierszach, ktore
  zostaly. Test mierzyl nie te wielkosc, co trzeba.

Zasieg byl przy tym wezszy, niz wygladal: warstwa SQLite (`schema.sqlite.ts`) trzymala te
trzy kolumny jako gole `text` bez FK od poczatku, a desktop chodzi na SQLite
(`desktop/main.js`). Kaskada dotyczyla **wylacznie trybu serwerowego**.

Ale jest drugi pisarz, ktorego schemat nie tlumaczy: `backend/scripts/rodo-delete.ts`
robi jawny `update({ actor_user_id: null })`. Idzie on przez klient w ksztalcie Supabase,
wiec dziala na OBU backendach - takze na SQLite, czyli w produkcie, ktory wysylamy.
I tu nie ma czego "naprawiac": RODO art. 17 kaze zanonimizowac aktora, AI Act art. 12
kaze zachowac dowod, a `actor_user_id` wchodzi do hasha. Wykonanie obowiazku prawnego
MUSI zerwac lancuch.

## Decyzja

**1. Pola wchodzace do hasha nie sa kolumnami FK z akcja `on delete`.**
Migracja `024_audit_log_drop_hash_field_fks.sql` (na tej linii pierwotnie `020`;
renumeracja przy scaleniu linii - ADR-0163) zdejmuje wiezy z `actor_user_id`,
`chat_id` i `document_id`; `schema.sql` juz ich nie tworzy. Rejestr append-only nie jest
dzieckiem czatu ani dokumentu - te kolumny to **zdenormalizowany slad historyczny**,
ktory ma prawo wskazywac na obiekt juz nieistniejacy. Postgres dogania warstwe SQLite,
nie odwrotnie.

**2. Przerwanie lancucha z mocy prawa jest NAZWANE, nie ukryte.**
Nowy `event_type` `audit.chain.legal_break` (migracja `025`, rebuild SQLite v8 - pierwotnie
`021` i v6, renumeracja z suma obu linii - ADR-0163).
`rodo-delete.ts` zbiera id wierszy PRZED anonimizacja i po niej zapisuje zdarzenie
z powodem, polem, licznikiem, zakresem `first_id`/`last_id` oraz lista id - bez danych
osobowych, z aktorem pseudonimizowanym tym samym hashem co w `rodo.delete`, zeby IOD
mogl powiazac oba wpisy ze zgloszeniem.

**3. Weryfikator ma trojstan, nie dwustan.**
`verify-audit-chain.ts` czyta deklaracje i dzieli zerwania na `§` z mocy prawa
(zadeklarowane - jedyna kategoria oparta na dowodzie), ` ` zgodne z kaskada sprzed
migracji 024 (hipoteza) i `!` niewyjasnione (do obejrzenia przez czlowieka).

**4. Bramka mierzy PISARZY, nie schemat.**
`audit-hash-inputs-have-one-writer.test.ts` dostal rejestr pisarzy z dokladnym licznikiem
(`audit.ts` insert x1, `rodo-delete.ts` update x1) oraz test wiazacy jedyne pozwolenie na
UPDATE z obowiazkiem zadeklarowania skutku.

## Konsekwencje

**Czego ta decyzja NIE naprawia.** Lancuchy zerwane wczesniej w trybie serwerowym
zostaja zerwane. Hash liczy sie z wartosci, ktorej juz nie ma, wiec nie da sie ich
odtworzyc. Audytor musi wiedziec o tym oknie - jest opisane w `CHANGELOG.md`. To ten sam
rodzaj uczciwosci, co przy luce `llm_route` z 2026-08-31: nie udajemy, ze historia
wyglada inaczej, niz wyglada.

**Rollback jest kosztowny i to jest zamierzone.** DOWN migracji 024 przywraca defekt,
a `ADD CONSTRAINT` waliduje istniejace wiersze - wiec padnie, jesli w audycie sa juz
wskazania na usuniete obiekty (a po 024 to stan normalny). DOWN migracji 025 sprawia,
ze anonimizacja RODO znow zrywa lancuch BEZ SLADU.

**Wiszace identyfikatory sa teraz normalnym stanem.** Kod czytajacy `audit_log` nie moze
zakladac, ze `document_id` da sie zjoinowac z `documents`. Tak dziala desktop od poczatku.

**`audit.chain.legal_break` jest ostrzezeniem, nie bledem.** Jego obecnosc znaczy, ze
system wykonal obowiazek prawny i sam to zglosil. Brak takiego zdarzenia przy zerwanym
lancuchu jest sygnalem powaznym.

## Alternatywy odrzucone

- **`on delete no action` zamiast zdjecia FK** - odrzucone: `no action` zostawia wiez,
  wiec kasowanie dokumentu zaczeloby sie wywalac bledem integralnosci. Zamiana cichego
  psucia lancucha na twardy blad w funkcji produktu nie jest naprawa.
- **Wyjecie `actor_user_id` z wejsc hasha** - odrzucone z powodu mocniejszego niz
  koszt migracji: wtedy atrybucja nie jest chroniona WCALE i kazdy moze podmienic
  sprawce bez wykrycia. Rejestr z AI Act art. 12 bez chronionego "kto" nie
  odpowiada na pytanie, po ktore istnieje. (Uniewaznienie wszystkich lancuchow
  i korzeni Merkle to dodatkowy koszt, nie glowny argument.)
- **Zaprzestanie anonimizacji przy RODO art. 17** - odrzucone jako decyzja techniczna:
  wykladnia art. 17 nalezy do Administratora, nie do warstwy kodu. Wariant zostaje
  otwarty, ale wymaga stanowiska prawnego, nie commita.
- **Naprawa wylacznie schematu** - odrzucone: zapalilaby bramke na zielono, zostawiajac
  zywa luke w `rodo-delete.ts`, czyli na desktopie. Bramka mierzaca nie te wielkosc,
  co trzeba, jest gorsza niz jej brak, bo daje spokoj.
- **Odlozenie do wydania 2.0.0** - odrzucone: defekt dotyczy dowodu zgodnosci, ktory jest
  glowna teza produktu wobec kancelarii.

## Aktualizacja 2026-10-06 - eksport wpisu zerwanego z mocy prawa

Decyzja wlasciciela produktu (punkt 2 decyzji w `docs/NAPRAWY_2026-10-02.md`):
eksport audytu wpisu zanonimizowanego na podstawie RODO art. 17 wychodzi ZE
ZNACZNIKIEM "zerwanie z mocy prawa", zamiast byc odrzucanym (dotyczy
`GET /api/audit/export/:eventId` i `GET /api/audit/bundle/:messageId`).

Serwer (`resolveLegalBreak` w `backend/src/lib/audit-pack.ts`) wybiera
deklaracje ta sama regula co weryfikator lancucha - funkcja
`collectLegalBreakDeclarations` zostala wydzielona z `classifyContentBreaks`
w `backend/src/lib/audit-chain-verify.ts` bez zmiany werdyktow lancucha - i
wydaje eksport tylko wtedy, gdy deklaracja ma `affected_hashes_after`, a
aktualna tresc wiersza daje dokladnie zadeklarowany hash.

**Deklaracja w starym formacie (bez `affected_hashes_after`) = odmowa 409**,
choc lancuch (`GET /api/audit/chain`) nadal pokazuje taki wiersz jako UWAGI.
Powod: bez hasha po zerwaniu nie da sie odroznic samej anonimizacji od
pozniejszej zmiany tresci tego samego wiersza (R-AC-01). Eksport jest dowodem
wydawanym na zewnatrz; znacznik "niezweryfikowane" przenioslby na odbiorce
rozstrzygniecie, ktorego on z pliku nie podejmie. Starej deklaracji nie da sie
uzupelnic po fakcie - hash policzony dzis z biezacej tresci potwierdzalby
dokladnie te zmiane, ktorej nie umiemy wykluczyc.

Granica (bez zmian wobec tego ADR): deklaracja jest chroniona wlasnym hashem i
miejscem w lancuchu, nie kotwica zewnetrzna. Kto ma zapis do bazy, moze dopisac
na koncu lancucha spojna deklaracje wybielajaca zmiane - do tego potrzebny jest
podpis i znacznik czasu (ADR-0037 / ADR-0049). Paczka nie niesie dowodu Merkle
dla samej deklaracji.
