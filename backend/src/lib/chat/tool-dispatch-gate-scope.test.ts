// B-04 (audyt 2026-09): bramka human-in-the-loop (ADR-0137) obejmuje takze
// replicate_document i remember - kazda akcje agenta o trwalym skutku zapisu.
//  - staging ON: karta `pending`, NIC nie jest zapisane przed decyzja czlowieka,
//  - zatwierdzenie karty (executeStagedTool) wykonuje TO SAMO co inline
//    (te same znormalizowane argumenty: replicateDocumentCopies / saveMemory),
//  - staging OFF: remember inline zostawia slad bez tresci (memoryWrites ->
//    llm_route.memory_writes tury).
// Swieza baza SQLite + storage na dysku + brain w katalogu tymczasowym.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DocIndex, DocStore } from "./types";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "patron-gate-scope-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = path.join(TMP, "storage");
process.env.PATRON_BRAIN_DIR = path.join(TMP, "brain");
process.env.DOWNLOAD_SIGNING_SECRET = "test-gate-scope-syntetyczny-sekret-0123456789";

const USER = "u_gate_scope";
// `any`: shim bez generyka schematu (jak tool-dispatch-mutation-gate.test.ts).
let db: any;
let runToolCalls: typeof import("./tool-dispatch").runToolCalls;
let executeStagedTool: typeof import("./mutation-approval-executor").executeStagedTool;
let getApprovalById: typeof import("../mutation-approval").getApprovalById;
let projectId = "";
let docId = "";
let storagePath = "";

beforeAll(async () => {
    db = (await import("../supabase")).createServerSupabase();
    ({ runToolCalls } = await import("./tool-dispatch"));
    ({ executeStagedTool } = await import("./mutation-approval-executor"));
    ({ getApprovalById } = await import("../mutation-approval"));
    const proj = await db.from("projects").insert({ user_id: USER, name: "Sprawa Testowa" }).select().single();
    projectId = proj.data.id;
    const { generateDocx } = await import("./docx-generate");
    const gen: any = await generateDocx("Pozew", [{ content: "Powod wnosi o zaplate." }], USER, db, { projectId });
    docId = gen.document_id;
    storagePath = gen.storage_path;
});
afterEach(() => {
    delete process.env.PATRON_MUTATION_APPROVAL;
});
afterAll(async () => {
    (await import("../db/sqlite-connection")).closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

function ctx(): { docStore: DocStore; docIndex: DocIndex } {
    return {
        docStore: new Map([["doc-0", { storage_path: storagePath, file_type: "docx", filename: "Pozew.docx" }]]),
        docIndex: { "doc-0": { document_id: docId, filename: "Pozew.docx" } },
    };
}

async function call(name: string, args: Record<string, unknown>, proj: string | null = projectId) {
    const { docStore, docIndex } = ctx();
    return runToolCalls(
        [{ id: `${name}-1`, function: { name, arguments: JSON.stringify(args) } }],
        docStore, USER, db, () => {}, undefined, undefined, docIndex, new Map(), proj,
    );
}

async function docCount(): Promise<number> {
    return (await db.from("documents").select("id").eq("project_id", projectId)).data.length;
}

describe("B-04 replicate_document przez bramke stagingu", () => {
    it("staging ON: karta pending, zero nowych dokumentow; zatwierdzenie tworzy kopie", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const przed = await docCount();
        const out = await call("replicate_document", { doc_id: "doc-0", count: 3, new_filename: "Wezwanie.docx" });
        const res = JSON.parse((out.toolResults[0] as { content: string }).content);
        expect(res.staged).toBe(true);
        expect(out.docsReplicated).toHaveLength(0);
        expect(await docCount()).toBe(przed);

        const card = await getApprovalById(db, USER, res.approval_id);
        expect(card?.tool_name).toBe("replicate_document");
        expect(card?.document_id).toBe(docId);
        expect(card?.tool_payload).toMatchObject({ count: 3, new_filename: "Wezwanie.docx", project_id: projectId });

        const ex = await executeStagedTool(card!, USER, db);
        expect(ex.ok).toBe(true);
        expect(await docCount()).toBe(przed + 3);
        const names = ((ex.result as { copies: { filename: string }[] }).copies).map((c) => c.filename);
        // Te same nazwy, ktore dalaby sciezka inline dla tych argumentow.
        expect(names).toEqual(["Wezwanie (1).docx", "Wezwanie (2).docx", "Wezwanie (3).docx"]);
    });

    it("staging OFF: replicate_document inline jak dotad (te same nazwy kopii)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "false"; // jawny wylacznik (domyslnie ON od 2026-10-06)
        const przed = await docCount();
        const out = await call("replicate_document", { doc_id: "doc-0", count: 3, new_filename: "Wezwanie.docx" });
        expect(out.docsReplicated[0].copies.map((c) => c.new_filename)).toEqual([
            "Wezwanie (1).docx",
            "Wezwanie (2).docx",
            "Wezwanie (3).docx",
        ]);
        expect(await docCount()).toBe(przed + 3);
    });
});

describe("B-04 remember przez bramke stagingu", () => {
    const brainFile = (scope: string, slug: string) => path.join(TMP, "brain", scope, `${slug}.md`);

    it("staging ON: karta pending, nic nie zapisane; zatwierdzenie zapisuje ten sam wpis", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const out = await call("remember", { type: "decyzja", title: "Cofniecie pozwu", body: "Klient zdecydowal o cofnieciu.", slug: "cofniecie" });
        const res = JSON.parse((out.toolResults[0] as { content: string }).content);
        expect(res.staged).toBe(true);
        expect(fs.existsSync(brainFile(projectId, "cofniecie"))).toBe(false);
        expect(out.memoryWrites).toEqual([]);

        const card = await getApprovalById(db, USER, res.approval_id);
        expect(card?.tool_name).toBe("remember");
        expect(card?.tool_payload).toEqual({
            scope: projectId,
            title: "Cofniecie pozwu",
            body: "Klient zdecydowal o cofnieciu.",
            type: "decyzja",
            slug: "cofniecie",
        });
        const ex = await executeStagedTool(card!, USER, db);
        expect(ex.ok).toBe(true);
        expect(fs.readFileSync(brainFile(projectId, "cofniecie"), "utf8")).toContain("Klient zdecydowal o cofnieciu.");

        // Slad wstrzymania w audit_log (C-09) - bez tresci wpisu.
        const { data: rows } = await db.from("audit_log").select("*").eq("event_type", "mutation.approval.decision");
        const staged = rows
            .map((r: any) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload))
            .find((p: any) => p.approval_id === res.approval_id);
        expect(staged).toMatchObject({ tool_name: "remember", phase: "staged" });
        expect(JSON.stringify(staged)).not.toContain("cofnieciu");
    });

    it("staging OFF: remember inline zapisuje i oddaje slad bez tresci (memoryWrites)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "false"; // jawny wylacznik (domyslnie ON od 2026-10-06)
        const out = await call("remember", { type: "termin", title: "Termin Kowalski", body: "Apelacja do 14 dni.", slug: "termin-kowalski" });
        const res = JSON.parse((out.toolResults[0] as { content: string }).content);
        expect(res.ok).toBe(true);
        expect(out.memoryWrites).toHaveLength(1);
        const w = out.memoryWrites[0];
        expect(w).toMatchObject({ scope_kind: "case", action: "created", title_chars: 15, body_chars: 19 });
        expect(w.entry_sha256).toMatch(/^[0-9a-f]{16}$/);
        expect(JSON.stringify(w)).not.toMatch(/Kowalski|kowalski|Apelacja/);
    });
});

describe("B-04 llm_route niesie memory_writes", () => {
    it("buildLlmRouteEvent: pole memory_writes tylko gdy byly zapisy", async () => {
        const { buildLlmRouteEvent } = await import("../routing/auditLlmRoute");
        const base = {
            actorUserId: USER, model: "ollama/x", provider: "ollama", egress: "no-egress" as const,
            classification: "internal" as const, action: "allow" as const, reason: "local" as never,
        };
        const w = { scope_kind: "case", action: "created", entry_sha256: "0123456789abcdef", title_chars: 1, body_chars: 2 };
        expect((buildLlmRouteEvent({ ...base, memoryWrites: [w] }).payload as any).memory_writes).toEqual([w]);
        expect((buildLlmRouteEvent({ ...base, memoryWrites: [] }).payload as any).memory_writes).toBeUndefined();
    });
});
