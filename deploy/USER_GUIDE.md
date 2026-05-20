# Patron — podręcznik użytkownika

Krótki przewodnik dla prawnika kancelarii, która już ma postawioną
instancję Patrona (jeśli jeszcze nie ma, patrz [`deploy/README.md`](./README.md)
dla operatora).

> **Pamiętaj**: Patron jest narzędziem **wspomagającym**. Każde pismo,
> opinia, edycja dokumentu wymaga Twojej weryfikacji przed podpisaniem
> lub wysłaniem. Patron nigdy nie pisze za prawnika.

## Spis treści

1. [Pierwsze logowanie](#1-pierwsze-logowanie)
2. [Wybór modelu LLM](#2-wybór-modelu-llm)
3. [Praca z dokumentami](#3-praca-z-dokumentami)
4. [Czat: jak rozmawiać z Patronem](#4-czat-jak-rozmawiać-z-patronem)
5. [Konektory polskiego prawa](#5-konektory-polskiego-prawa)
6. [Panel cytatów](#6-panel-cytatów)
7. [Audyt — co Patron zapisuje](#7-audyt--co-patron-zapisuje)
8. [FAQ](#8-faq)
9. [Co robić, gdy coś nie działa](#9-co-robić-gdy-coś-nie-działa)

---

## 1. Pierwsze logowanie

1. Otwórz adres podany przez Twojego Operatora (np. `https://patron.kancelaria.pl`).
2. Zarejestruj się przez Supabase Auth (email + hasło) **lub** zaloguj
   przez SSO, jeśli kancelaria ma to skonfigurowane.
3. Po zalogowaniu zobaczysz pustą skrzynkę czatów.

## 2. Wybór modelu LLM

Patron jest **vendor-agnostic** — kancelaria sama wybiera, którego modelu
używa. Trzy ścieżki, w zależności od polityki firmy:

| Model | Gdzie żyje | Kiedy używać |
|---|---|---|
| **Gemini (Google)** | Chmura Google | Szybko, tanio, dobrze radzi sobie z polskim. Treść promptu trafia do Google. |
| **Claude (Anthropic)** | Chmura Anthropic | Najlepszy do długich dokumentów (200k+ kontekstu). Treść promptu trafia do Anthropic. |
| **Ollama lokalny** | Twój serwer | Bezwzględna tajemnica zawodowa — model nie opuszcza kancelarii. Wolniejszy, wymaga GPU. |

**Konfiguracja**: menu **Konto → Modele i klucze API**. Wpisz klucz API
do wybranego dostawcy. Klucz jest szyfrowany przed zapisem
(`USER_API_KEYS_ENCRYPTION_SECRET`).

> Operator może też skonfigurować klucz globalnie dla całej kancelarii
> (jeden klucz = jedna faktura). Wtedy w **Modele i klucze API** zobaczysz
> "Provider configured by admin" i nie musisz nic wpisywać.

## 3. Praca z dokumentami

### Załączanie dokumentu do czatu

1. W oknie czatu kliknij **„Załącz plik"** (ikona spinacza).
2. Wybierz `.docx` lub `.pdf` z dysku.
3. Patron uploaduje plik do MinIO i przygotowuje go do analizy.
4. Plik dostaje wewnętrzny identyfikator `doc-0`, `doc-1` itd. — Patron
   używa tego, gdy pytasz o konkretny dokument.

### Czytanie i wyszukiwanie

W czacie napisz np.:
- *„Przeczytaj NDA"* — Patron wywołuje narzędzie `read_document`.
- *„Znajdź wszystkie wzmianki o RODO w umowie"* — narzędzie `find_in_document`.
- *„Wyświetl klauzulę 4.2"* — narzędzie + cytat z numerem strony.

### Generowanie pisma `.docx`

Napisz np.:
- *„Sporządź pozew o zapłatę 50 000 zł na rzecz X przeciwko Y, podstawa faktyczna: ..."*
- *„Przygotuj skargę do WSA na decyzję Prezesa UODO znak DKN.5130.2024 z dnia 12.03.2026 r."*

Patron wywołuje `generate_docx` i zwraca kartę pobierania `.docx`. Po
wygenerowaniu **musisz zweryfikować** treść — Patron stawia placeholder
podpisu (`[Podpis - imię, nazwisko, tytuł zawodowy, nr wpisu]`).

### Edycja śledzona (`tracked changes`)

1. Załącz `.docx` do czatu.
2. Napisz np. *„W klauzuli 5 zmień termin z 14 na 30 dni i dodaj prawo do
   odstąpienia"*.
3. Patron zaproponuje edycje jako **tracked changes** — karta z każdą
   zmianą i przyciskami **Akceptuj / Odrzuć**.
4. Po decyzji zmiana wchodzi do nowej wersji dokumentu (historia
   wersji w `document_versions`).

## 4. Czat — jak rozmawiać z Patronem

### Co Patron umie

- Analizować załączone dokumenty (cytaty z numerami stron).
- Wywoływać 5 konektorów MCP polskiego prawa (patrz § 5).
- Generować i edytować `.docx` z tracked changes.
- Stosować workflow (jeśli kancelaria ma zdefiniowane szablony).

### Najlepsze praktyki

- **Bądź konkretny**: zamiast „przygotuj umowę", powiedz „NDA dwustronna,
  Polska, między spółką X (jako Ujawniający) a osobą fizyczną Y, termin
  poufności 5 lat, nieujawnianie po wygaśnięciu nieograniczone, prawo
  polskie, sąd właściwy dla siedziby X".
- **Załączaj kontekst**: jeśli pytasz o klauzulę z konkretnej umowy,
  najpierw załącz tę umowę.
- **Pytaj o weryfikację**: *„Sprawdź w NSA czy ten argument przeszedł
  w orzecznictwie z 2024-2025"* — Patron wywoła `nsa__search`.

### Czego Patron NIE zrobi

- Nie podpisze pisma za Ciebie.
- Nie wyśle maila do klienta ani do sądu.
- Nie wykona płatności ani innej czynności prawnej.
- Nie zapisze hasła klienta ani innych sekretów w czacie (zalecenie:
  nie wklejaj haseł i numerów kart do treści czatu).

## 5. Konektory polskiego prawa

Patron ma **5 konektorów MCP** wpiętych w czat. Wywołasz je naturalnym
pytaniem, model sam zdecyduje, którego użyć:

| Konektor | Co zwraca | Przykład pytania |
|---|---|---|
| **mcp-saos** | orzeczenia sądów powszechnych, SN, TK, KIO | *„Wyroki SN o niezgodności umowy z zasadami współżycia społecznego"* |
| **mcp-nsa** | orzeczenia NSA + 16 WSA (sądy administracyjne) | *„Orzecznictwo NSA o art. 6 ust. 1 lit. f RODO z 2025 r."* |
| **mcp-isap** | ustawy, rozporządzenia (Dz.U. + M.P., 96k+ aktów od 1918) | *„Najnowsza wersja ustawy o ochronie danych osobowych"* |
| **mcp-krs** | rejestr przedsiębiorców (oficjalne API MS) | *„Zarząd i sposób reprezentacji ORLEN SA"* |
| **mcp-eu-sparql** | akty UE + orzeczenia CJEU (EUR-Lex) | *„Polskie tłumaczenie RODO, CELEX 32016R0679"* |

### Kiedy Patron wywoła kilka konektorów naraz

Gdy pytanie obejmuje kilka domen. Przykład:

> *„Przygotuj analizę: art. 6 ust. 1 lit. f RODO w polskim orzecznictwie
> administracyjnym, ze szczególnym uwzględnieniem decyzji UODO i wyroków
> WSA z lat 2024-2026."*

Patron wywoła równolegle:
- `eu-sparql__search_by_celex` — RODO art. 6
- `isap__search_acts` — ustawa o ochronie danych z 2018 r.
- `nsa__search` — orzecznictwo WSA / NSA

Panel cytatów pokaże **3 sekcje** z weryfikowalnymi linkami.

## 6. Panel cytatów

Po prawej stronie ekranu (lub w mobile pod treścią) zobaczysz **panel
cytatów** podzielony na sekcje:

- **Dokumenty z czatu** (twoje załączniki) — klikając cytat `[N]`,
  otwiera dokument na właściwej stronie z podświetlonym fragmentem.
- **Orzeczenia z SAOS** (sądy powszechne + SN + TK + KIO).
- **Orzeczenia z CBOSA (NSA / WSA)** — sądy administracyjne.
- **Akty prawa polskiego (Dz.U. / M.P.)** — link do ISAP.
- **Krajowy Rejestr Sądowy** — link do wyszukiwarki MS.
- **Akty prawa UE (EUR-Lex / CJEU)**.

Każdy cytat z konektora ma kompletny link — kliknięcie otwiera oryginał
w nowej karcie. **Zawsze zweryfikuj cytat przed wstawieniem do pisma.**

## 7. Audyt — co Patron zapisuje

Każda Twoja interakcja zostawia ślad w `audit_log` z hash-chain SHA-256
(zgodnie z AI Act art. 12):

- **Twój prompt**: tylko długość, liczba załączników, wybrany workflow
  (BEZ pełnej treści).
- **Odpowiedź Patrona**: model, liczba tokenów, liczba cytatów, lista
  wywołanych konektorów (np. `["saos__search", "isap__get_act"]`).
- **Operacje na dokumentach**: które dokumenty czytałeś / edytowałeś
  (tylko identyfikatory, nie treść).

**Co to znaczy w praktyce**:
- IOD kancelarii widzi historię użycia (kto, kiedy, jakim modelem,
  jakie konektory).
- Modyfikacja audit log po zapisie psuje łańcuch — wykrywa to weryfikator
  (`npm run audit:verify`).
- W razie sporu z klientem masz dowód, czego Patron użył.

## 8. FAQ

**Czy Patron jest zgodny z RODO?**
Tak — przy poprawnym wdrożeniu. Patron jest narzędziem self-host;
kancelaria jest administratorem danych. Konstytucja AI v1.1.0 mapuje
9 zasad na art. 5 / 25 / 30 / 32 RODO i AI Act. Patrz
`governance/CONSTITUTION.md`.

**Czy treść mojego czatu trafia do dostawcy LLM?**
Tak, jeśli używasz Gemini / Claude / OpenAI w chmurze. Patrz § 2 — dla
najwyższej szczelności użyj Ollama lokalnie. Operator wybiera politykę
dla całej kancelarii.

**Czy Patron uczy się z moich dokumentów?**
**Nie.** Patron nie trenuje modeli na danych kancelarii. Treść trafia
do LLM tylko przy konkretnym wywołaniu, nie staje się częścią wag.

**Co robić, gdy Patron poda błędny cytat?**
Otwórz panel cytatów, kliknij link do oryginału, zweryfikuj. Jeśli
Patron wymyślił cytat (halucynacja) — zgłoś to do Administratora
(Konstytucja AI Art. 2 i Art. 6).

**Czy mogę używać Patrona z telefonu?**
Tak, frontend jest responsywny. Pełna funkcjonalność wymaga większego
ekranu (panel cytatów boczny), ale czat + załączanie dokumentów
działa na mobile.

**Czy mogę cofnąć zaakceptowaną edycję `.docx`?**
Tak — każda edycja tworzy nową wersję w `document_versions`.
W panelu dokumentu znajdziesz historię wersji z możliwością powrotu.

**Co jeśli mój klient prosi o usunięcie wszystkich danych (RODO art. 17)?**
Zgłoś IOD-owi. Operator uruchomi `npm run rodo:delete --user <id>
--confirm`. Dane klienta zostaną usunięte z bazy + plików, audit log
zostaje z anonimowym `actor_user_id` (compliance > prawo do usunięcia,
RODO art. 17 ust. 3 lit. b).

**Co jeśli klient prosi o eksport danych (RODO art. 20)?**
Operator uruchomi `npm run rodo:export --user <id> --out plik.json`
i przekaże Ci JSON do dostarczenia klientowi.

## 9. Co robić, gdy coś nie działa

**Patron nie odpowiada / błąd „Provider not configured"**
Otwórz **Konto → Modele i klucze API** i sprawdź, czy masz wpisany
klucz LLM. Jeśli klucz globalny był skonfigurowany przez Administratora,
zgłoś problem do IT.

**Konektor MCP nie zwraca wyników**
Sprawdź formułowanie zapytania. Np. dla SAOS użyj polskich słów
kluczowych; dla KRS użyj numeru KRS (10 cyfr); dla EUR-Lex użyj CELEX
(np. `32016R0679`).

**Wygenerowany `.docx` nie otwiera się w Wordzie**
Zgłoś Operatorowi. Patron używa wewnętrznie `docx` library — czasem
zdarza się błąd przy bardzo skomplikowanej strukturze tabeli. Operator
ma logi i może poprawić.

**Frontend pokazuje "Stream error"**
Odśwież stronę. Jeśli powtarza się — Operator sprawdzi backend
(`docker compose logs backend`).

**Mam pomysł na ulepszenie**
Otwórz feature request: <https://github.com/matematicsolutions/patron/issues/new/choose>
Albo zgłoś przez kontakt z Administratorem kancelarii.

---

## Kontakt

- **Operator** kancelarii (postawił Patrona): konkretna osoba IT z kancelarii.
- **MateMatic** (vendor): <https://matematic.co>, [kontakt@matematic.co](mailto:kontakt@matematic.co).
- **Konstytucja AI**: pełen tekst w `governance/CONSTITUTION.md` w repozytorium.

*Wersja: 1.0 / 2026-05-20 / pasująca do Patrona v1.0.0.*
