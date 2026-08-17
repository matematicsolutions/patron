# ADR-0095: Tier-governance egress (envelope_tier + tier-floor) i wspolny chokepoint data-residency (domkniecie luki /draft/refine)

**Status**: Wdrozony 2026-06-02 na branch `feat/tier-governance-envelope` (NIE scalony do main - czeka na akceptacje). Rozszerza ADR-0067 (straznik data-residency) o (1) N-arny straznik egress dla operacji wielomodelowych oraz (2) jeden wspolny punkt egzekwowania dla WSZYSTKICH sciezek wychodzacych do LLM, co domyka realny przeciek: `/draft/refine` egressowal bez straznika residency.

**Data**: 2026-06-02

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych / Art. 2 - Tajemnica zawodowa**: pipeline obrony (`/draft/refine`) robil do 3 wywolan LLM przez `egressForModel` + maskowanie PII, ale BEZ `decideRoute` - tresc sprawy objetej tajemnica mogla wyjsc do chmury (maskowanie PII nie jest blokada residency, a nazwiska/firmy sa LLM-noop, czyli niemaskowane - dlug FAZA 1). Ten ADR egzekwuje na tej sciezce te sama polityke co czat: tajemnica -> wylacznie model lokalny, bez wyjatku.
- **Art. 3 - Audytowalnosc / determinizm**: `tier.ts` to czyste funkcje (zero IO, zero LLM, zero zegara); ten sam zbior modeli + klasyfikacja daje ten sam werdykt. Blokada egress audytowana jako `llm_route` (action: block) w hash-chain (ADR-0001) na obu sciezkach.
- **Art. 4 - Neutralnosc wobec dostawcow**: `envelope_tier` operuje na `EgressFlag` (strefa), nie na nazwie dostawcy. Zaden provider nie jest faworyzowany.
- **Art. 7 - Minimalnosc**: zero nowej zaleznosci npm. `enforceEgressGuard` to ekstrakcja istniejacej logiki ze `stream.ts` (AGENTS.md: "nie kopiuj logiki, importuj ja"), a nie nowy mechanizm.

**Powiazane ADR**:
- ADR-0067 (straznik data-residency `decideRoute` + `guardEgress` + per-call audit `llm_route`): ten ADR rozszerza go. `tierFloorFor` odwzorowuje polityke `decideRoute` 1:1 (parytet zakuty testem), `guardEnvelopeTier` to jego wersja N-arna.
- ADR-0014 (rejestr egress, `egressForModel`): zrodlo mapowania model -> strefa. Tier = ta sama strefa uporzadkowana relacja surowosci.
- ADR-0058 (pipeline obrony Invisible AI, `/draft/refine`): sciezka, ktora dotad omijala straznik residency. Ten ADR ja domyka.
- ADR-0068 (maskowanie PII przed egress): pozostaje jako defense-in-depth NAD blokada residency, nie zamiast niej.
- ADR-0093 (cost-caps): rezerwa "tier-governance" z B domknieta tutaj w czesci envelope_tier.

**Inspiracja** (clean-room, wzorzec nie kod): LegalQuants/lq-ai (Apache-2.0) - `envelope_tier` (operacja wielomodelowa nie eskaluje skrycie strefy egress) i `sole-egress` (jeden punkt wyjscia). Bierzemy idee, nie kod (inny stack: Python/FastAPI). Patrz THIRD_PARTY_INSPIRATIONS.md.

---

## Kontekst

ADR-0067 dostarczyl straznika data-residency dla POJEDYNCZEGO wywolania (`decideRoute` + `guardEgress`), egzekwowanego inline w `lib/chat/stream.ts`. Audyt stanu (2026-06-02) ujawnil dwie luki:

1. **Brak jednego chokepointu.** Egress do LLM zachodzi w co najmniej dwoch miejscach: `chat/stream.ts` (przez `guardEgress`) ORAZ `pipeline/defense.ts` wywolywany z `routes/draft.ts` (przez `egressForModel` + maskowanie PII, BEZ `guardEgress`/`decideRoute`). `/draft/refine` nie znal nawet klasyfikacji sprawy - nie przyjmowal `project_id`. Skutek: dla domyslnego modelu chmurowego (`gemini-3-flash-preview` = `us-with-dpa`) draft sprawy objetej tajemnica mogl wyjsc do USA, zamaskowany tylko czesciowo (identyfikatory regex; nazwiska/firmy niemaskowane).

2. **Brak straznika dla operacji wielomodelowej.** `decideRoute` ocenia jeden model. Operacja na wielu modelach (przyszly ensemble groundingu cytatow, tabular multi-model) nie ma straznika agregujacego - latwo wpiac kontrole tylko dla modelu "glownego" i rozeslac te sama tresc do pozostalych.

## Decyzja

### 1. envelope_tier + tier-floor (`backend/src/lib/routing/tier.ts`)
- `EgressTier` = alias `EgressFlag` (tier to ta sama strefa, uporzadkowana). `EGRESS_TIER_ORDER`: no-egress(0) < eu-only(1) < us-with-dpa(2).
- `maxTier(tiers)` = envelope_tier (najgorsza strefa w zbiorze; pusty zbior = no-egress).
- `tierFloorFor(classification, allowUsProviders)` = sufit dozwolonej strefy: tajemnica -> no-egress (bez wyjatku); reszta -> eu-only, a us-with-dpa tylko za zgoda Administratora. Lustro polityki `decideRoute`.
- `guardEnvelopeTier({classification, models[], allowUsProviders})` blokuje, gdy `envelope_tier > ceiling`, PRZED jakimkolwiek wyjsciem. Dla jednego modelu = identyczna decyzja co `decideRoute` (parytet, anty-dryf). Fail-closed: nieznany model -> us-with-dpa.

### 2. Wspolny chokepoint (`backend/src/lib/routing/enforceEgress.ts`)
- `enforceEgressGuard({db, model, projectId, actorUserId, chatId?})` woła `guardEgress` i - GDY BLOK - od razu emituje audyt `llm_route` (action: block). Sciezka allow audytuje sie u wolajacego (zna realny koszt/latencje po wywolaniu).
- `chat/stream.ts` przepisany z inline na `enforceEgressGuard` (zero zmiany zachowania; ta sama tresc audytu).
- `routes/draft.ts`: przyjmuje opcjonalny `project_id`, woła `enforceEgressGuard` PRZED `runDefensePipeline`, przy blokadzie zwraca HTTP 403 `{detail, code:"egress_blocked", suggestedModel}`, a po sukcesie audytuje `llm_route` (action: allow) - parytet z czatem.

### Zmiana zachowania (swiadoma)
`/draft/refine` z modelem chmurowym i `ALLOW_US_PROVIDERS=false` jest teraz BLOKOWANY (jak czat). Domyslny model (`gemini-3-flash-preview`) jest chmurowy, wiec bez `ALLOW_US_PROVIDERS=true` albo modelu lokalnego (Ollama) endpoint zwroci 403. To jest naprawienie przecieku, nie regresja: dane internal/tajemnica nie powinny egressowac bez swiadomej decyzji Administratora - taka byla juz polityka czatu.

## Ewaluacja (eval-first, ADR-0087)

`backend/src/lib/routing/tier.test.ts` (13 testow): BASELINE dokumentuje luke - naiwny guard tylko modelu glownego (lokalnego) przepuszcza mieszany zbior z tajemnica; `guardEnvelopeTier` na calym zbiorze blokuje (offendingModel wskazany). Plus invarianty `maxTier`/`tierFloorFor`, fail-closed, oraz TEST PARYTETU: dla kazdej klasyfikacji x modelu `guardEnvelopeTier([m]).allowed == (decideRoute(m).action==='allow')` - pilnuje jednego zrodla semantyki bez refaktoru `decideRoute`.

`backend/src/lib/routing/enforceEgress.test.ts` (4 testy): tajemnica+chmura -> blok + audyt `llm_route(block)`; draft ogolny (internal)+chmura US+ALLOW_US=false -> blok; model lokalny -> allow i ZERO audytu w helperze (allow audytuje wolajacy); client_general+chmura+ALLOW_US=true -> allow.

Bramki: `tsc` EXIT 0, pelny suite vitest 1048 pass / 0 fail (bez regresji na `guard.test.ts`/`decideRoute.test.ts`/`stream`).

## Alternatywy odrzucone
- **Duplikacja inline guard w `draft.ts`** (skopiowac ze `stream.ts`): odrzucone - AGENTS.md zakazuje kopiowania logiki. Ekstrakcja do wspolnego helpera = jeden chokepoint.
- **Refaktor `decideRoute` -> delegacja do `tier.ts`** (jedno zrodlo bez parytetu): odrzucone na teraz (additive-only, zero ryzyka regresji na przetestowanym `decideRoute`). Dryf pilnowany testem parytetu; ujednolicenie = rezerwacja.
- **PHASE_GRANTS (bounded-autonomy)**: NIE materializowane jako kod. PATRON jest request/response (jedyny scheduler to Merkle, brak autonomicznych agentow w tle). Szkielet faz pozostaje rezerwacja na wypadek dodania autonomii - nie projektujemy autonomii, ktorej nie ma.

## Rezerwacje
- Wpiecie `guardEnvelopeTier` w realny call-site wielomodelowy (ensemble groundingu - przyszly kandydat A; tabular jest dzis single-model, wiec straznik jest no-op-safe do czasu ensemble).
- Ujednolicenie `decideRoute` jako 1-arnego przypadku `guardEnvelopeTier` (po stabilizacji).
- Pelny audyt `envelope_tier` w payload `llm_route` przy operacjach wielomodelowych (zbiorczy vs per-model - decyzja przy wpieciu A).
