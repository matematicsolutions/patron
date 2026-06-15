// Testy batcha hygieny retrievalu: P3 #14 (overlap chunkow), P3 #15 (prefix-match
// PL w buildFtsMatch), P2 #8 (wersjonowanie embeddera - reconcileEmbedderMeta).

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkText } from "./indexer";
import { buildFtsMatch } from "./retrieval";
import { reconcileEmbedderMeta } from "../db/sqlite-connection";

describe("P3 #14: overlap chunkow", () => {
    it("sasiednie chunki maja zakladke (ogon poprzedniego na poczatku nastepnego)", () => {
        // Dwa dlugie akapity -> co najmniej 2 chunki.
        const para = (w: string) => Array.from({ length: 120 }, () => w).join(" ");
        const text = `${para("alfa")}\n\n${para("beta")}`;
        const chunks = chunkText(text);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        // Drugi chunk zaczyna sie od ogona pierwszego (overlap) - zawiera "alfa".
        expect(chunks[1].content.startsWith("alfa")).toBe(true);
    });

    it("pojedynczy chunk i pusty tekst - bez zmian (zero regresji)", () => {
        expect(chunkText("")).toEqual([]);
        const one = chunkText("Krotka notatka.");
        expect(one).toEqual([{ index: 0, content: "Krotka notatka." }]);
    });

    it("overlapChars=0 wylacza zakladke", () => {
        const para = (w: string) => Array.from({ length: 120 }, () => w).join(" ");
        const text = `${para("alfa")}\n\n${para("beta")}`;
        const noOverlap = chunkText(text, 900, 200, 0);
        expect(noOverlap[1].content.startsWith("beta")).toBe(true);
    });
});

describe("P3 #15: prefix-match PL w buildFtsMatch", () => {
    it("dlugi token slowny -> prefix rdzenia (lapie formy odmienione)", () => {
        const m = buildFtsMatch("oskarzonego")!;
        expect(m).toContain("*");
        // rdzen jest prefiksem formy bazowej
        const stem = m.replace("*", "");
        expect("oskarzony".startsWith(stem)).toBe(true);
        expect("oskarzonemu".startsWith(stem)).toBe(true);
    });

    it("sygnatury/krotkie/liczby zostaja exact (bez prefiksu)", () => {
        const m = buildFtsMatch("III CZP 11/13")!;
        expect(m).toContain('"iii"');
        expect(m).toContain('"czp"');
        expect(m).toContain('"11"');
        expect(m).not.toContain("*");
        expect(m).toContain(" OR ");
    });

    it("pusty/niealfanumeryczny -> null", () => {
        expect(buildFtsMatch("   ")).toBeNull();
    });
});

describe("P2 #8: reconcileEmbedderMeta (wersjonowanie embeddera)", () => {
    const tmp = path.join(os.tmpdir(), `patron-embmeta-${Date.now()}.db`);
    let db: Database.Database;

    beforeAll(() => {
        db = new Database(tmp);
        db.exec(
            `create table retrieval_meta (key text primary key, value text not null);
             create table doc_chunks (id integer primary key, document_id text, embedding_model text);
             create table vec_chunks (rowid integer primary key, embedding blob);`,
        );
    });
    afterAll(() => {
        db.close();
        for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
            try {
                fs.unlinkSync(f);
            } catch {
                /* ignore */
            }
        }
    });

    const hasVec = () =>
        !!db
            .prepare(
                "select name from sqlite_master where type='table' and name='vec_chunks'",
            )
            .get();

    it("pierwszy raz -> 'fresh', zapisuje meta", () => {
        expect(reconcileEmbedderMeta(db, 384, "modelA")).toBe("fresh");
        const dim = db
            .prepare("select value from retrieval_meta where key='embed_dim'")
            .get() as { value: string };
        expect(dim.value).toBe("384");
    });

    it("te same wartosci -> 'unchanged', vec_chunks zostaje", () => {
        expect(reconcileEmbedderMeta(db, 384, "modelA")).toBe("unchanged");
        expect(hasVec()).toBe(true);
    });

    it("zmiana modelu (ten sam wymiar) -> 'model-changed', BEZ dropu vec", () => {
        expect(reconcileEmbedderMeta(db, 384, "modelB")).toBe("model-changed");
        expect(hasVec()).toBe(true);
    });

    it("niezgodnosc wymiaru -> 'dim-mismatch', DROP vec_chunks + zerowanie znacznikow", () => {
        db.prepare(
            "insert into doc_chunks (id, document_id, embedding_model) values (1,'d','modelB')",
        ).run();
        expect(reconcileEmbedderMeta(db, 512, "modelB")).toBe("dim-mismatch");
        expect(hasVec()).toBe(false);
        const row = db
            .prepare("select embedding_model from doc_chunks where id=1")
            .get() as { embedding_model: string | null };
        expect(row.embedding_model).toBeNull();
        // nowy wymiar zapisany
        const dim = db
            .prepare("select value from retrieval_meta where key='embed_dim'")
            .get() as { value: string };
        expect(dim.value).toBe("512");
    });
});
