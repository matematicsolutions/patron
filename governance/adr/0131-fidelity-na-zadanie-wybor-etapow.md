# ADR-0131: Fidelity na żądanie - wybór etapów doskonalenia (zamiast wymuszonego pipeline)

**Status**: Przyjęty (2026-06-14)

## Kontekst

Panel „Doskonalę pismo" (`DraftRefinePanel`) uruchamiał pipeline obrony (ADR-0058
„Invisible AI") zawsze przez WSZYSTKIE trzy etapy: Recenzent -> Adwokat diabła ->
Pisz po ludzku. Każdy etap to osobne wywołanie LLM, więc jedno „doskonalenie" =
do 3 round-tripów. Backend (`/draft/refine`) domyślnie brał `ALL_STAGES`, gdy
żądanie nie wskazało etapów, a frontend nigdy ich nie wskazywał.

Skutek: długie oczekiwanie nawet wtedy, gdy mecenas chciał tylko lekką redakcję.
Pierwsze wrażenie u sceptycznego prawnika - „wolno = słabo" - jest decydujące i
nieodwracalne na starcie produktu (first-mover). Fidelity to wyróżnik, ale jako
WYMUSZONY pipeline obciąża każde wyjście latencją.

## Decyzja

Fidelity jest **opt-in i wybieralne per etap**, nie wymuszonym pipeline'em.

1. **Frontend**: panel pokazuje trzy checkboxy (Recenzent / Adwokat diabła / Pisz
   po ludzku). Domyślnie zaznaczony jeden, najszybszy i najuniwersalniejszy:
   „Pisz po ludzku" (1 przebieg). Mecenas dokłada Recenzenta/Adwokata, gdy chce
   głębszej pracy. Tryb adwokata (perspektywa) pokazywany tylko, gdy etap
   „adwokat" jest wybrany. Etapy wysyłane w kolejności kanonicznej niezależnie od
   kolejności klikania.
2. **Backend**: `/draft/refine` honoruje jawną listę `stages` (również pustą =
   brak etapów). `ALL_STAGES` pozostaje domyślną TYLKO gdy `stages` w żądaniu
   pominięto (kompatybilność API). `effectiveStages = requestedStages ?? ALL_STAGES`.

Pipeline obrony (`defense.ts`), maskowanie PII przed egressem (ADR-0068) i bramka
data-residency (ADR-0067) bez zmian - dotyczą każdego uruchomionego etapu.

## Konsekwencje

- (+) Domyślne „doskonalenie" = 1 wywołanie LLM zamiast 3 -> ~3x szybciej; lepsze
  pierwsze wrażenie na launch.
- (+) Fidelity nadal widoczne i dostępne (checkboxy) - wyróżnik nie znika, mecenas
  świadomie decyduje, kiedy zapłacić latencją za głębię.
- (+) Zgodne z zasadą agent-native: zdolność zostaje, użytkownik steruje, kiedy działa.
- (-) Domyślnie nie biegnie Recenzent ani Adwokat diabła - użytkownik musi je włączyć
  świadomie (akceptowalne; to właśnie cel).
- Rewiduje ADR-0058 w części „zawsze wszystkie etapy" -> „etapy na żądanie".

## Poza zakresem (v1.0.1)

- Dedykowane przyciski „Recenzja" / „Pisz po ludzku" wprost na gotowej odpowiedzi
  asystenta (bez otwierania pełnego panelu).
- Ewentualny tryb „pismo formalne" z domyślnie włączonym kompletem etapów.
- Asynchroniczny przebieg (stream surowej odpowiedzi + doskonalenie w tle).
