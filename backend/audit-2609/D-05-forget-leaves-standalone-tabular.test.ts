// D-05: "Zapomnij sprawe" (lib/rodo/forget.ts:80-99) kasuje tylko tabular_reviews z
// project_id = sprawa. Przeglad tabelaryczny tworzony z domyslnej sciezki UI
// (/tabular-reviews -> AddNewTRModal, underProject=false -> project_id null,
// frontend/src/app/components/tabular/AddNewTRModal.tsx:139-144) moze obejmowac
// dokumenty sprawy (routes/tabular.ts:239-256 akceptuje kazdy dostepny dokument).
// Po kasacji sprawy komorki znikaja (FK cascade), ale ZOSTAJA: przeglad (tytul,
// document_ids), czaty przegladu i ich wiadomosci z trescia wyprowadzona z akt.
// forget-case raportuje tabularReviews: 0 i zwraca sukces.
// Oczekiwane: po forgetCase nie zostaje zadna tresc wyprowadzona z dokumentow sprawy
// (czaty przegladu obejmujacego te dokumenty sa usuniete, a przeglad nie wskazuje ich).
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d05-${Date.now()}.db`);
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d05-brain-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_BRAIN_DIR = brainDir;

let db: any;
let projectId = "";
let docId = "";
let reviewId = "";

beforeAll(async () => {
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    db = createServerSupabase();
    projectId = (
        await db.from("projects").insert({ user_id: LOCAL_USER_ID, name: "Sprawa Testowy" }).select("id").single()
    ).data.id;
    docId = (
        await db
            .from("documents")
            .insert({ project_id: projectId, user_id: LOCAL_USER_ID, filename: "umowa-jan-testowy.docx", file_type: "docx", status: "ready" })
            .select("id")
            .single()
    ).data.id;
    // Jak routes/tabular.ts POST / bez project_id (domyslna sciezka UI).
    reviewId = (
        await db
            .from("tabular_reviews")
            .insert({
                user_id: LOCAL_USER_ID,
                title: "Umowy Jana Testowego",
                columns_config: [{ index: 0, name: "Kara umowna", prompt: "Jaka kara?" }],
                document_ids: [docId],
                project_id: null,
            })
            .select("id")
            .single()
    ).data.id;
    await db.from("tabular_cells").insert({ review_id: reviewId, document_id: docId, column_index: 0, status: "done", content: { summary: "Kara 10 000 zl" } });
    const trChatId = (
        await db.from("tabular_review_chats").insert({ review_id: reviewId, user_id: LOCAL_USER_ID, title: "Kary" }).select("id").single()
    ).data.id;
    await db.from("tabular_review_chat_messages").insert({
        chat_id: trChatId,
        role: "assistant",
        content: [{ type: "content", text: "Jan Testowy zaplaci kare 10 000 zl (umowa, par. 7)." }],
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

describe("D-05 forget-case vs przeglad tabelaryczny poza projektem", () => {
    it("nie zostaje czat przegladu z trescia z akt zapomnianej sprawy", async () => {
        const { forgetCase } = await import("../src/lib/rodo/forget");
        const report = await forgetCase(projectId, db);
        const { data: cells } = await db.from("tabular_cells").select("id").eq("review_id", reviewId);
        expect((cells ?? []).length).toBe(0); // komorki znikaja przez FK cascade - to dziala
        const { data: chats } = await db.from("tabular_review_chats").select("id").eq("review_id", reviewId);
        const ids = (chats ?? []).map((c: any) => c.id);
        const { data: msgs } = ids.length
            ? await db.from("tabular_review_chat_messages").select("content").in("chat_id", ids)
            : { data: [] };
        const { data: reviews } = await db.from("tabular_reviews").select("id, title, document_ids").eq("id", reviewId);
        const msg = `raport=${JSON.stringify(report)} przeglad=${JSON.stringify(reviews)} wiadomosci=${JSON.stringify(msgs)}`;
        expect((msgs ?? []).length, msg).toBe(0);
        const stillPointing = (reviews ?? []).filter((r: any) => JSON.stringify(r.document_ids ?? []).includes(docId));
        expect(stillPointing.length, msg).toBe(0);
    });
});
