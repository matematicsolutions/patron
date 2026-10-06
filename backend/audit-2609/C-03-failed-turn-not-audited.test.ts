// C-03: Tura czatu zakonczona bledem providera LLM (wyjatek w streamChatWithTools)
// nie zostawia w audit_log ZADNEGO sladu bledu ani wywolania modelu: routes/chat.ts:661-676
// (catch) tylko pisze SSE "error" i console.error, a llm_route "allow" jest dopisywany
// dopiero PO udanym strumieniu (lib/chat/stream.ts:589). W audit_log zostaje samo
// chat.message.user - nie da sie odroznic tury nieudanej od porzuconej ani ustalic,
// ze tresc sprawy zostala wyslana do modelu, ktory potem padl.
// Oczekiwane: nieudane wywolanie LLM zostawia wpis w audit_log dla tego czatu
// (np. llm_route/chat.message.assistant z oznaczeniem bledu), bez tresci.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c03-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

const MCP_TOOL = "saos__search_judgments";

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model najgorszego przypadku: wola narzedzie lokalne i narzedzie MCP.
        streamChatWithTools: vi.fn(async () => {
            // Provider pada PO wyslaniu zadania (np. 500 / timeout / 401).
            throw new Error("provider HTTP 500: upstream error");
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

describe("C-03 nieudana tura LLM w audit_log", () => {
    it("blad providera w turze zostawia wpis w audit_log tego czatu", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await fetch(`${base}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Przygotuj odpowiedz na pozew." }],
                model: "ollama/qwen3:8b",
            }),
        });
        const sse = await r.text();
        // Sanity: uzytkownik dostal blad w SSE.
        expect(sse).toContain("Blad generowania");
        const chatId = JSON.parse(sse.split("\n").find((l) => l.includes('"chat_id"'))!.slice(6)).chatId;
        await new Promise((res) => setTimeout(res, 100));

        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data } = await db.from("audit_log").select("*").order("id", { ascending: true });
        const rows = (data ?? []) as { event_type: string; chat_id: string | null; payload: any }[];
        // Sanity: wejscie uzytkownika zostalo zaudytowane.
        expect(rows.some((x) => x.event_type === "chat.message.user" && x.chat_id === chatId)).toBe(true);
        // ZADANE: poza samym wejsciem istnieje slad proby wywolania modelu / bledu.
        const afterUser = rows.filter((x) => x.event_type !== "chat.message.user");
        expect(afterUser.length).toBeGreaterThan(0);
    });
});
