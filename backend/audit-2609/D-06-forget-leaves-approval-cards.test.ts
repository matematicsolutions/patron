// D-06: "Zapomnij sprawe" (lib/rodo/forget.ts) nie dotyka tabeli mutation_approvals
// (ADR-0137). FK chat_id/document_id sa ON DELETE SET NULL
// (lib/db/schema.sqlite.ts:179-180), wiec po kasacji karty ZOSTAJA z pelnym
// tool_payload: filename, edits (fragmenty tekstu akt: find/replace) dla edit_document
// i sections (pelna tresc pisma) + projectId dla generate_docx
// (lib/chat/tool-dispatch.ts:1114-1119, :1767-1774). Karty pending dalej widac w
// skrzynce /account/approval-cards i mozna je zatwierdzic po "zapomnieniu" sprawy.
// Zakres: tylko przy PATRON_MUTATION_APPROVAL=true (domyslnie OFF).
// Oczekiwane: po forgetCase nie zostaje karta zatwierdzenia z trescia akt tej sprawy.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d06-${Date.now()}.db`);
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d06-brain-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_BRAIN_DIR = brainDir;

let db: any;
let projectId = "";

beforeAll(async () => {
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const { stageMutationApproval } = await import("../src/lib/mutation-approval");
    db = createServerSupabase();
    projectId = (
        await db.from("projects").insert({ user_id: LOCAL_USER_ID, name: "Sprawa Testowy" }).select("id").single()
    ).data.id;
    const docId = (
        await db
            .from("documents")
            .insert({ project_id: projectId, user_id: LOCAL_USER_ID, filename: "pozew-jan-testowy.docx", file_type: "docx", status: "ready" })
            .select("id")
            .single()
    ).data.id;
    const chatId = (
        await db.from("chats").insert({ project_id: projectId, user_id: LOCAL_USER_ID, title: "Pozew" }).select("id").single()
    ).data.id;
    // Jak maybeStageMutation dla edit_document (tool-dispatch.ts:1109-1120).
    await stageMutationApproval(db, {
        userId: LOCAL_USER_ID,
        chatId,
        documentId: docId,
        toolName: "edit_document",
        toolPayload: {
            doc_id: "doc-0",
            document_id: docId,
            filename: "pozew-jan-testowy.docx",
            edits: [{ find: "Jan Testowy, PESEL 90010112349, zam. ul. Testowa 1", replace: "Powod" }],
        },
    });
    // Jak maybeStageMutation dla generate_docx (tool-dispatch.ts:1762-1775).
    await stageMutationApproval(db, {
        userId: LOCAL_USER_ID,
        chatId,
        documentId: null,
        toolName: "generate_docx",
        toolPayload: {
            title: "Pozew o rozwod",
            sections: [{ heading: "Uzasadnienie", body: "Jan Testowy od 2024 r. pozostaje w separacji..." }],
            projectId,
            filename: "Pozew o rozwod.docx",
        },
    });
});

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(brainDir, { recursive: true, force: true });
});

describe("D-06 forget-case vs karty zatwierdzen", () => {
    it("po kasacji sprawy nie zostaje karta z trescia akt", async () => {
        const { forgetCase } = await import("../src/lib/rodo/forget");
        await forgetCase(projectId, db);
        const { data: cards } = await db.from("mutation_approvals").select("tool_name, status, chat_id, document_id, tool_payload");
        const leaking = (cards ?? []).filter((c: any) => JSON.stringify(c.tool_payload).includes("Jan Testowy"));
        expect(leaking.length, JSON.stringify(cards)).toBe(0);
    });
});
