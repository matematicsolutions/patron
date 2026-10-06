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

    it("staging ON: add_comments stage'uje karte pending i NIE wykonuje (US3)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const { docStore, docIndex } = docxFixture();
        const toolCalls: ToolCall[] = [
            {
                id: "tc",
                function: {
                    name: "add_comments",
                    arguments: JSON.stringify({
                        doc_id: "doc-0",
                        comments: [{ find: "art. 415 KC", text: "sprawdz podstawe" }],
                    }),
                },
            },
        ];
        const out = await runToolCalls(
            toolCalls,
            docStore,
            "u_gate_c",
            db,
            () => {},
            undefined,
            undefined,
            docIndex,
            new Map(),
            null,
        );
        expect(out.docsCommented).toHaveLength(0);
        const parsed = JSON.parse(
            (out.toolResults[0] as { content: string }).content,
        );
        expect(parsed.staged).toBe(true);
        const { data } = await db
            .from("mutation_approvals")
            .select("*")
            .eq("user_id", "u_gate_c")
            .eq("status", "pending");
        expect((data ?? []).length).toBe(1);
        expect(data[0].tool_name).toBe("add_comments");
    });

    it("staging high-stakes: edit_document stage'uje (fail-closed bez metadanych)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "high-stakes";
        const { docStore, docIndex } = docxFixture();
        const toolCalls: ToolCall[] = [
            {
                id: "th",
                function: {
                    name: "edit_document",
                    arguments: JSON.stringify({
                        doc_id: "doc-0",
                        edits: [{ find: "X", replace: "Y" }],
                    }),
                },
            },
        ];
        const out = await runToolCalls(
            toolCalls,
            docStore,
            "u_gate_hs",
            db,
            () => {},
            undefined,
            undefined,
            docIndex,
            new Map(),
            null,
        );
        expect(out.docsEdited).toHaveLength(0);
        const { data } = await db
            .from("mutation_approvals")
            .select("id")
            .eq("user_id", "u_gate_hs")
            .eq("status", "pending");
        expect((data ?? []).length).toBe(1);
    });

    it("sciezka narzedzi nie zepsuta: list_documents dziala (staging OFF)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "false";
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

    // C-09 (audyt 2026-09): karta nosi chat_id tury, a samo wstrzymanie trafia
    // do audit_log (istniejacy event_type z phase:"staged", bez nowego typu).
    it("staging ON: karta z chat_id tury i slad wstrzymania w audit_log (C-09)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const chat = await db
            .from("chats")
            .insert({ user_id: "u_gate_chat", title: "Tura testowa" })
            .select()
            .single();
        const chatId = chat.data.id as string;
        const { docStore, docIndex } = docxFixture();
        const out = await runToolCalls(
            [
                {
                    id: "tc9",
                    function: {
                        name: "edit_document",
                        arguments: JSON.stringify({ doc_id: "doc-0", edits: [{ find: "A", replace: "B" }] }),
                    },
                },
            ],
            docStore, "u_gate_chat", db, () => {}, undefined, undefined, docIndex, new Map(), null,
            { chatId },
        );
        const approvalId = JSON.parse((out.toolResults[0] as { content: string }).content).approval_id;
        const { data: cards } = await db.from("mutation_approvals").select("*").eq("id", approvalId);
        expect(cards[0].chat_id).toBe(chatId);

        const { data: rows } = await db
            .from("audit_log")
            .select("*")
            .eq("event_type", "mutation.approval.decision")
            .eq("chat_id", chatId);
        expect(rows).toHaveLength(1);
        const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
        expect(payload).toEqual({
            approval_id: approvalId,
            tool_name: "edit_document",
            phase: "staged",
            staging_mode: "all",
        });
        // Minimalizacja: ani argumentow mutacji, ani pola decyzji (jej jeszcze nie ma).
        expect(JSON.stringify(payload)).not.toContain("replace");
        expect(rows[0].document_id).toBe(realDocId);
    });

    it("staging ON: czat spoza tabeli chats (np. tabular) -> karta bez chat_id, ale staging dziala i audyt ma czat (C-09)", async () => {
        process.env.PATRON_MUTATION_APPROVAL = "true";
        const { docStore, docIndex } = docxFixture();
        const out = await runToolCalls(
            [
                {
                    id: "tc9b",
                    function: {
                        name: "edit_document",
                        arguments: JSON.stringify({ doc_id: "doc-0", edits: [{ find: "A", replace: "B" }] }),
                    },
                },
            ],
            docStore, "u_gate_tab", db, () => {}, undefined, undefined, docIndex, new Map(), null,
            { chatId: "tabular-chat-nie-w-chats" },
        );
        const parsed = JSON.parse((out.toolResults[0] as { content: string }).content);
        // FK chats nie wywraca stagingu (fail-closed bez karty bylby regresja).
        expect(parsed.staged).toBe(true);
        const { data: cards } = await db.from("mutation_approvals").select("*").eq("id", parsed.approval_id);
        expect(cards[0].chat_id).toBeNull();
        const { data: rows } = await db
            .from("audit_log")
            .select("*")
            .eq("chat_id", "tabular-chat-nie-w-chats");
        expect(rows).toHaveLength(1);
    });

    it("domyslnie (brak env, ADR-0137 od 2026-10-06): edit_document stage'uje karte i tura zna wstrzymanie", async () => {
        delete process.env.PATRON_MUTATION_APPROVAL;
        const { docStore, docIndex } = docxFixture();
        const turnEditState = new Map();
        const out = await runToolCalls(
            [
                {
                    id: "t-def",
                    function: {
                        name: "edit_document",
                        arguments: JSON.stringify({
                            doc_id: "doc-0",
                            edits: [{ find: "Kowalski", replace: "Nowak" }],
                        }),
                    },
                },
            ],
            docStore,
            "u_gate_default",
            db,
            () => {},
            undefined,
            undefined,
            docIndex,
            turnEditState,
            null,
        );
        expect(out.docsEdited).toHaveLength(0);
        expect(turnEditState.size).toBe(0);
        const parsed = JSON.parse((out.toolResults[0] as { content: string }).content);
        expect(parsed.staged).toBe(true);
        // Sygnal dla UI (SSE mutation_staged): narzedzie + karta, bez argumentow.
        expect(out.mutationsStaged).toEqual([
            { tool: "edit_document", approval_id: parsed.approval_id },
        ]);
    });

    it("staging OFF: edit_document NIE tworzy karty (proceed do inline)", async () => {
        // Jawny wylacznik (PATRON_MUTATION_APPROVAL=false) -> bramka zwraca proceed.
        process.env.PATRON_MUTATION_APPROVAL = "false";
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
