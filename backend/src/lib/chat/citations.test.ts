import { describe, expect, it } from "vitest";
import {
    CITATIONS_BLOCK_RE,
    normalizeCitation,
    parseCitations,
    resolveDoc,
    resolveDocLabel,
} from "./citations";
import type { DocIndex, DocStore } from "./types";

describe("normalizeCitation", () => {
    it("akceptuje minimalny poprawny rekord", () => {
        const c = normalizeCitation({
            ref: 1,
            doc_id: "doc-0",
            page: 3,
            quote: "tekst",
        });
        expect(c).toEqual({ ref: 1, doc_id: "doc-0", page: 3, quote: "tekst" });
    });

    it("akceptuje wariant historyczny marker + text", () => {
        const c = normalizeCitation({
            marker: "[2]",
            doc_id: "doc-1",
            page: 5,
            text: "treść",
        });
        expect(c).toEqual({ ref: 2, doc_id: "doc-1", page: 5, quote: "treść" });
    });

    it("akceptuje page jako zakres N-M", () => {
        const c = normalizeCitation({
            ref: 1,
            doc_id: "doc-0",
            page: "41-42",
            quote: "fraza",
        });
        expect(c?.page).toBe("41-42");
    });

    it("page niepoprawne -> domyslnie 1", () => {
        const c = normalizeCitation({
            ref: 1,
            doc_id: "doc-0",
            page: "abc",
            quote: "fraza",
        });
        expect(c?.page).toBe(1);
    });

    it("odrzuca rekord bez ref ani marker", () => {
        expect(
            normalizeCitation({ doc_id: "doc-0", page: 1, quote: "x" }),
        ).toBeNull();
    });

    it("odrzuca pusty quote", () => {
        expect(
            normalizeCitation({ ref: 1, doc_id: "doc-0", page: 1, quote: "" }),
        ).toBeNull();
    });

    it("odrzuca brak doc_id", () => {
        expect(
            normalizeCitation({ ref: 1, page: 1, quote: "x" }),
        ).toBeNull();
    });

    it("odrzuca null i string", () => {
        expect(normalizeCitation(null)).toBeNull();
        expect(normalizeCitation("foo")).toBeNull();
    });
});

describe("parseCitations", () => {
    it("zwraca puste gdy brak bloku <CITATIONS>", () => {
        expect(parseCitations("Sama proza bez cytatow.")).toEqual([]);
    });

    it("parsuje pojedynczy cytat", () => {
        const text = `Cos tam [1].\n<CITATIONS>\n[{"ref":1,"doc_id":"doc-0","page":2,"quote":"X"}]\n</CITATIONS>`;
        const out = parseCitations(text);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ ref: 1, doc_id: "doc-0", quote: "X" });
    });

    it("filtruje niepoprawne rekordy w tablicy", () => {
        const text = `<CITATIONS>[{"ref":1,"doc_id":"doc-0","page":1,"quote":"OK"},{"ref":2}]</CITATIONS>`;
        const out = parseCitations(text);
        expect(out).toHaveLength(1);
        expect(out[0].ref).toBe(1);
    });

    it("zepsuty JSON -> puste", () => {
        const text = `<CITATIONS>nie jest jsonem</CITATIONS>`;
        expect(parseCitations(text)).toEqual([]);
    });

    it("blok ktorego JSON nie jest tablica -> puste", () => {
        const text = `<CITATIONS>{"ref":1}</CITATIONS>`;
        expect(parseCitations(text)).toEqual([]);
    });
});

describe("CITATIONS_BLOCK_RE", () => {
    it("dopasowuje wieloliniowy blok", () => {
        const text = `prefiks\n<CITATIONS>\n[1,2]\n</CITATIONS>\nsufiks`;
        const m = text.match(CITATIONS_BLOCK_RE);
        expect(m).not.toBeNull();
        expect(m![1].trim()).toBe("[1,2]");
    });
});

describe("resolveDoc / resolveDocLabel", () => {
    const docIndex: DocIndex = {
        "doc-0": {
            document_id: "uuid-a",
            filename: "nda.docx",
            version_id: "v1",
            version_number: 1,
        },
        "doc-1": {
            document_id: "uuid-b",
            filename: "msa.docx",
        },
    };
    const docStore: DocStore = new Map([
        [
            "doc-0",
            {
                storage_path: "/x/nda.docx",
                file_type: "docx",
                filename: "nda.docx",
            },
        ],
        [
            "doc-1",
            {
                storage_path: "/x/msa.docx",
                file_type: "docx",
                filename: "msa.docx",
            },
        ],
    ]);

    it("resolveDoc zwraca rekord po slug-u", () => {
        expect(resolveDoc("doc-0", docIndex)?.filename).toBe("nda.docx");
    });

    it("resolveDocLabel: slug -> ten sam slug", () => {
        expect(resolveDocLabel("doc-0", docStore)).toBe("doc-0");
    });

    it("resolveDocLabel: filename -> slug", () => {
        expect(resolveDocLabel("msa.docx", docStore)).toBe("doc-1");
    });

    it("resolveDocLabel: document_id (UUID) -> slug", () => {
        expect(resolveDocLabel("uuid-a", docStore, docIndex)).toBe("doc-0");
    });

    it("resolveDocLabel: nieznany identyfikator -> null", () => {
        expect(resolveDocLabel("nie-istnieje", docStore, docIndex)).toBeNull();
    });
});
