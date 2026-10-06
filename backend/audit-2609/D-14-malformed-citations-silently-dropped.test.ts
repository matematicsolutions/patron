// D-14: Gdy blok <CITATIONS> odpowiedzi nie przejdzie parsera, cytaty znikaja BEZ sygnalu.
// lib/chat/citations.ts:47-59 (parseCitations) zwraca [] przy dowolnym bledzie JSON
// (np. przecinek na koncu listy - typowe dla modeli lokalnych), a normalizeCitation
// (:14-41) odrzuca rekord z "ref": "1" (string zamiast liczby). Blok <CITATIONS> jest
// ukryty przed UI (stream.ts:233-250), wiec mecenas widzi w prozie znacznik [1] bez karty
// cytatu i BEZ werdyktu groundingu (ADR-0005): ani zielony, ani zolty, ani czerwony.
// Event SSE "citations" ma citations: [] i grounding: {} - nie da sie odroznic
// "model nie cytowal" od "cytaty sie zgubily". ADR-0146/AGENTS.md: brak weryfikacji ma
// byc jawnym sygnalem, nigdy cisza.
// Oczekiwane: znacznik [N] w odpowiedzi bez sparsowanego cytatu daje jawny sygnal
// (np. grounding[N] = niezweryfikowany / flaga bledu parsowania w evencie citations).
import { describe, it, expect, vi } from "vitest";

const { answer } = vi.hoisted(() => ({ answer: { text: "" } }));
vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        streamChatWithTools: vi.fn(async (params: any) => {
            params.callbacks?.onContentDelta?.(answer.text);
            return { fullText: answer.text };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return { ...orig, getMcpTools: vi.fn(async () => []), isMcpTool: vi.fn(() => false) };
});

import { runLLMStream } from "../src/lib/chat/stream";

function fakeDb() {
    const db: any = {
        from() {
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, insert: () => b,
                single: async () => ({ data: null, error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
            };
            return b;
        },
    };
    return db;
}

async function run(text: string) {
    answer.text = text;
    const events: any[] = [];
    await runLLMStream({
        apiMessages: [
            { role: "system", content: "Jestes asystentem." },
            { role: "user", content: "Jaka jest kara umowna?" },
        ],
        docStore: new Map([["doc-0", { storage_path: "documents/u/d/source.docx", file_type: "docx", filename: "umowa.docx" }]]),
        docIndex: { "doc-0": { document_id: "d", filename: "umowa.docx", version_id: null, version_number: null } } as any,
        userId: "u1",
        db: fakeDb(),
        write: (s: string) => { if (s.startsWith("data: {")) events.push(JSON.parse(s.slice(6))); },
        model: "ollama/qwen3:8b",
        projectId: null,
    });
    const ev = events.find((e) => e.type === "citations");
    const signalled =
        (ev?.citations?.length ?? 0) > 0 ||
        Object.keys(ev?.grounding ?? {}).length > 0 ||
        !!ev?.error || !!ev?.parse_error ||
        events.some((e) => /citation/i.test(e.type) && (e.error || e.status === "error"));
    return { ev, signalled };
}

describe("D-14 zgubione cytaty przy blednym bloku <CITATIONS>", () => {
    it("przecinek na koncu listy JSON -> jawny sygnal, nie cisza", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { ev, signalled } = await run(
            'Kara umowna wynosi 1000 zl za kazdy dzien [1].\n<CITATIONS>[{"ref": 1, "doc_id": "doc-0", "page": 1, "quote": "Kara umowna wynosi 1000 zl"},]</CITATIONS>',
        );
        expect(signalled, JSON.stringify(ev)).toBe(true);
    });
    it('"ref": "1" (string) -> jawny sygnal, nie cisza', async () => {
        const { ev, signalled } = await run(
            'Kara umowna wynosi 1000 zl za kazdy dzien [1].\n<CITATIONS>[{"ref": "1", "doc_id": "doc-0", "page": 1, "quote": "Kara umowna wynosi 1000 zl"}]</CITATIONS>',
        );
        expect(signalled, JSON.stringify(ev)).toBe(true);
    });
});
