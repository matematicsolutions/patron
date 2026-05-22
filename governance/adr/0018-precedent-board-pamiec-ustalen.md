# ADR-0018: Precedent board - pamiec ustalen (findings) per klient

**Status**: Proponowany (cherry-pick blueprint, niewpiety w stack produkcyjny)
**Data**: 2026-05-22
**Powiazane zasady** (Konstytucja Patrona v1.1.1, zweryfikowane wzgledem `governance/CONSTITUTION.md`):
- **Art. 1 - Lokalnosc danych** (RODO art. 25, AI Act art. 10) - board jest lokalnym storem, nigdy nie opuszcza serwera kancelarii; brak komponentu chmurowego
- **Art. 5 - Tajemnica zawodowa** (Pr.Adw. art. 6, Pr.RP art. 3) - **rdzen tego ADR**: precedensy sa **izolowane per klient**. Ustalenie ze sprawy klienta A NIGDY nie wyplywa jako kontekst przy sprawie klienta B. Izolacja jest twarda (osobny namespace per `client_id`), nie filtrem aplikacyjnym ktory da sie obejsc
- **Art. 6 - Granica bledu** (human in the loop) - precedens **sugeruje** kontekst, nie **decyduje**. Agent nie wnioskuje automatycznie "znowu RED" na podstawie boardu; precedens jest wstrzykiwany jako materialy do rozwazenia, a kwalifikacje potwierdza prawnik
- **Art. 3 - Audytowalnosc** (AI Act art. 12, RODO art. 30) - kazdy wpis boardu jest evidence-linked (wskaznik do zrodlowego ustalenia + sprawy); wstrzykniecie precedensu loguje sie w hash-chain (ADR-0001)
- **Art. 7 - Minimalnosc danych** (RODO art. 5 ust. 1 lit. c) - board trzyma metadane ustalenia (typ, severity, jurysdykcja, typ dokumentu, wskaznik dowodu), NIE pelne dokumenty klienta ani ich tresc

**Powiazane ADR**:
- ADR-0007 (hybrid retrieval) - **odrebny cel**. ADR-0007 wyszukuje **dokumenty zrodlowe** (akta, orzeczenia). Ten ADR pamieta **wnioski** (co uznalismy za RED i dlaczego). To dwie warstwy: retrieval materialu vs pamiec ocen.
- ADR-0009 (nocna konsolidacja pamieci) - konsolidacja moze przycinac i obnizac pewnosc (confidence decay) wpisow boardu w cyklu nocnym; board jest jednym ze zrodel, ktore ADR-0009 utrzymuje.
- ADR-0001 (hash-chain audit trail) - wstrzykniecie precedensu = zdarzenie logowane z `client_id`, `precedent_id`, `finding_ref`.
- ADR-0003 (pseudonimizacja PII pre-LLM) - tekst ustalenia przed zapisem do boardu przechodzi przez warstwe pseudonim; board nie przechowuje surowych danych osobowych.

**Inspiracja cherry-pick**: [AnttiHero/lavern](https://github.com/AnttiHero/lavern) (Apache 2.0), plik `src/claw/precedent-board.ts` - pattern instytucjonalnej pamieci ustalen (index findings -> query przed nowym dokumentem -> wstrzykniecie pasujacych precedensow jako kontekst; lokalny, per-klient, confidence-decaying, evidence-linked). **NIE forkujemy** - cherry-pick patternu. Kod TypeScript Patrona pisany od zera w `backend/src/lib/precedent/`.

## Decyzja

Patron dostaje warstwe `backend/src/lib/precedent/` realizujaca **board ustalen per klient**. Po zatwierdzeniu deliverable istotne ustalenia (severity RED/YELLOW) sa indeksowane do boardu danego klienta. Przed nowa analiza dokumentu board jest odpytywany; pasujace precedensy (po typie ustalenia, jurysdykcji, typie dokumentu) sa wstrzykiwane jako **kontekst do rozwazenia przez prawnika**, oznaczone jako precedens (nie jako biezace ustalenie).

Szkic typu (poglad, nie finalna sygnatura):

```ts
// backend/src/lib/precedent/types.ts
interface PrecedentEntry {
  id: string;
  clientId: string;           // twarda izolacja - namespace per klient (Art. 5)
  findingType: string;        // np. "klauzula-limitacji-odpowiedzialnosci"
  severity: 'RED' | 'YELLOW' | 'GREEN';
  jurisdiction: string;       // "PL" | "EU" | ...
  documentType: string;       // "umowa-dostawy" | "NDA" | ...
  evidenceRef: string;        // wskaznik do zrodlowego ustalenia (sprawa + lokalizacja), NIE tresc
  confidence: number;         // maleje w czasie (decay), clamp [0,1]
  createdAt: string;
}
```

## Co bierzemy z precedent-board (cherry-pick)

1. **Index findings po przetworzeniu** - po zatwierdzeniu deliverable znaczace ustalenia laduja do boardu.
2. **Query-before-process** - przed analiza nowego dokumentu board zwraca pasujace precedensy jako kontekst.
3. **Per-client isolation** - osobny namespace per `client_id`; zero cross-client leakage (twardy wymog Art. 5).
4. **Confidence decay** - pewnosc precedensu maleje w czasie (stare ustalenie moze byc nieaktualne wobec zmiany prawa); clamp [0,1], NaN-safe daty.
5. **Evidence-linked** - kazdy wpis wskazuje zrodlowe ustalenie, nie przechowuje tresci (Art. 7).

## Czego NIE bierzemy

- **Claw daemon** (autonomiczny watcher folderu + inference w tle) - Patron przetwarza na zadanie Operatora, nie autonomicznie. Autonomiczny agent czytajacy akta bez wyzwolenia czlowieka koliduje z Art. 6.
- **Notyfikacje Telegram** - kanal zewnetrzny, dane sprawy nie wychodza poza serwer (Art. 1).
- **Model "outcome" Lavern** (semantyka US) - zastepujemy wlasna taksonomia ustalen PL (typy klauzul, jurysdykcje PL/EU).
- **Auto-stosowanie precedensu** - precedens nigdy nie staje sie automatycznie ustaleniem biezacej sprawy (Art. 6); zawsze przechodzi przez prawnika.

## Konsekwencje

**Pozytywne**:
- Kancelaria nie analizuje tej samej klauzuli od zera za kazdym razem - "tej klauzuli typu X juz raz przyjrzelismy sie w sprawie tego klienta" (oszczednosc czasu, spojnosc ocen).
- Spojnosc kwalifikacji w obrebie klienta - ta sama klauzula nie dostaje raz RED, raz GREEN bez powodu.
- Evidence-link + hash-chain = pelny audyt, skad wzial sie kontekst (AI Act art. 12).

**Negatywne / koszty**:
- Nowa warstwa `lib/precedent/` + store + testy izolacji per klient - **~4 tygodnie dev** (19 dni roboczych wg planu T1-T6, do walidacji w T1).
- Ryzyko "kotwiczenia" - prawnik moze bezkrytycznie powielic stary precedens. Mitigacja: precedens jawnie oznaczony, confidence widoczna, Art. 6 wymusza potwierdzenie.

**Ryzyka**:
- **Cross-client leakage** to najpowazniejsze ryzyko - precedens klienta A pokazany przy kliencie B = naruszenie tajemnicy. **Mitigacja**: izolacja na poziomie namespace + test bezpieczenstwa wymuszajacy, ze query dla `client_id=B` nigdy nie zwroci wpisu `client_id=A` (obowiazkowy test T2).
- Nieaktualny precedens po zmianie prawa - mitigacja przez confidence decay (ADR-0009) + jurisdiction/data w kontekscie.

## Plan implementacji

| Faza | Zakres | Czas |
|---|---|---|
| **T1** | Typy `PrecedentEntry` + store `lib/precedent/` (persystencja lokalna, atomic writes, NaN-safe daty, clamp confidence). Tests schematu. | 4 dni |
| **T2** | Izolacja per klient + **test bezpieczenstwa cross-client** (query `client_id=B` nigdy nie zwraca wpisu A - test obowiazkowy, bramka Art. 5). | 3 dni |
| **T3** | Indexer (po zatwierdzeniu deliverable -> wpis RED/YELLOW do boardu, przez warstwe pseudonim ADR-0003). | 3 dni |
| **T4** | Query + wstrzykniecie kontekstu (match po findingType/jurisdiction/documentType, oznaczenie "precedens", confidence widoczna). Log w hash-chain (ADR-0001). | 4 dni |
| **T5** | Confidence decay + integracja z nocna konsolidacja (ADR-0009). Tests decay. | 3 dni |
| **T6** | `docs/precedent-board.md` + sekcja w USER_GUIDE (jak prawnik widzi i odrzuca precedens). | 2 dni |

**Lacznie**: ~4 tygodnie dev (19 dni roboczych: 4+3+3+4+3+2). Zalezne wstepnie od ADR-0003 (pseudonim) - tekst ustalenia idzie przez pseudonim przed zapisem.

**Bumpa Konstytucji**: NIE. Ten ADR realizuje istniejace zasady (Art. 1/3/5/6/7), nie zmienia ich tresci.

## Marko-pl scope (przed merge)

ADR-0018 dostaje **2x runda Marko-pl** (regula [feedback_marko_2x_runda_pattern](../../../.claude/projects/C--Users-Wieslaw/memory/feedback_marko_2x_runda_pattern.md)). Zakres review:

1. Czy izolacja per klient jest faktycznie twarda (namespace), a nie filtrem aplikacyjnym do obejscia?
2. Czy "precedens sugeruje, nie decyduje" jest egzekwowane w przeplywie (Art. 6), czy tylko zadeklarowane?
3. Czy board faktycznie nie przechowuje tresci/PII (Art. 7), tylko metadane + evidence-ref?
4. Czy nie ma kolizji z ADR-0007 (retrieval) - kto czego uzywa, gdzie granica.
5. Czy plan T1-T6 ma test cross-client leakage jako bramke (nie "nice to have").

## Zalaczniki

- [precedent-board.ts (Lavern)](https://github.com/AnttiHero/lavern/blob/main/src/claw/precedent-board.ts) - pattern zrodlowy (do walidacji w T1)
- [Konstytucja v1.1.1 Art. 5](../CONSTITUTION.md) - tajemnica zawodowa (rdzen izolacji)
- [ADR-0007](./0007-hybrid-retrieval-vec-bm25-graph.md) - retrieval dokumentow (warstwa odrebna)
- [ADR-0009](./0009-overnight-memory-consolidation.md) - nocna konsolidacja (decay boardu)
