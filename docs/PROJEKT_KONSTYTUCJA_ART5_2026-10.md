# Projekt zmiany Konstytucji - Art. 5 (do decyzji właściciela produktu i ponownego podpisu)

Status: **PRZYJĘTY przez właściciela produktu 2026-10-10** i wpisany do `governance/CONSTITUTION.md` jako wersja 1.8.0, razem ze zmianą Art. 6 (karty zatwierdzeń domyślnie włączone). **Czeka na ponowny podpis kancelarii** (sekcja 6.1 Konstytucji). Do tego czasu kod egzekwuje zasady surowsze niż podpisana wersja 1.7.2. W tekście przyjętym usunięto zdanie, że skuteczność detektora jest „publikowana” - tego nie potwierdziliśmy; zostało „mierzymy na zestawach ewaluacyjnych”.

## Dlaczego

Wersja 1.6.0 (ADR-0101) opisuje zgodę na model chmurowy dla spraw objętych tajemnicą jako **domyślnie włączoną na desktopie**. Uzasadnienie brzmiało: „Zgoda zdejmuje BLOKADĘ, nie ZABEZPIECZENIA [...] PII jest maskowane przed wysłaniem”.

Audyt 2026-09 wykazał pomiarem, że kod nie spełniał tego założenia:

- treść dokumentów trafiała do modelu przez wyniki narzędzi bez maskowania (A-01, P0);
- detektor przepuszczał 89% nazwisk na zestawach ewaluacyjnych (A-02).

Od commita `a43710e` kod ma domyślnie `PATRON_ALLOW_PRIVILEGED_CLOUD=false`. Zgodę dla konkretnej sprawy Operator wyraża w polu „Model chmurowy” na pasku sprawy (ADR-0128), a zgoda zostaje zapisana w `audit_log`. Konstytucja musi opisywać to, co kod egzekwuje.

## Proponowany tekst (zastępuje punkt „zgoda Operatora” w Art. 5)

> - zgoda Operatora na model chmurowy dla sprawy objętej tajemnicą: **domyślnie sprawy objęte tajemnicą przetwarza wyłącznie model lokalny**. Operator może świadomie wyrazić zgodę na model chmurowy **dla konkretnej sprawy** (pole „Model chmurowy” na pasku sprawy, ADR-0128). Zgoda jest zapisywana w audit logu, a każde wyjście danych tej sprawy jest tam odnotowywane z jawnym powodem. Zgoda globalna dla wszystkich spraw (`PATRON_ALLOW_PRIVILEGED_CLOUD=true`) jest możliwa wyłącznie jako świadoma decyzja Administratora i nie jest ustawieniem domyślnym żadnej instalacji. Zgoda zdejmuje blokadę, ale nie zabezpieczenia: przed wysłaniem do modelu spoza maszyny treść przechodzi pseudonimizację (rozmowa, wyniki narzędzi, tytuły, tabular, draft). **Pseudonimizacja ogranicza ryzyko, ale go nie usuwa.** Detektor nie rozpoznaje każdej osoby i każdego podmiotu, a jego skuteczność jest mierzona i publikowana (zestawy ewaluacyjne). Dlatego zgoda dotyczy sprawy, a nie instalacji. Patrz ADR-0101 (aktualizacja 2026-10-02) i ADR-0128.

## Proponowany wpis w historii wersji

| Wersja | Data | Zmiana |
|---|---|---|
| 1.8.0 | (data podpisu) | Art. 5: zgoda na model chmurowy dla spraw objętych tajemnicą domyślnie WYŁĄCZONA (także na desktopie); zgoda per sprawa (ADR-0128) albo świadoma zgoda globalna Administratora. Zmiana wynika z audytu 2026-09 (A-01, A-02): założenie ADR-0101 „PII maskowane przed wysłaniem” nie obejmowało treści dokumentów w wynikach narzędzi i nie chroniło większości nazwisk. Wdrożone: domyślne `PATRON_ALLOW_PRIVILEGED_CLOUD=false` oraz bramka `desktop/scripts/egress-defaults-gate.test.cjs`; maskowanie wyników narzędzi, draftu, tytułów i tabular. Karty zatwierdzeń (ADR-0137) domyślnie WŁĄCZONE (Art. 6, decyzja 2026-10-06). MINOR (zmiana egzekwowanego zachowania na bardziej restrykcyjne). Wymaga ponownego podpisu, bo zmienia treść zasady. |

## Do decyzji właściciela produktu

1. Akceptacja tekstu albo poprawki.
2. Czy w tej samej wersji (1.8.0) opisać w Art. 6 domyślne włączenie kart zatwierdzeń (decyzja z 2026-10-06), czy osobnym wpisem.
3. Termin ponownego podpisu przez kancelarie.
