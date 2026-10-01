# ADR-0160 - Baner MCP Security pokazuje tryb, ktory brama egzekwuje, nie wartosc zmiennej env

- **Status:** Proponowany (kod gotowy, testy + mutant)
- **Data:** 2026-10-01
- **Galaz:** na galezi ADR-0158/0159, linia publiczna
- **Zmienia:** [ADR-0042](./0042-ui-banner-mcp-security-gateway.md) (zrodlo pola `gateway.mode`)
- **Mapuje na:** ADR-0028 (brama przy starcie), ADR-0158 (zatwierdzenie `human_review`;
  tam zgloszone jako "poza zakresem"), ADR-0147 sekcja 3a (ta sama klasa bledu: sygnal zaufania,
  ktory nie opisuje stanu)

## Kontekst

ADR-0042 dodal baner MCP Security w panelu admina. Pole `gateway.mode` czytal z nowej zmiennej
`MCP_SECURITY_GATEWAY_MODE` (`enforce` / `audit` / `off`, brak = `off`) i zastrzegl, ze zmienna
"nie zmienia runtime behavior gateway'a"; tryb sterujacy egzekwowaniem zarezerwowano jako
ADR-0045. ADR-0045 nie powstal.

Skutek: `getMcpTools` blokuje konektory przy `denied` i `human_review` zawsze, a baner przy
domyslnej konfiguracji mowil adminowi "MCP Security: Wylaczony. Zalecane wlaczenie w env
MCP_SECURITY_GATEWAY_MODE". Przy `audit` mowil "Narzedzia NIE sa blokowane" - a byly.
`.env.docker.example` opisywal `audit` jako "loguje wszystko, nie blokuje" i `off` jako
"no-op". Admin, ktory poszedl za zaleceniem, ustawial zmienna, ktora niczego nie wlaczala, i
dostawal komunikat zgodny z rzeczywistoscia tylko przypadkiem.

## Decyzja

**1. `gateway.mode` = tryb egzekwowany przez kod.** `readGatewayMode()` zwraca `enforce`, bo
taki jest jedyny tryb, w ktorym dziala `getMcpTools`. Zmienna `MCP_SECURITY_GATEWAY_MODE` jest
ignorowana.

**2. Bez trybu "tylko loguj".** Tryb mniej restrykcyjny niz `enforce` oslabia ochrone przed
konektorem z ukryta instrukcja albo podmienionym narzedziem. Jesli kiedys bedzie potrzebny,
wchodzi osobnym ADR jako zmiana w `getMcpTools` (i w audycie), nie w banerze.

**3. Frontend bez zmian.** Kontrakt endpointu (`mode`, `active`) zostaje; komunikaty dla `off`
i `audit` w slownikach sa od teraz nieosiagalne z tego backendu. Usuniecie ich i doprecyzowanie
licznika blokad (dzis "ZABLOKOWANO" liczy tylko `denied`, choc `human_review` bez zatwierdzenia
tez blokuje) to porzadek na pozniej.

## Weryfikacja

- `security.test.ts`: `readGatewayMode` zwraca `enforce`, a `active` jest `true` dla braku
  zmiennej i dla `off`, `audit`, `enforce`, nieznanej wartosci oraz `"  OFF  "`.
- Mutant: przywrocone czytanie zmiennej - 5 z 6 przypadkow czerwonych (zielony zostaje tylko
  `enforce`).

## Konsekwencje

- Admin, ktory ustawil `MCP_SECURITY_GATEWAY_MODE=off` lub `audit`, zobaczy `enforce`. To
  prawda o systemie; wczesniej baner opisywal jego konfiguracje, nie zachowanie.
- Wdrozenia Docker z ustawiona zmienna dzialaja jak dotad - zmienna nigdy nie sterowala brama.
