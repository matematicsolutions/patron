// A-09: Argumenty wywolan narzedzi MCP sa "odmaskowywane" (odtworzTokeny, lib/chat/stream.ts:37-49,
// 436-442) i wysylane do zewnetrznych konektorow MCP (runMcpTool, lib/mcp/index.ts:545-549) bez
// zadnej kontroli PII, bez straznika egress i bez audytu tresci argumentow. Token [PESEL_1], ktory
// maskowanie ukrylo przed modelem chmurowym, wraca jako prawdziwy PESEL w zapytaniu do
// zewnetrznej uslugi (SAOS/KRS/ISAP/EUR-Lex - publiczne API w sieci).
// Oczekiwane: identyfikator klienta zamaskowany na egressie do modelu nie jest odtwarzany
// w zapytaniu do zewnetrznego serwera MCP (albo wywolanie wymaga jawnej decyzji Operatora).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PESEL = "85071202931"; // syntetyczny, poprawna suma kontrolna

const { mcpCalls } = vi.hoisted(() => ({ mcpCalls: [] as { name: string; args: unknown }[] }));

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model posluszny wstrzyknietej instrukcji: szuka orzeczen "po stronie" -
        // przepisuje zamaskowany token z konwersacji do argumentu narzedzia MCP.
        streamChatWithTools: vi.fn(async (params: any) => {
            const userMsg: string = params.messages.find((m: any) => m.role === "user").content;
            const token = userMsg.match(/\[PESEL_\d+\]/)?.[0] ?? "brak-tokenu";
            await params.runTools([
                { id: "m1", name: "saos__search_judgments", input: { query: `strona ${token}` } },
            ]);
            params.callbacks?.onContentDelta?.("Brak orzeczen.");
            return { fullText: "Brak orzeczen." };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return {
        ...orig,
        getMcpTools: vi.fn(async () => [{
            type: "function",
            function: { name: "saos__search_judgments", description: "Szukaj orzeczen", parameters: { type: "object", properties: { query: { type: "string" } } } },
        }]),
        isMcpTool: vi.fn((n: string) => n.includes("__")),
        runMcpTool: vi.fn(async (name: string, args: unknown) => {
            mcpCalls.push({ name, args });
            return { text: "[]", citations: [], isError: false };
        }),
    };
});

import { runLLMStream } from "../src/lib/chat/stream";

function fakeDb(tables: Record<string, any[]>) {
    const db: any = {
        from(table: string) {
            const rows = tables[table] ?? [];
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, insert: () => b,
                single: async () => ({ data: rows[0] ?? null, error: null }),
                maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
            };
            return b;
        },
    };
    return db;
}

describe("A-09 MCP: zamaskowany identyfikator odtwarzany w zapytaniu do zewnetrznego serwera", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        mcpCalls.length = 0;
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("PESEL klienta nie trafia do argumentow zewnetrznego konektora MCP", async () => {
        await runLLMStream({
            apiMessages: [
                { role: "system", content: "Jestes asystentem." },
                { role: "user", content: `Klient PESEL ${PESEL}. Sprawdz orzecznictwo.` },
            ],
            docStore: new Map(),
            docIndex: {},
            userId: "u1",
            db: fakeDb({ projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }] }),
            write: () => {},
            model: "openrouter/google/gemini-3-flash-preview",
            projectId: "p1",
        });
        expect(mcpCalls.length).toBe(1);
        expect(JSON.stringify(mcpCalls[0]!.args)).not.toContain(PESEL);
    });
});
