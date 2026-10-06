// C-09: Karta zatwierdzenia mutacji (ADR-0137) jest tworzona z chat_id = null na
// wszystkich trzech sciezkach stagingu (lib/chat/tool-dispatch.ts:1112, :1316, :1765 -
// `chatId: null`; runToolCalls w ogole nie dostaje chatId). Tym samym wpis decyzji
// czlowieka mutation.approval.decision (lib/mutation-approval.ts:275-288 bierze
// card.chat_id) tez ma chat_id = null, a staging sam w sobie nie zostawia wpisu w
// audit_log. Z audit_log nie da sie powiazac aktu nadzoru (art. 14) z tura czatu, w
// ktorej agent zaproponowal zapis, ani ustalic wstrzymania, o ktorym nikt nie zdecydowal.
// Oczekiwane: karta nosi chat_id tury, w ktorej powstala (a wstrzymanie jest widoczne
// w audit_log tej tury).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c09-${Date.now()}.db`);
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
                {
                    id: "g1",
                    name: "generate_docx",
                    input: { title: "Odpowiedz na pozew", sections: [{ heading: "I", body: "Tresc testowa." }] },
                },
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

describe("C-09 karta zatwierdzenia a tura czatu", () => {
    it("generate_docx przy wlaczonym stagingu tworzy karte z chat_id tury i slad w audit_log", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        vi.spyOn(console, "log").mockImplementation(() => {});
        const r = await fetch(`${base}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: "Przygotuj odpowiedz na pozew jako DOCX." }],
                model: "ollama/qwen3:8b",
            }),
        });
        const sse = await r.text();
        const chatId = JSON.parse(sse.split("\n").find((l) => l.includes('"chat_id"'))!.slice(6)).chatId;
        await new Promise((res) => setTimeout(res, 100));

        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data: cards } = await db.from("mutation_approvals").select("*");
        // Sanity: akcja zostala wstrzymana jako karta pending.
        expect(cards.length).toBe(1);
        expect(cards[0].status).toBe("pending");
        expect(cards[0].tool_name).toBe("generate_docx");
        // ZADANE: karta jest powiazana z tura czatu.
        expect(cards[0].chat_id).toBe(chatId);
        // ZADANE: wstrzymanie widac w audit_log tej tury.
        const { data: rows } = await db.from("audit_log").select("*").eq("chat_id", chatId);
        expect(JSON.stringify(rows.map((x: any) => x.payload))).toContain(cards[0].id);
    });
});
