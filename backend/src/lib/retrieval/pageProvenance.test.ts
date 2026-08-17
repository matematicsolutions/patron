// Testy proweniencji strony (audyt P2 #10): parser markerow [Page N] +
// przypisanie page_no do chunkow i zwrot w retrieve. Offline (PATRON_DISABLE_VEC).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitByPageMarkers } from "./indexer";

let indexer: typeof import("./indexer");
let retrieval: typeof import("./retrieval");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-page-test-${Date.now()}.db`);

describe("splitByPageMarkers (pure)", () => {
    it("brak markerow -> jeden segment page=null (back-compat)", () => {
        const segs = splitByPageMarkers("Zwykly tekst bez stron.");
        expect(segs).toEqual([{ page: null, text: "Zwykly tekst bez stron." }]);
    });

    it("rozbija po [Page N] i odrywa marker od tresci", () => {
        const segs = splitByPageMarkers("[Page 1]\nAlfa beta.\n\n[Page 2]\nGamma delta.");
        expect(segs.length).toBe(2);
        expect(segs[0].page).toBe(1);
        expect(segs[0].text).toContain("Alfa beta");
        expect(segs[0].text).not.toContain("[Page");
        expect(segs[1].page).toBe(2);
        expect(segs[1].text).toContain("Gamma delta");
    });

    it("tekst przed pierwszym markerem -> segment page=null", () => {
        const segs = splitByPageMarkers("Wstep.\n\n[Page 1]\nTresc.");
        expect(segs[0].page).toBeNull();
        expect(segs[0].text).toContain("Wstep");
        expect(segs[1].page).toBe(1);
    });
});

describe("page_no end-to-end (indexDocument + retrieve)", () => {
    beforeAll(async () => {
        process.env.PATRON_DB_BACKEND = "sqlite";
        process.env.PATRON_DISABLE_VEC = "1";
        process.env.PATRON_DB_PATH = tmp;
        conn = await import("../db/sqlite-connection");
        conn.getDb();
        indexer = await import("./indexer");
        retrieval = await import("./retrieval");
    });

    afterAll(() => {
        conn.closeDb();
        for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
            try {
                fs.unlinkSync(f);
            } catch {
                /* ignore */
            }
        }
    });

    it("przypisuje page_no z markerow i zwraca w retrieve", async () => {
        await indexer.indexDocument(
            "doc-pdf",
            "[Page 1]\nWprowadzenie do sprawy zachowku i darowizn.\n\n" +
                "[Page 2]\nBieglY stwierdzil sprzecznosc w wyliczeniu substratu zachowku.",
        );
        const hits = await retrieval.retrieve("substrat zachowku biegly", 5, {
            vec: false,
        });
        expect(hits.length).toBeGreaterThan(0);
        const onP2 = hits.find((h) => /substrat/i.test(h.content));
        expect(onP2?.pageNo).toBe(2);
        // tresc chunku nie zawiera markera strony
        expect(hits.every((h) => !/\[Page/.test(h.content))).toBe(true);
    });

    it("zrodlo bez markerow -> page_no null (back-compat)", async () => {
        await indexer.indexDocument(
            "doc-plain",
            "Notatka bez numeracji stron o art. 991 KC i roszczeniu o zachowek.",
        );
        const hits = await retrieval.retrieve("art. 991 zachowek roszczenie", 5, {
            vec: false,
        });
        const h = hits.find((x) => x.documentId === "doc-plain");
        expect(h).toBeTruthy();
        expect(h?.pageNo).toBeNull();
    });
});
