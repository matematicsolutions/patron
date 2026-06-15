# ADR-0069: Naglowki bezpieczenstwa frontendu + CSP report-only

**Status**: Wdrozony 2026-05-29 (H8 LIVE). Konstytucja v1.4.2.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 5 (ochrona danych), Art. 2 (tajemnica zawodowa)
**Powiazane**: ADR-0062 (frontend tryb local), ADR-0067 (H9 self-host czcionek pdf.js - upraszcza font-src)

## Kontekst

Audyt FAZA 0 (H8): `frontend/next.config.ts` nie ustawial zadnych naglowkow bezpieczenstwa.
Brak X-Frame-Options i frame-ancestors -> dokumenty klientow podatne na clickjacking (osadzenie
w obcej ramce). Brak Referrer-Policy -> UUID sprawy w sciezce moze wyciec w naglowku Referer do
innego origin. Brak CSP -> brak ostatniej linii obrony przed XSS / wstrzyknieta tresc w podgladzie.

## Decyzja

`async headers()` w next.config.ts dla wszystkich sciezek (`/:path*`):

- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` - zakaz osadzania (anti-clickjacking).
- `X-Content-Type-Options: nosniff` - brak MIME sniffingu.
- `Referrer-Policy: strict-origin-when-cross-origin` - UUID sprawy nie wycieka w Referer.
- `Permissions-Policy` - wylaczone kamera/mikrofon/geolokalizacja/browsing-topics.
- `Content-Security-Policy-Report-Only` - polityka w trybie raportowania, nie blokowania.

CSP jest REPORT-ONLY na start. Powod: dynamiczny podglad docx i pdf.js oraz Next moga generowac
inline script/style; twardy enforce bez obserwacji ryzykuje zepsuciem UI. Report-only zbiera
naruszenia (do konsoli / report-uri w przyszlosci) bez wplywu na dzialanie. Przejscie na twardy
`Content-Security-Policy` po analizie raportow = rezerwacja. Self-host czcionek pdf.js (H9, ADR-0067)
juz pozwala na `font-src 'self'` bez CDN.

## Konsekwencje

- Dokumenty klientow nieosadzalne, UUID sprawy nie wycieka w Referer (Art. 5).
- CSP report-only nie zmienia zachowania UI - zero ryzyka regresji teraz, sygnal do enforce pozniej.
- Naglowki dotycza warstwy Next; w trybie Electron (single-user) i tak dominuje, ale spojnosc
  z deploymentem serwerowym zachowana.

## Status weryfikacji

- Frontend `tsc --noEmit` clean. Zmiana w jednym pliku (next.config.ts), zero nowych zaleznosci.
- Twardy CSP enforce + report-uri = rezerwacja po obserwacji raportow report-only.
