// D-15: Tabular review po cichu obcina dokument do 120 000 znakow
// (routes/tabular.ts:1852 `documentText.slice(0, 120_000)` w queryTabularAllColumns;
// tak samo regenerate-cell :1685). Dluzsza umowa (umowa kredytu / SPA - dokladnie te, pod
// ktore sa wbudowane workflow tabelaryczne, np. builtin-credit-agreement) jest
// analizowana tylko do ok. 40-60 strony; dla postanowien dalej model odpowiada
// "Not Found", komorka dostaje status "done" i nic w UI ani w SSE nie mowi, ze reszty
// dokumentu nie przeczytano (cichy sukces - "brak klauzuli" zamiast "nie sprawdzono").
// Oczekiwane: model dostaje postanowienie z konca dokumentu (np. przez okna/chunking),
// albo komorka/strumien jawnie sygnalizuje, ze dokument zostal obciety.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d15-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d15-store-"));
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
        // Model nie widzi postanowienia (jest za granica obciecia) -> "Not Found".
        streamChatWithTools: vi.fn(async (params: any) => {
            prompts.push(String(params.messages?.[0]?.content ?? ""));
            const line = JSON.stringify({ column_index: 0, summary: "Not Found", flag: "grey", reasoning: "Brak postanowienia o prawie wlasciwym." });
            params.callbacks?.onContentDelta?.(line + "\n");
            return { fullText: line };
        }),
    };
});

const CLAUSE = "Prawem wlasciwym dla niniejszej umowy jest prawo polskie.";
let server: http.Server;
let base = "";
let reviewId = "";
let docId = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { tabularRouter } = await import("../src/routes/tabular");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { uploadFile } = await import("../src/lib/storage");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();

    docId = (
        await db.from("documents").insert({ user_id: LOCAL_USER_ID, filename: "umowa-kredytu.docx", file_type: "docx", status: "ready" }).select("id").single()
    ).data.id;
    const key = `documents/${LOCAL_USER_ID}/${docId}/source.docx`;
    const filler = Array.from({ length: 1400 }, (_, i) => `<w:p><w:r><w:t>Par. ${i + 1}. Kredytobiorca zobowiazuje sie do terminowej splaty rat zgodnie z harmonogramem stanowiacym zalacznik nr 1 do umowy.</w:t></w:r></w:p>`).join("");
    const z = new JSZip();
    z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${filler}<w:p><w:r><w:t>${CLAUSE}</w:t></w:r></w:p></w:body></w:document>`);
    const bytes = await z.generateAsync({ type: "uint8array" });
    await uploadFile(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "application/octet-stream");
    const ver = (
        await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 }).select("id").single()
    ).data.id;
    await db.from("documents").update({ current_version_id: ver }).eq("id", docId);

    reviewId = (
        await db
            .from("tabular_reviews")
            .insert({ user_id: LOCAL_USER_ID, title: "Umowy kredytu", columns_config: [{ index: 0, name: "Prawo wlasciwe", prompt: "Jakie jest prawo wlasciwe?" }], document_ids: [docId] })
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

describe("D-15 tabular review: obciecie dlugiego dokumentu", () => {
    it("postanowienie z konca umowy trafia do modelu albo obciecie jest jawne", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await fetch(`${base}/tabular-review/${reviewId}/generate`, { method: "POST" });
        const sse = await r.text();
        expect(prompts.length).toBe(1);
        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data: cells } = await db.from("tabular_cells").select("status, content").eq("review_id", reviewId);
        const modelSawClause = prompts.some((p) => p.includes(CLAUSE));
        const signalled = /truncat|obciet|obcie/i.test(sse) || cells[0].status !== "done";
        const msg = `promptLen=${prompts[0]!.length} modelSawClause=${modelSawClause} cells=${JSON.stringify(cells)}`;
        expect(modelSawClause || signalled, msg).toBe(true);
    });
});
