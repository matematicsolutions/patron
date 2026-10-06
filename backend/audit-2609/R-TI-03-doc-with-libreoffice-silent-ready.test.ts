// R-TI-03: lib/documentIngest.ts (zmiana z 2026-09-09) uzaleznia przyjecie `.doc`
// od isLibreOfficeAvailable() i uzasadnia to tak (l. ~43-48): bez LibreOffice
// ".doc ... ekstrakcja pada, tekst jest pusty, dokument nie wchodzi do indeksu ...
// konczylo sie to CICHO - plik ladowal ze statusem ready". Ale LibreOffice NIE jest
// uzywany do ekstrakcji tekstu: tekst `.doc` dalej idzie przez convertToMarkdown ->
// extractDocxBodyText (parser ZIP/OOXML, convert/toMarkdown.ts l. 37/94), a jedynym
// uzyciem LibreOffice jest podglad PDF W TLE (renderPdfInBackground). Na maszynie
// Z LibreOffice (tryb serwerowy: Dockerfile go instaluje) binarny `.doc` dalej:
// ekstrakcja pada -> scanText "" -> skan input-security na pustym tekscie -> 201
// "ready" -> brak indeksu. Opisany defekt nie jest naprawiony tam, gdzie .doc jest
// przyjmowany. Oczekiwane: .doc przyjety jako "ready" ma tekst (zindeksowany),
// albo ingest jawnie odmawia/oznacza blad.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { indexed } = vi.hoisted(() => ({ indexed: [] as { docId: string; len: number }[] }));

vi.mock("../src/lib/convert", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/convert")>();
    return {
        ...orig,
        isLibreOfficeAvailable: () => true, // srodowisko z LibreOffice (np. obraz Docker)
        docxToPdf: vi.fn(async () => { throw new Error("konwersja w tle - nieistotna tu"); }),
    };
});
vi.mock("../src/lib/retrieval/indexer", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/retrieval/indexer")>();
    return {
        ...orig,
        indexDocument: vi.fn(async (docId: string, text: string) => {
            indexed.push({ docId, len: text.length });
        }),
    };
});

const tmpDb = path.join(os.tmpdir(), `patron-rti03-${Date.now()}.db`);
const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), "patron-rti03-store-"));
let ingest: typeof import("../src/lib/documentIngest");
let conn: typeof import("../src/lib/db/sqlite-connection");
let db: any;

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DISABLE_VEC = "1";
    process.env.PATRON_STORAGE = "fs";
    process.env.PATRON_DB_PATH = tmpDb;
    process.env.PATRON_STORAGE_DIR = tmpStore;
    conn = await import("../src/lib/db/sqlite-connection");
    conn.getDb();
    ingest = await import("../src/lib/documentIngest");
    db = (await import("../src/lib/supabase")).createServerSupabase();
}, 60_000);

afterAll(() => {
    conn.closeDb();
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(tmpStore, { recursive: true, force: true });
});

/** Binarny Word 97-2003: naglowek OLE/CFB (D0 CF 11 E0 A1 B1 1A E1) + tresc. */
function oleDoc(): Buffer {
    const head = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const body = Buffer.alloc(4096, 0);
    Buffer.from("Pozew Jana Testowego o zaplate 12 000 zl", "latin1").copy(body, 1024);
    return Buffer.concat([head, body]);
}

describe("R-TI-03 .doc przy dostepnym LibreOffice", () => {
    it("przyjety jako ready, ale bez tekstu i bez indeksu = cichy sukces", async () => {
        const r = await ingest.ingestDocument({
            content: oleDoc(),
            filename: "pozew-jan-testowy.doc",
            userId: "u1",
            projectId: null,
            db,
        });
        await new Promise((res) => setTimeout(res, 50)); // indeksacja idzie w tle (void)
        const row = r.documentId
            ? (conn.getDb().prepare("select status from documents where id = ?").get(r.documentId) as { status: string })
            : null;
        const wynik = {
            httpStatus: r.httpStatus,
            status: row?.status ?? null,
            zindeksowany: indexed.some((i) => i.docId === r.documentId && i.len > 0),
        };
        // Dopuszczalne: odmowa (>=400) ALBO status != ready ALBO tekst w indeksie.
        const cichySukces = wynik.httpStatus < 400 && wynik.status === "ready" && !wynik.zindeksowany;
        expect(cichySukces, `wynik=${JSON.stringify(wynik)}`).toBe(false);
    }, 60_000);
});
