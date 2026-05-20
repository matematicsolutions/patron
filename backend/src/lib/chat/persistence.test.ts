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
