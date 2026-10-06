// Executor kart zatwierdzenia (ADR-0137) a wykonanie czesciowe (audyt C-08):
// runEditDocument / runAddComments zwracaja ok:true, gdy weszla choc jedna
// pozycja, a reszte oddaja w errors[]. Executor musi to przeniesc do jawnych
// liczb (counts) i do result (requested / applied / failed / partial / errors).

import { describe, expect, it, vi } from "vitest";
import type { MutationApproval } from "../mutation-approval";

const { runEditDocument, runAddComments } = vi.hoisted(() => ({
    runEditDocument: vi.fn(),
    runAddComments: vi.fn(),
}));
vi.mock("./docx-edit", () => ({ runEditDocument, runAddComments }));
vi.mock("./docx-generate", () => ({ generateDocx: vi.fn() }));

import { executeStagedTool } from "./mutation-approval-executor";

function card(tool: MutationApproval["tool_name"], payload: Record<string, unknown>): MutationApproval {
    return {
        id: "c1",
        user_id: "u1",
        chat_id: null,
        document_id: "d1",
        tool_name: tool,
        tool_payload: payload,
        status: "approved",
        staged_at: "",
        staged_by: "u1",
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
        executed_at: null,
        execution_error: null,
        created_at: "",
        updated_at: "",
    };
}

const okRun = (applied: number, errors: { index: number; reason: string }[]) => ({
    ok: true,
    version_id: "v2",
    version_number: 2,
    storage_path: "p",
    download_url: "/d",
    annotations: Array.from({ length: applied }, () => ({})),
    errors,
});

describe("executeStagedTool - liczby wykonania (C-08)", () => {
    it("edit_document: 1 z 2 zmian -> counts + result.partial", async () => {
        runEditDocument.mockResolvedValueOnce(okRun(1, [{ index: 1, reason: "Nie znaleziono." }]));
        const r = await executeStagedTool(card("edit_document", { edits: [{}, {}] }), "u1", {} as never);
        expect(r.ok).toBe(true);
        expect(r.counts).toEqual({ requested: 2, applied: 1, failed: 1 });
        expect(r.failures).toEqual([{ index: 1, reason: "Nie znaleziono." }]);
        expect(r.result).toMatchObject({ requested: 2, applied: 1, failed: 1, partial: true });
    });

    it("add_comments: wszystkie weszly -> failed 0, partial false", async () => {
        runAddComments.mockResolvedValueOnce(okRun(2, []));
        const r = await executeStagedTool(card("add_comments", { comments: [{}, {}] }), "u1", {} as never);
        expect(r.counts).toEqual({ requested: 2, applied: 2, failed: 0 });
        expect(r.result).toMatchObject({ partial: false, errors: [] });
    });
});
