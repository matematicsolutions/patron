// C-08: Zatwierdzona karta edit_document/add_comments, z ktorej wykonala sie tylko CZESC
// zmian (runEditDocument zwraca ok:true + errors[] gdy >=1 zmiana weszla,
// lib/chat/docx-edit.ts:83-96), jest zapisywana jako pelny sukces: executor zwraca
// ok:true (lib/chat/mutation-approval-executor.ts:37-49), rdzen czysci execution_error
// (lib/mutation-approval.ts:337-347), a audit mutation.approval.decision ma
// executed:true bez sladu pominietych zmian (:276-287). UI inboxa pokazuje komunikat
// tylko gdy executed=false (frontend/src/app/(pages)/account/approval-cards/page.tsx:61).
// Czlowiek zatwierdzil N zmian, weszlo mniej - nikt sie o tym nie dowiaduje (cichy sukces).
// Oczekiwane: czesciowe wykonanie jest odnotowane na karcie (execution_error / flaga)
// i w audit_log (np. liczba zastosowanych vs zatwierdzonych), bez tresci zmian.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c08-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

// Dokument nie zawiera fragmentu drugiej zmiany: 1 z 2 zmian wchodzi.
vi.mock("../src/lib/chat/docx-edit", () => ({
    runEditDocument: vi.fn(async () => ({
        ok: true,
        version_id: "v2",
        version_number: 2,
        download_url: "/download/x",
        annotations: [{ index: 0, find: "Jan Testowy", replace: "Adam Probny" }],
        errors: [{ index: 1, reason: "Nie znaleziono fragmentu do zmiany." }],
    })),
    runAddComments: vi.fn(),
}));
vi.mock("../src/lib/chat/docx-generate", () => ({ generateDocx: vi.fn() }));

let db: any;
let userId = "";
let cardId = "";

beforeAll(async () => {
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { stageMutationApproval } = await import("../src/lib/mutation-approval");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    db = createServerSupabase();
    userId = LOCAL_USER_ID;
    const doc = await db
        .from("documents")
        .insert({ user_id: userId, filename: "umowa.docx", file_type: "docx", status: "ready" })
        .select()
        .single();
    const card = await stageMutationApproval(db, {
        userId,
        documentId: doc.data.id,
        toolName: "edit_document",
        toolPayload: {
            document_id: doc.data.id,
            edits: [
                { find: "Jan Testowy", replace: "Adam Probny" },
                { find: "kara umowna 10%", replace: "kara umowna 5%" },
            ],
        },
    });
    cardId = card!.id;
});

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("C-08 czesciowe wykonanie zatwierdzonej karty", () => {
    it("1 z 2 zatwierdzonych zmian weszla -> karta i audit_log odnotowuja czesciowe wykonanie", async () => {
        const { approveMutationApproval } = await import("../src/lib/mutation-approval");
        const { executeStagedTool } = await import("../src/lib/chat/mutation-approval-executor");
        const res = await approveMutationApproval(
            db,
            { id: cardId, userId, actorId: userId },
            (card) => executeStagedTool(card, userId, db),
        );
        expect(res.ok).toBe(true);
        // Sanity: wykonanie faktycznie bylo czesciowe (1 zastosowana, 1 blad).
        expect((res.execution?.result as any)?.errors?.length).toBe(1);

        const { data: dec } = await db.from("audit_log").select("*").eq("event_type", "mutation.approval.decision");
        const payload = dec[0].payload;
        const cardFlagged = res.card?.execution_error !== null && res.card?.execution_error !== undefined;
        const auditFlagged =
            payload.executed === false ||
            payload.execution_error_present === true ||
            typeof payload.applied === "number" ||
            typeof payload.failed === "number" ||
            payload.partial === true;
        // ZADANE: czesciowe wykonanie nie jest zapisane jako pelny sukces.
        expect(
            cardFlagged || auditFlagged,
            `karta.execution_error=${res.card?.execution_error} audit=${JSON.stringify(payload)}`,
        ).toBe(true);
    });
});
