import { describe, expect, it } from "vitest";
import path from "path";
import { extractMcpCitations, resolveStdioSpawn } from "./index";

describe("resolveStdioSpawn (ADR-0134 poliglot runtime)", () => {
    const base = { name: "x", transport: "stdio" as const };

    it("http transport - bez zmian", () => {
        const cfg = { name: "h", transport: "http" as const, url: "http://x" };
        expect(resolveStdioSpawn(cfg)).toEqual(cfg);
    });

    it("node (bare) bez Electrona - command zostaje, arg .js rozwiazany", () => {
        const out = resolveStdioSpawn({
            ...base,
            command: "node",
            args: ["mcp-bundled/saos/dist/index.js"],
        });
        expect(out.command).toBe("node");
        expect(path.isAbsolute(out.args?.[0] ?? "")).toBe(true);
        expect((out.args?.[0] ?? "").endsWith("index.js")).toBe(true);
    });

    it("python frozen-exe - wzgledny command rozwiazany do absolutnego", () => {
        const out = resolveStdioSpawn({
            ...base,
            runtime: "python",
            command: "mcp-bundled/de-eli/de-eli-mcp.exe",
            args: [],
        });
        expect(path.isAbsolute(out.command ?? "")).toBe(true);
        expect((out.command ?? "").endsWith("de-eli-mcp.exe")).toBe(true);
    });

    it("python script - arg .py rozwiazany", () => {
        const out = resolveStdioSpawn({
            ...base,
            runtime: "python",
            command: "python",
            args: ["mcp-bundled/de-eli/server.py"],
        });
        expect(out.command).toBe("python");
        expect(path.isAbsolute(out.args?.[0] ?? "")).toBe(true);
        expect((out.args?.[0] ?? "").endsWith("server.py")).toBe(true);
    });

    it("absolutny command - bez zmian", () => {
        const abs = path.resolve("/opt/x/connector.exe");
        const out = resolveStdioSpawn({ ...base, command: abs, args: [] });
        expect(out.command).toBe(abs);
    });
});

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
