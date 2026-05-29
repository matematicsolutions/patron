# ADR-0067: Governance routingu LLM - straznik data-residency + per-call audit + pseudonimizacja egress

**Status**: Wdrozony 2026-05-29 (B1 + B2 LIVE; cost-caps i consensus - rezerwacja). Konstytucja v1.4.0.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 2 (zero-cloud / tajemnica zawodowa),
Art. 4 (neutralnosc wobec dostawcow), Art. 5 (ochrona danych / minimalizacja),
Art. 3 (audytowalnosc), AI Act art. 12 (record-keeping)
**Powiazane**: ADR-0014 (multi-provider abstraction - slownik DataClassification/EgressFlag),
ADR-0003 (pseudonimizacja PII pre-LLM - wpiecie szkieletu wrap/unwrap),
ADR-0027 (privilege rings - wzorzec czystej funkcji decyzyjnej decideRing),
ADR-0026/0036 (Merkle), ADR-0047/0048 (audit pack), ADR-0035 (migration infra),
ADR-0059 (OpenRouter provider - zrodlo realnego kosztu)

## Kontekst

Audyt FAZA 0 (2026-05-29) wskazal dwa blockery przed kontaktem z realnymi aktami:

- **B1**: warstwa pseudonimizacji PII (ADR-0003) istniala jako szkielet (`lib/pseudonim/`
  z dzialajacym `wrap`/`unwrap`), ale nie byla wpieta w sciezke wywolania LLM. Dane
  klienta (PESEL/NIP/imiona) szly jawnie do modelu chmurowego.
- **B2**: brak runtime egress enforcement. `streamChatWithTools` routowal wylacznie po
  prefiksie modelu (`providerForModel`), bez sprawdzenia klasyfikacji danych wzgledem
  strefy egress. Dane objete tajemnica + model chmurowy przechodzily bez przeszkod.

ADR-0014 wprowadzil slownik (`DataClassification` x `EgressFlag`) i schematy Zod, ale tylko
jako typy (T1) - router (T3) nie istnial jako wpiety modul. Rozwazano osobny ADR z wlasnym
slownikiem (tajemnica/wrazliwe/ogolne x local/eu/inny). Odrzucono: dwa rownolegle slowniki
dla tej samej decyzji = mirror-drift. Budujemy B2 jako realizacje routera ADR-0014.

Rozwazono tez budowe serwera MCP do OpenRouter. Odrzucono: OpenRouter nie ma oficjalnego MCP
i swiadomie spycha protokol na klienta; generyczne spolecznosciowe serwery sa scommoditizowane
(zero przewagi). Wartosc jest w warstwie zgodnosci spietej z istniejacym audytem PATRON, nie
w connectorze.

## Decyzja

Warstwa governance jako brama przed wywolaniem providera (`lib/chat/stream.ts`), zlozona z
dwoch straznikow + maskowania PII na egress.

### B2 - Straznik 1: data-residency (egzekwowanie)

- Kazda sprawa (`projects.classification`) ma klasyfikacje `DataClassification`:
  `public` / `internal` / `client_general` / `attorney_client_privileged`. Default fail-closed
  `attorney_client_privileged`; czat ogolny bez sprawy -> `internal`; nieznana/blad odczytu ->
  fail-closed `attorney_client_privileged`.
- Kazdy model ma strefe `EgressFlag` (`lib/routing/egress.ts`): `ollama/*` -> `no-egress`;
  cala chmura (Anthropic/OpenAI/Google/OpenRouter) -> `us-with-dpa`; nieznany -> `us-with-dpa`
  (fail-closed). `eu-only` zarezerwowane (dodawane gdy region UE kontraktowo potwierdzony).
  Bielik przez OpenRouter to nadal `us-with-dpa` - request wychodzi do US infra.
- Czysta funkcja `decideRoute(classification, egress, allowUsProviders)` (wzorzec `decideRing`
  ADR-0027), `lib/routing/decideRoute.ts`:
  - `no-egress` -> zawsze allow (dane nie opuszczaja maszyny).
  - `attorney_client_privileged` -> tylko `no-egress`; chmura = blok, bez wyjatku.
  - `client_general` / `internal` / `public` -> `eu-only` zawsze allow; `us-with-dpa` allow
    tylko gdy `ALLOW_US_PROVIDERS=true` (swiadoma decyzja Administratora, Art. 2/4).
- Punkt egzekwowania (`guardEgress` w `lib/routing/guard.ts`) wola `decideRoute` przed kazdym
  wyjsciem do providera. Blok -> event SSE `error` (`code: egress_blocked`) z czytelnym
  komunikatem PL + sugestia modelu lokalnego (`PATRON_LOCAL_MODEL`).

### B2 - Straznik 2: per-call audit z realnym kosztem

- Po kazdym wywolaniu (i przy bloku) powstaje zdarzenie `audit_log` typu `llm_route`
  (`lib/routing/auditLlmRoute.ts`) z polami: model, dostawca, strefa egress, klasyfikacja,
  decyzja (allow/block), powod, sprawa_id, tokeny prompt/completion, realny koszt, latencja,
  actor, znacznik czasu.
- Koszt realny z OpenRouter (`usage.include` -> `usage.cost` w ostatnim chunku); brak realnego
  kosztu -> `cost_estimated: true`, `cost_usd: null` (statyczna tabela cen = rezerwacja ADR-beta).
- Zdarzenie wchodzi do istniejacego hash-chain (ADR-0001) + Merkle (ADR-0026/0036) + audit pack
  (ADR-0047/0048). Typ `llm_route` dodany do whitelisty przez migracje 005 (ALTER CHECK), we
  wszystkich 4 lustrach enum (audit.ts `EVENT_TYPES`, schema.sqlite.ts, schema.sql, migracja).

### B1 - Pseudonimizacja na egress (defense-in-depth)

- Wpiecie szkieletu ADR-0003 w sciezke czatu: przed wyjsciem do chmury (`egress != no-egress`)
  i dla danych nie-publicznych konwersacja (system prompt + wiadomosci) przechodzi przez
  `wrapConversation` (`lib/pseudonim/egress.ts`) - jedna wspolna mapa, ten sam identyfikator
  dostaje ten sam token wszedzie.
- Odpowiedz przechodzi przez `PseudonimStreamUnwrapper` - odwraca tokeny w strumieniu z
  hold-back dla tokenow rozcietych na granicy chunkow (token bez zamykajacego `]` jest
  wstrzymany; nigdy nie emitujemy polowki ani nie ujawniamy oryginalu przy obcietym strumieniu).
- Wylacznik awaryjny `PATRON_PSEUDONIM_EGRESS=false`. Model lokalny (pilotaz Ollama) -> brak
  maskowania (dane nie wychodza).

## Konsekwencje

Pozytywne:
- Zero-cloud i tajemnica zawodowa egzekwowane w kodzie, nie tylko domyslna flaga (Art. 2 LIVE).
- Pelny niezmienny slad kazdego wywolania LLM jako dowod nalezytej starannosci (AI Act art. 12).
- Realna kontrola kosztu (fundament pod cost-caps ADR-beta).
- Reuse istniejacej infrastruktury (Merkle, audit pack, migracje, wrap/unwrap) - maly diff.
- Pilotaz "tylko Ollama lokalnie" jest teraz wymuszony polityka, nie zalezy od wyboru w pickerze.

Koszty i ryzyka:
- Rejestr `EgressFlag` utrzymywany recznie (fail-closed gdy nieznany).
- Zaleznosc od OpenRouter dla realnego kosztu (inaczej `cost_estimated`).
- Czat sprawy domyslnie (privileged) dziala tylko lokalnie - aby uzyc chmury, mecenas swiadomie
  obniza klasyfikacje sprawy ORAZ Administrator wlacza `ALLOW_US_PROVIDERS`. To celowe tarcie.
- Dodatkowa brama + maskowanie w sciezce (minimalna latencja; czyste funkcje + lekki ALTER).

## Ograniczenia / dlug (FAZA 1)

- Detektor imion/nazw firm jest LLM-based i wciaz no-op (`detect.ts noopLlmDetector`) - maskujemy
  tylko identyfikatory regexowe (PESEL/NIP/REGON/KRS/email/telefon). Imiona nie sa maskowane.
- Argumenty wywolan narzedzi nie sa odwracane - jezeli model wstawi token do argumentu toola,
  narzedzie dostanie token (rzadkie dla ustrukturyzowanych identyfikatorow).
- `EgressFlag eu-only` pusty do czasu kontraktowego potwierdzenia regionu UE dostawcy.
- Brak UI do zmiany klasyfikacji sprawy w tej iteracji (kolumna + default sa; kontrolka = dlug).
- Mapa pseudonimow per-call in-memory (nie persystowana) - zgodne z RODO art. 17 (nic nie zostaje).

## Anty-zakres (rezerwacje)

- Cost-caps per sprawa/klient z egzekwowaniem budzetu: osobny ADR-beta (zalezy od per-call kosztu).
- Multi-model consensus/verification high-stakes: osobny ADR-gamma (spina sie z ADR-0058).
- Hierarchiczne budzety per zespol, integracja z corporate IdP: poza zakresem desktopu single-user.

## Status weryfikacji

- 47 nowych testow (27 routing: macierz 4 klasyfikacje x 3 strefy x ALLOW_US + fail-closed
  guard; 20 pseudonim egress: wspolna mapa + strumien z tokenem rozcietym/niezamknietym).
- `tsc --noEmit` clean. Backend 781 testow pass (5 todo).
- Commity: B2 routing (straznik + audit + migracje 005/006), B1 pseudonim (wrapConversation +
  stream unwrapper + wpiecie). Chirurgiczne, bez naruszenia rownoleglych zmian rebrandu.
