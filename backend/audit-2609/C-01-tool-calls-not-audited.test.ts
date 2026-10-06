// C-01: Wywolania narzedzi LOKALNYCH agenta (read_document, find_in_document,
// search_corpus, edit_document, generate_docx, ...) NIE zostawiaja zadnego sladu w
// audit_log - event_type "tool.call" jest tylko zarezerwowany (lib/audit.ts:37, brak w
// CHECK), runToolCalls nie pisze audytu, a chat.message.assistant (routes/chat.ts:635-658)
// niesie tylko liczniki + mcp_tools_called (z kart cytatow MCP). Nie da sie wiec ustalic,
// ktore akta model przeczytal ani co zapisal. (Wywolania MCP zostawiaja
// ring_policy.decision z nazwa narzedzia - ale bez chat_id/aktora, patrz C-02.)
// Oczekiwane (AGENTS.md "every LLM interaction is logged", ADR-0001, AI Act art. 12):
// po turze, w ktorej model wywolal narzedzie lokalne, audit_log pozwala ustalic KTORE
// narzedzie zostalo wywolane (nazwa narzedzia w payloadzie zdarzenia tej tury).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c01-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model wola narzedzie lokalne (odczyt akt).
        streamChatWithTools: vi.fn(async (params: any) => {
            await params.runTools([
                { id: "c1", name: "read_document", input: { doc_id: "doc-0" } },
            ]);
            params.callbacks?.onContentDelta?.("Gotowe.");
            return { fullText: "Gotowe." };
        }),
    };
});
vi.mock("../src/lib/storage", () => ({
    downloadFile: vi.fn(async () => new TextEncoder().encode("%PDF-1.4\n%synthetic\n").buffer),
    uploadFile: vi.fn(),
    storageKey: vi.fn(() => "k"),
}));
vi.mock("../src/lib/chat/pdf", () => ({
    extractPdfText: vi.fn(async () => "Pozew. Powod: Jan Testowy. Pozwany: Adam Probny."),
}));
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return { ...orig, getMcpTools: vi.fn(async () => []) };
});

let server: http.Server;
let base = "";
let documentId = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { chatRouter } = await import("../src/routes/chat");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();
    const doc = await db
        .from("documents")
        .insert({ user_id: LOCAL_USER_ID, filename: "pozew.pdf", file_type: "pdf", status: "ready" })
        .select()
        .single();
    documentId = doc.data.id;
    const ver = await db
        .from("document_versions")
        .insert({ document_id: documentId, storage_path: "documents/x/pozew.pdf", source: "upload", version_number: 1 })
        .select()
        .single();
    await db.from("documents").update({ current_version_id: ver.data.id }).eq("id", documentId);
    const app = express();
    app.use(express.json());
    app.use("/chat", chatRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("C-01 wywolania narzedzi w audit_log", () => {
    it("tura z wywolaniem read_document zostawia slad nazwy narzedzia w audit_log", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const r = await fetch(`${base}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: [
                    {
                        role: "user",
                        content: "Przeczytaj pozew.",
                        files: [{ filename: "pozew.pdf", document_id: documentId }],
                    },
                ],
                model: "ollama/qwen3:8b",
            }),
        });
        const sse = await r.text();
        expect(r.status).toBe(200);
        // Sanity: tura sie zakonczyla i zapisala zdarzenie asystenta.
        expect(sse).toContain("[DONE]");
        await new Promise((res) => setTimeout(res, 100));

        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data } = await db.from("audit_log").select("*").order("id", { ascending: true });
        const rows = (data ?? []) as { event_type: string; payload: unknown }[];
        const types = rows.map((x) => x.event_type);
        expect(types).toContain("chat.message.user");
        expect(types).toContain("chat.message.assistant");

        // Sanity: narzedzie faktycznie przeczytalo akta (zdarzenie doc_read w czacie).
        const { data: msgs } = await db.from("chat_messages").select("*").eq("role", "assistant");
        expect(JSON.stringify(msgs.map((m: any) => m.content))).toContain("doc_read");
        const allPayloads = JSON.stringify(rows.map((x) => x.payload));
        // ZADANE: audit_log pozwala ustalic, co agent zrobil w tej turze.
        expect(allPayloads).toContain("read_document");
    });
});
