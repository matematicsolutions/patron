# ADR-0121: Lokator tolerujacy roznice bialych znakow (whitespace-loose)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. `locatorFromCollapsedQuote` w locator.ts; wpiete jako fallback w `ground-citations.ts` (po exact). Stacked na ADR-0116/0120 (branch feat/oc-locator-loose-match na feat/oc-locator-rawtext, PR #3).

**Data**: 2026-06-14

**Powiazane zasady**: Art. 1 (offline, czysta funkcja), Art. 3 (deterministyczne mapowanie), Art. 7 (fail-closed: null gdy brak dopasowania; tylko whitespace tolerowany, wielkosc liter i interpunkcja musza sie zgadzac - brak falszywych trafien).

**Powiazane ADR**: ADR-0116 (lokator, `locatorFromQuote`), ADR-0120 (lokator przy groundingu - ten ADR podnosi jego trafialnosc), ADR-0007/0054 (indekser RAG, ktorego normalizacja chunka jest zrodlem roznicy).

---

## Kontekst

Lokator exact (`locatorFromQuote`, 0116) wymaga, by fragment wystepowal DOSLOWNIE w surowym zrodle. Ale dwa glowne zrodla cytatu roznia sie od surowego tekstu wylacznie **zwijaniem bialych znakow**:
- chunk RAG: indekser robi `text.replace(/\s+/g, " ")`,
- cytat LLM: model czesto normalizuje spacje/lamanie wierszy z dokumentu.

Skutkiem exact-only lokator w 0120/0118 byl `null` dla wiekszosci cytatow przekraczajacych granice wiersza. To NIE wymaga migracji (Route B) - roznica jest czysto whitespace'owa i odwracalna mapowaniem.

## Decyzja

Dodac `locatorFromCollapsedQuote(text, sourceText)` (locator.ts):
- zwija `\s+` -> `" "` w zapytaniu (i przycina), zwija zrodlo `collapseWhitespaceWithMap` budujac `map[]` (zwiniety indeks -> surowy indeks),
- znajduje zwiniete zapytanie w zwinietym zrodle, mapuje granice z powrotem na **surowy** span,
- zwraca `CitationLocator` z DOSLOWNYM surowym `rawText` (niezmiennik 0116 zachowany), bez wiodacych/koncowych bialych znakow.

Tolerowane sa WYLACZNIE biale znaki - wielkosc liter i interpunkcja musza sie zgadzac (zero falszywych trafien).

Wpiecie: w `ground-citations.ts` lokator liczony jako `locatorFromQuote(...) ?? locatorFromCollapsedQuote(...)` - exact ma pierwszenstwo, fallback podnosi trafialnosc. Zero dodatkowego I/O (zrodlo juz prefetchowane).

### Zarezerwowane
1. Pelna normalizacja (lowercase/cudzyslowy/myslniki jak grounding.normalize) z mapa - jezeli okaze sie potrzebna; 0121 celuje w dominujaca roznice (whitespace).
2. Uzycie w `search_corpus`->feed - tam koszt to N odczytow zrodla; sensowne dopiero z Route B (offsety w doc_chunks) albo swiadoma decyzja o koszcie.

---

## Konsekwencje

**Pozytywne**: drastycznie wyzsza trafialnosc trwalego lokatora dla zweryfikowanych cytatow (granice wierszy, podwojne spacje, tabulacje) bez migracji i bez dodatkowego I/O. Mapowanie deterministyczne, czysta funkcja, w pelni testowalne.

**Negatywne / koszt**: tolerancja ograniczona do whitespace; cytat rozniacy sie wielkoscia liter/interpunkcja dalej da null (swiadome - inaczej rosnie ryzyko falszywej kotwicy). Offsety UTF-16.

**Bramki PRZED merge**: TSC `--noEmit` exit 0 (spelnione); `src/lib/citation` + `src/lib/chat` 121/121 (spelnione, +6 testow: dopasowanie mimo whitespace, niezmiennik verbatim, brak tolerancji wielkosci liter, tabulacje, fallback w groundingu); Marko 2x; CHANGELOG przy merge; private-remote przed push.
