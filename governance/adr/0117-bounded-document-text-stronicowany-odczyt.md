# ADR-0117: Bounded document text (stronicowany odczyt dokumentu)

**Status**: Proponowany 2026-06-14. Konstytucja v1.5.0. Modul `document-window.ts` (pure core) gotowy, eksportowany, przetestowany; wpiecie jako narzedzie agenta `get_document_text` (tools.ts + tool-dispatch.ts) = rezerwacja (osobny ADR).

**Data**: 2026-06-14

**Powiazane zasady** (Konstytucja Patrona v1.5.0):
- **Art. 1 - Lokalnosc danych**: czysta funkcja na tekscie, ktory backend juz trzyma. Zero egress, zero LLM.
- **Art. 3 - Audytowalnosc**: deterministyczna - ten sam `(fullText, charOffset, maxChars)` daje zawsze to samo okno i ten sam `nextOffset`.
- **Art. 7 - Minimalnosc / rzetelnosc**: zwraca tylko zamowione okno z jawnym sygnalem `truncated`/`nextOffset` zamiast cichego ucinania. Pierwszy slice inicjatywy T1.1 (typed feed search->read->cite) z adopcji OpenContracts.

**Powiazane ADR**:
- ADR-0116 (trwaly lokator cytatu) - okno zwraca offsety w surowym tekscie; lokator (0116) buduje sie na tych samych offsetach UTF-16. `get_document_text` + `reanchor` to komplet read->cite.
- ADR-0005 (grounding) / ADR-0007/0054 (retrieval) - okno nie zastepuje wyszukiwania; to ograniczony odczyt PO znalezieniu dokumentu.

Inspiracja: Open-Source-Legal/OpenContracts (MIT), narzedzie MCP `get_document_text(char_offset, max_chars)` - bounded slice pagination jako ochrona przed zalaniem kontekstu. Patrz THIRD_PARTY_INSPIRATIONS.md. Bierzemy WZORZEC (kontrakt okna), nie kod.

---

## Kontekst

Dzis `read_document` i `fetch_documents` (`lib/chat/tool-dispatch.ts`) zwracaja **caly** tekst dokumentu do agenta. Dla aktualnych akt (umowy, postanowienia, zalaczniki na setki stron) to dwa realne problemy:

1. **Zalanie okna kontekstu** - jeden duzy dokument wypiera z kontekstu cala reszte rozmowy i innych zrodel.
2. **Koszt** - model placi za kazdy token wejscia przy kazdej turze; zrzut calego dokumentu mnozy koszt bez potrzeby.

OpenContracts rozwiazuje to `get_document_text(char_offset, max_chars)` z jawnym `next_offset`/`truncated` - agent czyta dokument oknami, kontynuujac tylko gdy potrzebuje. Brakuje tego w Patronie; `find_in_document` daje tylko trafienia z kontekstem, nie sekwencyjny odczyt zakresu.

---

## Decyzja

Dodac modul `backend/src/lib/chat/document-window.ts` - czysty rdzen stronicowania (zero IO), ktory przyszle narzedzie `get_document_text` opakuje wokol `readDocumentContent`.

### Kontrakt `boundedDocumentText(fullText, charOffset?, maxChars?)`

Zwraca `DocumentWindow`:
```ts
interface DocumentWindow {
  text: string;              // okno fullText.slice(charOffset, end)
  charOffset: number;        // faktyczny (zaciety do [0, totalChars]) start
  maxChars: number;          // faktyczny (zaciety do [1, HARD_MAX_CHARS]) limit
  totalChars: number;        // pelna dlugosc dokumentu (UTF-16)
  nextOffset: number | null; // end gdy zostalo wiecej, inaczej null
  truncated: boolean;        // true gdy okno != caly dokument
}
```

- `DEFAULT_MAX_CHARS = 50_000`, `HARD_MAX_CHARS = 200_000` (lustro OpenContracts; do strojenia na korpusie pilotazowym).
- Zacinanie wejscia jest jawne i audytowalne: `charOffset` do `[0, totalChars]`, `maxChars` do `[1, HARD_MAX_CHARS]`.
- `nextOffset` to jedyny kanal kontynuacji - iterujac `charOffset := nextOffset` az do `null` agent odtwarza caly dokument.
- Offsety UTF-16 (spojnie z ADR-0116 / copySpan / ExtractedEntity).

### Co pozostaje zarezerwowane (nie w 0117)

1. **Wpiecie narzedzia `get_document_text`** w `tools.ts` (schema) + `tool-dispatch.ts` (branch) z `readDocumentContent` i scopingiem `projectId -> documents -> documentIds` - osobny ADR (dotyka powierzchni narzedzi agenta).
2. **Ciecie po granicy semantycznej** (nie ucinaj w polowie zdania/akapitu) - v1 tnie po znaku. Granica = rezerwacja.
3. **Mapowanie okna na strony PDF** (`[Page N]`) - osobny temat (page-tagging), poza zakresem.

---

## Konsekwencje

**Pozytywne**:
- Agent czyta duze akta oknami zamiast zrzutu calosci - mniejszy koszt, brak zalania kontekstu (Art. 7).
- `nextOffset`/`truncated` to jawny, audytowalny sygnal niekompletnosci - nigdy ciche uciecie.
- Offsety okna sa wprost zywnoscia dla lokatora ADR-0116 (read->cite jednym ukladem offsetow).
- Czysta funkcja, zero zaleznosci, deterministyczna - trywialna do testu i do wpiecia.

**Negatywne / koszt**:
- v1 tnie po znaku UTF-16, wiec okno moze rozcinac zdanie albo (rzadko) pare surogatow na granicy. Swiadomy wybor; ciecie po granicy = rezerwacja. Agent i tak sklada okna po `nextOffset`.
- Domyslny `maxChars` (50k) i twardy limit (200k) sa zgadywane z OpenContracts - do strojenia benchmarkiem na korpusie PL.

**Bramki PRZED merge**:
- TSC clean (backend): `tsc --noEmit` exit 0.
- Testy zielone: `src/lib/chat/document-window.test.ts` (cala zawartosc miesci sie -> truncated false/nextOffset null; pierwsze/srodkowe/ostatnie okno; charOffset poza zakresem -> puste okno; offset/maxChars ujemne i powyzej limitu -> zaciecie; pusty tekst; round-trip po nextOffset odtwarza caly tekst) plus pelny backend bez regresji.
- Marko 2x na tym ADR przed merge. Merge na osobnej galezi, bramka private-remote przed push.
