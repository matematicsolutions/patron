// C-02: Zdarzenie llm_route (jedyne, ktore niesie realnie uzyty model, dostawce,
// strefe egress i decyzje straznika) jest zapisywane BEZ chat_id - lib/chat/stream.ts:341
// (enforceEgressGuard bez chatId) i stream.ts:589-600 (appendLlmRouteEvent bez chatId);
// runLLMStream nawet nie dostaje chatId. Tura czatu nie da sie wiec odtworzyc z
// audit_log po chat_id: przy modelu domyslnym chat.message.assistant ma model=null
// (routes/chat.ts:640 zapisuje model z body), a llm_route wisi bez powiazania.
// Oczekiwane: zdarzenia tury (w tym llm_route) sa powiazane z chat_id tej tury i
// z samych wpisow tego czatu da sie ustalic, jaki model odpowiadal.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c02-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

const MCP_TOOL = "saos__search_judgments";

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model najgorszego przypadku: wola narzedzie lokalne i narzedzie MCP.
        streamChatWithTools: vi.fn(async (params: any) => {
            await params.runTools([
                { id: "c1", name: "read_document", input: { doc_id: "doc-0" } },
                { id: "c2", name: MCP_TOOL, input: { query: "art. 415 KC" } },
            ]);
            params.callbacks?.onContentDelta?.("Gotowe.");
            return { fullText: "Gotowe." };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return {
        ...orig,
        getMcpTools: vi.fn(async () => []),
        isMcpTool: vi.fn((n: string) => n === MCP_TOOL),
        // Konektor zwraca tekst bez kart cytatow (np. pusta lista wynikow).
        runMcpTool: vi.fn(async () => ({
            text: "Brak orzeczen dla zapytania.",
            citations: [],
            isError: false,
        })),
    };
});

let server: http.Server;
let base = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { chatRouter } = await import("../src/routes/chat");
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

describe("C-02 powiazanie llm_route z tura czatu", () => {
    it("wpisy audit_log tury maja chat_id tury i ujawniaja uzyty model", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const r = await fetch(`${base}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Krotkie pytanie." }],
                model: "ollama/qwen3:8b",
            }),
        });
        const sse = await r.text();
        expect(sse).toContain("[DONE]");
        const chatId = JSON.parse(sse.split("\n").find((l) => l.includes('"chat_id"'))!.slice(6)).chatId;
        await new Promise((res) => setTimeout(res, 100));

        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data } = await db.from("audit_log").select("*").order("id", { ascending: true });
        const rows = (data ?? []) as { event_type: string; chat_id: string | null; payload: any }[];
        const route = rows.filter((x) => x.event_type === "llm_route");
        // Sanity: straznik egress zapisal decyzje dla tej tury.
        expect(route.length).toBe(1);
        expect(route[0].payload.model).toBe("ollama/qwen3:8b");
        // ZADANE: decyzja routingu jest przypisana do czatu, w ktorym zapadla.
        expect(route[0].chat_id).toBe(chatId);
    });

    it("przy modelu domyslnym wpisy czatu ujawniaja, ktory model odpowiadal", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const r = await fetch(`${base}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // Brak "model" w body = model domyslny (klient API; UI zwykle wysyla model).
            body: JSON.stringify({ messages: [{ role: "user", content: "Drugie pytanie." }] }),
        });
        const sse = await r.text();
        const chatId = JSON.parse(sse.split("\n").find((l) => l.includes('"chat_id"'))!.slice(6)).chatId;
        await new Promise((res) => setTimeout(res, 100));
        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data } = await db.from("audit_log").select("*").eq("chat_id", chatId);
        const rows = (data ?? []) as { event_type: string; payload: any }[];
        const models = rows.map((x) => x.payload?.model).filter((m) => typeof m === "string" && m);
        // ZADANE: z wpisow tego czatu da sie ustalic model (AI Act art. 12).
        expect(models.length).toBeGreaterThan(0);
    });
});
