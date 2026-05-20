import { describe, expect, it } from "vitest";
import { extractMcpCitations } from "./index";

describe("extractMcpCitations", () => {
    it("zwraca puste gdy structuredContent jest undefined/null/skalary", () => {
        expect(extractMcpCitations(undefined, "saos", "search")).toEqual([]);
        expect(extractMcpCitations(null, "saos", "search")).toEqual([]);
        expect(extractMcpCitations("string", "saos", "search")).toEqual([]);
        expect(extractMcpCitations(42, "saos", "search")).toEqual([]);
    });

    it("zwraca puste gdy citations nie jest tablica", () => {
        expect(
            extractMcpCitations(
                { citations: "not-array" },
                "saos",
                "search",
            ),
        ).toEqual([]);
        expect(extractMcpCitations({}, "saos", "search")).toEqual([]);
    });

    it("mapuje pelny rekord SAOS", () => {
        const out = extractMcpCitations(
            {
                citations: [
                    {
                        title: "I ACa 772/13 - SA w Krakowie",
                        url: "https://www.saos.org.pl/judgments/12345",
                        snippet: "fragment uzasadnienia...",
                        case_number: "I ACa 772/13",
                        court: "SA w Krakowie",
                        judgment_date: "2013-11-20",
                        saos_id: 12345,
                    },
                ],
            },
            "saos",
            "search",
        );
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            source: "mcp",
            server: "saos",
            tool: "search",
            title: "I ACa 772/13 - SA w Krakowie",
            url: "https://www.saos.org.pl/judgments/12345",
            snippet: "fragment uzasadnienia...",
        });
        // dodatkowe pola laduja w metadata
        expect(out[0].metadata).toMatchObject({
            case_number: "I ACa 772/13",
            court: "SA w Krakowie",
            judgment_date: "2013-11-20",
            saos_id: 12345,
        });
    });

    it("akceptuje rekord z samym tytulem (bez url)", () => {
        const out = extractMcpCitations(
            { citations: [{ title: "tylko tytul" }] },
            "saos",
            "search",
        );
        expect(out).toHaveLength(1);
        expect(out[0].url).toBeUndefined();
    });

    it("akceptuje rekord z samym url (bez tytulu)", () => {
        const out = extractMcpCitations(
            { citations: [{ url: "https://example.org/a" }] },
            "saos",
            "search",
        );
        expect(out).toHaveLength(1);
        expect(out[0].title).toBeUndefined();
    });

    it("odrzuca rekord bez title i url", () => {
        const out = extractMcpCitations(
            { citations: [{ snippet: "tylko snippet" }] },
            "saos",
            "search",
        );
        expect(out).toEqual([]);
    });

    it("zachowuje kolejnosc i pomija nie-obiekty", () => {
        const out = extractMcpCitations(
            {
                citations: [
                    { title: "A", url: "https://a" },
                    null,
                    "string",
                    { title: "B", url: "https://b" },
                ],
            },
            "saos",
            "search",
        );
        expect(out.map((c) => c.title)).toEqual(["A", "B"]);
    });

    it("merge metadata podanego przez serwer + dodatkowe pola", () => {
        const out = extractMcpCitations(
            {
                citations: [
                    {
                        title: "T",
                        extra: "x",
                        metadata: { foo: "bar" },
                    },
                ],
            },
            "isap",
            "lookup",
        );
        expect(out[0].metadata).toMatchObject({ extra: "x", foo: "bar" });
    });

    it("uzywa przekazanego servera i toola w outpucie", () => {
        const out = extractMcpCitations(
            { citations: [{ title: "T", url: "https://x" }] },
            "ksiega-wieczysta",
            "get_kw",
        );
        expect(out[0].server).toBe("ksiega-wieczysta");
        expect(out[0].tool).toBe("get_kw");
    });
});
