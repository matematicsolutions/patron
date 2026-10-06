// D-10: Gdy edit_document zastosuje czesc zmian, a czesc sie nie dopasuje, UI dostaje
// event doc_edited BEZ informacji o nieudanych edycjach. runEditDocument zwraca
// `errors` (lib/chat/docx-edit.ts:238-246), ale tool-dispatch przekazuje je WYLACZNIE
// modelowi (lib/chat/tool-dispatch.ts:1211-1222); payload SSE/persistowany
// DocEditedResult (:1195-1206) ma tylko annotations udanych zmian. Pelna porazka jest
// sygnalizowana (emitEditError -> doc_edited.error), czesciowa - nie. Jesli model napisze
// "wprowadzilem wszystkie zmiany" (najgorszy przypadek), mecenas widzi karte
// "Edytowano" z jedna zmiana i nie wie, ze druga (np. termin) NIE zostala wprowadzona.
// Oczekiwane: event doc_edited (lub osobny event) niesie informacje o edycjach, ktorych
// nie udalo sie zastosowac.
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d10-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d10-store-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = storeDir;
// Sciezka inline (edycja w turze). Karty zatwierdzen (ADR-0137) sa domyslnie
// wlaczone od 2026-10-06 - jawny wylacznik; sciezke karty pokrywa C-08.
process.env.PATRON_MUTATION_APPROVAL = "false";
process.env.DOWNLOAD_SIGNING_SECRET = "test-secret-d10-0123456789abcdef0123456789abcdef";

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        streamChatWithTools: vi.fn(async (params: any) => {
            await params.runTools([
                {
                    id: "e1",
                    name: "edit_document",
                    input: {
                        doc_id: "doc-0",
                        edits: [
                            { find: "1000 zl", replace: "2000 zl", context_before: "wynosi ", context_after: "." },
                            { find: "30 dni", replace: "7 dni", context_before: "Termin platnosci ", context_after: "." },
                        ],
                    },
                },
            ]);
            params.callbacks?.onContentDelta?.("Wprowadzilem obie zmiany.");
            return { fullText: "Wprowadzilem obie zmiany." };
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return { ...orig, getMcpTools: vi.fn(async () => []), isMcpTool: vi.fn(() => false) };
});

let docIndex: any;
let docStore: any;

beforeAll(async () => {
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { uploadFile } = await import("../src/lib/storage");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();
    const z = new JSZip();
    z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Kara umowna wynosi 1000 zl.</w:t></w:r></w:p><w:p><w:r><w:t>Termin platnosci 14 dni.</w:t></w:r></w:p></w:body></w:document>`);
    const bytes = await z.generateAsync({ type: "uint8array" });
    const docId = (
        await db.from("documents").insert({ user_id: LOCAL_USER_ID, filename: "umowa.docx", file_type: "docx", status: "ready" }).select("id").single()
    ).data.id;
    const key = `documents/${LOCAL_USER_ID}/${docId}/source.docx`;
    await uploadFile(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "application/octet-stream");
    const ver = (
        await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 }).select("id").single()
    ).data.id;
    await db.from("documents").update({ current_version_id: ver }).eq("id", docId);
    docIndex = { "doc-0": { document_id: docId, filename: "umowa.docx", version_id: ver, version_number: 1 } };
    docStore = new Map([["doc-0", { storage_path: key, file_type: "docx", filename: "umowa.docx" }]]);
});

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("D-10 czesciowo nieudana edycja DOCX", () => {
    it("UI dostaje informacje, ze jedna z dwoch edycji nie zostala zastosowana", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { runLLMStream } = await import("../src/lib/chat/stream");
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
        const sse: any[] = [];
        await runLLMStream({
            apiMessages: [
                { role: "system", content: "Jestes asystentem." },
                { role: "user", content: "Zmien kare na 2000 zl i termin na 7 dni." },
            ],
            docStore,
            docIndex,
            userId: LOCAL_USER_ID,
            db: createServerSupabase(),
            write: (s: string) => { if (s.startsWith("data: {")) sse.push(JSON.parse(s.slice(6))); },
            model: "ollama/qwen3:8b",
            projectId: null,
        });
        const edited = sse.filter((e) => e.type === "doc_edited");
        expect(edited.length).toBe(1);
        expect(edited[0].annotations.length).toBe(1); // sanity: jedna zmiana weszla
        const failureInfo = edited[0].error ?? edited[0].errors ?? sse.find((e) => /edit.*(error|fail)/i.test(e.type));
        const hasFailure = Array.isArray(failureInfo) ? failureInfo.length > 0 : !!failureInfo;
        expect(hasFailure, JSON.stringify(edited[0])).toBe(true);
    });
});
