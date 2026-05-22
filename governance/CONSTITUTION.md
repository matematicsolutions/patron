# Konstytucja AI Patrona

Wersja: 1.2.0
Data: 2026-05-22
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
- 5 konektorów MCP (`mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`,
  `mcp-eu-sparql`, osobne repo): MIT. To infrastruktura do publicznych
  źródeł prawa polskiego. Chcemy, żeby cały ekosystem polskiego
  legal-techu mógł je wpinać do swoich produktów, niezależnie od ich
  licencji.

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

---

## 5. Audyt i record-keeping

### 5.1. Co jest zapisywane

| Zdarzenie | Pola w `audit_log` |
|---|---|
| `chat.message.user` | user_id, chat_id, content_len, file_count, workflow_id |
| `chat.message.assistant` | chat_id, model, full_text_len, event_count, citation_count, mcp_citation_count, mcp_tools_called[] |
| (planowane Faza 4.2) `doc.read` | document_id, user_id, version_id |
| (planowane) `doc.export` | document_id, user_id, destination |

Pola w `payload` jsonb są celowo bez pełnej treści. Przechowujemy
długości, liczniki, identyfikatory. Pełna treść jest w `chat_messages`
(z kasowaniem na żądanie RODO art. 17).

### 5.2. Hash-chain

```
audit_log[N].prev_hash == audit_log[N-1].hash
audit_log[N].hash      == sha256(prev_hash || canonical_json(ts, event_type, actor, chat_id, document_id, payload))
audit_log[0].prev_hash == "0".repeat(64)   # genesis
```

Weryfikator: `npm run audit:verify` (`scripts/verify-audit-chain.ts`).
4 scenariusze ataku pokryte testami (modyfikacja payload, usunięcie wpisu,
podmiana hash, reorder).

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
