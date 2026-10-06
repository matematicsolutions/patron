// R-TI-04: lib/documentIngest.ts przeniosl konwersje DOCX->PDF W TLO
// (`void renderPdfInBackground(...)`, l. ~366-375): ingest odpowiada 201 zanim
// powstanie podglad, a konwersja trwa 25-40 s NA DOKUMENT (komentarz convert.ts).
// renderPdfInBackground (l. ~57-90) po zakonczeniu konwersji BEZWARUNKOWO
// zapisuje converted-pdfs/<user>/<doc>.pdf i dopiero potem probuje zaktualizowac
// wiersz wersji - nie sprawdza, czy dokument nadal istnieje. Usuwanie dokumentu
// (DELETE /single-documents/:id, routes/documents.ts l. ~91-103) i RODO forget-case
// (lib/rodo/forget.ts l. ~95-114) kasuja pliki WYLACZNIE po sciezkach zapisanych w
// document_versions; w oknie konwersji pdf_storage_path jest jeszcze null. Skutek:
// dokument usuniety w trakcie konwersji zostawia na dysku pelna kopie PDF tresci
// sprawy, do ktorej nie prowadzi juz zaden wiersz bazy (sierota, poza zasiegiem
// RODO art. 17). Przed zmiana konwersja byla synchroniczna, wiec sciezka PDF trafiala
// do wersji ZANIM klient dostal id dokumentu.
// Oczekiwane: po usunieciu dokumentu na dysku nie zostaje zaden plik z jego trescia.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { gate } = vi.hoisted(() => {
    let release: () => void = () => {};
    const p = new Promise<void>((r) => { release = r; });
    return { gate: { p, release: () => release(), started: 0 } };
});

vi.mock("../src/lib/convert", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/convert")>();
    return {
        ...orig,
        isLibreOfficeAvailable: () => true,
        // Konwersja trwa (LibreOffice 25-40 s) - zwalniana recznie po usunieciu.
        docxToPdf: vi.fn(async () => {
            gate.started++;
            await gate.p;
            return Buffer.from("%PDF-1.4\n% Pozew Jana Testowego (rendition)\n%%EOF\n");
        }),
    };
});
vi.mock("../src/lib/retrieval/indexer", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/retrieval/indexer")>();
    return { ...orig, indexDocument: vi.fn(async () => {}) };
});

const tmpDb = path.join(os.tmpdir(), `patron-rti04-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-rti04-store-"));
let server: http.Server;
let base = "";
let conn: typeof import("../src/lib/db/sqlite-connection");

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DISABLE_VEC = "1";
    process.env.PATRON_STORAGE = "fs";
    process.env.PATRON_DB_PATH = tmpDb;
    process.env.PATRON_STORAGE_DIR = storeDir;
    conn = await import("../src/lib/db/sqlite-connection");
    conn.getDb();
    const express = (await import("express")).default;
    const { documentsRouter } = await import("../src/routes/documents");
    const app = express();
    app.use(express.json());
    app.use("/single-documents", documentsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => {
    server?.close();
    conn.closeDb();
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(storeDir, { recursive: true, force: true });
});

function plikiNaDysku(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...plikiNaDysku(full));
        else out.push(path.relative(storeDir, full).split(path.sep).join("/"));
    }
    return out;
}

describe("R-TI-04 podglad PDF w tle vs usuniecie dokumentu", () => {
    it("dokument usuniety w trakcie konwersji nie zostawia sieroty PDF w storage", async () => {
        const { Document, Packer, Paragraph } = await import("docx");
        const docx = await Packer.toBuffer(
            new Document({ sections: [{ children: [new Paragraph("Pozew Jana Testowego o zaplate.")] }] }),
        );
        const fd = new FormData();
        fd.append("file", new Blob([docx]), "pozew-jan-testowy.docx");
        const up = await fetch(`${base}/single-documents`, { method: "POST", body: fd });
        const body = (await up.json()) as { id?: string };
        expect(up.status, JSON.stringify(body)).toBe(201);
        const docId = body.id as string;
        expect(gate.started, "warunek: konwersja w tle wystartowala").toBe(1);

        // Uzytkownik usuwa dokument (np. pomylka) - konwersja jeszcze trwa.
        const del = await fetch(`${base}/single-documents/${docId}`, { method: "DELETE" });
        expect(del.status).toBe(204);
        const poUsunieciu = plikiNaDysku(storeDir).filter((f) => f.includes(docId));
        expect(poUsunieciu, "warunek: delete posprzatal to, o czym wiedzial").toEqual([]);

        gate.release(); // LibreOffice konczy
        await new Promise((r) => setTimeout(r, 300));

        const sieroty = plikiNaDysku(storeDir).filter((f) => f.includes(docId));
        const wiersz = conn.getDb().prepare("select count(*) c from documents where id = ?").get(docId) as { c: number };
        expect(wiersz.c, "warunek: dokumentu nie ma w bazie").toBe(0);
        expect(sieroty, "plik z trescia usunietego dokumentu zostal na dysku").toEqual([]);
    }, 60_000);
});
