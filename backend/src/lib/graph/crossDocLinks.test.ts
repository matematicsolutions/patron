// Testy rozwiazania to_doc_id w grafie cytowan (audyt P2 #11). Offline:
// PATRON_DISABLE_VEC=1 (BM25 + graf + encje, bez warstwy wektorowej).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let indexer: typeof import("../retrieval/indexer");
let graph: typeof import("./index");
let conn: typeof import("../db/sqlite-connection");
const tmp = path.join(os.tmpdir(), `patron-crossdoc-test-${Date.now()}.db`);

const SIG = "Sygn. akt III CZP 11/13";

function edgesForSig(): { from_doc_id: string; to_doc_id: string | null }[] {
    const db = conn.getDb();
    return db
        .prepare(
            `select cg.from_doc_id, cg.to_doc_id
             from citation_graph cg
             join extracted_entities e on e.id = cg.to_entity_id
             where e.entity_type = 'SYGNATURA_ORZECZENIA'
               and e.value_normalized like '%CZP 11/13%'`,
        )
        .all() as { from_doc_id: string; to_doc_id: string | null }[];
}

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DISABLE_VEC = "1";
    process.env.PATRON_DB_PATH = tmp;
    conn = await import("../db/sqlite-connection");
    conn.getDb();
    indexer = await import("../retrieval/indexer");
    graph = await import("./index");
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

describe("resolveToDocLinks (P2 #11)", () => {
    it("rozwiazuje to_doc_id gdy DOKLADNIE JEDEN inny dokument zawiera cytowana sygnature", async () => {
        // doc "wyrok" JEST wyrokiem o tej sygnaturze; doc "pismo" go cytuje.
        await indexer.indexDocument(
            "wyrok",
            `Wyrok Sadu Najwyzszego ${SIG} w sprawie zachowku.`,
        );
        await indexer.indexDocument(
            "pismo",
            `Powolujemy sie na wyrok ${SIG} oraz art. 991 KC.`,
        );
        // indexDocument wola resolveToDocLinks; krawedz "pismo" -> "wyrok".
        const edges = edgesForSig();
        const pismoEdge = edges.find((e) => e.from_doc_id === "pismo");
        expect(pismoEdge?.to_doc_id).toBe("wyrok");
        const wyrokEdge = edges.find((e) => e.from_doc_id === "wyrok");
        expect(wyrokEdge?.to_doc_id).toBe("pismo");
    });

    it("zostawia null gdy NIEJEDNOZNACZNIE wielu wlascicieli (>1)", async () => {
        // Trzeci dokument z ta sama sygnatura -> z perspektywy "pismo" wlasciciele
        // = {wyrok, wyrok2} (2) -> niejednoznacznie -> to_doc_id null.
        await indexer.indexDocument(
            "wyrok2",
            `Inny dokument tez przywoluje ${SIG} w tle.`,
        );
        const edges = edgesForSig();
        const pismoEdge = edges.find((e) => e.from_doc_id === "pismo");
        expect(pismoEdge?.to_doc_id).toBeNull();
    });

    it("jest idempotentny (ponowny przebieg = ten sam wynik)", () => {
        const before = edgesForSig()
            .map((e) => `${e.from_doc_id}->${e.to_doc_id}`)
            .sort();
        graph.resolveToDocLinks();
        graph.resolveToDocLinks();
        const after = edgesForSig()
            .map((e) => `${e.from_doc_id}->${e.to_doc_id}`)
            .sort();
        expect(after).toEqual(before);
    });

    it("clearDocumentIndex zeruje to_doc_id wskazujacy na usuwany dokument (nie kasuje cytatu)", async () => {
        // Czysty korpus: tylko 2 dokumenty -> jednoznaczne linki.
        const db = conn.getDb();
        db.exec("delete from citation_graph; delete from extracted_entities; delete from doc_chunks;");
        await indexer.indexDocument("A", `Wyrok ${SIG}.`);
        await indexer.indexDocument("B", `Cytat: ${SIG}.`);
        expect(edgesForSig().find((e) => e.from_doc_id === "B")?.to_doc_id).toBe("A");
        // Usun A: krawedz B->(sygnatura) zostaje, ale to_doc_id wyzerowany.
        indexer.clearDocumentIndex("A");
        const bEdge = edgesForSig().find((e) => e.from_doc_id === "B");
        expect(bEdge).toBeTruthy(); // cytat B nadal istnieje
        expect(bEdge?.to_doc_id).toBeNull(); // rozwiazany cel zniknal
    });
});
