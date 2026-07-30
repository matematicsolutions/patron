# ADR-0140: Klient kanalu dystrybucji paczek wiedzy (chunki + manifest + delta)

**Status**: Przyjety (2026-07-18) - implementacja zaplanowana w architekturze
dostarczania MateMatic (legal-pack-factory/docs/architektura-dostarczania.md,
"Integracja po stronie PATRONA"). Repo prywatne, artefakty produkcyjne bez
publikacji do wspolnej decyzji WM+agent.

## Kontekst

Paczki wiedzy PATRON 2.0 Edition (SQLite, do 1,6 GB) sa publikowane w kanale
chunkowym przez `lpf publish` (legal-pack-factory, wzorzec Steam/SteamPipe):
chunki stalego rozmiaru 256 KB gzipowane OSOBNO i adresowane wlasnym sha256,
manifest = lista skrotow + skrot calosci, plik `*.state.json` jako wskaznik
biezacej wersji (wzorzec replikacji OSM). Pomiary z fabryki: kwartalna
aktualizacja (+2% orzeczen) = pobranie ~20% pliku; kanal dla 50 kancelarii =
677 MB zamiast 33 GB.

PATRON-owi brakowalo strony klienckiej: pobrania delty, weryfikacji i podmiany
paczki oraz komunikatu w UI. Model abonamentu jest bez DRM - wygasa kanal, nie
produkt - wiec "dostepna aktualizacja" w UI to jedyny (lagodny) nacisk.

## Decyzja

Port logiki fetch/update z `legal_pack_factory/channel.py` na TypeScript w
backendzie PATRONA, wylacznie wbudowane moduly Node (https, crypto, zlib, fs)
plus better-sqlite3 (juz w zaleznosciach) do `pack_meta`:

- `backend/src/lib/pack-channel.ts` - rdzen: `fetchPack` (odtworzenie paczki
  z kanalu z seedem = poprzednia lokalna paczka; pobierane sa wylacznie
  brakujace chunki, kazdy weryfikowany sha256, calosc weryfikowana
  `pack_sha256` z manifestu), `checkUpdate` (dry-run + realny rozmiar delty
  policzony z manifestu i seeda), `updatePack` (staging `.new`, backup
  `.prev`, podmiana DOPIERO po zgodnosci skrotu; plik zajety przez inny
  proces = `PackBusyError` z czytelnym komunikatem, stara paczka nietknieta),
  `readChannelStamp`/`stampChannel` (`pack_meta.channel_url` +
  `channel_version` - paczka zna swoj kanal, wzorzec naglowka OSM PBF).
  W odroznieniu od wersji Python seed indeksowany jako digest->offset
  (nie tresc w RAM) - paczka 1,6 GB nie miesci sie w pamieci.
- `backend/src/routes/packs.ts` - `GET /api/packs`, `GET /api/packs/updates`,
  `POST /api/packs/update`; requireAuth+requireAdmin (parytet /api/status),
  paczka wskazywana wylacznie nazwa pliku z katalogu paczek (zero traversal),
  plik zajety -> HTTP 409. Katalog: `PATRON_PACKS_DIR` albo
  `%APPDATA%/PATRON/packs`.
- `frontend`: banner `PackUpdateBanner` w glownym layoucie (obok bannerow MCP
  Security i egress) - "dostepna aktualizacja X -> Y, do pobrania N MB z M MB";
  i18n `packUpdates` (pl + en, reszta locale przez fallback).

Transport jest nieistotny (base = URL http(s) LUB katalog/pendrive - rozni je
tylko prefiks sciezki), dzieki czemu testy vitest cwicza pelny cykl na kanale
katalogowym bez sieci.

## Konsekwencje

- Droga klienta z architektury dostarczania dziala po stronie PATRONA:
  paczka opieczetowana przy publikacji aktualizuje sie bez zadnej konfiguracji.
- RODO/tajemnica: ruch wylacznie WYCHODZACY po opublikowane artefakty (GET
  manifestu i chunkow); zadne dane kancelarii nie opuszczaja urzadzenia.
- Weryfikacja minisign nad manifestem (slot `signing` w manifescie) czeka na
  wygenerowanie klucza przez WM - nastepny krok, poza zakresem tego ADR.
- Zdarzenie audit hash-chain dla aktualizacji paczki (nowy `event_type` to
  5 mirrorow wg precedensu connector.toggle) - swiadomie odlozone; dzis slad
  operacyjny w logu procesu.
