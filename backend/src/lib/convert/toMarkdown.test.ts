import { describe, it, expect, vi } from "vitest";
import {
    convertToMarkdown,
    hasEnoughText,
    isImage,
    isSupportedConvertType,
    suffixOf,
    type ConvertDeps,
} from "./toMarkdown";

function deps(over: Partial<ConvertDeps> = {}): {
    deps: ConvertDeps;
    ocr: ReturnType<typeof vi.fn>;
    pdf: ReturnType<typeof vi.fn>;
    docx: ReturnType<typeof vi.fn>;
} {
    const ocr = vi.fn(async () => "TEKST Z OCR");
    const pdf = vi.fn(async () => "[Page 1]\n");
    const docx = vi.fn(async () => "# Umowa\nTresc docx");
    return {
        deps: {
            extractPdfText: over.extractPdfText ?? (pdf as ConvertDeps["extractPdfText"]),
            extractDocxText: over.extractDocxText ?? (docx as ConvertDeps["extractDocxText"]),
            ocr: over.ocr ?? (ocr as ConvertDeps["ocr"]),
        },
        ocr,
        pdf,
        docx,
    };
}

const buf = (s = "x") => Buffer.from(s);

describe("helpery", () => {
    it("suffixOf / isImage / isSupportedConvertType", () => {
        expect(suffixOf("skan.PDF")).toBe("pdf");
        expect(isImage("zdjecie.JPG")).toBe(true);
        expect(isImage("pismo.docx")).toBe(false);
        expect(isSupportedConvertType("a.png")).toBe(true);
        expect(isSupportedConvertType("a.tiff")).toBe(true);
        expect(isSupportedConvertType("a.xlsx")).toBe(false);
    });

    it("hasEnoughText: skan (pusto/markery) = false, tekstowy = true", () => {
        expect(hasEnoughText("[Page 1]\n\n[Page 2]\n   ")).toBe(false);
        expect(hasEnoughText("[Page 1]\nPozew o zaplate kwoty 10000 zl...")).toBe(true);
    });
});

describe("convertToMarkdown - routing", () => {
    it("DOCX -> mammoth, bez OCR", async () => {
        const d = deps();
        const r = await convertToMarkdown({ buffer: buf(), filename: "pismo.docx" }, d.deps);
        expect(r.engine).toBe("docx");
        expect(r.ocrUsed).toBe(false);
        expect(d.ocr).not.toHaveBeenCalled();
        expect(r.markdown).toContain("Umowa");
    });

    it("obraz (jpg) -> OCR", async () => {
        const d = deps();
        const r = await convertToMarkdown({ buffer: buf(), filename: "zdjecie.jpg" }, d.deps);
        expect(r.engine).toBe("ocr");
        expect(r.ocrUsed).toBe(true);
        expect(d.ocr).toHaveBeenCalledWith(expect.any(Buffer), "image", "zdjecie.jpg");
    });

    it("PDF z warstwa tekstu -> pdfjs, bez OCR", async () => {
        const d = deps({
            extractPdfText: vi.fn(async () => "[Page 1]\nObszerna tresc pisma procesowego..."),
        });
        const r = await convertToMarkdown({ buffer: buf(), filename: "wyrok.pdf" }, d.deps);
        expect(r.engine).toBe("pdf-text");
        expect(r.ocrUsed).toBe(false);
        expect(d.ocr).not.toHaveBeenCalled();
    });

    it("PDF-skan (brak warstwy tekstu) -> OCR", async () => {
        const ocr = vi.fn(async () => "Tresc rozpoznana z kserowki sadowej");
        const r = await convertToMarkdown(
            { buffer: buf(), filename: "skan-z-sadu.pdf" },
            {
                extractPdfText: async () => "[Page 1]\n\n[Page 2]\n   ", // pusty skan
                extractDocxText: async () => "",
                ocr: ocr as ConvertDeps["ocr"],
            },
        );
        expect(r.engine).toBe("ocr");
        expect(r.ocrUsed).toBe(true);
        expect(ocr).toHaveBeenCalledWith(expect.any(Buffer), "pdf", "skan-z-sadu.pdf");
        expect(r.markdown).toContain("kserowki");
    });

    it("OCR -> post-processing flaguje podejrzana date (ADR-0075)", async () => {
        const r = await convertToMarkdown(
            { buffer: buf(), filename: "skan.jpg" },
            {
                extractPdfText: async () => "",
                extractDocxText: async () => "",
                ocr: async () => "Postanowienie z dnia 12.03.3013 r. w sprawie...",
            },
        );
        expect(r.engine).toBe("ocr");
        expect(r.flags?.some((f) => f.kind === "suspect-date")).toBe(true);
    });

    it("nieobslugiwany format -> rzuca", async () => {
        const d = deps();
        await expect(
            convertToMarkdown({ buffer: buf(), filename: "arkusz.xlsx" }, d.deps),
        ).rejects.toThrow(/Nieobslugiwany format/);
    });
});
