# ADR-0002: Dual-license — AGPL-3.0 shell, MIT connectors

**Status**: Accepted
**Data**: 2026-05-20
**Powiązane**: Konstytucja AI Patrona, Art. 4 (vendor neutrality) i Art. 9
(dostępność wiedzy); fork attribution w `NOTICE`.

## Decyzja

Patron jest stackiem dwu-licencyjnym:

| Komponent | Licencja |
|---|---|
| `patron` (powłoka: backend + frontend + governance + deploy) | **AGPL-3.0-only** |
| `mcp-saos`, `mcp-nsa`, `mcp-isap`, `mcp-krs`, `mcp-eu-sparql` (5 konektorów MCP, osobne repo) | **MIT** |

## Kontekst

Patron jest forkiem [Mike](https://github.com/willchen96/mike)
(MIT) z istotnymi modyfikacjami (polonizacja, 5 konektorów polskiego
prawa, audit trail hash-chain, Konstytucja AI, docker-compose stack).
MIT pozwala na zmianę licencji w forku, pod warunkiem zachowania
oryginalnej noty (zob. `NOTICE`).

Stoimy przed wyborem licencji dla nowych komponentów:

1. **Wszystko MIT** — maksymalna permissywność. Każdy może wziąć
   Patrona, zamknąć, sprzedać jako SaaS. Brak ochrony moatu.
2. **Wszystko AGPL** — twarda copyleft. Konektory MCP też zamknięte —
   inni gracze polskiego legal-techu (np. konkurencja MateMatic, ale
   też startupy klientów, autorzy LegalTech innovation challenges)
   nie mogą ich użyć w swoich zamkniętych produktach. To zubaża
   ekosystem.
3. **Dual: AGPL shell + MIT connectors (wybrana)** — chronimy
   value-prop (powłokę z Konstytucją AI, audit trail, polonizacją,
   dispatchem narzędzi), oddajemy infrastrukturę (konektory danych
   publicznych do publicznych źródeł prawa).

## Uzasadnienie wyboru

### Dlaczego AGPL-3.0 dla powłoki

**Kancelaria stosująca self-host NIE jest redystrybutorem.** AGPL
nakłada obowiązek udostępnienia kodu źródłowego tylko gdy
oprogramowanie jest **udostępniane w sieci użytkownikom trzecim**.
Kancelaria, która uruchamia Patrona na własnym serwerze dla
własnych prawników, **nie ma żadnego dodatkowego obowiązku** poza
tym, co już daje AGPL (prawo do używania, modyfikacji, dystrybucji
wewnątrz organizacji).

**Konkurent oferujący Patrona jako SaaS dla kancelarii — TAK, musi
otworzyć modyfikacje.** To jest dokładnie cel. Nie chcemy aby:

- Ktoś wziął Patrona, dodał własne konektory MCP, zamknął, sprzedał
  to z powrotem do kancelarii jako konkurencyjny SaaS, podcinając
  MateMatic.
- Ktoś zbudował zamknięty produkt na bazie audit trail hash-chain
  i Konstytucji AI Patrona, czerpiąc z pracy społeczności.

AGPL-3.0 zostawia oba scenariusze **otwarte z obowiązkiem
udostępnienia kodu** — co eliminuje motywację konkurencji do
takiego ruchu (musieliby otworzyć całą swoją wartość dodaną).

Vendor-lock-in po naszej stronie: zero. Kancelaria może zawsze
wziąć Patrona, fork, prowadzić go sama. AGPL gwarantuje że to
prawo nie zniknie.

### Dlaczego MIT dla konektorów MCP

Konektory są **adapterami do publicznych źródeł prawa**: SAOS,
CBOSA, Sejm ELI, MS KRS, EUR-Lex. Te dane są publiczne — nasza
wartość dodana to format, struktura citations, throttle, dokumentacja
toolingu MCP. To nie jest moat — to infrastruktura.

MIT pozwala aby:

- **Inne polskie produkty legal-tech** (konkurencyjne, komplementarne,
  edukacyjne) mogły wpinać `mcp-nsa` do swoich agentów bez taraktowania
  ich kodu.
- **Studenci, hackathony, akademickie projekty** mogły badać polskie
  prawo nie martwiąc się o licencję.
- **Patron** (AGPL) mógł zawierać kod MIT — kompatybilność MIT→AGPL
  jest bezproblemowa.

Im więcej osób używa naszych konektorów, tym bardziej stają się
**de facto standardem** zwracania cytatów z polskiego prawa
(`structuredContent.citations`). To jest własna nagroda — efekt
sieciowy.

## Konsekwencje

**Plusy**:
- Ochrona moatu (powłoka + governance + UX) bez ofiarowania
  ekosystemu.
- Kancelarie self-host nie czują obciążenia AGPL.
- Konektory mogą żyć własnym życiem w ekosystemie PL legal-tech.
- Zgodne z Art. 9 Konstytucji (dostępność wiedzy) — kod otwarty.
- Zgodne z Art. 4 Konstytucji (vendor neutrality) — kancelaria
  zawsze może fork i prowadzić sama.

**Minusy / ograniczenia**:
- Komplikacja: musimy utrzymywać 6 repozytoriów osobno.
  Mitigation: bundler `scripts/bundle-mcp.cjs` + monorepo-style
  workflow przy pracy.
- AGPL bywa odrzucane przez wewnętrzne polityki dużych korporacji.
  Mitigation: kancelarie to nie korporacje IT — AGPL nie jest dla
  nich blokerem przy self-host.
- Możliwość zamieszania: który komponent ma jaką licencję?
  Mitigation: tabela w `CONTRIBUTING.md` + `package.json` "license"
  field + LICENSE plik w każdym repo + ten ADR.

## Implementacja

- `patron/LICENSE` — GNU AGPL v3 (zachowane z forku, ponowna konfirmacja).
- `patron/NOTICE` — attribution forka Mike + uzasadnienie wyboru AGPL.
- `mcp-*/LICENSE` × 5 — MIT z copyrightem MateMatic.
- `patron/CONTRIBUTING.md` — sekcja "License model" z tabelą + DCO.
- `package.json` "license" w każdym repo zgodne z LICENSE.

## Alternatywy odrzucone

| Wariant | Powód odrzucenia |
|---|---|
| Wszystko MIT | Brak ochrony powłoki przed komercyjnym zamknięciem. |
| Wszystko AGPL | Zatruwa konektory dla ekosystemu (legalne, ale szkodliwe). |
| GPL-3.0 (nie AGPL) | Network use clause AGPL jest celowo dobrana — kancelarie self-host są wolne, SaaS-i nie. GPL-3.0 nie ma tej klauzuli. |
| BSL (Business Source License) z konwersją na MIT po 4 latach | Złożone, kontrowersyjne, słabe doświadczenie społeczności. Nie warto wprowadzać. |
| Mozilla Public License 2.0 | File-level copyleft — działa dla bibliotek, nie dla produktu. |

## Aktualizacja konstytucji

Konstytucja AI Patrona v1.0.0 → v1.1.0 (MINOR bump):
- Art. 9 (Dostępność wiedzy) doprecyzowany: konkretnie wymienia
  AGPL-3.0 dla shell i MIT dla konektorów, z odsyłaczem do
  ADR-0002.

## Status weryfikacji

- [x] LICENSE pliki istnieją we wszystkich 6 repo
- [x] NOTICE w patron z pełnym attribution
- [x] CONTRIBUTING.md z tabelą licencji
- [x] package.json zgodne z LICENSE
- [ ] Aktualizacja Konstytucji do v1.1.0 (Art. 9) — w toku w tym
      samym commicie co ADR
