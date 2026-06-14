// Testy scope RAG (audyt P2 #5) - izolacja tajemnicy miedzy sprawami.
// Swieza tymczasowa baza SQLite per uruchomienie (PATRON_DB_PATH).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let db: any;
let resolveSearchScope: typeof import("./tool-dispatch").resolveSearchScope;
const tmp = path.join(os.tmpdir(), `patron-scope-test-${Date.now()}.db`);

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    process.env.PATRON_DISABLE_VEC = "1";
    const supa = await import("../supabase");
    db = supa.createServerSupabase();
    ({ resolveSearchScope } = await import("./tool-dispatch"));

    // Sprawa A z 2 dokumentami, sprawa B z 1, oraz 1 dokument standalone.
    await db.from("projects").insert({ id: "projA", user_id: "u1", name: "Sprawa A" });
    await db.from("projects").insert({ id: "projB", user_id: "u1", name: "Sprawa B" });
    for (const [id, project_id] of [
        ["docA1", "projA"],
        ["docA2", "projA"],
        ["docB1", "projB"],
        ["docLoose", null],
    ] as const) {
        await db.from("documents").insert({
            id,
            user_id: "u1",
            project_id,
            filename: `${id}.pdf`,
            file_type: "pdf",
            status: "ready",
        });
    }
});

afterEach(() => {
    delete process.env.PATRON_RAG_CROSS_CASE;
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

describe("resolveSearchScope (P2 #5)", () => {
    it("czat sprawy -> tylko dokumenty tej sprawy", async () => {
        const r = await resolveSearchScope(db, "projA");
        expect(r.documentIds?.sort()).toEqual(["docA1", "docA2"]);
        expect(r.crossCase).toBe(false);
    });

    it("czat ogolny (bez sprawy) -> DOMYSLNIE tylko dokumenty standalone, NIE akta spraw", async () => {
        const r = await resolveSearchScope(db, null);
        expect(r.documentIds).toEqual(["docLoose"]);
        expect(r.documentIds).not.toContain("docA1");
        expect(r.documentIds).not.toContain("docB1");
        expect(r.crossCase).toBe(false);
        expect(r.scopeNote).toMatch(/izolacj/i);
    });

    it("documentIds=[] (gdy brak standalone) => retrieve zwroci zero, nie caly korpus", async () => {
        // potwierdzamy semantyke: czat ogolny nigdy nie zwraca undefined (caly korpus)
        const r = await resolveSearchScope(db, null);
        expect(r.documentIds).not.toBeUndefined();
    });

    it("PATRON_RAG_CROSS_CASE=true -> caly korpus (undefined) + flaga + ostrzezenie", async () => {
        process.env.PATRON_RAG_CROSS_CASE = "true";
        const r = await resolveSearchScope(db, null);
        expect(r.documentIds).toBeUndefined();
        expect(r.crossCase).toBe(true);
        expect(r.scopeNote).toMatch(/przekrojow/i);
    });

    it("cross-case NIE dotyczy czatu sprawy (projectId ma priorytet)", async () => {
        process.env.PATRON_RAG_CROSS_CASE = "true";
        const r = await resolveSearchScope(db, "projB");
        expect(r.documentIds).toEqual(["docB1"]);
        expect(r.crossCase).toBe(false);
    });
});
