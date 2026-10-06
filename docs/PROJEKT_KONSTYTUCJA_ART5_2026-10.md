# Projekt zmiany Konstytucji - Art. 5 (do decyzji WM i ponownego podpisu)

Status: **PROJEKT**. Nie wchodzi w życie bez decyzji WM i ponownego podpisu przez kancelarie (Sec 6.1). Tekst w `governance/CONSTITUTION.md` pozostaje bez zmian do tego czasu.

## Dlaczego

Wersja 1.6.0 (ADR-0101) opisuje zgodę na model chmurowy dla spraw objętych tajemnicą jako **domyślnie włączoną na desktopie**. Uzasadnienie brzmiało: „Zgoda zdejmuje BLOKADĘ, nie ZABEZPIECZENIA ... PII jest maskowane przed wysłaniem”.

Audyt 2026-09 zmierzył, że to założenie nie trzymało się w kodzie:

- treść dokumentów trafiała do modelu przez wyniki narzędzi bez maskowania (A-01, P0);
- detektor przepuszczał 89% nazwisk na zestawach ewaluacyjnych (A-02).

Od commita `a43710e` kod ma domyślnie `PATRON_ALLOW_PRIVILEGED_CLOUD=false`. Zgoda dla konkretnej sprawy idzie polem „Model chmurowy” na pasku sprawy (ADR-0128) i zostaje w `audit_log`. Konstytucja musi opisywać to, co kod egzekwuje.

## Proponowany tekst (zastępuje punkt „zgoda Operatora” w Art. 5)

> - zgoda Operatora na model chmurowy dla sprawy objętej tajemnicą: **domyślnie sprawy objęte tajemnicą przetwarza wyłącznie model lokalny**. Operator może świadomie wyrazić zgodę na model chmurowy **dla konkretnej sprawy** (pole „Model chmurowy” na pasku sprawy, ADR-0128). Zgoda jest zapisywana w audit logu, a każde wyjście danych tej sprawy ląduje tam z jawnym powodem. Zgoda globalna dla wszystkich spraw (`PATRON_ALLOW_PRIVILEGED_CLOUD=true`) jest możliwa wyłącznie jako świadoma decyzja Administratora i nie jest ustawieniem domyślnym żadnej instalacji. Zgoda zdejmuje blokadę, ale nie zabezpieczenia: przed wysłaniem do modelu spoza maszyny treść przechodzi pseudonimizację (rozmowa, wyniki narzędzi, tytuły, tabular, draft). **Pseudonimizacja ogranicza ryzyko, ale go nie usuwa.** Detektor nie rozpoznaje każdej osoby i każdego podmiotu, a jego skuteczność jest mierzona i publikowana (zestawy ewaluacyjne). Dlatego zgoda dotyczy sprawy, a nie instalacji. Patrz ADR-0101 (aktualizacja 2026-10-02) i ADR-0128.

## Proponowany wpis w historii wersji

| Wersja | Data | Zmiana |
|---|---|---|
| 1.8.0 | (data podpisu) | Art. 5: zgoda na model chmurowy dla spraw objętych tajemnicą domyślnie WYŁĄCZONA (także na desktopie); zgoda per sprawa (ADR-0128) albo świadoma zgoda globalna Administratora. Zmiana wynika z audytu 2026-09 (A-01, A-02): założenie ADR-0101 „PII maskowane przed wysłaniem” nie obejmowało treści dokumentów w wynikach narzędzi i nie chroniło większości nazwisk. Wdrożone: domyślne `PATRON_ALLOW_PRIVILEGED_CLOUD=false` + bramka `desktop/scripts/egress-defaults-gate.test.cjs`; maskowanie wyników narzędzi, draftu, tytułów i tabular. Dodatkowo: karty zatwierdzeń (ADR-0137) domyślnie WŁĄCZONE (Art. 6, decyzja 2026-10-06). MINOR (zmiana egzekwowanego zachowania na bardziej restrykcyjne). Wymaga re-podpisu, bo zmienia treść zasady. |

## Do decyzji WM

1. Akceptacja tekstu albo poprawki.
2. Czy w tej samej wersji (1.8.0) opisać w Art. 6 domyślne włączenie kart zatwierdzeń (decyzja z 2026-10-06), czy osobnym wpisem.
3. Termin ponownego podpisu przez kancelarie.
