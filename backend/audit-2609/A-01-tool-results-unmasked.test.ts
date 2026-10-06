// A-01: Wyniki narzedzi czatu (read_document / fetch_documents / get_document_text /
// find_in_document / search_corpus / recall / read_table_cells) wracaja do modelu
// chmurowego BEZ pseudonimizacji - wrapConversation obejmuje tylko system prompt i
// wiadomosci na starcie tury (lib/chat/stream.ts:362-377), a runTools zwraca surowa
// tresc akt (stream.ts:575-581) wprost do kolejnego wywolania providera.
// Oczekiwane: tresc dokumentu klienta wysylana do modelu chmurowego przechodzi przez
// ta sama sciezke maskowania co wiadomosci (PESEL/e-mail/osoba po kotwicy nie
// pojawiaja sie jawnym tekstem w wyniku narzedzia oddawanym providerowi).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Syntetyczne dane (PESEL z poprawna suma kontrolna, wygenerowany).
const PESEL = "90010112349";
const EMAIL = "jan.testowy@example.com";
const DOC_TEXT = `Powod: Pan Jan Testowy, PESEL ${PESEL}, e-mail ${EMAIL}. Pozwany: Pan Adam Probny.`;

const captured: { params?: any; toolResults?: { tool_use_id: string; content: string }[] } = {};

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model najgorszego przypadku: od razu prosi o read_document.
        streamChatWithTools: vi.fn(async (params: any) => {
            captured.params = params;
            captured.toolResults = await params.runTools([
                { id: "c1", name: "read_document", input: { doc_id: "doc-0" } },
            ]);
            params.callbacks?.onContentDelta?.("Gotowe.");
            return { fullText: "Gotowe." };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return { ...orig, getMcpTools: vi.fn(async () => []) };
});
vi.mock("../src/lib/storage", () => ({
    downloadFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4\n%synthetic\n").buffer),
    uploadFile: vi.fn(),
    storageKey: vi.fn(() => "k"),
}));
vi.mock("../src/lib/chat/pdf", () => ({
    extractPdfText: vi.fn(async () => DOC_TEXT),
}));

import { runLLMStream } from "../src/lib/chat/stream";

function fakeDb(tables: Record<string, any[]>) {
    const inserts: { table: string; row: any }[] = [];
    const db: any = {
        inserts,
        from(table: string) {
            const rows = tables[table] ?? [];
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, neq: () => b, is: () => b, gt: () => b, lt: () => b,
                insert: (row: any) => { inserts.push({ table, row }); return b; },
                single: async () => ({ data: rows[0] ?? null, error: null }),
                maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
            };
            return b;
        },
    };
    return db;
}

describe("A-01 wyniki narzedzi do modelu chmurowego bez maskowania", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        // Domyslne ustawienia instalatora desktop (desktop/main.js:211-212).
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
        delete process.env.PATRON_PSEUDONIM_EGRESS;
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("tresc dokumentu z read_document oddawana providerowi chmurowemu jest zamaskowana", async () => {
        const db = fakeDb({
            projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }],
        });
        const out: string[] = [];
        vi.spyOn(console, "log").mockImplementation(() => {});
        await runLLMStream({
            apiMessages: [
                { role: "system", content: "Jestes asystentem." },
                { role: "user", content: "Streszcz dokument doc-0." },
            ],
            docStore: new Map([["doc-0", { storage_path: "s/doc0.pdf", file_type: "pdf", filename: "pozew.pdf" }]]),
            docIndex: {},
            userId: "u1",
            db,
            write: (s) => out.push(s),
            model: "openrouter/google/gemini-3-flash-preview",
            projectId: "p1",
        });

        // Sanity: sciezka maskowania wiadomosci byla aktywna (egress chmurowy).
        expect(captured.params.model).toMatch(/^openrouter\//);
        const toolContent = captured.toolResults?.[0]?.content ?? "";
        // Sanity: narzedzie faktycznie zwrocilo tresc dokumentu.
        expect(toolContent).toContain("Pozwany");
        // ZADANE: identyfikatory klienta nie wychodza jawnym tekstem.
        expect(toolContent).not.toContain(PESEL);
        expect(toolContent).not.toContain(EMAIL);
        expect(toolContent).not.toContain("Jan Testowy");
    });
});
