# ADR-0105: Input-security "open mode" - detekcja bez ukrywania, egzekwowanie za flagą

- **Status:** Zaakceptowany (pilot-driven, decyzja Operatora WM). Branch `feat/tier-governance-envelope`, NIESCALONY do `main` (bramka: 2x review WM).
- **Data:** 2026-06-05
- **Kontekst pilota:** Pilot-01-Czechowicz. Realne akta karne/gospodarcze (sprawa Klamczynski - 626 zeskanowanych stron, sprawa Tataj - DOCX).

## Kontekst

Pipeline input-security (ADR-0019/0020) skanuje kazdy dokument wejsciowy (prompt-injection, steganografia, obfuskacja, evasion) i mapuje wynik na akcje: `allowed` / `quarantined` / `human_review` / `blocked`. Dotychczasowy kontrakt (`resolveIngestOutcome`, `isHardThreat`):

- `human_review` (high) -> status `review`, **NIE indeksowany do RAG**, 202.
- `quarantined` (medium) -> status `ready`, ale **NIE indeksowany**.
- `blocked` (critical) -> 422, bajty nieutrwalone.
- read-time (W4): `human_review`/`blocked` **wstrzymywaly odczyt** tresci do modelu.

**Problem ujawniony na realnych aktach:** skonsolidowany OCR akt Klamczynskiego (skany papierowe) dostal `threat_level: high` -> `human_review` -> 0 chunkow w RAG -> PATRON "nie czytal dokumentow". To **false-positive**: szum OCR + struktura pisma procesowego wyglada dla detektorow jak evasion/obfuskacja/injection. Ten sam mechanizm tlumaczy brak statusu `ready` dla DOCX Tataja. Skutek: **zabezpieczenie tak ostre, ze produkt staje sie bezuzyteczny** dla swojego podstawowego zadania - czytania akt kancelarii.

Kluczowa obserwacja modelu zagrozen: PATRON to **desktop single-user**. Operator (adwokat) JEST czlowiekiem w petli (Konstytucja Art. 6) i wciaga **WLASNE akta wlasnego klienta**. Chowanie tych akt przed nim, by chronic go przed injection w jego wlasnych dokumentach, jest paternalistyczne i lamie rdzenny use-case. Realne wektory (exfiltracja) sa domkniete innymi warstwami: egress guard (chmura blokowana dla tajemnicy bez zgody - ADR-0099/0101), maskowanie PII, opcja modelu lokalnego zero-cloud.

## Decyzja

> Zasada przewodnia (WM): *"Statek najbezpieczniejszy jest w porcie, ale nie po to buduje sie statki."* Zabezpieczenie, ktore unieruchamia produkt, mija sie z celem. Bezpieczenstwo ma sluzyc pracy adwokata, nie ja zastepowac.

**Domyslnie OPEN: detekcja dalej dziala, ale NIC nie jest ukrywane.** Egzekwowanie (gardlowanie) przeniesione za flage `PATRON_INPUT_SECURITY_ENFORCE` (domyslnie OFF).

- `inputSecurityEnforce()` czyta `process.env.PATRON_INPUT_SECURITY_ENFORCE` (`1`/`true`/`yes`).
- `resolveIngestOutcome(result, enforce=false)`:
  - **OPEN (default):** kazda akcja -> `201 ready`, `persist:true`, `allowIndex:true`. `securityStatus` niesie **wykryta akcje** (badge w UI + `audit_log` nietkniete).
  - **ENFORCE:** zachowanie ADR-0020 (review/quarantine/blocked gardluja).
- `isHardThreat(result, enforce=false)`: OPEN -> zawsze `false` (read-time nie wstrzymuje); ENFORCE -> `blocked`/`human_review` wstrzymuja.
- Wpiete w 3 callery: `documentIngest.ts` (ingest), `routes/documents.ts` (nowa wersja), `chat/tool-dispatch.ts` (read-time W4).

**Co zostaje niezmienione:** skan ZAWSZE sie wykonuje; `audit_log` (`input_security_scan`, AI Act art. 12) zapisuje findings; `securityStatus` na dokumencie -> badge ostrzegawczy w UI. Operator widzi "uwaga: oznaczony do przegladu", ale dokument jest dostepny.

## Konsekwencje

- (+) **Uzytecznosc wraca:** wlasne akta Operatora zawsze indeksowane i przeszukiwalne. Klamczynski: 1157 chunkow, PATRON odpowiedzial na pytanie o zarzut (art. 300 § 2 k.k.).
- (+) **Governance zachowane:** detekcja + audyt + badge - sygnal jest, dowod AI Act jest, tylko nie ukrywamy. "Najpierw otwarte i uzyteczne, rygor pozniej na wniosek praktykow" (decyzja WM).
- (+) **Odwracalne z danymi:** gdy praktyk powie "za luzno", `PATRON_INPUT_SECURITY_ENFORCE=1` przywraca pelny rygor ADR-0020 - bez zmiany kodu, z realnymi przypadkami w rece.
- (-) **Swiadome obnizenie obrony w glab:** wrogi dokument (genuine injection) tez sie zaindeksuje i trafi do modelu. Ryzyko ograniczone: single-user desktop, egress guard + maskowanie PII + opcja modelu lokalnego. Dla trybu serwerowego/multi-tenant ENFORCE powinno byc domyslnie ON (rezerwacja: wpiecie per-mode w starcie).
- (-) Badge `securityStatus` musi byc czytelny w UI, by Operator wiedzial, ze skan cos zglosil (pierscien/etykieta - istnieje dla `human_review`).

## Bramki

ADR przed merge do `main`; 2x review WM (Konstytucja Art. 7). Domyslne OPEN to **zmiana postawy bezpieczenstwa** - wymaga swiadomej akceptacji WM (jest: "zrobmy wszystko otwarte i mozliwe, a potem na sugestie praktykow rygory"). Tryb serwerowy: rozwazyc ENFORCE=ON domyslnie przed jakimkolwiek wdrozeniem multi-tenant.
