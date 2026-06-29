// Testy warstwy kart zatwierdzenia mutacji (ADR-0137). Swieza tymczasowa baza
// SQLite per uruchomienie (PATRON_DB_PATH) - jak supabase-shim.test.ts.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `any`: createServerSupabase() zwraca shim bez generyka schematu - luzny typ
// w tescie jest swiadomy (jak w supabase-shim.test.ts).
let db: any;
let mod: typeof import("./mutation-approval");
// Realny dokument (FK mutation_approvals.document_id -> documents.id).
let docId: string;
const tmp = path.join(os.tmpdir(), `patron-mutapproval-test-${Date.now()}.db`);

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const supa = await import("./supabase");
    db = supa.createServerSupabase();
    mod = await import("./mutation-approval");
    const doc = await db
        .from("documents")
        .insert({ user_id: "u1", filename: "pismo.docx", file_type: "docx", status: "ready" })
        .select()
        .single();
    docId = doc.data.id;
});

afterAll(async () => {
    const { closeDb } = await import("./db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

async function countAuditDecisions(): Promise<number> {
    const { data } = await db
        .from("audit_log")
        .select("id")
        .eq("event_type", "mutation.approval.decision");
    return (data ?? []).length;
}

describe("canTransition (reguly przejsc, fail-closed)", () => {
    it("tylko pending -> approved/rejected; terminalne stany zablokowane", () => {
        expect(mod.canTransition("pending", "approved")).toBe(true);
        expect(mod.canTransition("pending", "rejected")).toBe(true);
        expect(mod.canTransition("approved", "rejected")).toBe(false);
        expect(mod.canTransition("rejected", "approved")).toBe(false);
        expect(mod.canTransition("approved", "approved")).toBe(false);
    });
});

describe("isMutationApprovalEnabled (env opt-in)", () => {
    it("domyslnie OFF; ON tylko przy PATRON_MUTATION_APPROVAL=true", () => {
        const prev = process.env.PATRON_MUTATION_APPROVAL;
        delete process.env.PATRON_MUTATION_APPROVAL;
        expect(mod.isMutationApprovalEnabled()).toBe(false);
        process.env.PATRON_MUTATION_APPROVAL = "true";
        expect(mod.isMutationApprovalEnabled()).toBe(true);
        process.env.PATRON_MUTATION_APPROVAL = "1";
        expect(mod.isMutationApprovalEnabled()).toBe(false);
        if (prev === undefined) delete process.env.PATRON_MUTATION_APPROVAL;
        else process.env.PATRON_MUTATION_APPROVAL = prev;
    });
});

describe("stageMutationApproval + scoping", () => {
    it("tworzy karte pending z round-trip tool_payload i scoping user_id", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            chatId: null,
            documentId: docId,
            toolName: "edit_document",
            toolPayload: { document_id: docId, edits: [{ find: "a", replace: "b" }] },
        });
        expect(card).not.toBeNull();
        expect(card!.status).toBe("pending");
        expect(card!.user_id).toBe("u1");
        expect(card!.tool_name).toBe("edit_document");
        // jsonb round-trip przez shim (JSON_COLUMNS.mutation_approvals).
        expect((card!.tool_payload.edits as unknown[]).length).toBe(1);
        expect(card!.staged_by).toBe("u1");
    });

    it("getPendingApprovals zwraca tylko karty danego usera", async () => {
        await mod.stageMutationApproval(db, {
            userId: "u2",
            toolName: "generate_docx",
            toolPayload: { title: "Pismo" },
        });
        const u1 = await mod.getPendingApprovals(db, "u1");
        const u2 = await mod.getPendingApprovals(db, "u2");
        expect(u1.every((c) => c.user_id === "u1")).toBe(true);
        expect(u2.every((c) => c.user_id === "u2")).toBe(true);
        expect(u2.length).toBe(1);
    });

    it("getApprovalById nie zwraca karty innego usera (izolacja)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u3",
            toolName: "edit_document",
            toolPayload: {},
        });
        expect(await mod.getApprovalById(db, "u3", card!.id)).not.toBeNull();
        expect(await mod.getApprovalById(db, "u_other", card!.id)).toBeNull();
    });
});

describe("approveMutationApproval (wykonuje + audytuje)", () => {
    it("pending -> approved, executor wywolany, executed_at + audit (decision=approved)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            documentId: docId,
            toolName: "edit_document",
            toolPayload: { ok: true },
        });
        const before = await countAuditDecisions();
        let executedWith: string | null = null;
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async (c) => {
                executedWith = c.id;
                return { ok: true, result: { version_id: "v1" } };
            },
        );
        expect(res.ok).toBe(true);
        expect(executedWith).toBe(card!.id);
        expect(res.card!.status).toBe("approved");
        expect(res.card!.approved_by).toBe("u1");
        expect(res.card!.executed_at).not.toBeNull();
        expect(res.card!.execution_error).toBeNull();
        expect(await countAuditDecisions()).toBe(before + 1);
    });

    it("executor zawodzi -> karta approved, execution_error ustawiony, ok=true (decyzja zaszla)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "generate_docx",
            toolPayload: {},
        });
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async () => ({ ok: false, error: "dokument zmieniony" }),
        );
        expect(res.ok).toBe(true);
        expect(res.execution!.ok).toBe(false);
        expect(res.card!.status).toBe("approved");
        expect(res.card!.executed_at).toBeNull();
        expect(res.card!.execution_error).toBe("dokument zmieniony");
    });

    it("fail-closed: brak karty -> 404; powtorne approve -> 409; nie-czlowiek -> 403", async () => {
        expect(
            (await mod.approveMutationApproval(db, { id: "nope", userId: "u1", actorId: "u1" }, async () => ({ ok: true }))).status,
        ).toBe(404);

        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        await mod.approveMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" }, async () => ({ ok: true }));
        const second = await mod.approveMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" }, async () => ({ ok: true }));
        expect(second.status).toBe(409);

        const card2 = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        const nonHuman = await mod.approveMutationApproval(db, { id: card2!.id, userId: "u1", actorId: "system" }, async () => ({ ok: true }));
        expect(nonHuman.status).toBe(403);
    });
});

describe("rejectMutationApproval (zamyka + audytuje, bez wykonania)", () => {
    it("pending -> rejected z powodem, audit (decision=rejected)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        const before = await countAuditDecisions();
        const res = await mod.rejectMutationApproval(db, {
            id: card!.id,
            userId: "u1",
            actorId: "u1",
            reason: "niezgodne ze stanowiskiem",
        });
        expect(res.ok).toBe(true);
        expect(res.card!.status).toBe("rejected");
        expect(res.card!.rejection_reason).toBe("niezgodne ze stanowiskiem");
        expect(res.card!.executed_at).toBeNull();
        expect(await countAuditDecisions()).toBe(before + 1);
    });

    it("fail-closed: reject juz odrzuconej -> 409", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        await mod.rejectMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" });
        const second = await mod.rejectMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" });
        expect(second.status).toBe(409);
    });
});
