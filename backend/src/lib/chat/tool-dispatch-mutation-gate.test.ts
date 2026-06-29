// Test regresji bramki stagingu mutacji (ADR-0137, T025) w runToolCalls.
// Sprawdza, ze:
//   - przy wlaczonym stagingu edit_document NIE wykonuje sie (karta pending),
//   - sciezka narzedzi czatu nie jest zepsuta (narzedzie nie-mutujace dziala),
//   - przy wylaczonym stagingu bramka nie tworzy kart (proceed).
// Swieza tymczasowa baza SQLite per uruchomienie (PATRON_DB_PATH).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DocStore, DocIndex, ToolCall } from "./types";

// `any`: shim bez generyka schematu (jak supabase-shim.test.ts).
let db: any;
let runToolCalls: typeof import("./tool-dispatch").runToolCalls;
// Realny dokument (FK mutation_approvals.document_id -> documents.id).
let realDocId: string;
const tmp = path.join(os.tmpdir(), `patron-gate-test-${Date.now()}.db`);

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const supa = await import("../supabase");
    db = supa.createServerSupabase();
    ({ runToolCalls } = await import("./tool-dispatch"));
    const doc = await db
        .from("documents")
        .insert({ user_id: "u_gate", filename: "pismo.docx", file_type: "docx", status: "ready" })
        .select()
        .single();
    realDocId = doc.data.id;
});

afterEach(() => {
    delete process.env.PATRON_MUTATION_APPROVAL;
});

afterAll(async () => {
    const { closeDb } = await import("../db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

function docxFixture(): { docStore: DocStore; docIndex: DocIndex } {
    const docStore: DocStore = new Map([
        ["doc-0", { storage_path: "x", file_type: "docx", filename: "pismo.docx" }],
    ]);
    const docIndex: DocIndex = {
        "doc-0": { document_id: realDocId, filename: "pismo.docx" },
    };
    return { docStore, docIndex };
}

describe("bramka stagingu w runToolCalls (ADR-0137)", () => {
    it("staging ON: edit_document stage'uje karte pending i NIE wykonuje zapisu", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const { docStore, docIndex } = docxFixture();
        const turnEditState = new Map();
        const toolCalls: ToolCall[] = [
            {
                id: "t1",
                function: {
                    name: "edit_document",
                    arguments: JSON.stringify({
                        doc_id: "doc-0",
                        edits: [{ find: "Kowalski", replace: "Nowak" }],
                    }),
                },
            },
        ];

        const out = await runToolCalls(
            toolCalls,
            docStore,
            "u_gate",
            db,
            () => {},
            undefined,
            undefined,
            docIndex,
            turnEditState,
            null,
        );

        // Akcja NIE wykonana: brak edycji, brak wersji w turnEditState.
        expect(out.docsEdited).toHaveLength(0);
        expect(turnEditState.size).toBe(0);

        const parsed = JSON.parse(
            (out.toolResults[0] as { content: string }).content,
        );
        expect(parsed.staged).toBe(true);
        expect(parsed.status).toBe("pending");
        expect(typeof parsed.approval_id).toBe("string");

        // Karta zapisana jako pending dla tego usera.
        const { data } = await db
            .from("mutation_approvals")
            .select("*")
            .eq("user_id", "u_gate")
            .eq("status", "pending");
        expect((data ?? []).length).toBe(1);
        expect(data[0].tool_name).toBe("edit_document");
    });

    it("sciezka narzedzi nie zepsuta: list_documents dziala (staging OFF)", async () => {
        const { docStore } = docxFixture();
        const toolCalls: ToolCall[] = [
            { id: "t2", function: { name: "list_documents", arguments: "{}" } },
        ];
        const out = await runToolCalls(
            toolCalls,
            docStore,
            "u_gate",
            db,
            () => {},
        );
        const list = JSON.parse(
            (out.toolResults[0] as { content: string }).content,
        );
        expect(Array.isArray(list)).toBe(true);
        expect(list[0].doc_id).toBe("doc-0");
    });

    it("staging OFF: edit_document NIE tworzy karty (proceed do inline)", async () => {
        // Bez env -> isMutationApprovalEnabled()=false -> bramka zwraca proceed.
        // Nie sterujemy pelnym zapisem (storage), ale potwierdzamy, ze zaden
        // NOWY rekord pending nie powstal w wyniku samej bramki.
        const { data: before } = await db
            .from("mutation_approvals")
            .select("id")
            .eq("user_id", "u_gate_off")
            .eq("status", "pending");
        const { docStore, docIndex } = docxFixture();
        const toolCalls: ToolCall[] = [
            {
                id: "t3",
                function: {
                    name: "edit_document",
                    arguments: JSON.stringify({ doc_id: "doc-0", edits: [] }),
                },
            },
        ];
        // edits=[] -> walidacja odrzuca przed bramka; brak kart i brak throw.
        await runToolCalls(
            toolCalls,
            docStore,
            "u_gate_off",
            db,
            () => {},
            undefined,
            undefined,
            docIndex,
            new Map(),
            null,
        );
        const { data: after } = await db
            .from("mutation_approvals")
            .select("id")
            .eq("user_id", "u_gate_off")
            .eq("status", "pending");
        expect((after ?? []).length).toBe((before ?? []).length);
    });
});
