// B-04: Bramka human-in-the-loop (ADR-0137, maybeStageMutation) obejmuje tylko
// edit_document / generate_docx / add_comments. Dwa narzedzia agenta o trwalych
// skutkach ubocznych omijaja ja nawet przy PATRON_MUTATION_APPROVAL=true:
//   - replicate_document: tworzy do 20 nowych dokumentow w sprawie (wiersze documents
//     + document_versions + pliki w storage) - lib/chat/tool-dispatch.ts:1446-1741,
//   - remember: zapisuje pamiec trwala sprawy (brain/*.md), bez karty i bez zdarzenia
//     w audit hash-chain - lib/chat/tool-dispatch.ts:655-676.
// Oczekiwane: przy wlaczonym stagingu kazda akcja agenta o trwalym skutku zapisu
// staje sie karta `pending` (albo co najmniej zostawia slad w audit_log) i NIE
// wykonuje sie przed zatwierdzeniem czlowieka.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "audit-b04-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = path.join(TMP, "storage");
process.env.PATRON_BRAIN_DIR = path.join(TMP, "brain");
process.env.DOWNLOAD_SIGNING_SECRET = "audyt-b04-syntetyczny-sekret-testowy-0123456789";

let db: any;
let runToolCalls: typeof import("../src/lib/chat/tool-dispatch").runToolCalls;
let projectId = "";
let docId = "";
let storagePath = "";

beforeAll(async () => {
    db = (await import("../src/lib/supabase")).createServerSupabase();
    ({ runToolCalls } = await import("../src/lib/chat/tool-dispatch"));
    const proj = await db.from("projects").insert({ user_id: "u_b04", name: "Sprawa Testowa" }).select().single();
    projectId = proj.data.id;
    const { generateDocx } = await import("../src/lib/chat/docx-generate");
    const gen: any = await generateDocx("Pozew", [{ content: "Powod Jan Testowy wnosi o zaplate." }], "u_b04", db, { projectId });
    docId = gen.document_id;
    storagePath = gen.storage_path;
    process.env.PATRON_MUTATION_APPROVAL = "true";
});
afterAll(async () => {
    delete process.env.PATRON_MUTATION_APPROVAL;
    (await import("../src/lib/db/sqlite-connection")).closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

function ctx() {
    const docStore: any = new Map([["doc-0", { storage_path: storagePath, file_type: "docx", filename: "Pozew.docx" }]]);
    const docIndex: any = { "doc-0": { document_id: docId, filename: "Pozew.docx" } };
    return { docStore, docIndex };
}

describe("B-04 zakres bramki ADR-0137 przy PATRON_MUTATION_APPROVAL=true", () => {
    it("replicate_document nie tworzy dokumentow przed zatwierdzeniem czlowieka", async () => {
        const { docStore, docIndex } = ctx();
        const przed = (await db.from("documents").select("id").eq("project_id", projectId)).data.length;
        await runToolCalls(
            [{ id: "r1", function: { name: "replicate_document", arguments: JSON.stringify({ doc_id: "doc-0", count: 20 }) } }],
            docStore, "u_b04", db, () => {}, undefined, undefined, docIndex, new Map(), projectId,
        );
        const po = (await db.from("documents").select("id").eq("project_id", projectId)).data.length;
        expect(po - przed, "replicate_document wykonany inline mimo stagingu").toBe(0);
    });

    it("remember przy wlaczonym stagingu tworzy karte albo slad w audit_log (nie zapisuje po cichu)", async () => {
        const { docStore, docIndex } = ctx();
        const kartyPrzed = (await db.from("mutation_approvals").select("id")).data.length;
        const auditPrzed = (await db.from("audit_log").select("id")).data.length;
        const out = await runToolCalls(
            [{ id: "m1", function: { name: "remember", arguments: JSON.stringify({ type: "decyzja", title: "Cofniecie pozwu", body: "Klient zdecydowal o cofnieciu pozwu.", slug: "cofniecie" }) } }],
            docStore, "u_b04", db, () => {}, undefined, undefined, docIndex, new Map(), projectId,
        );
        const wynik = JSON.parse((out.toolResults[0] as { content: string }).content);
        const kartyPo = (await db.from("mutation_approvals").select("id")).data.length;
        const auditPo = (await db.from("audit_log").select("id")).data.length;
        expect(
            { zapisano: wynik.ok === true, nowaKarta: kartyPo > kartyPrzed, nowyAudyt: auditPo > auditPrzed },
            "pamiec trwala zapisana bez karty i bez zdarzenia audytu",
        ).not.toEqual({ zapisano: true, nowaKarta: false, nowyAudyt: false });
    });
});
