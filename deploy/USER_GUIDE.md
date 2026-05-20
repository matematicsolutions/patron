# Patron - podręcznik użytkownika

Przewodnik dla prawnika z kancelarii, która ma już postawioną instancję
Patrona. Jeśli jeszcze nie ma, Administrator znajdzie instrukcję w
[`deploy/README.md`](./README.md).

> Patron wspomaga pracę, ale nie zastępuje prawnika. Każde pismo, opinia
> i edycja dokumentu wymaga Twojej weryfikacji przed podpisaniem lub
> wysłaniem.

## Spis treści

1. [Pierwsze logowanie](#1-pierwsze-logowanie)
2. [Wybór modelu LLM](#2-wybór-modelu-llm)
3. [Praca z dokumentami](#3-praca-z-dokumentami)
4. [Czat: jak rozmawiać z Patronem](#4-czat-jak-rozmawiać-z-patronem)
5. [Źródła polskiego prawa](#5-źródła-polskiego-prawa)
6. [Panel cytatów](#6-panel-cytatów)
7. [Audyt - co Patron zapisuje](#7-audyt---co-patron-zapisuje)
8. [FAQ](#8-faq)
9. [Co robić, gdy coś nie działa](#9-co-robić-gdy-coś-nie-działa)

---

## 1. Pierwsze logowanie

1. Otwórz adres podany przez Administratora (np. `https://patron.kancelaria.pl`).
2. Zarejestruj się przez Supabase Auth (email + hasło) lub zaloguj się
   przez SSO, jeśli kancelaria ma to skonfigurowane.
3. Po zalogowaniu zobaczysz pustą skrzynkę czatów.

## 2. Wybór modelu LLM

Patron nie jest przywiązany do jednego dostawcy LLM. Kancelaria sama
wybiera model. Trzy ścieżki:

| Model | Gdzie żyje | Kiedy używać |
|---|---|---|
| Gemini (Google) | Chmura Google | Szybko, tanio, dobrze radzi sobie z polskim. Treść promptu trafia do Google. |
| Claude (Anthropic) | Chmura Anthropic | Najlepszy do długich dokumentów (200k+ kontekstu). Treść promptu trafia do Anthropic. |
| Ollama lokalny | Twój serwer | Treść promptu nie opuszcza kancelarii - wybór dla spraw objętych tajemnicą zawodową. Wolniejszy, wymaga GPU. |

Klucz API wpiszesz w menu **Konto → Modele i klucze API**. Patron
szyfruje go przed zapisem (sekretem `USER_API_KEYS_ENCRYPTION_SECRET`).

> Administrator może wpisać klucz globalnie dla całej kancelarii (jeden klucz
> = jedna faktura). Wtedy w **Modele i klucze API** zobaczysz komunikat
> o kluczu skonfigurowanym po stronie serwera i nie musisz nic wpisywać.

## 3. Praca z dokumentami

### Załączanie dokumentu do czatu

1. W oknie czatu kliknij „Załącz plik" (ikona spinacza).
2. Wybierz `.docx` lub `.pdf` z dysku.
3. Patron wgrywa plik do MinIO i przygotowuje go do analizy.
4. Plik dostaje identyfikator `doc-0`, `doc-1` itd. Patron używa go,
   gdy pytasz o konkretny dokument.

### Czytanie i wyszukiwanie

W czacie napisz np.:
- *„Przeczytaj NDA"* - Patron wywołuje narzędzie `read_document`.
- *„Znajdź wszystkie wzmianki o RODO w umowie"* - narzędzie `find_in_document`.
- *„Wyświetl klauzulę 4.2"* - narzędzie plus cytat z numerem strony.

### Generowanie pisma `.docx`

Napisz np.:
- *„Sporządź pozew o zapłatę 50 000 zł na rzecz X przeciwko Y, podstawa faktyczna: ..."*
- *„Przygotuj skargę do WSA na decyzję Prezesa UODO znak DKN.5130.2024 z dnia 12.03.2026 r."*

Patron wywołuje `generate_docx` i zwraca kartę pobierania `.docx`. Po
wygenerowaniu zweryfikuj treść. W miejscu podpisu Patron wstawia
placeholder (`[Podpis - imię, nazwisko, tytuł zawodowy, nr wpisu]`).

### Edycja śledzona (`tracked changes`)

1. Załącz `.docx` do czatu.
2. Napisz np. *„W klauzuli 5 zmień termin z 14 na 30 dni i dodaj prawo do
   odstąpienia"*.
3. Patron zaproponuje edycje jako zmiany śledzone (każda widoczna obok
   oryginału). Każda zmiana ma kartę z przyciskami **Akceptuj / Odrzuć**.
4. Po Twojej decyzji zmiana trafia do nowej wersji dokumentu (historia
   wersji w `document_versions`).

## 4. Czat - jak rozmawiać z Patronem

### Co Patron umie

- Analizować załączone dokumenty (z cytatami i numerami stron).
- Wywoływać 5 źródeł polskiego prawa (patrz § 5).
- Generować i edytować `.docx` ze zmianami śledzonymi.
- Stosować workflow, jeśli kancelaria ma zdefiniowane szablony.

### Jak formułować pytania, żeby dostać odpowiedź z konkretem i cytatami

Bądź konkretny. Zamiast „przygotuj umowę", napisz: „NDA dwustronna,
Polska, między spółką X (jako Ujawniający) a osobą fizyczną Y, termin
poufności 5 lat, nieujawnianie po wygaśnięciu nieograniczone, prawo
polskie, sąd właściwy dla siedziby X".

Załączaj kontekst. Jeśli pytasz o klauzulę z konkretnej umowy, najpierw
załącz tę umowę.

Proś o weryfikację. Po napisaniu *„Sprawdź w NSA, czy ten argument
przeszedł w orzecznictwie z 2024-2025"* Patron wywoła `nsa__search`.

### Czego Patron nie zrobi

- Nie podpisze pisma za Ciebie.
- Nie wyśle maila do klienta ani do sądu.
- Nie wykona płatności ani innej czynności prawnej.
- Nie zapamięta hasła klienta ani innych sekretów (nie wklejaj haseł
  i numerów kart do treści czatu).

## 5. Źródła polskiego prawa

Patron ma 5 źródeł polskiego prawa zintegrowanych z czatem. Wywołasz je
naturalnym pytaniem - model sam zdecyduje, które pasuje:

| Źródło | Co zwraca | Przykład pytania |
|---|---|---|
| mcp-saos | orzeczenia sądów powszechnych, SN, TK, KIO | *„Wyroki SN o niezgodności umowy z zasadami współżycia społecznego"* |
| mcp-nsa | orzeczenia NSA i 16 WSA (sądy administracyjne) | *„Orzecznictwo NSA o art. 6 ust. 1 lit. f RODO z 2025 r."* |
| mcp-isap | ustawy, rozporządzenia (Dz.U. i M.P., 96k+ aktów od 1918) | *„Najnowsza wersja ustawy o ochronie danych osobowych"* |
| mcp-krs | rejestr przedsiębiorców (oficjalne API MS) | *„Zarząd i sposób reprezentacji ORLEN SA"* |
| mcp-eu-sparql | akty UE i orzeczenia CJEU (EUR-Lex) | *„Polskie tłumaczenie RODO, CELEX 32016R0679"* |

### Kiedy Patron wywoła kilka źródeł naraz

Gdy pytanie obejmuje kilka domen. Przykład:

> *„Przygotuj analizę: art. 6 ust. 1 lit. f RODO w polskim orzecznictwie
> administracyjnym, ze szczególnym uwzględnieniem decyzji UODO i wyroków
> WSA z lat 2024-2026."*

Patron wywoła równolegle:
- `eu-sparql__search_by_celex` - RODO art. 6
- `isap__search_acts` - ustawa o ochronie danych z 2018 r.
- `nsa__search` - orzecznictwo WSA i NSA

Panel cytatów pokaże trzy sekcje z linkami do oryginałów.

## 6. Panel cytatów

Po prawej stronie ekranu (na telefonie pod treścią) zobaczysz panel
cytatów podzielony na sekcje:

- Dokumenty z czatu (twoje załączniki). Kliknięcie cytatu `[N]` otwiera
  dokument na właściwej stronie z podświetlonym fragmentem.
- Orzeczenia z SAOS (sądy powszechne, SN, TK, KIO).
- Orzeczenia z CBOSA (NSA i WSA - sądy administracyjne).
- Akty prawa polskiego (Dz.U. i M.P., link do ISAP).
- Krajowy Rejestr Sądowy (link do wyszukiwarki MS).
- Akty prawa UE (EUR-Lex i CJEU).

Każdy cytat ze źródła ma link do oryginału - kliknięcie otwiera go
w nowej karcie. Zweryfikuj cytat, zanim wstawisz go do pisma.

## 7. Audyt - co Patron zapisuje

Każda Twoja interakcja zapisuje się w `audit_log` z hash-chain SHA-256
(zgodnie z AI Act art. 12). Co Patron loguje:

- Twój prompt: tylko długość, liczba załączników i wybrany workflow
  (bez pełnej treści).
- Odpowiedź Patrona: model, liczba tokenów, liczba cytatów i lista
  wywołanych źródeł (np. `["saos__search", "isap__get_act"]`).
- Operacje na dokumentach: które dokumenty czytałeś i edytowałeś
  (tylko identyfikatory, bez treści).

W praktyce:
- IOD kancelarii widzi historię użycia (kto, kiedy, jakim modelem,
  jakie źródła).
- Modyfikacja audit log po zapisie psuje łańcuch - wykrywa to
  weryfikator (`npm run audit:verify`).
- W razie sporu z klientem masz dowód, czego Patron użył.

## 8. FAQ

**Czy Patron jest zgodny z RODO?**
Tak, przy poprawnym wdrożeniu. Patron działa w infrastrukturze
kancelarii (self-host), a kancelaria jest administratorem danych.
Konstytucja AI v1.1.0 mapuje 9 zasad na art. 5, 25, 30 i 32 RODO oraz
na AI Act. Pełen tekst w `governance/CONSTITUTION.md`.

**Czy treść mojego czatu trafia do dostawcy LLM?**
Tak, jeśli używasz Gemini, Claude lub OpenAI w chmurze. Patrz § 2.
Jeśli kancelaria nie chce przekazywać danych poza swoją infrastrukturę,
wybierz Ollama lokalnie. Politykę dla całej kancelarii ustala Administrator.

**Czy Patron uczy się z moich dokumentów?**
Nie. Patron nie trenuje modeli na danych kancelarii. Treść trafia do
LLM tylko przy konkretnym wywołaniu i nie staje się częścią wag.

**Co robić, gdy Patron poda błędny cytat?**
Otwórz panel cytatów, kliknij link do oryginału i sprawdź. Jeśli
cytat nie istnieje w źródle (halucynacja modelu), zgłoś to
Administratorowi (Konstytucja AI Art. 2 i Art. 6).

**Czy mogę używać Patrona z telefonu?**
Tak, frontend jest responsywny. Czat i załączanie dokumentów działają
na telefonie. Boczny panel cytatów wygodniej obsługuje się na
większym ekranie.

**Czy mogę cofnąć zaakceptowaną edycję `.docx`?**
Tak. Każda edycja tworzy nową wersję w `document_versions`. W panelu
dokumentu znajdziesz historię wersji i możesz wrócić do poprzedniej.

**Co jeśli mój klient prosi o usunięcie wszystkich danych (RODO art. 17)?**
Zgłoś to IOD-owi. Administrator uruchomi `npm run rodo:delete --user <id>
--confirm`. Patron usunie dane klienta z bazy i z plików. W audit log
zostaje wpis z anonimowym `actor_user_id` (compliance ma pierwszeństwo
nad prawem do usunięcia - RODO art. 17 ust. 3 lit. b).

**Co jeśli klient prosi o eksport danych (RODO art. 20)?**
Administrator uruchomi `npm run rodo:export --user <id> --out plik.json`
i przekaże Ci JSON do przekazania klientowi.

## 9. Co robić, gdy coś nie działa

**Patron nie odpowiada albo widzę błąd „Provider not configured"**
Otwórz **Konto → Modele i klucze API** i sprawdź, czy masz wpisany
klucz LLM. Jeśli klucz globalny ustawiał Administrator, zgłoś problem
do IT.

**Źródło polskiego prawa nie zwraca wyników**
Sprawdź sformułowanie zapytania. Dla SAOS użyj polskich słów
kluczowych. Dla KRS - 10-cyfrowego numeru. Dla EUR-Lex - numeru CELEX
(np. `32016R0679`).

**Wygenerowany `.docx` nie otwiera się w Wordzie**
Zgłoś Administratorowi. Patron używa biblioteki `docx`, która czasem nie
radzi sobie z bardzo skomplikowaną strukturą tabeli. Administrator ma logi
i może to poprawić.

**Frontend pokazuje „Stream error"**
Odśwież stronę. Jeśli błąd wraca, Administrator sprawdzi backend
(`docker compose logs backend`).

**Mam pomysł na ulepszenie**
Otwórz feature request: <https://github.com/matematicsolutions/patron/issues/new/choose>.
Możesz też zgłosić pomysł przez Administratora kancelarii.

---

## Kontakt

- Administrator kancelarii (osoba z IT, która postawiła Patrona).
- MateMatic (dostawca Patrona): <https://matematic.co>, [kontakt@matematic.co](mailto:kontakt@matematic.co).
- Konstytucja AI: pełen tekst w `governance/CONSTITUTION.md` w repozytorium.

*Wersja: 1.0 / 2026-05-20 / pasująca do Patrona v1.0.0.*
