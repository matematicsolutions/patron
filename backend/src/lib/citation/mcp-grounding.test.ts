// ADR-0146: testy groundingu cytatow MCP (deterministyczne, offline).
import { describe, it, expect } from "vitest";
import {
    extractQuotedSpans,
    groundMcpCitations,
    matchQuoteInSource,
    mcpCitationKey,
    mcpGroundingSummary,
    type McpSourceText,
} from "./mcp-grounding";
import type { McpCitation } from "../mcp/types";

const KIS_TEXT = `Interpretacja indywidualna 0114-KDIP3-1.4011.844.2024.2.MS2 z 2025-01-10.
W świetle art. 10 ust. 1 pkt 8 ustawy o PIT źródłem przychodów jest odpłatne zbycie
nieruchomości, jeżeli nie następuje w wykonaniu działalności gospodarczej i zostało
dokonane przed upływem pięciu lat, licząc od końca roku kalendarzowego, w którym
nastąpiło nabycie. W przypadku nabycia w drodze spadku okres pięcioletni liczy się od
końca roku, w którym nastąpiło nabycie lub wybudowanie nieruchomości przez spadkodawcę.
Stanowisko Wnioskodawcy jest prawidłowe.`;

const KIS_CIT: McpCitation = {
    source: "mcp",
    server: "eureka",
    tool: "get_interpretation",
    title: "0114-KDIP3-1.4011.844.2024.2.MS2",
    url: "https://eureka.mf.gov.pl/informacje/podglad/123",
};

const src = (over: Partial<McpSourceText> = {}): McpSourceText => ({
    server: "eureka",
    tool: "get_interpretation",
    text: KIS_TEXT,
    citationKeys: [mcpCitationKey(KIS_CIT)],
    ...over,
});

describe("extractQuotedSpans", () => {
    it("wyciaga blockquote (wielolinijkowy) i cudzyslowy w prozie; pomija krotkie i <CITATIONS>", () => {
        const answer = [
            "Zgodnie z interpretacja KIS:",
            "> W przypadku nabycia w drodze spadku okres pięcioletni liczy się od końca roku,",
            "> w którym nastąpiło nabycie przez spadkodawcę.",
            "",
            'Organ dodaje, że „stanowisko Wnioskodawcy jest prawidłowe w całości” oraz mówi o „ustawie o PIT”.',
            "<CITATIONS>[{\"ref\":1,\"doc_id\":\"x\",\"quote\":\"to jest cytat dokumentowy o dlugosci wielu slow\"}]</CITATIONS>",
        ].join("\n");
        const spans = extractQuotedSpans(answer);
        expect(spans.map((s) => s.kind)).toEqual(["blockquote", "inline"]);
        expect(spans[0].quote).toContain("okres pięcioletni liczy się od końca roku, w którym");
        expect(spans[1].quote).toBe("stanowisko Wnioskodawcy jest prawidłowe w całości");
    });

    it("zdejmuje markdown (pogrubienie, znaczniki [n]) i zewnetrzne cudzyslowy z blockquote", () => {
        const spans = extractQuotedSpans('> **„Stanowisko Wnioskodawcy jest prawidłowe”** [1]');
        expect(spans).toHaveLength(1);
        expect(spans[0].quote).toBe("Stanowisko Wnioskodawcy jest prawidłowe");
    });

    it("pusta odpowiedz = brak spanow", () => {
        expect(extractQuotedSpans("")).toEqual([]);
        expect(extractQuotedSpans("Bez cytatow, sama proza.")).toEqual([]);
    });
});

describe("matchQuoteInSource", () => {
    it("doslowny fragment = ZWERYFIKOWANY (ratio 0), niezaleznie od cudzyslowow/bialych znakow", () => {
        const r = matchQuoteInSource(
            "„okres pięcioletni liczy się od końca roku,\n w którym nastąpiło nabycie”",
            KIS_TEXT,
        );
        expect(r.status).toBe("ZWERYFIKOWANY");
        expect(r.ratio).toBe(0);
        expect(r.at).toBeGreaterThan(0);
    });

    it("drobna modyfikacja = ZMODYFIKOWANY (kotwice znajduja okno)", () => {
        const r = matchQuoteInSource(
            "okres pięcioletni liczy sie od konca roku, w ktorym nastapilo nabycie",
            KIS_TEXT,
        );
        expect(r.status).toBe("ZMODYFIKOWANY");
        expect(r.ratio).toBeGreaterThan(0);
        expect(r.ratio).toBeLessThanOrEqual(0.15);
    });

    it("zmyslony 'doslowny cytat' = NIEZWERYFIKOWANY", () => {
        const r = matchQuoteInSource(
            "Sprzedaż nieruchomości nabytej w spadku po upływie trzech lat jest zwolniona z podatku w każdym przypadku",
            KIS_TEXT,
        );
        expect(r.status).toBe("NIEZWERYFIKOWANY");
    });

    it("luki [...] w cytacie sa dozwolone (segmenty w kolejnosci)", () => {
        const r = matchQuoteInSource(
            "źródłem przychodów jest odpłatne zbycie [...] przed upływem pięciu lat",
            KIS_TEXT,
        );
        expect(r.status).toBe("ZWERYFIKOWANY");
    });

    it("dlugie zrodlo (200k znakow) - dopasowanie tolerant konczy sie szybko", () => {
        const long = "lorem ipsum dolor sit amet ".repeat(8000) + KIS_TEXT;
        const t0 = Date.now();
        const r = matchQuoteInSource(
            "okres pięcioletni liczy sie od konca roku, w ktorym nastapilo nabycie",
            long,
        );
        expect(r.status).toBe("ZMODYFIKOWANY");
        expect(Date.now() - t0).toBeLessThan(2000);
    });
});

describe("groundMcpCitations - werdykty per cytat i per karta", () => {
    it("PRZYPADEK 08-17: blockquote 'doslowny cytat KIS' nie wystepuje w zrodle -> red na cytacie I na karcie", () => {
        const answer = [
            "KIS w interpretacji 0114-KDIP3-1.4011.844.2024.2.MS2 stwierdza:",
            "> Sprzedaż nieruchomości nabytej w spadku po upływie trzech lat od śmierci spadkodawcy",
            "> nie podlega opodatkowaniu, niezależnie od daty nabycia przez spadkodawcę.",
        ].join("\n");
        const rep = groundMcpCitations({ answerText: answer, sources: [src()], citations: [KIS_CIT] });
        expect(rep.summary).toMatchObject({ quotes: 1, red: 1, green: 0, sources: 1, cards: 1 });
        expect(rep.quotes[0].verdict).toBe("red");
        expect(rep.quotes[0].citationKey).toBe(mcpCitationKey(KIS_CIT));
        expect(rep.perCitation[mcpCitationKey(KIS_CIT)]).toMatchObject({
            verdict: "red",
            reason: "quote_not_found",
        });
    });

    it("cytat doslowny znaleziony -> green na cytacie i karcie", () => {
        const answer = "> W przypadku nabycia w drodze spadku okres pięcioletni liczy się od końca roku";
        const rep = groundMcpCitations({ answerText: answer, sources: [src()], citations: [KIS_CIT] });
        expect(rep.quotes[0]).toMatchObject({ verdict: "green", status: "ZWERYFIKOWANY", citationKey: mcpCitationKey(KIS_CIT) });
        expect(rep.perCitation[mcpCitationKey(KIS_CIT)]).toMatchObject({ verdict: "green", reason: "quote_found", matched: 1 });
    });

    it("brak doslownego cytatu w odpowiedzi -> karta yellow 'no_quote' (nie zweryfikowano), zero red", () => {
        const rep = groundMcpCitations({
            answerText: "Zdaniem KIS okres liczy sie od nabycia przez spadkodawce (parafraza).",
            sources: [src()],
            citations: [KIS_CIT],
        });
        expect(rep.quotes).toHaveLength(0);
        expect(rep.perCitation[mcpCitationKey(KIS_CIT)]).toMatchObject({ verdict: "yellow", reason: "no_quote" });
    });

    it("brak tekstu zrodla -> karta yellow 'no_source', NIGDY green", () => {
        const rep = groundMcpCitations({
            answerText: "> W przypadku nabycia w drodze spadku okres pięcioletni liczy się od końca roku",
            sources: [src({ text: "" })],
            citations: [KIS_CIT],
        });
        expect(rep.perCitation[mcpCitationKey(KIS_CIT)]).toMatchObject({ verdict: "yellow", reason: "no_source" });
        // Bez tekstu zrodla nie mowimy "nie wystepuje" (red) tylko "nie zweryfikowano" (yellow).
        expect(rep.quotes[0]).toMatchObject({ verdict: "yellow", status: "BRAK_ZRODLA" });
        expect(rep.quotes[0].citationKey).toBeUndefined();
    });

    it("span obecny w tekscie WYKLUCZONYM (cytat dokumentowy / wiadomosc usera) jest pomijany", () => {
        const userMsg = "Klient pisze: „proszę o analizę sprzedaży mieszkania nabytego po babci w 2021 roku”.";
        const answer = "Pytanie brzmi: „proszę o analizę sprzedaży mieszkania nabytego po babci w 2021 roku”.";
        const rep = groundMcpCitations({
            answerText: answer,
            sources: [src()],
            citations: [KIS_CIT],
            excludeTexts: [userMsg],
        });
        expect(rep.quotes).toHaveLength(0);
    });

    it("listing wynikow (wiele kart z jednego wywolania): trafienie przypisane do karty poprzedzajacej fragment", () => {
        const c1: McpCitation = { source: "mcp", server: "saos", tool: "search", title: "I ACa 1/20", url: "https://saos/1" };
        const c2: McpCitation = { source: "mcp", server: "saos", tool: "search", title: "II CSK 2/21", url: "https://saos/2" };
        const listing = [
            "1. I ACa 1/20 - SA w Krakowie: Sąd oddalił powództwo w całości z uwagi na przedawnienie roszczenia.",
            "2. II CSK 2/21 - SN: Klauzula spreadu walutowego jest abuzywna i nie wiąże konsumenta od chwili zawarcia umowy.",
        ].join("\n");
        const rep = groundMcpCitations({
            answerText: 'SN stwierdził, że „klauzula spreadu walutowego jest abuzywna i nie wiąże konsumenta”.',
            sources: [{ server: "saos", tool: "search", text: listing, citationKeys: [mcpCitationKey(c1), mcpCitationKey(c2)] }],
            citations: [c1, c2],
        });
        expect(rep.quotes[0].verdict).toBe("green");
        expect(rep.quotes[0].citationKey).toBe(mcpCitationKey(c2));
        expect(rep.perCitation[mcpCitationKey(c2)].verdict).toBe("green");
        expect(rep.perCitation[mcpCitationKey(c1)]).toMatchObject({ verdict: "yellow", reason: "no_quote" });
    });

    it("red bez jednoznacznego przypisania (wiele kart, brak kotwic) zostaje na poziomie odpowiedzi", () => {
        const c1: McpCitation = { source: "mcp", server: "saos", tool: "search", title: "I ACa 1/20", url: "https://saos/1" };
        const c2: McpCitation = { source: "mcp", server: "saos", tool: "search", title: "II CSK 2/21", url: "https://saos/2" };
        const rep = groundMcpCitations({
            answerText: "> Zupełnie zmyślony fragment orzeczenia o treści niewystępującej nigdzie w listingu wyników",
            sources: [{ server: "saos", tool: "search", text: "1. I ACa 1/20 tekst. 2. II CSK 2/21 tekst.", citationKeys: [mcpCitationKey(c1), mcpCitationKey(c2)] }],
            citations: [c1, c2],
        });
        expect(rep.quotes[0].verdict).toBe("red");
        expect(rep.quotes[0].citationKey).toBeUndefined();
        expect(rep.perCitation[mcpCitationKey(c1)].verdict).toBe("yellow");
        expect(rep.perCitation[mcpCitationKey(c2)].verdict).toBe("yellow");
        expect(mcpGroundingSummary(rep)).toMatchObject({ red: 1, cards_red: 0, cards: 2 });
    });

    it("summary audytowe niesie tylko liczby", () => {
        const s = mcpGroundingSummary(groundMcpCitations({ answerText: "", sources: [], citations: [] }));
        expect(s).toEqual({ quotes: 0, green: 0, yellow: 0, red: 0, sources: 0, cards: 0, cards_red: 0 });
        expect(mcpGroundingSummary(null)).toBeNull();
    });
});
