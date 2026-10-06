// D-11: Tabular review (POST /tabular-review/:id/generate) dla skanu (jpg/png/tiff, a
// takze PDF bez warstwy tekstu i .doc) wysyla do modelu PUSTY dokument i zapisuje
// komorki jako status "done" z odpowiedzia modelu ("Not Found"). routes/tabular.ts:1051-1065
// rozroznia tylko pdf (extractPdfMarkdown: pdfjs, bez OCR) i "reszte" (mammoth docx);
// dla obrazu mammoth rzuca, blad jest lapany (console.error / `catch { return "" }`,
// :1952 i :1979), a queryTabularAllColumns (:1822) idzie dalej z documentText = "".
// Tymczasem ingest OCR-uje skany (documentIngest.ts:138-147) i tekst lezy w doc_chunks -
// czat go uzywa (tool-dispatch.ts:246-266), tabular nie. Mecenas dostaje tabele
// "Nie znaleziono" dla kazdej kolumny: wyglada jak przeczytany dokument bez klauzul,
// a dokument nie zostal przeczytany wcale (cichy sukces).
// Oczekiwane: model dostaje tekst dokumentu (OCR z ingestu), albo - gdy tekstu brak -
// komorki sa oznaczone jako blad/nieczytelne, nie "done".
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d11-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d11-store-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = storeDir;

process.env.ALLOW_US_PROVIDERS = "true";
process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
// Model chmurowy z kluczem (lokalny Ollama wywraca generate - patrz D-12).
vi.mock("../src/lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        title_model: "openrouter/google/gemini-3-flash-preview",
        tabular_model: "openrouter/google/gemini-3-flash-preview",
        api_keys: { openrouter: "sk-test-syntetyczny" },
    })),
    getUserApiKeys: vi.fn(async () => ({ openrouter: "sk-test-syntetyczny" })),
}));

const { prompts } = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        // Model zachowuje sie jak kazdy LLM wobec pustego dokumentu: "Not Found".
        streamChatWithTools: vi.fn(async (params: any) => {
            prompts.push(String(params.messages?.[0]?.content ?? ""));
            const line = JSON.stringify({ column_index: 0, summary: "Not Found", flag: "grey", reasoning: "Brak postanowienia o karze." });
            params.callbacks?.onContentDelta?.(line + "\n");
            return { fullText: line };
        }),
    };
});

const OCR_TEXT = "Kara umowna za zwloke wynosi 500 zl za kazdy dzien. Najemca Jan Testowy.";
let server: http.Server;
let base = "";
let reviewId = "";
let docId = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { tabularRouter } = await import("../src/routes/tabular");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { uploadFile } = await import("../src/lib/storage");
    const { getDb } = await import("../src/lib/db/sqlite-connection");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();

    docId = (
        await db.from("documents").insert({ user_id: LOCAL_USER_ID, filename: "umowa-skan.jpg", file_type: "jpg", status: "ready" }).select("id").single()
    ).data.id;
    const key = `documents/${LOCAL_USER_ID}/${docId}/source.jpg`;
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    await uploadFile(key, jpg.buffer as ArrayBuffer, "image/jpeg");
    const ver = (
        await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 }).select("id").single()
    ).data.id;
    await db.from("documents").update({ current_version_id: ver }).eq("id", docId);
    // Tekst z OCR, ktory ingest zapisal do indeksu RAG (documentIngest.ts:259-263).
    getDb()
        .prepare("insert into doc_chunks (document_id, chunk_index, content, created_at) values (?, 0, ?, ?)")
        .run(docId, OCR_TEXT, new Date().toISOString());

    reviewId = (
        await db
            .from("tabular_reviews")
            .insert({ user_id: LOCAL_USER_ID, title: "Kary", columns_config: [{ index: 0, name: "Kara umowna", prompt: "Jaka jest kara umowna?" }], document_ids: [docId] })
            .select("id")
            .single()
    ).data.id;
    await db.from("tabular_cells").insert({ review_id: reviewId, document_id: docId, column_index: 0, status: "pending" });

    const app = express();
    app.use(express.json());
    app.use("/tabular-review", tabularRouter);
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
    fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("D-11 tabular review na skanie", () => {
    it("model dostaje tekst skanu albo komorka nie udaje sukcesu", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await fetch(`${base}/tabular-review/${reviewId}/generate`, { method: "POST" });
        const sse = await r.text();
        expect(r.status).toBe(200);
        expect(prompts.length).toBe(1); // sanity: generate doszedl do modelu
        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data: cells } = await db.from("tabular_cells").select("status, content").eq("review_id", reviewId);
        const modelSawText = prompts[0]!.includes("Kara umowna za zwloke");
        const msg = `modelSawText=${modelSawText} cells=${JSON.stringify(cells)} sse=${sse.slice(0, 400)}`;
        expect(modelSawText || cells[0].status !== "done", msg).toBe(true);
    });
});
