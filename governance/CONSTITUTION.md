# Konstytucja AI Patrona

Wersja: 1.6.1
Data: 2026-06-04
Status: obowiązująca
Wydawca: MateMatic / Wiesław Mazur

> Dokument governance opisujący zasady, ograniczenia i role w pracy
> z produktem Patron - lokalnym agentem AI dla polskich kancelarii
> prawnych. Pisany w polskim porządku prawnym, zgodnie z AI Act, RODO
> oraz Zasadami Etyki Adwokackiej i Zasadami Etyki Zawodowej Radcy
> Prawnego.

---

## Spis sekcji

1. [Misja](#1-misja)
2. [Zasady (max 9 artykułów)](#2-zasady-max-9-artykułów)
3. [Granice - czego Patron NIE robi](#3-granice---czego-patron-nie-robi)
4. [Role governance](#4-role-governance)
5. [Audyt i record-keeping](#5-audyt-i-record-keeping)
6. [Ewolucja konstytucji](#6-ewolucja-konstytucji)
7. [Załącznik A: Mapa do AI Act + RODO + Etyka zawodowa](#załącznik-a-mapa-do-aktow-prawnych)
8. [Załącznik B: Słowniczek](#załącznik-b-słowniczek)

---

## 1. Misja

Patron to lokalny agent AI dla polskiej kancelarii prawnej. Pomaga
prawnikowi pracować szybciej z dokumentami i orzecznictwem. Trzyma
tajemnicę zawodową, RODO i przewidywalność.

Patron NIE jest:
- chmurową usługą SaaS - produkt instaluje się u kancelarii (self-host)
- czarną skrzynką - każde wywołanie modelu, każdy odczyt dokumentu,
  każde wywołanie konektora zostawia ślad w audit trail z hash-chain
- modelem AI - Patron jest powłoką, **kancelaria sama wybiera model**
  (Gemini / Claude / OpenAI / lokalny przez Ollamę) i ponosi
  odpowiedzialność za jego użycie

Jedno zdanie: prawnik pyta po polsku, Patron cytuje weryfikowalne
źródła z polskiego prawa, kancelaria ma audytowalny ślad każdej operacji.

---

## 2. Zasady (max 9 artykułów)

### Art. 1 - Lokalność danych (RODO art. 25, AI Act art. 10)

Wszystkie dane klientów (dokumenty, czaty, identyfikatory spraw)
przebywają na infrastrukturze kancelarii. Patron nie ma trybu, w którym
treść dokumentu trafia do zewnętrznego operatora bez świadomej decyzji.

Operatorzy modeli LLM (Anthropic / Google / OpenAI) widzą tylko
zawartość promptu i odpowiedź. Kancelaria decyduje, którego dostawcę
używa, i ponosi za to odpowiedzialność. Dla maksymalnej szczelności:
Ollama + Qwen / Llama lokalnie, bez transferu do US.

### Art. 2 - Weryfikowalność źródeł

Patron nie odpowiada na pytanie prawne bez podania źródła, jeśli
pytanie dotyczy konkretnego aktu lub orzeczenia. Każdy cytat z dokumentu
klienta ma znacznik `[N]` i blok `<CITATIONS>` z dokładnym fragmentem
i numerem strony. Każdy cytat z konektora MCP (SAOS/NSA/ISAP/EUR-Lex)
ma URL do oryginału, sygnaturę i datę. W panelu UI klient klika
i otwiera źródło.

Skutek: prawnik zawsze może zweryfikować, czy Patron nie zmyślił.

### Art. 3 - Audytowalność (AI Act art. 12, RODO art. 30)

Każde zdarzenie ważne compliance'owo (wiadomość użytkownika,
odpowiedź asystenta, wywołane narzędzia MCP) trafia do
`audit_log` z hash-chain SHA-256. Modyfikacja albo usunięcie wpisu
psuje łańcuch. Weryfikator (`npm run audit:verify`) wykrywa
to w sekundy.

Retencja audit log: 5 lat (zgodnie ze standardową retencją
dokumentów kancelarii). Eksport: pełny dump JSON z weryfikacją hash.

### Art. 4 - Neutralność wobec dostawców (zasada przewidywalności)

Patron nie zamyka kancelarii w jednym dostawcy modelu. Wymiana
Gemini ↔ Claude ↔ Ollama to zmiana 1 wartości w `.env`, bez
przepisywania danych. Każdy konektor MCP (SAOS, NSA, ISAP, EUR-Lex)
to osobny proces, który można wymienić, wyłączyć albo dodać.

### Art. 5 - Tajemnica zawodowa (Pr.Adw. art. 6, Pr.RP art. 3)

Dane chronione tajemnicą zawodową (treść konsultacji, akta klienta)
nie opuszczają infrastruktury kancelarii bez świadomej decyzji osoby
uprawnionej do podejmowania decyzji compliance. Definicja „świadomej
decyzji" - patrz § 4.

Mechanizmy techniczne:
- bring-your-own-model: kancelaria wybiera, czy LLM idzie do chmury
  czy zostaje lokalnie (Ollama)
- self-host MinIO/Supabase: pliki nie wychodzą poza serwer kancelarii
- audit log: każde wywołanie modelu zostawia ślad (kto, kiedy, ile
  tokenów, jaki tool MCP, ale BEZ pełnej treści promptu - tylko
  długość i metadata)
- kontrola wejścia: dokumenty przesłane do Patrona są skanowane
  lokalnie (deterministycznie, bez LLM) pod kątem prób manipulacji
  modelem (prompt-injection), ukrytych akcji PDF i zaciemnionej treści,
  ZANIM trafią do modelu lub indeksu RAG; decyzja skanu trafia do audit
  logu (ADR-0019, ADR-0020)
- zgoda Operatora (desktop, single-user): w instalacji jednoosobowej
  adwokat jest osobą uprawnioną do decyzji compliance na własnej maszynie,
  a wybór modelu chmurowego dla sprawy objętej tajemnicą JEST tą świadomą
  decyzją (§ 4). Egzekwowane technicznie: domyślny twardy blok chmury dla
  tajemnicy ustępuje, gdy Operator wyraził zgodę (`PATRON_ALLOW_PRIVILEGED_CLOUD`,
  na desktopie domyślnie włączona). Zgoda zdejmuje BLOKADĘ, nie ZABEZPIECZENIA:
  każde wyjście danych ląduje w audit logu z jawnym powodem
  `privileged-cloud-by-operator`, a PII jest maskowane przed wysłaniem. Tryb
  serwerowy/fabryczny pozostaje rygorystyczny (tajemnica → tylko model lokalny),
  dopóki Administrator nie włączy zgody. Patrz ADR-0101.

### Art. 6 - Granica błędu (zasada "human in the loop")

Patron nie wykonuje czynności prawnych w imieniu kancelarii. Pisma,
opinie, wnioski przygotowywane przez Patrona są draftami, które
prawnik musi przejrzeć i podpisać. Edycje proponowane przez Patrona
(zmiany śledzone w `.docx`) mają mechanizm Akceptuj / Odrzuć.
Domyślnie żadna zmiana nie jest automatycznie wcielona.

Patron nigdy nie składa pisma do sądu, nie wysyła maila do klienta,
nie podpisuje umowy.

### Art. 7 - Minimalność danych (RODO art. 5 ust. 1 lit. c)

Patron przetwarza tylko te dane, które są niezbędne do odpowiedzi
na konkretne pytanie. Wbudowane narzędzia (`read_document`,
`find_in_document`) ładują tylko dokumenty, do których prawnik
sięga w danej turze czatu, a nie cały folder klienta.

Konektory MCP (SAOS/NSA/ISAP/EUR-Lex) odpytują publiczne źródła prawa.
Nie ma w nich danych klienta kancelarii.

### Art. 8 - Stałość kontraktów

Schema bazy danych (`schema.sql`), kontrakty MCP (`mcp-servers.json`),
SSE eventy (`citations`, `mcp_citations`, `content_delta`, `doc_edited`)
są wersjonowane SEMVER. Łamanie kompatybilności wymaga MAJOR bump
i ADR (Architecture Decision Record). Kancelaria ma prawo zostać
na poprzedniej wersji i otrzymać dokument migracji.

### Art. 9 - Dostępność wiedzy

Wszystko, co Patron robi, jest udokumentowane w otwartym repozytorium:
kod, schema, runbook (`deploy/README.md`), playbook wdrożeniowy
(`governance/IMPLEMENTATION_PLAYBOOK.md`). Black-box nie istnieje.
Kancelaria może wykonać audyt bezpieczeństwa przez własny zespół IT
lub niezależnego audytora.

Model licencyjny (zob. [ADR-0002](./adr/0002-dual-license-agpl-shell-mit-connectors.md)):

- Powłoka Patrona (`patron` - backend, frontend, governance, deploy):
  AGPL-3.0-only. Kancelaria self-host nie ma żadnych dodatkowych
  obowiązków poza prawem do używania, modyfikacji i dystrybucji wewnątrz
  organizacji. Konkurent oferujący Patrona jako SaaS dla osób trzecich
  musi otworzyć swoje modyfikacje.
- 6 konektorów MCP (`mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`,
  `mcp-eu-sparql`, `mcp-eu-compliance`, osobne repo): MIT. To
  infrastruktura do publicznych źródeł prawa polskiego i unijnego.
  Chcemy, żeby cały ekosystem polskiego i unijnego legal-techu mógł
  je wpinać do swoich produktów, niezależnie od ich licencji.

---

## 3. Granice - czego Patron NIE robi

| Granica | Uzasadnienie |
|---|---|
| Nie wykonuje fine-tuningu na danych klienta | Treść akt klientów nie staje się częścią wag modelu. Zostaje tylko w bazie kancelarii. |
| Nie składa pism, nie wysyła maili, nie podpisuje umów | Human in the loop (Art. 6). |
| Nie udostępnia danych pomiędzy kancelariami | Każdy self-host to osobna instancja. Nie ma „chmury wspólnej". |
| Nie ukrywa wywołań LLM ani konektorów MCP | Wszystko widoczne w audit log oraz UI (panel cytatów). |
| Nie obiecuje aktualności źródeł poza tym, co źródła deklarują | Patron mówi „daty w SAOS bywają zniekształcone przez OCR, zweryfikuj". |
| Nie używa danych klienta do trenowania modeli MateMatic | Klauzula umowna oraz brak technicznych ścieżek wysyłki. |
| Nie ingeruje w wybór modelu kancelarii | Bring-your-own-model. Patron jest powłoką. |
| Nie tworzy reprezentatywnych zbioru przykładów dla marketing/sales | Bez wyraźnej pisemnej zgody klienta kancelarii. |

---

## 4. Role governance

### 4.1. Administrator kancelarii (Owner)

Wskazana osoba decyzyjna (typowo partner zarządzający / OD / IT). Odpowiada za:
- Wybór modelu LLM (sekretu API w `.env`).
- Wybór modelu retencji (5 lat audit log = default).
- Decyzję o wpięciu konektorów MCP (np. czy `mcp-eu-sparql` włączony).
- Akceptację aktualizacji konstytucji (każdy MINOR/MAJOR bump).
- Powołanie Operatora i Inspektora.

### 4.2. Operator (typowo IT / DevOps)

Odpowiada za:
- Uruchamianie i aktualizacje stacku (`docker compose up`, runbook).
- Backup (RODO art. 32, kopie zapasowe zgodnie z polityką).
- Monitoring (zdrowie kontenerów, integralność audit chain).
- Reagowanie na incydenty bezpieczeństwa (mostek do MateMatic, gdy potrzeba).

### 4.3. Inspektor (IOD / compliance)

Odpowiada za:
- Comiesięczny przegląd `audit_log` (sample 10% wpisów oraz verify chain).
- Aktualizację rejestru czynności przetwarzania (RODO art. 30).
- Decyzję o eksporcie albo usunięciu danych klienta (RODO art. 17 i 20).
- Akceptację incydentu (kto miał dostęp do czego i dlaczego).

### 4.4. Użytkownik (prawnik)

Odpowiada za:
- Świadomą interakcję z Patronem (nie wpisuje danych objętych
  bezwzględną tajemnicą do promptu, jeśli LLM jest w chmurze).
- Weryfikację cytatów PRZED dołączeniem do pisma do sądu.
- Zgłaszanie nieprawidłowości (halucynacje, błędne cytaty)
  do Administratora.

### 4.5. Dostawca (MateMatic)

Odpowiada za:
- Bezpieczeństwo kodu (`npm audit`, security review przed release).
- Stałość kontraktów (Art. 8).
- Aktualizacje konektorów MCP gdy źródła publiczne zmieniają format.
- Dokumentację i runbook.

Nie odpowiada za: model LLM (dostawca modelu), infrastrukturę kancelarii,
treść porad prawnych generowanych przez Patrona.

### 4.6. Admin (ADR-0034, LIVE 2026-05-27)

Podzbiór roli Administrator z dostępem do zaostrzonych endpointów backend
(np. `GET /api/audit/merkle/verify/:eventId` - audyt Merkle dla UODO/biegłego).
Admin pool zarządzany przez whitelist emaili w env `PATRON_ADMIN_EMAILS`
(CSV, lowercase, trim). Edycja wymaga restartu kontenera. Audyt zmian =
git history `.env.example` w repo deployment.

Middleware `requireAdmin` w `backend/src/middleware/auth.ts` - ZAWSZE po
`requireAuth` w łańcuchu (czyta `res.locals.userEmail`). Strukturyzowane logi
`[ADMIN] grant|denied` na stdout. Audit_log eventu `admin.access` = rezerwacja
ADR-0043 (wymaga migracji 002 ALTER CHECK whitelist event_type).

Typowy admin pool kancelarii: 1-3 osoby (operator + wspólnik + IT). MVP
whitelist email akceptowalny dla tej skali. Migracja na DB-backed role
(kolumna `is_admin` lub tabela `admin_users`) = przyszły ADR gdy kancelaria
przekroczy 10+ adminów.

---

## 5. Audyt i record-keeping

### 5.1. Co jest zapisywane

Whitelist event_type egzekwowana przez CHECK constraint `audit_log_event_type_whitelist` (ADR-0035, migracja 001). Dodanie nowego event_type wymaga osobnej migracji + ADR.

| Zdarzenie | Pola w `payload` jsonb | ADR |
|---|---|---|
| `chat.message.user` | user_id, chat_id, content_len, file_count, workflow_id | ADR-0001 |
| `chat.message.assistant` | chat_id, model, full_text_len, event_count, citation_count, mcp_citation_count, mcp_tools_called[] | ADR-0001 |
| `input_security_scan` | document_id, security_status, findings[category, technique, severity, confidence] | ADR-0019/0020 |
| `mcp_security.gateway` | server_name, action, risk_score, findings_count, findings[detector, severity, message] | ADR-0033 |
| `ring_policy.decision` | tool_name, server_name, ring, action, reason | ADR-0027 |
| `rodo.delete` | actor_user_id (NULL po anonimizacji) | RODO art. 17 |
| `rodo.export` | user_id, destination | RODO art. 20 |

Pola w `payload` jsonb są celowo bez pełnej treści. Przechowujemy
długości, liczniki, identyfikatory. Pełna treść jest w `chat_messages`
albo `documents` (z kasowaniem na żądanie RODO art. 17).

### 5.2. Hash-chain

```
audit_log[N].prev_hash == audit_log[N-1].hash
audit_log[N].hash      == sha256(prev_hash || canonical_json(ts, event_type, actor, chat_id, document_id, payload))
audit_log[0].prev_hash == "0".repeat(64)   # genesis
```

Weryfikator: `npm run audit:verify` (`scripts/verify-audit-chain.ts`).
4 scenariusze ataku pokryte testami (modyfikacja payload, usunięcie wpisu,
podmiana hash, reorder).

### 5.2.1. Merkle audit chain (ADR-0026, WDROZONY 2026-05-27)

Nad hash-chain zbudowane jest **drzewo Merkle** (RFC 6962) jako rownolegla
warstwa weryfikacji. Hash-chain detekuje modyfikacje (continuous integrity),
Merkle daje audytorowi proof-of-inclusion konkretnego eventu w **O(log n)**
zamiast O(n) lancucha.

Tabela `audit_merkle_roots` (chain_block_start, chain_block_end, merkle_root,
event_count, computed_at, computed_by). Lisce drzewa = `audit_log.hash`.
Wezly wewnetrzne = `sha256(left_hex || right_hex)`. Nieparzysta liczba lisci
= duplicate last.

Audytor (UODO, rewident, biegly w postepowaniu) dostaje samowystarczalny
`ProofBundle` (event_hash + proof + merkle_root + zakres bloku) i mozna
zweryfikowac offline przez `verifyProofBundle` - bez dostepu do bazy
kancelarii (chroni tajemnice zawodowa innych klientow).

Manualny trigger compute LIVE od ADR-0026; hybrid auto-trigger LIVE od
ADR-0036 (count >= 1000 events OR interval >= 24h, env-tunable, idempotency
check przed compute). Endpoint `GET /api/audit/merkle/verify/:eventId`
LIVE od ADR-0036 - audytor pobiera samowystarczalny ProofBundle przez
HTTPS i weryfikuje offline. UI viewer dla audytora = rezerwacja ADR-0040
(blocked-by ADR-0034 RBAC admin). Zewnetrzny znacznik czasu
(RFC 3161 / OpenTimestamps) = rezerwacja ADR-0037.

### 5.2.2. Whitelist event_type i infrastruktura migracji (ADR-0035, WDROZONY 2026-05-27)

Kolumna `audit_log.event_type` ma CHECK constraint z whitelist 7 produkcyjnych
wartosci (tabela 5.1). Lustrzane typowanie w TypeScript przez `EVENT_TYPES`
+ `EventType` union (`backend/src/lib/audit.ts`). Dwie warstwy obrony:
TypeScript wylapuje blad dewelopera w compile time, CHECK constraint wylapuje
blad runtime (raw SQL, mock supabase, atak SQL injection).

Dodanie nowego event_type wymaga: (1) migracji `backend/migrations/NNN_*.sql`
z ALTER CHECK, (2) ADR (jezeli nietrywialne semantycznie), (3) bump `EVENT_TYPES`
w `lib/audit.ts`, (4) wpis w tabeli 5.1 tej Konstytucji.

Infrastruktura migracji: governance-friendly runner `backend/scripts/run-migrations.ts`
(komendy `plan`/`mark`/`status`/`rollback`/`rollback:mark`). Operator kancelarii
aplikuje DDL manualnie w Supabase SQL Editor / psql / pgAdmin, potem oznacza
w rejestrze `schema_migrations`. Audytowalne (DDL widoczny w Supabase Audit Logs).
Zero nowych zaleznosci npm.

Down/rollback LIVE od ADR-0038 - format `-- UP` / `-- DOWN` sekcji w jednym
pliku migracji, pure helper `extractUpDown` w `lib/migrations.ts`. Operator
robi `npm run migrate:rollback NNN` (wypisuje DOWN SQL), aplikuje manualnie
w SQL Editor, potem `npm run migrate:rollback:mark NNN` (kasuje rekord
z schema_migrations + console.warn `[MIGRATE-ROLLBACK]`). Audit_log eventu
`migrate.rollback` = rezerwacja ADR-0043. CI gate na drift schema.sql vs
migrations = rezerwacja ADR-0039.

### 5.3. Retencja i usunięcie

- Domyślna retencja audit_log: 5 lat (konfigurowalne).
- Wniosek RODO art. 17 (prawo do bycia zapomnianym): zachowujemy
  audit_log (compliance obligation > prawo do usunięcia), ale
  anonimizujemy pole `actor_user_id` przez ustawienie na NULL
  (FK `ON DELETE SET NULL`).
- Eksport zgodnie z RODO art. 20: pełny dump JSON dla wnioskodawcy
  (osobny endpoint, planowane Faza 4.2).

### 5.4. Co audyt potwierdza

- Kompletność: każda odpowiedź asystenta ma swój wpis.
- Integralność: hash-chain niezerwany.
- Atrybucja: kto, kiedy, jakim modelem.
- Konektory: które MCP były wołane (`mcp_tools_called`).

Czego audyt nie pokrywa: treści dokumentów klientów. Są w
`document_versions` albo MinIO i mają osobny cykl życia. Szyfrowanie
zalecane przy backup off-site.

---

## 6. Ewolucja konstytucji

### 6.1. SEMVER

- MAJOR (X.0.0): zmiana znaczenia zasady, usunięcie zasady, zwężenie
  roli, łamanie kontraktu API. Wymaga pisemnej akceptacji Administratora
  i okresu przejściowego ≥ 60 dni.
- MINOR (1.X.0): nowa zasada, rozszerzenie roli, nowy wpis w audit_log.
  Wymaga notatki dla Administratora przed wdrożeniem.
- PATCH (1.0.X): doprecyzowanie, literówka, korekta linku. Wystarcza
  commit i changelog.

### 6.2. ADR (Architecture Decision Record)

Każda decyzja zmieniająca konstytucję, schemę bazy, kontrakt MCP
zostaje udokumentowana jako `governance/adr/NNNN-tytul.md` ze strukturą:

```
# ADR-NNNN: <tytul>
Status: Proposed | Accepted | Deprecated | Superseded by ADR-MMMM
Date: YYYY-MM-DD
Decision: <co zdecydowano>
Context: <jaki problem rozwiązuje>
Consequences: <co się zmienia>
```

### 6.3. Changelog konstytucji

| Wersja | Data | Zmiana |
|---|---|---|
| 1.6.1 | 2026-06-04 | Rozszerzenie zasady audytowalnosci (Art. 3) o grounding cytatow (ADR-0102). A: tagi proweniencji cytatu - DETERMINISTYCZNY (z metadanych zrodla retrievalu, nie z LLM) tag POCHODZENIA (saos/isap/eurlex/uzytkownik/model; default=model "do weryfikacji"; pinpoint zawsze do weryfikacji), os ortogonalna do verdict ADR-0097. B: stan needs_review komorki tabular - cytat bez weryfikowalnego zrodla nie milczy (undefined, ADR-0080) tylko oznacza needs_review ("pusta komorka ukrywa informacje"), rozszerza model komorki ADR-0011. Rekordy audit_log (groundingSummary chat + tabular.grounding ADR-0082) dostaja OPCJONALNE liczniki proweniencji/needs_review (tylko liczby/enumy, zero PII; pola dolaczane warunkowo = wstecznie kompatybilny ksztalt). Do UI/SSE wylacznie enumy (tag/pinpoint/status), uzasadnienia/tresci NIE. decision (ADR-0005, blokada deliverable) DETERMINISTYCZNA i nietknieta - to warstwa doradcza/znakujaca. Oba postanowienia za flagami PATRON_PROVENANCE_TAGS / PATRON_TABULAR_CELL_STATES (default OFF) - zero zmiany zachowania do evalu. Wzorzec clean-room z anthropics/claude-for-legal (Apache-2.0). tsc 0 (backend+frontend), vitest 1114 pass/0 fail (+20 testow), self-review patron-pr-review bez blockerow. WARUNEK: 2x review WM + eval korpus PL przed flipem flag, przed merge do main. PATCH (rozszerzenie istniejacej zasady audytowalnosci o opcjonalne liczniki, nie nowy event_type; brak zmiany kontraktow rol/API; per Sec 6.1 wystarcza commit i changelog, bez re-podpisu). |
| 1.6.0 | 2026-06-03 | Doprecyzowanie Art. 5 (tajemnica zawodowa) - mechanizm swiadomej zgody Operatora na model chmurowy dla spraw objetych tajemnica (ADR-0101). Kontekst: twardy blok `decideRoute` (tajemnica -> tylko model lokalny, chmura bez wyjatku) byl OSTRZEJSZY niz sama Konstytucja, ktora od Art. 1/Art. 5 dopuszcza egress "za swiadoma decyzja osoby uprawnionej". W desktop single-user adwokat JEST ta osoba na wlasnej maszynie - wybor modelu chmurowego (Libra/Anthropic = glowne narzedzie prawnikow PL, "kazdy model") jest ta decyzja. Egzekwowanie: `allowPrivilegedCloud` (env `PATRON_ALLOW_PRIVILEGED_CLOUD`, na desktopie domyslnie wlaczona przez main.js; tryb serwerowy/fabryczny = rygor domyslny). Zgoda zdejmuje BLOKADE, nie ZABEZPIECZENIA: kazdy egress w hash-chain z jawnym reason `privileged-cloud-by-operator` (Art. 3 audyt) + PII maskowane przed wysylka (Art. 7). 4 nowe testy decideRoute, pelny suite 1095 pass/5 todo/0 fail, tsc 0. Zweryfikowane na zywej binarce (privileged+chmura bez flag w konsoli; audyt potwierdzony). WARUNEK: re-podpis Konstytucji przez kancelarie + 2x review WM przed merge do main. MINOR (zmiana egzekwowanego zachowania bramy egress zgodna z istniejaca zasada swiadomej decyzji; nie lamie kontraktow rol). |
| 1.5.0 | 2026-05-29 | Wejscie kompletu: silnik konwersji->Markdown + OCR WPIETY w ingest (ADR-0074, powod powstania Patron Desktop - bol Beaty: zdjecia/skany/PDF bez limitu). documentIngest.ts ekstrahuje teraz przez convertToMarkdown (lib/convert/): ZACHOWAWCZE dla pdf/docx (te same extractPdfText/extractDocxBodyText), a skany-PDF bez warstwy tekstu i obrazy (jpg/png/tiff) ida przez OCR lokalny (Chandra, runOcr subprocess, zero-cloud). ALLOWED_TYPES dynamiczne: obrazy akceptowane TYLKO gdy isOcrConfigured() (PATRON_OCR_CMD ustawiony) - build bez Chandry zachowuje sie jak dotad (czyste odrzucenie, zero "przyjmuje-ale-blad"). Konwersja zasila istniejacy gate input-security + RAG + graf. Best-effort: blad OCR nie wywala ingestu. Silnik konwersji kompletny (toMarkdown routing + ocrRunner, 12 testow); fidelity wyjscia (Recenzent+Pisz-po-polsku) LIVE od v1.4.6. ZOSTAJE: packaging sidecar (embeddable Python + wagi Chandry, bundled nawet 20GB) + ustawienie PATRON_OCR_CMD + frontend accept +=obrazy (1 linia x2, czeka na sweep rebrandu - pliki dirty). 804 vitest pass bez regresji proven path, tsc clean. MINOR (nowy akceptowany format wejscia = zmiana kontraktu produktu; OCR gated, aktywny gdy Chandra skonfigurowana). |
| 1.4.6 | 2026-05-29 | Fidelity warstwy wyjscia: Recenzent + "Pisz po polsku" w pipeline obrony (ADR-0074 czesc, pierwsza ZYWA czesc - lib/pipeline/defense.ts). Port dostrojonych regul ze skilli Claude-side do spakowanego promptu, zeby Patron dawal jakosc demo (wygrana 40 stron vs 14 nad Libra). RECENZENT_BAR (fidelity marko-pl-content): twardy prog jakosci - tnie marketingowy belkot/hype, wymaga podstawy prawnej dla kazdej tezy, eliminuje mgliste atrybucje/powtorzenia/niespojny rejestr, egzekwuje strukture teza-podstawa-subsumpcja-wniosek. PISZ_PO_POLSKU_RULES (fidelity humanizer-pl, UI nazwa "Pisz po polsku"): konkretne wzorce AI-slop PL - slop-slownictwo, imieslowy pozornej glebi, regula trojki, negatywne paralelizmy, omijanie kopuly (stanowi->jest), strona bierna, filler/hedging, kalki anglicyzmow (dedykowany->przeznaczony), artefakty czatbota, tropy autorytetu; typografia tylko lacznik '-' (nigdy em-dash) + polskie cudzyslowy. Zachowane: cytaty/sygnatury/przepisy/merytoryka nietkniete (BASE_RULES). Nazwy UI (Invisible AI): Recenzent=marko, "Pisz po polsku"=humanizer; kolejne skille dokladane pozniej. +2 testy fidelity (regresja kasujaca reguly = czerwony test), tsc clean, 799 vitest pass. PATCH (refinement jakosci istniejacego ADR-0058, bez zmiany kontraktow rol ani API). |
| 1.4.5 | 2026-05-29 | Szyfrowanie at-rest SQLite - rdzen: klucz DPAPI + honest fail-loud (ADR-0072, ostatni elevated/RED z audytu - skradziony laptop = tajemnica plaintext). Decyzja Wieslawa o zrodle klucza: OS keychain/DPAPI. Klucz 256-bit prowizjonowany w Electron main przez safeStorage (DPAPI Win / Keychain mac), persystowany jako blob zaszyfrowany przez OS (userData/secrets/db_key.enc) - NIGDY plaintext na dysku (inaczej niz getOrCreateSecret); wstrzykiwany do backendu (osobny proces) przez PATRON_DB_ENCRYPTION_KEY. Backend lib/db/atrest.ts applyEncryptionKey jako pierwsza operacja po otwarciu: brak klucza -> no-op (plaintext jak dotad), klucz + sterownik szyfruje -> PRAGMA key, klucz + sterownik NIE szyfruje -> RZUCA (honest fail-loud, weryfikacja PRAGMA cipher_version - vanilla better-sqlite3 ignoruje PRAGMA key wiec dalby falszywe bezpieczenstwo). Aktywne tylko gdy PATRON_DB_ENCRYPTION=on (opt-in jak ADR-0067); default OFF = zero regresji. POZOSTALY KROK INFRA (blokujacy pelna aktywacje): podmiana better-sqlite3 -> better-sqlite3-multiple-ciphers - NIE zrobione bo node_modules przez junction do ~/patron (publiczny baseline, zakaz instalacji tam natywnej zaleznosci), + ryzyko kompat sqlite-vec, + migracja istniejacej bazy. Kod gotowy i honest (bez falszywej deklaracji); pelna aktywacja + MINOR przy wlaczeniu domyslnym. 3 testy (no-op / fail-loud / isCipherActive), tsc clean, 790 vitest pass. PATCH (rdzen zarzadzania kluczem + honest gate; szyfrowanie nieaktywne domyslnie, brak zmiany zachowania, brak nowej zaleznosci w tym kroku). |
| 1.4.4 | 2026-05-29 | Hardening egress - 2 elevated findings krytyka audytu (ADR-0071). (1) Electron shell.openExternal dostaje allowlist schematow (https/http/mailto) PRZED otwarciem - dotad otwieral DOWOLNY url, wiec model przez prompt injection mogl wstawic link file://JS ktorego klik otwiera handler OS (lancuch E2E); + guard will-navigate blokuje nawigacje glownego okna poza localhost. (2) Embedder e5-small: env.allowRemoteModels = PATRON_EMBED_ALLOW_DOWNLOAD === 'true' (default false) - dotad model byl cicho pobierany z HF Hub (CDN US) przy 1. starcie = ukryty egress (IP/UA/timestamp poza EOG, RODO art. 44). Lokalny cache/localModelPath dzialaja offline (instancje z cache bez zmian); jednorazowe pobranie = swiadoma zgoda Operatora (wzorzec ALLOW_US_PROVIDERS z ADR-0067); brak modelu + download off => retrieval degraduje do BM25+graf (fallback ADR-0007). Pre-bundling modelu do instalatora = dlug FAZA 1. Backend tsc clean, 787 vitest pass bez regresji; desktop/main.js zweryfikowany przegladem (proces Electron bez testow auto). PATCH (domkniecie dwoch niekontrolowanych wektorow egress per Art. 2 zero-cloud; spojny opt-in; brak zmiany kontraktow). |
| 1.4.3 | 2026-05-29 | Hardening documents.ts - skan input-security nowej wersji + audit rozstrzygniecia edycji (ADR-0070, domkniecie H5+H6 audytu FAZA 0). H5: POST /:documentId/versions przed uploadFile robi pelny skan input-security (extractPdfText/extractDocxBodyText -> analyzeInput -> resolveIngestOutcome -> appendAuditEvent input_security_scan); blocked => bajty nie trafiaja do storage + 422 + security_status. Reuse funkcji z lib/documentIngest.ts (zero kopii logiki, AGENTS.md) - domkniety parytet ADR-0055 (dotad /versions omijal skan). H6: rozstrzygniecie tracked-change (accept/reject) dostaje appendAuditEvent document.edit_resolved (nowy event_type, migracja 008 ALTER CHECK, 4 lustra) z payloadem bez tresci (edit_id/change_id/mode/version_id) - mutacja dokumentu prawnego wchodzi do hash-chain (AI Act art. 12). ODSTEPSTWO od rekomendacji audytu: handler CELOWO nadpisuje bajty in-place (decyzja anty-churn, komentarz w kodzie) - zostaje; krytyczna luka to brak sladu audytu, nie brak wersji. Pelne wersjonowanie per-rozstrzygniecie = opcja FAZA 1. Obie sciezki uploadu (single/projekt/folder ORAZ nowa wersja) skanowane; kazda mutacja dokumentu w hash-chain. tsc clean, 787 vitest pass bez regresji. Brak testow route-level (reuse otestowanych funkcji). PATCH (parytet istniejacej zasady kontroli wejscia Art. 5 dla nowej wersji + audit-first dla edycji; brak zmiany kontraktow rol). |
| 1.4.2 | 2026-05-29 | Naglowki bezpieczenstwa frontendu + CSP report-only (ADR-0069, domkniecie H8 audytu FAZA 0, lane frontend). `async headers()` w next.config.ts dla `/:path*`: X-Frame-Options DENY + CSP frame-ancestors 'none' (anti-clickjacking - dokumenty klientow nieosadzalne), X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin (UUID sprawy nie wycieka w Referer), Permissions-Policy (kamera/mikrofon/geolokalizacja/browsing-topics off), Content-Security-Policy-Report-Only. CSP w trybie REPORT-ONLY na start - dynamiczny podglad docx/pdf.js i Next generuja inline; report-only zbiera naruszenia bez psucia UI, twardy enforce po analizie raportow = rezerwacja. Self-host czcionek pdf.js (H9 ADR-0067) juz pozwala font-src 'self'. Frontend tsc clean, jeden plik, zero nowych zaleznosci. PATCH (warstwa naglowkow nad istniejacym frontendem per Art. 5; CSP nieblokujace; brak zmiany kontraktow). |
| 1.4.1 | 2026-05-29 | Hardening endpointu /draft/refine (ADR-0068, domkniecie H10-H14 audytu FAZA 0, lane high-stakes defense). Pipeline obrony (Recenzent/Adwokat diabla/Pisz po ludzku, do 3 wywolan LLM) dostaje audyt i ochrone wejscia. H10: klasyfikator high-stakes (ADR-0004) wpiety jako brama minimalna w routes/draft.ts (`classifyHighStakes` + `configFromEnv`, request przyjmuje opcjonalne document_type/cm_value/explicit_high_stakes) - dotad martwy kod, teraz ozywiony i logowany (faktyczne wlaczanie debate dalej za flaga DEBATE_ENABLED, rezerwacja ADR-0004 T3). H11: per-call audit `defense.pipeline.run` (nowy event_type, migracja 007 ALTER CHECK, 4 lustra enum) z payloadem bez tresci draftu (model/etapy/adwokat_mode/document_type/high_stakes+reasons+threshold/dlugosci/duration_ms) -> hash-chain (ADR-0001) + Merkle, dowod AI Act art. 12. H12: `sanitizeContext` w lib/pipeline/defense.ts usuwa znaki kontrolne i tnie context do 2000 znakow, `withContext` otacza go separatorem `<kontekst_sprawy>` (mitygacja prompt injection we wszystkich 3 etapach). H13: limit `MAX_DRAFT_CHARS=100000` w draft.ts (DoS/koszt - dotad tylko express.json 50MB). H14: `runDefensePipeline` maskuje draft (reuse wrapInto/unwrap + egressForModel z ADR-0067) gdy egress != no-egress i PATRON_PSEUDONIM_EGRESS != false - draft plynie zamaskowany przez etapy, output odwracany do prezentacji; model lokalny pomijany. Ograniczenia FAZA 1 (udokumentowane w ADR-0068): context niemaskowany, detektor imion LLM-noop, brak twardej bramy egress dla /draft/refine (endpoint niezwiazany ze sprawa - maskowanie H14 to mitygacja). 6 nowych testow + 1 zaktualizowany, tsc clean, 787 vitest pass. PATCH (hardening istniejacego endpointu - audit-first + walidacja wejscia + reuse pseudonimizacji; brak zmiany kontraktow rol, klasyfikator logowany nie zmienia jeszcze zachowania pipeline). |
| 1.4.0 | 2026-05-29 | Governance routingu LLM - straznik data-residency + per-call audit + pseudonimizacja egress (ADR-0067, domkniecie blockerow B1+B2 audytu FAZA 0). Art. 2 (zero-cloud / tajemnica zawodowa) i Art. 4 (neutralnosc) przestaja byc deklaratywne - sa egzekwowane w kodzie jako brama przed wywolaniem providera (`lib/chat/stream.ts`). **B2 (egress enforcement, realizacja routera ADR-0014 - reuse slownika DataClassification x EgressFlag, bez konkurencyjnych terminow):** czysta funkcja `decideRoute(classification, egress, allowUsProviders)` (wzorzec decideRing ADR-0027) w `lib/routing/`. Reguly: model lokalny (`no-egress`) zawsze allow; `attorney_client_privileged` (tajemnica) -> tylko lokalny, chmura blok bez wyjatku (flaga US nie odblokowuje); `client_general`/`internal`/`public` -> `eu-only` allow, `us-with-dpa` allow tylko gdy Administrator wlaczyl `ALLOW_US_PROVIDERS` (swiadoma decyzja transferu poza EOG + DPA/DPF). Rejestr egress fail-closed (nieznany model = `us-with-dpa`; cala chmura w tym Bielik przez OpenRouter = `us-with-dpa`). Blok -> SSE `error` (`egress_blocked`) z komunikatem PL + sugestia modelu lokalnego. Nowa kolumna `projects.classification` (default fail-closed `attorney_client_privileged`; czat ogolny -> `internal`; nieznana/blad -> fail-closed); `ensureSchemaUpgrades` idempotentnie dla istniejacych baz SQLite + migracja 006 (Postgres). **Straznik 2 (per-call audit):** nowy event_type `llm_route` (migracja 005 ALTER CHECK, 4 lustra enum) z model/dostawca/strefa/klasyfikacja/decyzja/sprawa/tokeny/realny koszt (OpenRouter `usage.include`)/latencja -> hash-chain (ADR-0001) + Merkle (ADR-0026/0036) + audit pack (ADR-0047/0048). Dowod nalezytej starannosci AI Act art. 12. **B1 (pseudonimizacja egress, wpiecie szkieletu ADR-0003):** przed wyjsciem do chmury (`egress != no-egress`, dane nie-publiczne) konwersacja maskowana jedna wspolna mapa (`wrapConversation`), odpowiedz odwracana w strumieniu (`PseudonimStreamUnwrapper` z hold-back dla tokenow rozcietych). Wylacznik `PATRON_PSEUDONIM_EGRESS=false`. Zakres: identyfikatory regexowe (PESEL/NIP/REGON/KRS/email/telefon); detektor imion LLM-based wciaz no-op + argumenty narzedzi nieodwracane = dlug FAZA 1 (udokumentowane). 47 nowych testow (27 routing macierz + 20 pseudonim strumien), tsc clean, 781 vitest pass. Cost-caps per sprawa (ADR-beta) i multi-model consensus (ADR-gamma) = rezerwacje. MINOR (nowa egzekwowana brama w zywej sciezce czatu - czat sprawy moze byc zablokowany polityka, dane maskowane przed egress; zmienia zachowanie produktu, nie lamie kontraktow rol). |
| 1.3.5 | 2026-05-29 | Audit bundle per-deliverable - rdzen (ADR-0066, realizacja rdzenia blueprintu ADR-0006, cherry-pick wzorca AnttiHero/lavern Apache 2.0 + 4-fazy walidacji wideo MateMatic). Art. 3 (audytowalnosc) dostaje narzedzie: samowystarczalny pakiet JSON dla jednego deliverable wysokiej stawki, sklejajacy tresc + wynik mechanicznej weryfikacji cytatow (grounding ADR-0005) + fragment hash-chain audit_log (ADR-0001) + wersje modelu + log kosztu (best-effort), z manifestem SHA-256 per czesc + integrity calosci. Dowod dla AI Act art. 12 oraz na wypadek reklamacji klienta / pytania regulatora "jak powstala ta analiza". 3 komponenty: `lib/audit-bundle.ts` (`buildAuditBundle` / `verifyAuditBundleIntegrity` 2-stopniowy per-czesc+calosc / `buildAuditBundleFilename`, reuse `canonicalSha256` z audit-pack ADR-0047), `scripts/verify-audit-bundle.ts` + npm `audit:verify-bundle` (offline, exit 0/1/2, round-trip zweryfikowany clean->0 tampered->1 z nazwa czesci), 9 testow. ODSTEPSTWA od blueprintu ADR-0006 (udokumentowane w ADR-0066): plaska nazwa `audit-bundle.ts` zamiast `audit/bundle.ts`, single-JSON + manifest per-czesc zamiast folderu/ZIP, SHA-256 integrity zamiast podpisu kluczem prywatnym (NIE wprowadzamy nowego sekretu - podpis Ed25519+RFC3161 = rezerwacja ADR-0049 wspolna z audit-pack), pominiete debate_transcript (ADR-0004 niewpiety) i pseudonim_map (rezerwacja). REZERWACJA: wpiecie (auto-trigger high-stakes / przycisk UI / endpoint eksportu ZIP), schema `audit_bundle_metadata` (bundle generowany na zadanie, nie persystowany), podpis, cost tracking tokenow. Backend 736/741 vitest pass, tsc clean. Zero nowych zaleznosci npm, zero migracji, zero nowego sekretu, zero zmian w zywym pipeline (builder czysty, wolany na zadanie). PATCH (nowe narzedzie audytowalnosci Art. 3 - czysty modul + CLI; brak zmiany kontraktow API, brak nowego endpointu, brak zmiany schema). |
| 1.3.4 | 2026-05-29 | Citation grounding - domkniecie poziomu 1 o warstwy widoczne (ADR-0065, realizacja rezerwacji z ADR-0005). (1) UI badge 3-stopniowy w `AssistantMessage.tsx`: znacznik cytatu `[N]` koloruje sie wg werdyktu - zielony verified / bursztynowy unverified / czerwony blocked, status w tooltipie (i18n `citations.groundingVerified/Unverified/Blocked`); brak werdyktu = neutralny szary (cytat MCP / starszy czat). (2) Persystencja werdyktu - `extractAnnotations` dokleja `grounding`+`grounding_status` do `citation_data` w `chat_messages.annotations`, badge przezywa reload. (3) Audit summary - pole `grounding: {total, verified, unverified, blocked}` przez helper `groundingSummary` w payloadzie istniejacego eventu `chat.message.assistant` (oba routy chat.ts + projectChat.ts). ODSTEPSTWO od blueprintu ADR-0005: zamiast 3 osobnych event_type (`citation.verified/unverified/blocked`) wybrano jedno podsumowanie w `chat.message.assistant` - brak migracji ALTER CHECK whitelist, brak audit spam (1 odpowiedz z 50 cytatami = 1 wpis), grounding to post-przetwarzanie juz audytowanej odpowiedzi. Per-cytat szczegol jest w annotations. DECYZJA PRODUKTOWA: werdykt `blocked` = czerwona flaga, NIE twardy blok renderu (prawnik widzi brak potwierdzenia i sam decyduje - Art. 2 weryfikowalnosc, nie cenzura modelu). Zero nowych zaleznosci npm, zero migracji, zero nowych endpointow. Backend 727/732 vitest pass, tsc clean (backend + frontend). Poziomy 2/3 (orzeczenia SAOS / przepisy ISAP-EUR-Lex) = rezerwacja. PATCH (techniczne domkniecie ADR-0005, pola addytywne w evencie SSE / annotations / payload audit, bez zmiany kontraktow rol ani API ani schema). |
| 1.3.3 | 2026-05-29 | Mechaniczna weryfikacja cytatow (citation grounding) LIVE dla dokumentow klienta - poziom 1 ADR-0005 (cherry-pick wzorca AnttiHero/lavern Apache 2.0, realizacja blueprintu z 2026-05-20). Art. 2 (weryfikowalnosc) spelniony technicznie, nie tylko deklaratywnie: kazdy cytat z bloku `<CITATIONS>` w odpowiedzi Patrona przechodzi PRZED zwrotem deterministyczny string-match (zero LLM, offline, zero kosztu) wzgledem pelnej tresci dokumentu klienta. Nowy czysty modul `backend/src/lib/citation/grounding.ts` (`verifyCitations(citations, resolveSource)` z 4 statusami ZWERYFIKOWANY/ZMODYFIKOWANY/NIEZWERYFIKOWANY/BRAK_ZRODLA -> decision verified/unverified/blocked, prog edit-distance 0.15 odroznia literowke od podmiany slowa) + warstwa wpiecia `backend/src/lib/chat/ground-citations.ts` (prefetch tekstu raz na doc_id przez `getDocumentTextForGrounding` reuzywajace sciezke read_document wraz z guard input-security ADR-0020, potem synchroniczny resolver na mapie - weryfikator pozostaje czysty). Wpiety w `chat/stream.ts` - werdykt grounding leci obok cytatow w evencie SSE `citations` (pole `grounding` per ref). Algorytm walidowany na eval harness LEDGAR/lex_glue (351 przypadkow) + 21 testow jednostkowych (15 verifier + 6 wiring), 725/730 vitest pass, tsc clean. Poziom 2 (orzeczenia SAOS) i poziom 3 (przepisy ISAP/EUR-Lex) = przyszle resolvery dopinane analogicznie (rezerwacja). UI badge 3-stopniowy w `AssistantMessage.tsx` + persystencja werdyktu na reload + audit event `citation.verified/unverified/blocked` = nastepna iteracja (rezerwacja ADR-0065). PATCH (techniczna realizacja istniejacej zasady Art. 2 weryfikowalnosci dla cytatow z dokumentow klienta; nie zmienia kontraktow API - sygnatura streamChatWithTools bez zmian, pole `grounding` dodane addytywnie w evencie SSE; brak zmiany schema - werdykt nie persystowany w tej iteracji). |
| 1.3.2 | 2026-05-27 | Endpoint "Wymus compute Merkle root" + UI fallback dla audytora (ADR-0048, realizacja rezerwacji z ADR-0047). Nowy endpoint `POST /api/audit/merkle/compute-now` (requireAuth + requireAdmin per ADR-0034) wywoluje `runAutoCompute` z thresholdami forsujacymi (`countThreshold=1`, `intervalMs=0`) - kazdy nowy event w audit_log wystarczy do compute, bypass auto-trigger ADR-0036 (count >= 1000 LUB interval >= 24h). Pure helper `lib/audit-merkle-compute-now.ts` z 3 funkcjami (`FORCE_*` thresholds jako stale, `parseComputerByLabel` z anti-injection sanitizacja `\r\n\t` i znakow kontrolnych x00-x1f + trim do 100 znakow, `buildComputeNowResponse` mapowanie 4 scenariuszy z `RunAutoComputeResult` na response) + 16 testow zero-mock. Frontend `<AuditExportButton />` rozszerzony do 5-stanowej state machine: gdy GET `/api/audit/export/:eventId` zwroci 404 z detail "brak Merkle root" - pokazuje secondary button "Wymus compute root i ponow eksport" w amber alert box, po sukcesie compute auto-retry eksport. Response endpointu zawsze 200 z `{computed: bool, reason, root?, error?}` - `no_new_events` to legalny stan, nie 409. Logowanie meta-audit `admin.access.merkle_compute_now` przez `recordAdminAccess` PRZED compute (zamiar wymuszenia rejestrowany niezaleznie od sukcesu). Migracja 004 ALTER CHECK whitelist event_type (UP/DOWN per ADR-0038, idempotent). Lustrzane wpisy w 4 miejscach (schema.sql + migration 004 + `EVENT_TYPES` w audit.ts + `AdminAccessEventType` w audit-admin-access.ts). Zero nowych zaleznosci npm. Bulk export ZIP = rezerwacja ADR-0050 (`jszip` juz w deps); PDF audit raport ludzki = rezerwacja ADR-0051 (rozdzielone bo rozne dependencje); machine-readable error code zamiast string match `detail.includes("brak Merkle root")` = dlug do ADR-0050. PATCH (UX safety net dla eksportu z ADR-0047, audytor mial juz mozliwosc przez prosbe do operatora `npm run merkle:trigger` - ten ADR daje mu to w UI; nie zmienia kontraktu rol w Konstytucji ani semantyki Merkle hash). |
| 1.3.1 | 2026-05-27 | Eksport audit pack JSON (ADR-0047, realizacja rezerwacji z ADR-0046). Nowy endpoint `GET /api/audit/export/:eventId` (requireAuth + requireAdmin per ADR-0034) zwraca samowystarczalny pakiet JSON dla audytora zewnetrznego: event z zamaskowanym payloadem (reuse `maskPayload` z ADR-0040 faza 1), Merkle proof bundle (reuse `fetchProofForEvent` z ADR-0036), SHA-256 integrity manifestu (canonical JSON z deterministycznym porzadkiem kluczy) wykrywajacy modyfikacje po wyniesieniu. Pure helper `lib/audit-pack.ts` z 5 funkcjami (`buildAuditPack`, `canonicalJsonStringify`, `canonicalSha256`, `verifyAuditPackIntegrity`, `buildAuditPackFilename`) + 24 testy zero-mock. Skrypt CLI `npm run audit:verify-pack -- <plik.json>` dwustopniowy (integrity SHA256 + Merkle proof verify offline, bez polaczenia z baza kancelarii). Frontend `<AuditExportButton />` w `<AuditEventDetail />` (native fetch + Blob + URL.createObjectURL, zero nowych deps). Migracja 003 ALTER CHECK whitelist event_type (dodanie `admin.access.audit_export`, format UP/DOWN per ADR-0038); logowanie meta-audit per ADR-0043. PDF jako audit raport ludzki i bulk export ZIP = rezerwacja ADR-0048; podpis kryptograficzny Ed25519 + RFC 3161 timestamping = rezerwacja ADR-0049. PATCH (rozszerzenie istniejacej funkcjonalnosci UI viewera audytora o eksport, nie zmienia kontraktu rol - audytor mial juz pelny wglad przez UI z ADR-0046; nowy endpoint REST oraz nowy event_type w whitelist meta-audit). |
| 1.3.0 | 2026-05-27 | UI viewer audytora - faza 2 frontend (ADR-0046, realizacja rezerwacji z ADR-0040). Strona Next.js `/admin/audit` w `frontend/src/app/(pages)/admin/audit/page.tsx` z 4 komponentami: `<AuditFilterBar />` (event_type / actor / since-until / limit + button Zastosuj), `<AuditEventsList />` (native table z paginacja cursor "Wczytaj wiecej"), `<AuditEventDetail />` (conditional render side panel z payload_masked, hash chain copy-to-clipboard, Merkle verify button), `<MerkleVerifyButton />` (one-click GET /api/audit/merkle/verify/:eventId, status idle/loading/verified/failed z lucide ikonami). Hook `useAuditLog` (useEffect + fetch, zero polling, explicit refetch). Wszystko zero nowych zaleznosci npm (shadcn button/input/badge + native HTML5 form / table / dialog overlay). Audytor zewnetrzny otwiera UI zamiast wymagac SQL access do bazy - operator kancelarii moze wlaczyc audyt bez technicznej intervence. MINOR (nowa funkcjonalnosc UI widoczna na zewnatrz, zmienia kontrakt produktu - audytor moze pracowac w UI). Backend juz LIVE z PII masking server-side (ADR-0040 faza 1) i admin.access.audit_viewer logging (ADR-0043). Eksport audit pack PDF/JSON = rezerwacja ADR-0047. |
| 1.2.11 | 2026-05-27 | Meta-audyt dostepu admin do chronionych endpointow (ADR-0043). Migracja 002_audit_log_admin_access_event_types.sql w formacie UP/DOWN (per ADR-0038) - DROP + ADD constraint `audit_log_event_type_whitelist` z 7 wartosci rozszerzonych do 11: dodane `admin.access.audit_viewer` (ADR-0040 viewer), `admin.access.security_banner` (ADR-0042 banner status), `admin.access.metrics` (ADR-0037 Prometheus scrape), `migrate.rollback` (ADR-0038 rezerwacja). Lustro `EVENT_TYPES` w `lib/audit.ts` zaktualizowane. Nowy helper `lib/audit-admin-access.ts` z funkcjami `buildAdminAccessPayload` (pure) i `recordAdminAccess` (async, graceful - catch + stderr log, NIGDY nie rzuca per Art. 8 stalosc kontraktow). Wpiecie w 3 endpointach: `GET /api/audit/log` (event_type audit_viewer), `GET /api/security/mcp-status` (security_banner), `GET /metrics` (metrics, actor = IP whitelist bez user). Payload zawiera method/path/query/remote_ip - bez body (endpointy read-only GET). 7 testow `audit-admin-access.test.ts` pass. 606/611 vitest pass. `schema.sql` zaktualizowany dla nowych deployments. PATCH (rozszerzenie zasady audytowalnosci o meta-audit, brak zmiany kontraktow API innych endpointow, dodanie wartosci do istniejacej whitelist). |
| 1.2.10 | 2026-05-27 | Observability - Prometheus metrics endpoint i dashboard Grafana dla audit-Merkle chain (ADR-0037, cherry-pick patternu z `ai-infra-curriculum/ai-infra-engineer-learning` MIT, mod-108). Endpoint `GET /metrics` w text/plain Prometheus exposition format (ZERO nowych zaleznosci npm, format publicznego protokolu wygenerowany natywnym JS). Chroniony IP whitelist (env `METRICS_ALLOWED_IPS`, brak env = 404 disabled). 4 metryki: `patron_audit_log_total{event_type}` counter, `patron_merkle_root_count` gauge, `patron_merkle_last_anchor_seconds` gauge, `patron_mcp_security_decisions_total{action}` counter, plus `patron_uptime_seconds` gauge. Dashboard Grafana JSON w `governance/dashboards/patron-audit-observability.json` (5 paneli: activity rate, merkle stat, anchor age gauge z thresholds, uptime, mcp decisions rate). Alerting rules = rezerwacja ADR-0044. Request latency histograms = rezerwacja ADR-0048. PATCH (read-only telemetria nad istniejacymi danymi, brak zmiany schema, brak zmiany kontraktow API innych endpointow). |
| 1.2.9 | 2026-05-27 | UI viewer audytora - faza 1 backend (ADR-0040). Endpoint `GET /api/audit/log` (requireAuth + requireAdmin per ADR-0034) z paginacja cursor-based, filtrowaniem (event_type / actor_user_id / since / until / limit), maskowaniem PII server-side. Nowy modul `lib/audit-pii-mask.ts` - pure functions maskowania PESEL (4+3+4 -> 11 znakow), NIP (3+4+3 -> 10), REGON 9/14 (3+N+3), email (3 znaki + ***@domena), dlugi tekst (head/tail z [...] w srodku), rekurencyjny `maskPayload` po obiektach i tablicach. Nowy modul `lib/audit-log-query.ts` - parser query params + builder response + cursor next compute. 44 nowych testow (27 mask + 17 query), 579/584 vitest pass. MINOR bump v1.3.0 zarezerwowany dla fazy 2 (frontend page ADR-0046). Logowanie wejsc audytora do audit_log = rezerwacja ADR-0043. Eksport audit pack PDF + JSON = rezerwacja ADR-0047. PATCH (rozszerzenie zasady audytowalnosci o nowy read-only endpoint + warstwe maskowania PII per Art. 5; brak zmiany kontraktow API innych endpointow, brak zmiany schema). |
| 1.2.8 | 2026-05-27 | UI banner MCP Security Gateway w panelu admin Patrona (ADR-0042). Read-only widget widoczny TYLKO dla admin (whitelist email env per ADR-0034) - pokazuje tryb pracy gateway (`enforce`/`audit`/`off`) i podsumowanie decyzji `audit`/`human_review`/`denied` z ostatnich 24h z `audit_log` (`event_type = "mcp_security.gateway"`). Nowy endpoint `GET /api/security/mcp-status` (requireAuth + requireAdmin), hook `useMcpSecurityStatus` (polling 60s, zero nowych zaleznosci npm), komponent `<McpSecurityBanner />` w `frontend/src/app/(pages)/layout.tsx` (banner sam sie chowa dla non-admin przez 403 z endpointu). Nowa zmienna env `MCP_SECURITY_GATEWAY_MODE` (default fail-safe `off`). Mode-aware enforcement w runtime gateway = rezerwacja ADR-0045. Audit_log eventu `admin.access.security_banner` = rezerwacja ADR-0043. PATCH (UI fasada nad istniejacymi decyzjami architektonicznymi ADR-0025/0028/0033, brak zmiany kontraktow API innych endpointow ani semantyki gateway). |
| 1.2.7 | 2026-05-27 | Sekcja 5.2.2 zaktualizowana - infrastruktura migracji rozszerzona o down/rollback (ADR-0038, LIVE). Format `-- UP` / `-- DOWN` sekcji w jednym pliku migracji `NNN_*.sql` (wzorzec sqitch/Flyway). Pure helper `extractUpDown` w `lib/migrations.ts` + 8 nowych testow. 2 nowe komendy runnera: `npm run migrate:rollback NNN` (wypisuje DOWN SQL) + `npm run migrate:rollback:mark NNN` (kasuje rekord z schema_migrations po manualnej aplikacji). Migracja 001 zaktualizowana z idempotent `-- DOWN` sekcja (`DROP CONSTRAINT IF EXISTS`) jako wzorzec. Audit_log eventu `migrate.rollback` = rezerwacja ADR-0043. PATCH (rozszerzenie istniejacej infrastruktury migracji o deterministyczna droge powrotu, brak zmiany kontraktow API). |
| 1.2.6 | 2026-05-27 | Nowa rola 4.6 Admin (ADR-0034, LIVE) - podzbiór Administratora z dostępem do zaostrzonych endpointów backend (audyt Merkle, w przyszłości UI viewer dla audytora ADR-0040 i UI banner mcp-security ADR-0042). Admin pool zarządzany przez whitelist emaili w env `PATRON_ADMIN_EMAILS` (CSV, lowercase, trim). Middleware `requireAdmin` w `backend/src/middleware/auth.ts` po `requireAuth` w łańcuchu. Endpoint `GET /api/audit/merkle/verify/:eventId` (ADR-0036) zaostrzony z "każdy zalogowany" na admin-only. Strukturyzowane logi `[ADMIN] grant|denied` na stdout (audit_log eventu `admin.access` = rezerwacja ADR-0043). PATCH (dodanie podzbioru roli istniejącej, brak zmiany kontraktów API innych endpointów). |
| 1.2.5 | 2026-05-27 | Sekcja 5.2.1 zaktualizowana - manualny trigger Merkle rozszerzony o hybrid auto-trigger (ADR-0036, LIVE). Compute Merkle root nastepuje automatycznie gdy nowych eventow >= 1000 LUB ostatni root sprzed >= 24h (whichever first, env-tunable). Endpoint `GET /api/audit/merkle/verify/:eventId` LIVE - audytor pobiera samowystarczalny ProofBundle przez HTTPS, weryfikuje offline przez `audit-merkle-verifier.ts`. setInterval w backend startup (single-instance self-host), manualny CLI fallback `npm run merkle:trigger`. PATCH (rozszerzenie zasady audytowalnosci - automatyzacja istniejacego mechanizmu, brak zmiany kontraktow API ani semantyki Merkle hash). |
| 1.2.4 | 2026-05-27 | Sekcja 5.1 (Co jest zapisywane) rozszerzona o 5 event_type ktore weszly do produkcji w iteracjach 1.2.2-1.2.3 (input_security_scan, mcp_security.gateway, ring_policy.decision, rodo.delete, rodo.export). Nowa sekcja 5.2.2 (Whitelist event_type i infrastruktura migracji) - ADR-0035, CHECK constraint `audit_log_event_type_whitelist` z 7 produkcyjnymi wartosciami + governance-friendly runner migracji. PATCH (doprecyzowanie istniejacej zasady audytowalnosci, brak zmiany kontraktow API; zgodnie z § 6.1 wystarcza commit i changelog). |
| 1.2.3 | 2026-05-27 | Nowa sekcja 5.2.1 (Merkle audit chain, ADR-0026, WDROZONY 2026-05-27). Drzewo Merkle nad hash-chain (ADR-0001) jako rownolegla warstwa weryfikacji - audytor dostaje proof-of-inclusion w O(log n) zamiast O(n). Drugi pattern z trojki cherry-pick Microsoft AGT (po ADR-0025 MCP Security Gateway i ADR-0027 Privilege Rings). PATCH (rozszerzenie zasady audytowalnosci bez zmiany kontraktow, korpus pozostalych zasad bez zmian). |
| 1.2.2 | 2026-05-24 | Nowy Zalacznik C (OWASP Agentic Top 10 - mapping na Artykuly Konstytucji Patrona). Pokrycie 10/10 ryzyk ASI-01..ASI-10. Formalna deklaracja ze Patron jako produkt regulowany adresuje uznane branzowo ryzyka, nie tylko wlasne. PATCH (dodanie zalacznika referencyjnego, korpus zasad bez zmian). |
| 1.2.1 | 2026-05-24 | Lista konektorów MCP w Art. 9 rozszerzona z 5 do 6 - dodany `mcp-eu-compliance` (offline korpus EUR-Lex: GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA; MIT). Wpięcie w Patrona zdecydowane przez ADR-0022/0023 (2026-05-22). PATCH (doprecyzowanie listy referencyjnej, korpus zasady i model licencyjny bez zmian; zgodnie z § 6.1 wystarcza commit i changelog). |
| 1.2.0 | 2026-05-22 | Art. 5 rozszerzony o mechanizm „kontrola wejścia" - skan dokumentów wejściowych pod kątem manipulacji modelu (prompt-injection / ukryte akcje PDF / zaciemnienie) przed wejściem do modelu lub RAG (ADR-0019, ADR-0020). MINOR (rozszerzenie zasady, brak łamania kontraktów). |
| 1.1.1 | 2026-05-20 | Art. 4 przemianowany z „Vendor neutrality" na „Neutralność wobec dostawców", rola 4.5 z „Vendor" na „Dostawca". PATCH (doprecyzowanie terminologii PL, korpus zasady i wszystkie kontrakty bez zmian; zgodnie z § 6.1 wystarcza commit i changelog). |
| 1.1.0 | 2026-05-20 | Art. 9 doprecyzowany o dual-license: AGPL-3.0 shell + MIT connectors (ADR-0002). MINOR bump (rozszerzenie zasady, brak łamania kontraktów). |
| 1.0.0 | 2026-05-20 | Pierwsza wersja konstytucji Patrona. |

---

## Załącznik A: Mapa do aktów prawnych

| Zasada | AI Act | RODO | Etyka zawodowa |
|---|---|---|---|
| Art. 1 (lokalność) | art. 10 (data governance) | art. 25 (privacy by design) | Pr.Adw. art. 6 ust. 3 |
| Art. 2 (weryfikowalność) | art. 13 (transparentność) | - | Pr.Adw. art. 8 (sumienność) |
| Art. 3 (audytowalność) | art. 12 (record-keeping) | art. 30 (rejestr czynności) | - |
| Art. 4 (neutralność wobec dostawców) | - | art. 28 ust. 3 (umowa powierzenia) | - |
| Art. 5 (tajemnica) | - | art. 9 (szczególne kategorie) | Pr.Adw. art. 6, Pr.RP art. 3 |
| Art. 6 (human in the loop) | art. 14 (nadzór człowieka) | art. 22 (zautomatyzowane decyzje) | Pr.Adw. art. 8 ust. 1 |
| Art. 7 (minimalność) | - | art. 5 ust. 1 lit. c | - |
| Art. 8 (stałość kontraktów) | art. 11 (dokumentacja techniczna) | - | - |
| Art. 9 (dostępność wiedzy) | art. 13 (transparentność) | - | Pr.Adw. art. 8 (kompetencja) |

> Skróty: Pr.Adw. = Ustawa Prawo o adwokaturze; Pr.RP = Ustawa o radcach prawnych.

---

## Załącznik B: Słowniczek

- Audit trail (ślad audytowy) - sekwencyjny zapis zdarzeń z hashem
  każdego wpisu linkującym do poprzedniego.
- Bring-your-own-model - kancelaria sama dostarcza klucz API do
  wybranego dostawcy LLM. Patron jest powłoką.
- Konektor MCP - osobny proces (`mcp-saos`, `mcp-nsa`, `mcp-isap`,
  `mcp-eu-sparql`) wystawiający narzędzia (`saos__search`,
  `nsa__get_judgment`, `isap__get_act`, `eu-sparql__search_by_celex`
  itd.).
- Self-host - instalacja produktu na infrastrukturze klienta. Dane
  nie opuszczają serwera kancelarii.
- Hash-chain - łańcuch hashy SHA-256, gdzie każdy rekord N zawiera
  hash rekordu N-1. Zerwanie łańcucha = wykryta modyfikacja historii.
- Tracked changes - propozycje edycji w `.docx` z mechanizmem
  Accept / Reject. Nie wchodzą do dokumentu bez decyzji prawnika.

---

Podpisał: Administrator kancelarii __________ data __________

Akceptacja Vendora (MateMatic): Wiesław Mazur, 2026-05-20

---

## Załącznik C: OWASP Agentic Top 10 - mapping na Artykuły Konstytucji Patrona

Cherry-pick referencji z [OWASP Top 10 for Agentic Applications (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) - branzowy konsensus 10 ryzyk dla aplikacji agentowych AI. Pattern mappingu cherry-picked z [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, snapshot 2026-05-24, audyt RODO 🟢 ZIELONY - patrz ADR-0024). Mapping adaptowany do Patrona pod realia polskich kancelarii prawnych.

| OWASP | Ryzyko (skrot) | Artykul Konstytucji Patrona | Komponent Patrona |
|---|---|---|---|
| ASI-01 | Agent Goal Hijack (manipulacja celow agenta) | Art. 6 Granica błędu (human in the loop) + Art. 3 Audytowalność | `backend/src/lib/input-security/` (ADR-0019/0020, prompt-injection PL) |
| ASI-02 | Tool Misuse & Exploitation | Art. 7 Minimalność danych + Art. 8 Stałość kontraktów | Lista 6 zatwierdzonych konektorow MCP + capability scoping w MCP |
| ASI-03 | Identity & Privilege Abuse | Art. 5 Tajemnica zawodowa + Art. 4 Neutralność wobec dostawców | Patron single-tenant per kancelaria, brak agent-to-agent identity poza scope |
| ASI-04 | Agentic Supply Chain Vulnerabilities | Art. 8 Stałość kontraktów + Art. 4 Neutralność wobec dostawców | `backend/src/lib/mcp-security/` (ADR-0025, MCP Security Gateway, 4 detektory: typosquat/drift/hidden-instructions/tool-poisoning) |
| ASI-05 | Unexpected Code Execution | Art. 6 Granica błędu (human in the loop) | Patron nie eksponuje narzedzia do wykonania kodu na maszynie kancelarii bez human ack |
| ASI-06 | Memory & Context Poisoning | Art. 3 Audytowalność (hash-chain) + Art. 1 Lokalność danych | `backend/src/lib/audit*.ts` (ADR-0001 hash-chain + ADR-0026 Merkle audit chain WDROZONY) |
| ASI-07 | Insecure Inter-Agent Communication | Art. 1 Lokalność danych + Art. 5 Tajemnica zawodowa | Patron single-tenant, brak komunikacji inter-agent w defaulcie. Komunikacja z LLM = TLS + DPA per provider |
| ASI-08 | Cascading Agent Failures | Art. 3 Audytowalność + Art. 6 Granica błędu | Planowane: ADR-0029 Agent SRE Governance (SLO/error budget/circuit breaker dla wywolan LLM) |
| ASI-09 | Human-Agent Trust Exploitation | Art. 6 Granica błędu (human in the loop) - **fundament** | Wszystkie decyzje high-stakes wymagaja ack Operatora (Konstytucja Art. 6) |
| ASI-10 | Rogue Agents | Art. 3 Audytowalność + Art. 6 Granica błędu | Hash-chain audit + procedura amendment Konstytucji (sekcja 6 Ewolucja) |

**Pokrycie**: 10/10 ryzyk OWASP Agentic Top 10 zaadresowanych przez Konstytucję Patrona. Trzy ryzyka (ASI-01, ASI-04, ASI-08) maja zaimplementowane lub planowane komponenty kodowe w Patronie - ADR-0019/0020 (input-security), ADR-0025 (mcp-security), ADR-0029 (SRE governance, planowany).

**Dla audytu**: ta tabela = formalna deklaracja, ze Patron jako produkt regulowany adresuje uznane branzowo ryzyka, nie tylko nasze wlasne. Mapowanie na Articles Konstytucji + komponenty kodu daje audytorowi sciezke od ryzyka do implementacji.
