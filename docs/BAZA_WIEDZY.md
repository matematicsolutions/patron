# Baza wiedzy PATRON — co umie i jak to wykorzystać

**Wersja:** zgodna ze stanem aplikacji 2026-06-03 | **Produkt:** Patron v1.x (MateMatic Solutions)

> 📘 Szukasz instrukcji krok po kroku? Zobacz **[Samouczek dla Mecenasa](./SAMOUCZEK.md)** — od pierwszego uruchomienia, przez wgranie akt, po edycję pism.

---

Witaj, Mecenasie.

Patron to asystent AI zainstalowany na sprzęcie Twojej kancelarii. Akta spraw, treści czatów, baza i historia są przechowywane lokalnie. Model AI wybierasz Ty — mocny model w chmurze (np. Libra/Claude, Gemini) dla najwyższej jakości albo model lokalny (Ollama), gdy zależy Ci na pracy bez internetu. Oba warianty są normalnym, świadomym wyborem kancelarii; klasyfikacja sprawy steruje tym, co i kiedy może wyjść poza komputer. Każde wywołanie modelu, każda decyzja o egressie danych i każde wyszukanie w dokumentach trafia do niemodyfikowalnego audit trail — dowodu zgodności z AI Act art. 12 i RODO. Patron nie jest modelem AI i nie podejmuje decyzji prawnych — jest powłoką, która pozwala Ci pracować szybciej z materiałem, który i tak masz na biurku.

---

## W CZYM MOGĘ CI POMÓC

### Praca z dokumentami

- Importowanie i analizowanie akt sprawy (PDF, DOCX, skany, całe foldery)
- Zadawanie pytań do dokumentów i otrzymywanie odpowiedzi z cytowaniem źródeł
- Masowa ekstrakcja danych z pakietów umów do tabeli (Tabular Review)
- Zarządzanie dokumentami z wersjonowaniem i śledzeniem zmian (tracked changes)
- Organizowanie spraw w projekty (teczki) ze współdzielonym dostępem

### Analiza i research

- Weryfikacja prawdziwości cytatów podanych przez AI (badge grounding: zielony / żółty / czerwony)
- Przeszukiwanie polskiego prawa przez konektor ISAP (Dz.U., M.P.)
- Przeszukiwanie prawa UE przez konektor EUR-Lex i EU-Compliance (RODO, AI Act, DORA, NIS2)
- Automatyczne workflowy dla powtarzalnych zadań (due diligence, analiza umowy)

### Pisanie i obrona pisma

- Trojstopniowy pipeline obrony draftu: Recenzent (luki logiczne) → Adwokat (kontrargumenty) → Humanizer (usuwa styl AI)
- Niestandardowe rozszerzenia pipeline przez bibliotekę umiejętności (w przygotowaniu)

### Bezpieczeństwo i zgodność

- Automatyczna klasyfikacja tajemnicy zawodowej i blokada wysyłania do chmury
- Skanowanie dokumentów wejściowych pod kątem prompt injection przed indeksacją
- Skanowanie konektorów MCP pod kątem zagrożeń (typosquat, ukryte instrukcje)
- Niemodyfikowalny audit trail z dowodem kryptograficznym (Merkle chain, AI Act art. 12)
- Trwałe usunięcie sprawy (RODO art. 17)

### Organizacja pracy

- Monitorowanie zużycia tokenów i kosztów per sprawa i per model
- Udostępnianie projektu współpracownikom
- Eksport dokumentów z zaznaczeniami i komentarzami

---

## FUNKCJE — SZCZEGÓŁOWY OPIS

---

### Czat z asystentem AI na dokumentach sprawy

**Co to robi:**
Prowadzisz streaming czat z modelem AI, który ma pełny kontekst dokumentów sprawy. Pod spodem działa RAG (BM25 + wektory + graf cytowania + zdarzenia prawne) — Patron wyciąga z akt najtrafniejsze fragmenty zanim wyśle zapytanie do modelu. Dane osobowe (PII) są pseudonimizowane przed ewentualnym egressem do chmury. Każda wymiana jest zapisywana w audit trail.

**Jak maksymalnie wykorzystać:**
Załaduj wszystkie akta sprawy do projektu przed pierwszym pytaniem — im szersza baza dokumentów, tym precyzyjniejszy retrieval. Pytaj wprost i konkretnie: zamiast „co jest w umowie" napisz „jakie są obowiązki Zamawiającego w §5 umowy nr X". Czat działa bez internetu, gdy wybrałeś model Ollama.

**Przykłady poleceń:**
- „Jakie zobowiązania wynikają z §3 tej umowy?"
- „Czy są podstawy do zarzutu przedawnienia roszczeń?"
- „Wymień wszystkie terminy płatności w tej umowie."
- „Porównaj klauzule kar umownych w dokumentach A i B."

---

### Pipeline obrony dokumentu (Recenzent / Adwokat / Humanizer)

**Co to robi:**
Trzystopniowy pipeline dla draftu pisma procesowego lub umowy. Etap 1 — Recenzent ocenia logikę prawną i wskazuje słabości argumentacji. Etap 2 — Adwokat (kontrargumenty) analizuje pismo z perspektywy strony przeciwnej i wskazuje, co przeciwnik zaatakuje. Etap 3 — Humanizer usuwa styl chatbota i sprawia, że tekst brzmi jak napisany przez prawnika. Każdy etap przechodzi przez ten sam egress guard — tajemnica zostaje lokalnie.

**Jak maksymalnie wykorzystać:**
Używaj pipeline po pierwszym drafcie AI albo po własnym roboczym tekście — Recenzent wyłapuje luki, które trudno dostrzec po kilku godzinach pracy nad sprawą. Możesz uruchomić wszystkie trzy etapy naraz albo wybrać jeden. Wynik kopiujesz lub eksportujesz. Najlepszy efekt daje iteracja: draft → pipeline → korekta → pipeline drugi raz.

**Przykłady poleceń:**
- „Ulepsz ten projekt pisma" (ikona Sparkles pod odpowiedzią).
- „Przejrzyj tę klauzulę jako Recenzent i wskaż słabości."
- „Napisz kontrargumenty do §4 jak pełnomocnik strony pozwanej."
- „Przepisz ten akapit po ludzku — usuń styl AI."

---

### Import i analiza dokumentów (PDF, DOCX, skany)

**Co to robi:**
Patron przyjmuje dokumenty, skanuje je przed indeksacją (wykrywa prompt injection zanim plik trafi do RAG), ekstrahuje tekst (PDF, DOCX, OCR dla skanów papierowych), dzieli na chunki rozumiejące strukturę prawną (nagłówki ustaw, paragrafy, jednostki redakcyjne) i indeksuje do wyszukiwania semantycznego i BM25.

**Jak maksymalnie wykorzystać:**
Używaj „Import folderu sprawy" (FolderIngestModal), żeby wgrać cały katalog akt naraz — nie musisz dodawać plików po jednym. Dla skanów papierowych OCR uruchamia się automatycznie, gdy administrator skonfigurował `PATRON_OCR_CMD`. Wgraj wszystkie dokumenty przed pierwszym pytaniem w czacie.

**Przykłady poleceń:**
- Przeciągnij folder akt na panel dokumentów.
- „Zaimportuj tę umowę i odpowiedz, kiedy upływa termin wypowiedzenia."
- „Przeanalizuj ten skan wyroku i wyciągnij sentencję."

---

### Tabular Review — masowa ekstrakcja danych z umów

**Co to robi:**
Wielodokumentowa ekstrakcja danych z pakietu umów do tabeli. Definiujesz kolumny (np. „Strony umowy", „Prawo właściwe", „Kara umowna", „Termin wypowiedzenia"), a Patron przeszukuje wszystkie wgrane dokumenty i wypełnia tabelę. Każda komórka ma badge grounding: zielony = cytat z dokumentu, żółty = możliwe przekształcenie, czerwony = wynik niepewny. Eksport do Excela.

**Jak maksymalnie wykorzystać:**
Wgraj pakiet umów (np. 50 umów najmu), stwórz nowy Przegląd, dodaj kolumny przez presety prawnicze (16 gotowych typów: Strony, Kara umowna, Przedmiot umowy i inne) lub własne. Kliknij „Generuj" — tabela wypełni się strumieniowo. Czerwony badge to sygnał do ręcznej weryfikacji konkretnej komórki — kliknij, żeby zobaczyć źródło. Eksportuj do Excela dla klienta lub zespołu. Maksymalny efekt: due diligence pakietów umów — 50 umów w godzinę zamiast tygodnia.

**Przykłady poleceń:**
- „Stwórz tabelę z karami umownymi ze wszystkich 30 umów w tym projekcie."
- „Wyciągnij prawo właściwe i sąd arbitrażowy z każdej umowy."
- „Porównaj terminy wypowiedzenia we wszystkich umowach najmu."

---

### Grounding cytowań — weryfikacja źródeł odpowiedzi AI

**Co to robi:**
Każda odpowiedź AI zawierająca cytat z dokumentu jest weryfikowana algorytmicznie (odległość Levenshteina dla dokładnych cytatów). Badge trójkolorowy: **zielony** = cytat dosłowny z dokumentu kancelarii, **żółty** = możliwe przekształcenie lub parafraz, **czerwony** = nie znaleziono w dokumentach. Cascade weryfikacji działa na poziomach 1–2 (aktywne), poziom 3 (głębsza weryfikacja parafraz przez model lokalny) jest dostępny jako opcja dla administratora.

**Jak maksymalnie wykorzystać:**
Czytaj badge przy każdym cytacie w odpowiedzi. Czerwony badge to sygnał do ręcznej weryfikacji — Patron mógł „skomponować" cytat, który brzmi wiarygodnie, ale nie pochodzi z Twoich dokumentów. Zielony badge oznacza, że możesz użyć cytatu bezpośrednio w piśmie ze wskazaniem źródła. Uwaga: flaga `PATRON_CITATION_JUDGE` (głębsza weryfikacja parafraz przez Ollamę) jest domyślnie wyłączona — zapytaj administratora o włączenie w trybie wysokiej pewności.

**Przykłady sytuacji:**
- Odpowiedź z zielonym badge = cytat zweryfikowany, bezpieczny do użycia w piśmie.
- Odpowiedź z czerwonym badge = nie cytuj bez ręcznego sprawdzenia w oryginale.
- „Sprawdź, czy ten wyrok cytuje art. 415 KC dosłownie czy w parafrazy."

---

### Zarządzanie dokumentami i wersjami

**Co to robi:**
Pełny CRUD dokumentów z wersjonowaniem. Patron proponuje zmiany w DOCX jako tracked changes (śledzenie zmian styl Word — czerwone wstawienia, przekreślenia), a mecenas akceptuje lub odrzuca je inline w UI. Możliwe są komentarze prawne dodawane do konkretnych paragrafów. Pobierasz pojedynczy plik lub ZIP całego projektu.

**Jak maksymalnie wykorzystać:**
Po wgraniu DOCX poproś asystenta o konkretną zmianę, wskazując paragraf. Patron zwróci plik DOCX z tracked changes, który otwierasz w Word i decydujesz, co zaakceptować. Wgrywaj nowe wersje przez „Nowa wersja" — stare wersje są zachowane z historią.

**Przykłady poleceń:**
- „Zaproponuj zmiany w §4 tej umowy jako tracked changes — chcę ograniczyć odpowiedzialność do szkody rzeczywistej."
- „Dodaj komentarz prawny do §3 — brakuje wskazania jurysdykcji."
- „Pobierz wszystkie dokumenty projektu jako ZIP."

---

### Projekty (teczki spraw)

**Co to robi:**
Organizacja pracy w projekty odpowiadające sprawom. Każdy projekt zawiera: folder dokumentów, czat z kontekstem projektowym (asystent ma dostęp do wszystkich dokumentów projektu jednocześnie), tabular reviews i listę współpracowników. Dokumenty można przenosić między folderami przeciąganiem.

**Jak maksymalnie wykorzystać:**
Twórz jeden projekt per sprawa i wgraj do niego wszystkie akta. Czat w projekcie automatycznie przeszukuje całą teczką — nie musisz wklejać fragmentów ręcznie. Udostępnij projekt współpracownikowi przez „People" — będzie miał dostęp do tych samych dokumentów i historii czatu. Jeśli sprawa ma 10 dokumentów, Patron przy pytaniu o sprzeczności przeszukuje wszystkie naraz.

**Przykłady poleceń:**
- „Jakie są sprzeczności między umową główną a aneksem nr 3?"
- Utwórz projekt „Sprawa XYZ" i wgraj do niego cały folder akt z dysku.

---

### Workflowy (automatyzacje krok po kroku)

**Co to robi:**
Edytor sekwencji kroków dla powtarzalnych zadań prawnych. Definiujesz prompt i opcjonalne kolumny tabelaryczne, zapisujesz jako workflow, uruchamiasz na nowych sprawach. Dostępne są workflowy wbudowane (read-only, dostarczone przez MateMatic) oraz własne. Edytor WYSIWYG (Tiptap), auto-save, możliwość udostępniania.

**Jak maksymalnie wykorzystać:**
Zacznij od wbudowanych workflowów (np. „Analiza umowy najmu", „Przegląd due diligence"). Uruchom na dokumentach nowej sprawy zamiast pisać pytania od początku. Jeśli potrzebujesz własnego — Workflowy → Nowy → wpisz instrukcje krok po kroku → zapisz. Przy kolejnych sprawach tego samego typu uruchamiasz workflow jednym kliknięciem. Maksymalny efekt: standaryzacja pracy kancelarii — każdy wspólnik robi due diligence tym samym checklistem.

**Przykłady:**
- Uruchom workflow „Analiza umowy o dzieło" na nowej umowie.
- Stwórz własny workflow „Sprawdzenie klauzul abuzywnych" dla spraw konsumenckich.

---

### Biblioteka umiejętności (Skill Library)

**Co to robi:**
Rozszerzenia pipeline obrony o niestandardowe etapy. Importujesz skill z pliku JSON (manifest z nazwą, instrukcją systemową, metadanymi egress). Po włączeniu skill pojawia się jako dodatkowy etap w Recenzent / Adwokat / Humanizer. Bramka egress blokuje skille wymagające chmury bez jawnej zgody.

Wbudowane umiejętności (zawsze aktywne): **Recenzent**, **Adwokat diabła**, **Pisz po ludzku** — to etapy panelu „Draft odpowiedzi". Własne włączasz, wyłączasz i importujesz.

**Jak maksymalnie wykorzystać:**
Otwórz **Biblioteka umiejętności** w panelu bocznym. Wbudowane działają od razu. Własne importujesz z pliku JSON (Import) — skille lokalne nie wymagają połączenia z internetem; bramka egress blokuje skille wymagające chmury bez jawnej zgody.

---

### Kontrola egresu danych (data residency)

**Co to robi:**
Każde zapytanie do LLM jest klasyfikowane (`attorney_client_privileged` / `internal` / `public`), a strażnik data-residency podejmuje i **audytuje** decyzję o egresie. W wersji desktopowej (jednoosobowej) adwokat jest gospodarzem danych na własnej maszynie, więc jego wybór modelu chmurowego jest świadomą zgodą — domyślnie **dowolny model działa na każdej sprawie**, również objętej tajemnicą. Zgoda zdejmuje blokadę, **nie** audyt: każde wyjście danych ląduje w niemodyfikowalnym dzienniku z jawnym powodem (np. `privileged-cloud-by-operator`), a PII jest maskowane przed wysłaniem. Tryb serwerowy/fabryczny pozostaje rygorystyczny (tajemnica → tylko model lokalny), dopóki administrator nie włączy zgody.

**Jak maksymalnie wykorzystać:**
Ustawienia → Modele: wybierz model dopasowany do zadania (chmurowy — np. Libra/Claude, Gemini — dla najwyższej jakości; lokalny Ollama dla pracy bez internetu). Sprawdzaj klasyfikację projektu w ustawieniach sprawy. Jeśli kancelaria chce zaostrzyć politykę (np. tajemnica wyłącznie lokalnie), administrator wyłącza zgodę zmiennymi `PATRON_ALLOW_PRIVILEGED_CLOUD` / `ALLOW_US_PROVIDERS`. Dziennik audytu daje pełny ślad, którym modelem i kiedy przetwarzano daną sprawę.

Tabular Review przechodzi przez ten sam strażnik data-residency co czat i pipeline obrony (ADR-0099) — klasyfikacja sprawy decyduje, czy dane mogą trafić do modelu chmurowego.

---

### Audit trail i compliance AI Act

**Co to robi:**
Niemodyfikowalny łańcuch hash (Merkle, RFC 6962) wszystkich zdarzeń: każde wywołanie LLM, decyzja egresu, skan bezpieczeństwa, weryfikacja cytatu. Widoczny w panelu `/admin/audit`. Eksport paczki audytowej (SHA-256 + Merkle proof) dla regulatora lub audytora. Weryfikacja CLI (`npm run audit:verify`). Merkle root przeliczany automatycznie co godzinę.

**Jak maksymalnie wykorzystać:**
Jako administrator: przejdź bezpośrednio pod URL `/admin/audit` (link w sidebarze jeszcze nie jest widoczny). Filtruj po typie zdarzenia, użytkowniku, zakresie dat. Kliknij zdarzenie → „Eksportuj paczkę audytową" → plik JSON z dowodem kryptograficznym. Przy kontroli UODO lub audycie AI Act: eksportuj paczkę dla konkretnego zdarzenia i przekaż audytorowi. Retencja: 5 lat.

**Przykłady użycia:**
- Eksport dowodu kryptograficznego dla konkretnej odpowiedzi asystenta na potrzeby kontroli.
- Weryfikacja, że żaden wpis audit trail nie został zmodyfikowany.

---

### RODO: zapomnij sprawę

**Co to robi:**
Endpoint `POST /rodo/forget-case` usuwa kompletnie: embeddingi RAG, brain store, relacyjne rekordy, pliki storage dla wskazanej sprawy. Wymaga jawnego potwierdzenia (`confirm: true`). Audit trail usunięcia jest zachowany (sam fakt usunięcia zostaje w logu, treść jest usuwana). Zgodne z RODO art. 17.

**Status — w przygotowaniu:** Brak przycisku w UI (blokada P2, ADR-0061). Mecenas samodzielnie nie może uruchomić z interfejsu. Dostępne przez API (curl lub narzędzie administratora). Wymaga przycisku „Usuń sprawę trwale (RODO)" w panelu projektu przed udostępnieniem mecenasowi.

**Jak skorzystać teraz:** Poproś administratora o wykonanie `POST /rodo/forget-case` z `{caseId, confirm: true}`. Fakt i data usunięcia zostaną odnotowane w audit trail.

---

### Zużycie tokenów i koszty

**Co to robi:**
Panel `/account/usage` z sumarycznym zużyciem tokenów, podziałem po modelu, podziałem po sprawie (caseId) i serią czasową. Statyczna tabela cen dla wszystkich modeli Anthropic / Google / OpenAI / OpenRouter. Ollama lokalna = koszt 0 tokenów w raporcie.

**Jak maksymalnie wykorzystać:**
Konto → Zużycie. Sprawdzaj regularnie per sprawa — jeśli jedna sprawa generuje 80% kosztów, rozważ zmianę modelu na tańszy dla rutynowych zapytań (`tabularModel` w Ustawieniach). Duże sprawy z wieloma dokumentami: preferuj Ollamę do eksploracji akt, model chmurowy tylko do finalnego draftu pisma.

---

### MCP Security Gateway (ochrona przed atakami na narzędzia AI)

**Co to robi:**
Skanuje każdy serwer MCP (zewnętrzne narzędzia) przed rejestracją: wykrywa typosquat (podrobione nazwy konektorów), drift konfiguracji, ukryte instrukcje w opisach narzędzi (prompt injection przez tool description), tool poisoning. Blokuje podejrzane konektory przed załadowaniem. Banner w UI informuje o stanie (enforce / audit / off).

**Jak maksymalnie wykorzystać:**
Jako administrator: sprawdź banner MCP Security na górze ekranu. Stan `enforce` = konektory skanowane i blokowane automatycznie. Przy dodawaniu nowego serwera MCP: załaduj konfigurację i sprawdź log bezpieczeństwa przed pierwszym użyciem przez mecenasa.

**Status — ograniczenia:** `GET /api/security/mcp-status` ma aktualnie błąd schematu bazy danych (blokada P0) — banner może pokazywać error zamiast statusu. Skontaktuj się z administratorem, jeśli banner wyświetla błąd.

---

### Konektory prawnicze: orzecznictwo i legislacja PL + UE

**Co to robi:**
Komplet **6 konektorów wbudowanych w instalator** (działają od razu, bez konfiguracji), dostępnych jako narzędzia w czacie. Patron automatycznie sięga do właściwej bazy, gdy pytanie dotyczy orzeczenia, przepisu lub podmiotu:

| Konektor | Domena | Przykładowe narzędzia |
|---|---|---|
| **saos** | orzeczenia sądów powszechnych, SN, TK, KIO | search / get_judgment / search_by_case |
| **nsa** | orzecznictwo NSA + 16 WSA (CBOSA) | search / get_judgment / search_by_case |
| **isap** | legislacja PL (Dz.U., M.P., Sejm ELI) | search_acts / get_act / get_act_text |
| **krs** | Krajowy Rejestr Sądowy | get_entity / get_entity_full / get_board |
| **eu-sparql** | prawo UE + TSUE (live SPARQL) | search_by_celex / search_by_date_range / search_cjeu |
| **eu-compliance** | compliance UE offline (RODO, AI Act, DORA, NIS2, eIDAS 2.0, CRA) | eu_search / eu_article / eu_check_applicability |

Konektory uruchamiają się pod silnikiem wbudowanym w aplikację — mecenas nie musi instalować żadnego dodatkowego oprogramowania. Korpus prawa UE (eu-compliance) działa w pełni offline.

**Jak maksymalnie wykorzystać:**
Pytaj wprost z powołaniem na akt lub temat. Wyniki traktuj jako podpowiedź do weryfikacji — weryfikuj bieżące brzmienie przepisów w LexLege / Legalis przed cytowaniem w piśmie (konektory mogą mieć opóźnienie w stosunku do Dz.U.). Wersje historyczne aktów (time-travel) są w planach (ADR-0021).

**Przykłady poleceń:**
- „Wyszukaj orzeczenia Sądu Najwyższego o zadośćuczynieniu za naruszenie dóbr osobistych. Podaj sygnatury." (Patron zwróci realne wyroki z SAOS, np. I CSK 90/15, III CSK 217/15.)
- „Sprawdź w KRS zarząd spółki Nowak-Bud sp. z o.o."
- „Jaka jest podstawa prawna w Rozporządzeniu RODO dla prawa do bycia zapomnianym?"
- „Pokaż mi art. 415 KC."
- „Jaka jest definicja 'systemu AI wysokiego ryzyka' w AI Act?"
- „Sprawdź, czy DORA ma zastosowanie do kancelarii prawnej."

---

## DOBRE PRAKTYKI

**1. Model lokalny vs chmura — zasada minimum.**
Wybierz model świadomie pod zadanie. Model chmurowy (Libra/Claude, Gemini) daje najwyższą jakość i jest normalnym wyborem kancelarii — działa na każdej sprawie, a egress jest audytowany. Model lokalny (Ollama) wybierz, gdy chcesz pracować bez internetu lub maksymalnie zawęzić obieg danych. To Twoja i zarządu kancelarii decyzja; Patron jej nie narzuca, tylko ją dokumentuje.

**2. Jeden projekt per sprawa.**
Nie mieszaj akt różnych spraw w jednym projekcie. Patron przeszukuje wszystkie dokumenty projektu przy każdym pytaniu — pomieszane sprawy dają rozproszony i błędny retrieval. Dobrze nazwany projekt (np. „Kowalski v. ABC SA — roszczeń 2026") ułatwia też pracę współpracownikom.

**3. Czytaj badge grounding przed cytowaniem.**
Zielony badge = cytat zweryfikowany w Twoich dokumentach, możesz go użyć w piśmie. Żółty = sprawdź oryginał. Czerwony = nie cytuj bez ręcznej weryfikacji. AI może formułować zdania, które brzmią jak cytaty, ale nimi nie są — badge jest Twoim filtrem.

**4. Pipeline obrony po, nie zamiast, własnej pracy.**
Recenzent i Adwokat są najskuteczniejsi, gdy dostaną gotowy draft — nie pusty prompt. Napisz swoją wersję argumentacji, wklej ją do pipeline i poproś o wskazanie słabości. Potem korekta przez Ciebie, opcjonalnie drugi przebieg pipeline.

**5. Wgraj wszystkie akta przed czatem.**
RAG retrieval działa tym lepiej, im więcej dokumentów sprawy jest zaindeksowanych. Wgrywaj akta przed pierwszym pytaniem, nie na bieżąco — inaczej wcześniejsze odpowiedzi mogą nie uwzględniać dokumentów dodanych później.

**6. Konektory prawnicze — jako podpowiedź, nie jako wyrocznię.**
mcp-isap i mcp-eu-compliance dostarczają teksty aktów, ale mogą mieć opóźnienie względem Dziennika Ustaw. Traktuj wyniki jako wstępną weryfikację i szybki dostęp do treści przepisu — przed cytowaniem w piśmie sprawdź bieżące brzmienie w oficjalnym źródle.

**7. Regularnie sprawdzaj panel zużycia tokenów.**
Jedna duża sprawa z wieloma iteracjami na modelu chmurowym może generować znaczące koszty. Konto → Zużycie → filtruj po caseId. Jeśli koszt jest wysoki, rozważ przełączenie na Ollamę dla pracy eksploracyjnej.

---

## FAQ

**Czy moje akta wychodzą do chmury?**
Domyślnie nie. Patron jest zainstalowany lokalnie na infrastrukturze kancelarii. Jeśli wybierzesz model chmurowy (Anthropic, Google, OpenAI), treść promptu trafia do tego dostawcy — ale wyłącznie wtedy, gdy Ty lub administrator podjął tę decyzję w Ustawieniach. Dla maksymalnej szczelności: model Ollama, zero ruchu do internetu.

**Który model wybrać?**
Do większości pracy: model chmurowy (Libra/Claude, Gemini) — najwyższa jakość redakcji i rozumowania, działa na każdej sprawie. Gdy potrzebujesz pracy offline lub maksymalnie zamkniętego obiegu danych: model lokalny (Ollama — llama3.2, Qwen lub inny zainstalowany). Zmiana to jedna wartość w Ustawieniach → Modele — nie wymaga reinstalacji. Niezależnie od wyboru, każde wyjście danych jest zapisane w dzienniku audytu.

**Co znaczy zielony / żółty / czerwony badge?**
Zielony: cytat dosłowny znaleziony w Twoich dokumentach. Żółty: AI mogło przekształcić oryginalny tekst — sprawdź oryginał. Czerwony: cytatu nie znaleziono w zaindeksowanych dokumentach, możliwa halucynacja — nie cytuj bez ręcznej weryfikacji.

**Jak usunąć sprawę (RODO art. 17)?**
Aktualnie przez API (brak przycisku w UI — w przygotowaniu). Poproś administratora o wykonanie `POST /rodo/forget-case` z `{caseId, confirm: true}`. Patron usunie embeddingi, pliki i rekordy tej sprawy. Fakt usunięcia zostanie odnotowany w audit trail. Interfejs użytkownika (przycisk w panelu projektu) jest zaplanowany w kolejnej wersji.

**Jak eksportować dokumenty z komentarzami do Worda?**
Poproś asystenta o zaproponowanie zmian jako „tracked changes". Patron zwróci plik DOCX, który otwierasz w Word — widzisz czerwone wstawienia i przekreślenia, akceptujesz lub odrzucasz każdą zmianę. Pobierz przez panel dokumentów → ikona pobierania.

**Czy Patron sprawdza, czy ustawa jest aktualna?**
Konektory (mcp-isap dla prawa PL, mcp-eu-compliance dla prawa UE) dostarczają teksty przepisów, ale mogą mieć opóźnienie. Patron nie weryfikuje automatycznie, czy pobrane brzmienie jest najnowsze. Traktuj wyniki jako podpowiedź — weryfikuj bieżącą wersję w Dzienniku Ustaw lub komercyjnej bazie przed pismem.

**Kto ma dostęp do audit trail?**
Tylko administrator kancelarii (rola Administrator) przez panel `/admin/audit`. Mecenas (rola Operator) nie ma bezpośredniego dostępu do surowego logu. Eksport paczki audytowej dla regulatora lub biegłego wykonuje administrator.

**Czy Patron podejmuje decyzje prawne?**
Nie. Patron jest narzędziem wspomagającym — przeszukuje dokumenty, cytuje źródła, proponuje sformułowania. Ocena prawna, podpisanie pisma i odpowiedzialność zawodowa pozostają po Twojej stronie. Patron nie zastępuje analizy mecenasa.

---

*Dokument zgodny ze stanem produktu na dzień 2026-06-03. Aktualizacja po każdym wydaniu z listą zmian statusów (działa / w przygotowaniu).*
