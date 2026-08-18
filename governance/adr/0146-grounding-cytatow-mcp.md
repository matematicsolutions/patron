# ADR-0146 — Grounding cytatow z konektorow MCP (spany cytowane vs tresc tool_result)

- **Status:** Przyjety (wdrozony 2026-08-18, `main`)
- **Data:** 2026-08-18
- **Galaz:** `main` (linia publiczna po scaleniu, ADR-0002 dual-license)
- **Zrodlo:** przebieg bojowy 2026-08-17 przed demo dla EY Polska (pomiar, nie hipoteza)
- **Mapuje na:** ADR-0005 (grounding cytatu z dokumentow), ADR-0097 (paraphrase judge, 3 kolory),
  ADR-0102 (kaskada), MCS v0.1 (`structuredContent.citations`)

## Kontekst

Cytaty z dokumentow kancelarii przechodza przez kaskade groundingu od ADR-0005: front pokazuje
plakietke green / yellow / red obok kazdego `[ref]`. Cytaty z **konektorow MCP** (SAOS, NSA,
ISAP, KRS, EUREKA, EUR-Lex, EU-Compliance) tej sciezki nie mialy: `groundCitationsByRef` liczy
werdykt wylacznie dla cytatow `<CITATIONS>` odwolujacych sie do `docStore`/`docIndex`, a
`mcp_citations` szly do UI osobnym zdarzeniem SSE, bez oceny.

**Pomiar 2026-08-17** (realne pytanie podatkowe, `gemini-3-flash-preview`, konektor `eureka`):
model odpowiedzial poprawnie co do tezy (art. 10 ust. 5 ustawy o PIT — piecioletni termin liczony
od nabycia przez spadkodawce), powolal **istniejaca** interpretacje (sygn.
`0114-KDIP3-1.4011.844.2024.2.MS2`, data 2024-12-27 zgodna ze zrodlem), a nastepnie podal
blockquote jako **doslowny cytat uzasadnienia organu**. String-match po normalizacji na PELNYM
dokumencie z API EUREKI: **0 z 4 zdan** tego blockquote'a nie wystepuje w zrodle. Kontrole
pozytywne sondy przeszly (sygnatura i slowo "spadkodawc" znalezione w tekscie 41 159 znakow),
wiec pomiar nie byl artefaktem.

To najgrozniejszy tryb porazki tej klasy produktu — **prawdziwe zrodlo pod niedoslownym
cytatem** — i dokladnie ten, przeciw ktoremu stoi haslo produktu ("AI, ktora wie, czego nie
wie"). UI milczal.

## Decyzja

Ugruntowac **spany, ktore model prezentuje jako doslowne cytaty**, wzgledem **tresci, ktora
konektor faktycznie zwrocil w tej turze**. Deterministycznie, offline, bez LLM.

1. **Wydobycie spanow** (`extractQuotedSpans`): blockquote'y markdown (`> ...`) oraz fragmenty
   w cudzyslowach (`„..."`, `"..."`, `«...»`) o sensownej dlugosci. To sa miejsca, w ktorych
   model TWIERDZI, ze cytuje. Spany wystepujace w tekstach wykluczonych (cytaty `<CITATIONS>`
   ugruntowane juz w ADR-0005, tresc wiadomosci uzytkownika) sa pomijane — tam model cytuje
   dokument kancelarii, nie zrodlo MCP.
2. **Dopasowanie** (`matchQuoteInSource`): ten sam algorytm co ADR-0005 (exact -> tolerant po
   normalizacji), ale zrodlem jest **tekst `tool_result`**, ktory model widzial, nie to, co
   pamieta. Wydajnosc: bez przesuwania okna edit-distance po calym orzeczeniu — najpierw
   kotwice (shingle cytatu), odleglosc liczona tylko w oknach wokol trafien; brak kotwic =
   niezweryfikowany.
3. **Werdykt trojstanowy** per cytat i per karta zrodla: `green` (cytat doslownie w zrodle),
   `yellow` (dopasowanie przyblizone / brak cytatu do sprawdzenia / brak tekstu zrodla),
   `red` (cytat podany jako doslowny NIE wystepuje w zrodle, przy jednoznacznym przypisaniu do
   karty). Cytaty `red` bez jednoznacznego przypisania ida na poziom odpowiedzi jako **baner** —
   nigdy cicho.
4. **Brak tekstu zrodla = `yellow`, nigdy `green`.** Blad samego groundingu tez nie jest cichy:
   UI dostaje `mcp_grounding` z `error` i pokazuje "nie zweryfikowano".

## Konsekwencje

- Kontrakt SSE: nowe zdarzenie `mcp_grounding` (po `mcp_citations`), pola `quotes`, `summary`,
  `perCitation` (klucz = `mcpCitationKey`). Zdarzenie leci tylko, gdy w turze byly zrodla MCP.
- Trwalosc: raport zapisywany jako jedna adnotacja `mcp_grounding` (persistence), wiec baner i
  plakietki przetrwaja reload rozmowy.
- Audyt (AI Act art. 12): payload `chat.message.assistant` dostaje `mcp_grounding` — **wylacznie
  liczby** (`quotes/green/yellow/red/sources/cards/cards_red`), zero tresci cytatow. Bez nowego
  `event_type`, wiec bez piatki mirrorow CHECK.
- Warstwa **doradcza**: nie blokuje odpowiedzi (jak verdict z ADR-0097). Prawnik dostaje sygnal,
  gdzie model twierdzi "cytuje", a zrodlo tego nie mowi.
- Zakres: sprawdzamy **ISTNIENIE** tekstu, nie WSPARCIE tezy (gradient ISTNIENIE / TRESC /
  FRAGMENT). Etap semantyczny (sedzia lokalny nad cytatem MCP) = rezerwacja na ADR-0147.
- Wiadomosci sprzed tego ADR nie maja werdyktu i **nie dostaja plakietki** (brak != green).

## Alternatywy odrzucone

- **Przepuscic `mcp_citations` przez istniejacy `groundCitationsByRef`:** odrzucone — ta funkcja
  kotwiczy w `docStore`/`docIndex` (dokumenty kancelarii z chunkami i offsetami). Zrodlo MCP jest
  efemeryczne (tekst jednej odpowiedzi narzedzia), nie ma id dokumentu ani indeksu.
- **Sedzia semantyczny (LLM) od razu:** odrzucone na ten etap — sedzia jest LOCAL-ONLY, a na
  maszynie bez GPU 18-19 min na orzeczenie (pomiar 2026-08-05). Istnienie cytatu rozstrzyga
  string-match w milisekundach; osad semantyczny to osobna decyzja i osobny koszt.
- **Blokowanie odpowiedzi przy `red`:** odrzucone — grounding jest doradczy; blokada zamienia
  narzedzie prawnika w bramke, ktora zaczyna sie obchodzic. Sygnal ma byc widoczny, nie karzacy.
- **Ocena tylko per karta (bez spanow):** odrzucone — karta zrodla moze byc prawdziwa, gdy sam
  cytat jest zmyslony; to bylby ten sam blad, ktory pomiar wykryl.
- **Milczenie przy braku tekstu zrodla:** odrzucone — cisza jest nierozroznialna od "sprawdzone".
