# ADR-0094: Kontrakt paczki skilla (rozszerzalnosc PATRON, fundament Biblioteki umiejetnosci)

**Status**: Zaproponowany 2026-06-02 (panel MVP). Konstytucja v1.5.0. Definiuje format paczki skilla i pierwsza wersje loadera + panelu "Biblioteka umiejetnosci". Wyciagniecie wbudowanych etapow obrony (Recenzent/Adwokat/Pisz po ludzku) z defense.ts do paczek = krok 2 (osobny ADR). Podpis kryptograficzny, entitlement/licencja i zrodlo `marketplace` = rezerwacja (sekcja Rezerwacje).

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: kontrakt rozdziela DWIE plaszczyzny ruchu - dystrybucje skilla (paczka, w przyszlosci pobranie z marketu) od danych klienta i inferencji (akta, prompt do LLM). Skill deklaruje polityke egress; wartosc domyslna to `no-egress`; bramka jest twarda. Pobranie skilla nie jest nigdy kanalem wyjscia danych klienta.
- **Art. 5 - Czlowiek decyduje**: mecenas swiadomie importuje i wlacza/wylacza kazda umiejetnosc. Zaden skill nie aktywuje sie sam. To samo dzialanie ("wlacz") obsluzy pozniej "kup/zainstaluj z marketu".
- **Art. 3 - Audytowalnosc / determinizm**: kazdy skill ma stabilne `id` + `version` (semver); stan instalacji jest utrwalony lokalnie. Uruchomienie skilla bedzie logowane (id + wersja) - jeden mechanizm sluzy art. 12 AI Act oraz przyszlemu rozliczeniu uzycia.
- **Art. 7 - Minimalnosc**: MVP to dane + lista + przelacznik + import z pliku. Bez sieci, bez nowych zaleznosci natywnych.

**Powiazane ADR**:
- ADR-0058 (pipeline obrony Invisible AI): Recenzent/Adwokat/Pisz po ludzku sa dzis zapieczone w `backend/src/lib/pipeline/defense.ts`. Ten ADR zaklada ich pozniejsze wyniesienie do paczek; do tego czasu prezentowane sa jako wpisy WBUDOWANE (read-only) w panelu.
- ADR-0053 (SQLite single-user zero-cloud): stan instalacji skilli laduje w lokalnej bazie (tabela `installed_skills` w SQLITE_SCHEMA).
- ADR-0019/0020 (input-document security): zaimportowana paczka przechodzi walidacje ksztaltu; tresciowy skan anty-injection promptu = rezerwacja przy wlaczeniu egzekucji importowanych skilli.

---

## Kontekst

Kierunek produktu (2026-06-02, ustalony z Operatorem): **PATRON to platforma/baza, a umiejetnosci (skille) sa jednostkami rozszerzajacymi - docelowo dystrybuowanymi przez MateMatic Marketplace LegalTech** (Os 1 strategii). Kazdy dodatkowy skill to potencjalny przychod.

Dzis dodanie umiejetnosci = zmiana kodu (np. nowy etap w `defense.ts`) -> rebuild Electrona -> NSIS -> reinstalacja u kancelarii. To nie skaluje sie i lamie zasade "ficzer = prompt, nie kod".

Potrzebny jest **kontrakt paczki skilla** - jeden stabilny szew, wokol ktorego zszyja sie: panel (teraz), loader (teraz), a w przyszlosci market, podpis i entitlement. Kontrakt musi byc poprawny od poczatku, bo zmiana formatu po dystrybucji paczek jest kosztowna.

Pozorny konflikt "market wymaga pobierania" vs "zero-egress" rozwiazuje rozdzielenie plaszczyzn: dystrybucja skilla moze isc siecia (jak wtyczka do Worda), dane klienta zostaja lokalnie. Kontrakt koduje to rozroznienie jawnie (pole `egress` + przyszle `source`), zeby market nigdy nie stal sie tylnymi drzwiami do egressu akt.

---

## Decyzja

### A. Skill to paczka danych, nie kod

Umiejetnosc opisuje deklaratywny **manifest** (JSON), a nie modul TypeScript. Loader skanuje lokalny katalog skilli przy starcie i udostepnia liste; wykonanie skilla wpina sie w zadeklarowana powierzchnie (`surface`). Wzorzec lustrzany do konektorow MCP (drop-in + brama) i presetow kolumn (ADR-0081, dane nie kod).

### B. Manifest v1 (minimalny rdzen + pola-szwy na przyszlosc)

```jsonc
{
  "manifest_version": 1,
  "id": "streszczenie-pisma",        // stabilny, kebab-case, unikalny
  "name": "Streszczenie pisma",      // etykieta UI
  "description": "Skraca pismo do tezy, podstawy i wniosku.",
  "version": "1.0.0",                // semver
  "surface": "draft-stage",          // gdzie sie wpina (enum, ponizej)
  "prompt": { "system": "...", "user": "..." },
  "egress": "no-egress",             // no-egress (default) | cloud-allowed
  "source": "local-file",            // local-file (teraz) | marketplace (rezerwacja)
  "publisher": "MateMatic",          // informacyjne w MVP
  "signature": null                  // rezerwacja (podpis Ed25519)
}
```

- `surface` (enum, rozszerzalny): `draft-stage` (etap pipeline obrony) na start. Kolejne (`tabular-lens`, `analysis`) dochodza wraz z egzekucja.
- Pola `source`, `publisher`, `signature` istnieja juz w v1 jako **szwy** - market/podpis/entitlement wpinaja sie bez zmiany `manifest_version`.

### C. Dwie plaszczyzny egress, twardy default

`egress: "no-egress"` jest wartoscia domyslna i zakladana, gdy pole pominieto. Skill deklarujacy `cloud-allowed` jest przy wlaczeniu blokowany do czasu jednorazowej, jawnej zgody mecenasa (per skill). To polityka DYSTRYBUCJI/wykonania skilla - rozlaczna od globalnej polityki egress danych klienta (routing modelu, ADR egress). Market (pobieranie) nigdy nie podlega tej bramce jako egress danych - bo nie wysyla akt.

### D. Stan instalacji w lokalnej bazie (SQLITE_SCHEMA)

Tabela `installed_skills` (id, name, version, surface, source, egress, manifest JSON, enabled, installed_at, updated_at). `create table if not exists` w SQLITE_SCHEMA - bez runnera migracji w trybie desktop (lustro: migracja Postgres `011_*` dla trybu serwerowego). Skille WBUDOWANE (etapy obrony) nie sa w tabeli - loader trzyma je jako read-only deskryptory i scala z lista zainstalowanych.

### E. Bramka czlowieka

Endpointy: `GET /skills` (wbudowane + zainstalowane), `POST /skills/import` (walidacja + utrwalenie paczki z pliku), `PATCH /skills/:id` (wlacz/wylacz - tylko zainstalowane), `DELETE /skills/:id`. Panel "Biblioteka umiejetnosci" w UI: karty, przelacznik, "importuj paczke". Wbudowanych nie da sie usunac ani wylaczyc (rdzen obrony).

### F. Zakres MVP (to, co teraz) vs krok 2+

MVP: kontrakt + loader (skan/walidacja/rejestr) + tabela + route + panel + import z pliku. Skille zaimportowane sa LISTOWANE i przelaczane; ich faktyczne wykonanie w pipeline = krok 2 razem z wyniesieniem etapow obrony do paczek (dowod modelu na dzialajacym kodzie). Day-1 panel pokazuje 3 wbudowane (Recenzent/Adwokat/Pisz po ludzku) - nie jest pusty, nic nie refaktoryzujemy przedwczesnie.

---

## Konsekwencje

**Pozytywne**
- Rozszerzalnosc bez rebuildu i bez wizyty serwisanta (dla skilli-promptow).
- Jeden stabilny kontrakt = fundament marketu, podpisu i entitlement bez przepisywania.
- Rozdzielenie plaszczyzn egress w KODZIE (pole + bramka), nie tylko w marketingu - utrzymuje przekaz "dane lokalnie" przy jednoczesnym sklepie.
- Day-1 wartosc dla mecenasa: widzi i kontroluje swoje umiejetnosci.

**Negatywne / dlug do splaty (rezerwacje)**
- **Podpis Ed25519** paczki - w MVP import dotyczy wylacznie zaufanych plikow lokalnych; przed wlaczeniem egzekucji importowanych skilli i przed marketem podpis jest WYMAGANY (reuse infry offline-token, ADR licencji). Do tego czasu panel oznacza zaimportowane jako "niepodpisane / lokalne".
- **Skan anty-injection tresci promptu** importowanego skilla (ADR-0019 duch) - wpiac przy egzekucji (krok 2), nie przy samym listowaniu.
- **Entitlement/licencja i `source: marketplace`** - rezerwacja; pola obecne, logika pozniej.
- **Metering uruchomien** (audyt = billing) - wpiac przy egzekucji.
- `surface` egzekwowany dla jednej wartosci (`draft-stage`) na start.

---

## Rezerwacje (kolejne ADR)

1. Wyniesienie etapow obrony z `defense.ts` do paczek wbudowanych (krok 2) - pierwsze realne SKU.
2. Podpis Ed25519 paczki + weryfikacja przy imporcie (brama zaufania).
3. Egzekucja importowanych skilli w pipeline + skan anty-injection + metering.
4. `source: marketplace` - klient marketu jako kolejny dostawca zrodla, entitlement, kanal aktualizacji.
