# Patron - AI Implementation Playbook

**Cel**: wdrożenie Patrona w kancelarii w 6-8 tygodni, od pierwszego
spotkania do produkcyjnego pilotażu.

**Odbiorcy**: Administrator kancelarii (partner zarządzający / OD),
Operator (IT / DevOps), Inspektor (IOD / compliance), 2-3 prawników
pilotażowych.

**Punkt wyjścia**: kancelaria zatwierdziła
[Konstytucję AI Patrona v1.0.0](./CONSTITUTION.md) i wybrała model
LLM (Gemini / Claude / Ollama lokalny).

---

## Tydzień 0 - Decyzja i przygotowanie (przed startem)

**Po stronie kancelarii**:
- [ ] Wybór Administratora, Operatora, Inspektora (3 osoby).
- [ ] Decyzja o modelu LLM (bring-your-own-model).
- [ ] Decyzja o infrastrukturze: maszyna fizyczna w kancelarii vs
      VPS u zaufanego dostawcy (Beyond.pl / Atman / OVH-PL).
- [ ] Wybór 2-3 prawników do pilotażu (mix junior / senior).
- [ ] Akceptacja Konstytucji AI v1.0.0 (podpis Administratora).

**Po stronie MateMatic**:
- [ ] Onboarding session (1.5 h) - przejście przez Konstytucję
      i runbook.
- [ ] Akceptacja umowy wdrożeniowej (zakres, ceny, SLA).

**Wynik**: świadoma decyzja kancelarii o wdrożeniu + role obsadzone.

---

## Tydzień 1 - Infrastruktura

**Po stronie Operatora (z asystą MateMatic)**:
- [ ] Provisioning maszyny: 16 GB RAM, 8 vCPU, 200 GB SSD, Ubuntu 22.04
      LTS. Reverse proxy (Caddy / nginx-proxy-manager) z TLS.
- [ ] Instalacja Docker 24+, `docker compose`.
- [ ] Klonowanie 5 repozytoriów (`patron` + 4 `mcp-*`).
- [ ] Build serwerów MCP + bundler (`node scripts/bundle-mcp.cjs`).
- [ ] Postawienie Supabase self-host (osobny `docker-compose`).
- [ ] Postawienie MinIO (bucket `patron`).
- [ ] Konfiguracja `.env.docker` (sekrety wygenerowane lokalnie,
      `openssl rand -hex 32` × 2).
- [ ] Załadowanie `backend/schema.sql` do Postgresa Supabase.
- [ ] `docker compose up -d` + smoke test (`curl /health`, logi MCP).

**Punkt kontrolny tygodnia 1**:
- [x] Frontend dostępny pod publicznym URL z TLS.
- [x] Backend odpowiada na `/health`.
- [x] Logi pokazują 4× `[MCP] Connected to "X" - 3 tool(s) registered`.

**Czas po stronie Operatora**: ~4-6 h (jeśli pierwszy raz z Dockerem).

---

## Tydzień 2 - Bezpieczeństwo + Inspektor

**Po stronie Inspektora**:
- [ ] Aktualizacja rejestru czynności przetwarzania (RODO art. 30):
      nowa kategoria „Wewnętrzne narzędzie AI dla obsługi spraw klientów".
- [ ] Aktualizacja polityki bezpieczeństwa (kto ma dostęp do serwera,
      jak rotujemy klucze, jak backupujemy).
- [ ] Pierwszy backup test (Postgres + MinIO → szyfrowany off-site
      przez `age`).

**Po stronie Operatora**:
- [ ] Konfiguracja monitoringu (Uptime Kuma / Healthchecks.io).
- [ ] Konfiguracja log shipping (opcjonalnie: Loki / OpenSearch).
- [ ] Skonfigurowanie cron backupu codziennie 02:00.
- [ ] Test odtworzenia backupu na maszynie zapasowej.

**Po stronie Administratora**:
- [ ] Pierwszy `npm run audit:verify` - potwierdzenie integralności
      hash-chain.

**Punkt kontrolny tygodnia 2**:
- [x] Rejestr czynności przetwarzania zaktualizowany.
- [x] Backup działa i daje się odtworzyć.
- [x] Audit chain weryfikowalny.

---

## Tydzień 3 - Pilotaż prawniczy (2-3 osoby)

**Onboarding prawników pilotażowych** (2 h warsztat):
- [ ] Przedstawienie Konstytucji AI (zwłaszcza Art. 5 - tajemnica,
      Art. 6 - human in the loop, Art. 2 - weryfikowalność).
- [ ] Pokaz interfejsu: czaty, projekty, attachment dokumentów,
      panel cytatów (4 sekcje: SAOS / NSA / ISAP / EUR-Lex).
- [ ] Pokaz zmian śledzonych na `.docx` (mechanizm Akceptuj / Odrzuć).
- [ ] Pokazanie audit log: „Każde Wasze zapytanie zostawia ślad.
      Sami to weryfikujecie."

**Pierwsze pytania pilotażowe** (kontrolowane scenariusze):
- [ ] „Znajdź mi orzecznictwo NSA z 2024 o RODO art. 6 ust. 1 lit. f"
      → sprawdzić czy konektor `nsa` zwraca trafienia.
- [ ] „Jaka jest najnowsza wersja ustawy o ochronie danych osobowych?"
      → sprawdzić czy `isap` zwraca DU/2018/1000 + status IN_FORCE.
- [ ] „Daj mi treść RODO art. 22" → sprawdzić czy `eu-sparql` zwraca
      CELEX + EUR-Lex URL po polsku.

**Reguła dnia**: każdy prawnik pilotażowy zgłasza ≥ 1 obserwację dziennie
(co działa, co nie). Logujemy w GitHub Issues `patron`.

---

## Tydzień 4 - Skalowanie + tuning

**Po stronie prawników**:
- [ ] Pilotaż rozszerzony na 5-10 osób.
- [ ] Pierwsze realne sprawy (z dokumentami klientów, dla nielicznych
      spraw oznaczonych „test").

**Po stronie Administratora + MateMatic**:
- [ ] Przegląd statystyk z audit log: które konektory są wołane,
      ile tokenów średnio, czas odpowiedzi.
- [ ] Decyzja o ew. zwiększeniu zasobów (RAM / CPU) jeśli wąskie gardło.
- [ ] Tuning SYSTEM_PROMPT pod specyfikę kancelarii (np. dodanie
      preferencji terminologii - „odwołanie" vs „skarga", domyślny
      sąd właściwy).

---

## Tydzień 5 - Compliance review

**Po stronie Inspektora**:
- [ ] Pełny przegląd audit_log (sample 10% wpisów + verify chain).
- [ ] Test eksportu danych klienta (gdyby ktoś zgłosił RODO art. 20).
- [ ] Test usunięcia danych klienta (RODO art. 17) - sprawdzenie czy
      `chat_messages` + `documents` faktycznie znikają, a `audit_log`
      zachowuje wpisy z anonimizacją `actor_user_id`.
- [ ] Symulacja incydentu: „Co robimy, jeśli pracownik z dostępem
      do serwera odchodzi?" → procedura rotacji kluczy.

**Po stronie Operatora**:
- [ ] Aktualizacja stacku do najnowszych wersji
      (`git pull` + `bundle-mcp.cjs` + `docker compose build`).
- [ ] Drugi test odtworzenia backupu.

---

## Tydzień 6 - Decyzja go-live

**Spotkanie zarządu kancelarii** (60 min):
- [ ] Prezentacja statystyk pilotażu:
      • Liczba czatów × liczba osób × liczba spraw
      • Czas zaoszczędzony (subiektywna ocena prawników)
      • Lista incydentów (powinno być 0 critical)
      • Stan audit chain (zielony)
- [ ] Decyzja: **GO** / **NO-GO** dla pełnego rolloutu.
- [ ] Jeśli GO: aktualizacja Konstytucji AI z v1.0.0 → v1.0.1
      (PATCH, dodanie wpisu „produkcja od YYYY-MM-DD").

---

## Tygodnie 7-8 (opcjonalne) - Rollout

**Po stronie Administratora**:
- [ ] Włączenie wszystkich prawników kancelarii.
- [ ] Polityka „pierwszy tydzień parowanego użycia" (junior + senior).
- [ ] Cotygodniowy office hour z MateMatic (30 min) przez pierwszy
      miesiąc po go-live.

**Po stronie MateMatic**:
- [ ] Retainer support (1.5-3k PLN/mc): patche, aktualizacje konektorów,
      reakcja na incydenty SLA 24 h.

---

## Załącznik: Macierz odpowiedzialności (RACI)

| Działanie | Admin | Operator | Inspektor | MateMatic |
|---|---|---|---|---|
| Wybór modelu LLM | **A** | C | C | I |
| Build + deploy | A | **R** | I | C |
| Backup + odtwarzanie | A | **R** | I | C |
| Rejestr czynności RODO | A | I | **R** | I |
| Audit chain verify | A | C | **R** | I |
| Aktualizacja konektorów MCP | A | R | I | **R** |
| Reakcja na incydent | **A** | R | C | C |
| Decyzja go/no-go | **A** | I | C | I |
| Tuning SYSTEM_PROMPT | A | C | C | **R** |
| Aktualizacja Konstytucji AI | **A** | I | C | R |

> R = Responsible (wykonuje), A = Accountable (odpowiada), C = Consulted, I = Informed.

---

**Wersja playbooka**: 1.0.0
**Data**: 2026-05-20
**Powiązany dokument**: [CONSTITUTION.md](./CONSTITUTION.md)
