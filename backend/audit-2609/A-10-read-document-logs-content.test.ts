// A-10: readDocumentContent (lib/chat/tool-dispatch.ts:173-175) loguje na stdout pierwsze 120
// znakow tresci dokumentu sprawy (`firstChars=...`) oraz nazwy plikow przy kazdym read_document /
// fetch_documents / get_document_text / find_in_document. W trybie serwerowym (docker) stdout
// trafia do logow kontenera - poza audytem, retencja RODO i kontrola dostepu do spraw.
// Oczekiwane: logi operacyjne nie zawieraja tresci akt (co najwyzej dlugosc / identyfikator).
import { describe, it, expect, vi } from "vitest";

const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna
const DOC_TEXT = `Pozew. Powod Pan Jan Testowy, PESEL ${PESEL}, wnosi o zaplate.`;

vi.mock("../src/lib/storage", () => ({
    downloadFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4\n%synthetic\n").buffer),
    uploadFile: vi.fn(),
    storageKey: vi.fn(() => "k"),
}));
vi.mock("../src/lib/chat/pdf", () => ({ extractPdfText: vi.fn(async () => DOC_TEXT) }));

import { runToolCalls } from "../src/lib/chat/tool-dispatch";

describe("A-10 logi read_document zawieraja tresc akt", () => {
    it("console.log nie dostaje fragmentu tresci dokumentu", async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
            lines.push(a.map(String).join(" "));
        });
        const { toolResults } = await runToolCalls(
            [{ id: "c1", function: { name: "read_document", arguments: JSON.stringify({ doc_id: "doc-0" }) } }],
            new Map([["doc-0", { storage_path: "s/doc0.pdf", file_type: "pdf", filename: "pozew.pdf" }]]),
            "u1",
            {} as never,
            () => {},
        );
        spy.mockRestore();
        // Sanity: dokument zostal odczytany.
        expect(JSON.stringify(toolResults)).toContain(PESEL);
        const log = lines.join("\n");
        expect(log).not.toContain(PESEL);
        expect(log).not.toContain("Jan Testowy");
    });
});
