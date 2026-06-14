import { describe, expect, it } from "vitest";
import { extractAnnotations } from "./persistence";
import type { DocIndex, EditAnnotation } from "./types";
import type { McpCitation } from "../mcp";

describe("extractAnnotations", () => {
    const docIndex: DocIndex = {
        "doc-0": {
            document_id: "uuid-a",
            filename: "nda.docx",
            version_id: "v1",
            version_number: 1,
        },
    };

    it("zwraca pusta tablice dla pustego inputu", () => {
        expect(extractAnnotations("", {}, [], [])).toEqual([]);
    });

    it("ekstrahuje cytaty dokumentowe z bloku <CITATIONS>", () => {
        const text = `Cos tam [1].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":2,"quote":"X"}]\n</CITATIONS>`;
        const out = extractAnnotations(text, docIndex) as Array<
            Record<string, unknown>
        >;
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            type: "citation_data",
            ref: 1,
            doc_id: "doc-0",
            document_id: "uuid-a",
            filename: "nda.docx",
            version_id: "v1",
            version_number: 1,
        });
    });

    it("ADR-0005: dolacza werdykt grounding (decision + status) do citation_data po ref", () => {
        const text = `A [1]. B [2].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":1,"quote":"X"},{"ref":2,"doc_id":"doc-0","page":1,"quote":"Y"}]\n</CITATIONS>`;
        const grounding = {
            1: {
                ref: 1,
                doc_id: "doc-0",
                status: "ZWERYFIKOWANY" as const,
                decision: "verified" as const,
                worstRatio: 0,
                offset: 5,
            },
            2: {
                ref: 2,
                doc_id: "doc-0",
                status: "NIEZWERYFIKOWANY" as const,
                decision: "blocked" as const,
                worstRatio: 0.9,
                offset: -1,
            },
        };
        const out = extractAnnotations(text, docIndex, [], [], grounding) as Array<
            Record<string, unknown>
        >;
        expect(out[0]).toMatchObject({
            ref: 1,
            grounding: "verified",
            grounding_status: "ZWERYFIKOWANY",
        });
        expect(out[1]).toMatchObject({
            ref: 2,
            grounding: "blocked",
            grounding_status: "NIEZWERYFIKOWANY",
        });
    });

    it("ADR-0123: persystuje locator z werdyktu (reload occurrence-highlight)", () => {
        const text = `A [1] B [2].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":1,"quote":"X"},{"ref":2,"doc_id":"doc-0","page":1,"quote":"Y"}]\n</CITATIONS>`;
        const grounding = {
            1: {
                ref: 1,
                doc_id: "doc-0",
                status: "ZWERYFIKOWANY" as const,
                decision: "verified" as const,
                worstRatio: 0,
                offset: 5,
                locator: { rawText: "X", startHint: 5, occurrenceHint: 2 },
            },
            // werdykt bez lokatora (np. niezweryfikowany) -> brak pola locator
            2: {
                ref: 2,
                doc_id: "doc-0",
                status: "NIEZWERYFIKOWANY" as const,
                decision: "blocked" as const,
                worstRatio: 0.9,
                offset: -1,
                locator: null,
            },
        };
        const out = extractAnnotations(text, docIndex, [], [], grounding) as Array<
            Record<string, unknown>
        >;
        expect(out[0]).toMatchObject({
            ref: 1,
            grounding: "verified",
            locator: { rawText: "X", startHint: 5, occurrenceHint: 2 },
        });
        expect(out[1]).not.toHaveProperty("locator");
    });

    it("ADR-0123: bez mapy grounding citation_data NIE ma pola locator (backward-compat)", () => {
        const text = `A [1].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":1,"quote":"X"}]\n</CITATIONS>`;
        const out = extractAnnotations(text, docIndex) as Array<
            Record<string, unknown>
        >;
        expect(out[0]).not.toHaveProperty("locator");
    });

    it("ADR-0005: bez mapy grounding citation_data NIE ma pola grounding (backward-compat)", () => {
        const text = `A [1].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":1,"quote":"X"}]\n</CITATIONS>`;
        const out = extractAnnotations(text, docIndex) as Array<
            Record<string, unknown>
        >;
        expect(out[0]).not.toHaveProperty("grounding");
    });

    it("dolacza edit annotations z eventu doc_edited z typem edit_data", () => {
        const edit: EditAnnotation = {
            kind: "edit",
            edit_id: "e1",
            document_id: "uuid-a",
            version_id: "v2",
            version_number: 2,
            change_id: "c1",
            deleted_text: "stary",
            inserted_text: "nowy",
            context_before: "przed",
            context_after: "po",
            status: "pending",
        };
        const events = [
            { type: "doc_edited", filename: "nda.docx", annotations: [edit] },
        ];
        const out = extractAnnotations("", docIndex, events) as Array<
            Record<string, unknown>
        >;
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            type: "edit_data",
            edit_id: "e1",
            kind: "edit",
        });
    });

    it("dolacza MCP citations z dyskryminatorem type=mcp_citation", () => {
        const mcpCitations: McpCitation[] = [
            {
                source: "mcp",
                server: "saos",
                tool: "search",
                title: "I ACa 772/13",
                url: "https://www.saos.org.pl/judgments/12345",
                snippet: "fragment",
                metadata: { case_number: "I ACa 772/13" },
            },
        ];
        const out = extractAnnotations(
            "",
            docIndex,
            [],
            mcpCitations,
        ) as Array<Record<string, unknown>>;
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            type: "mcp_citation",
            source: "mcp",
            server: "saos",
            tool: "search",
            title: "I ACa 772/13",
            url: "https://www.saos.org.pl/judgments/12345",
        });
    });

    it("miksuje wszystkie 3 typy (citation_data + edit_data + mcp_citation)", () => {
        const text = `[1]\n<CITATIONS>[{"ref":1,"doc_id":"doc-0","page":1,"quote":"X"}]</CITATIONS>`;
        const edit: EditAnnotation = {
            kind: "edit",
            edit_id: "e1",
            document_id: "uuid-a",
            version_id: "v2",
            change_id: "c1",
            deleted_text: "a",
            inserted_text: "b",
            context_before: "x",
            context_after: "y",
            status: "pending",
        };
        const out = extractAnnotations(
            text,
            docIndex,
            [
                {
                    type: "doc_edited",
                    filename: "nda.docx",
                    annotations: [edit],
                },
            ],
            [
                {
                    source: "mcp",
                    server: "saos",
                    tool: "search",
                    title: "T",
                    url: "https://x",
                },
            ],
        ) as Array<Record<string, unknown>>;
        expect(out).toHaveLength(3);
        const types = out.map((a) => a.type);
        expect(types).toEqual(["citation_data", "edit_data", "mcp_citation"]);
    });

    it("pomija MCP citations gdy parametr nie podany", () => {
        const out = extractAnnotations("", docIndex, []) as unknown[];
        expect(out).toEqual([]);
    });
});
