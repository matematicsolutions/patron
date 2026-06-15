// Silnik konwersji dokumentow -> Markdown + OCR (ADR-0074, warstwa wejscia).
//
// Przyjmuje DOWOLNY wspierany format (DOCX/PDF/obraz) i zwraca tekst/Markdown,
// ktory zasila istniejacy ingest (input-security -> RAG -> graf). Skany papierowe
// i zdjecia (brak warstwy tekstu) ida przez OCR (Chandra, lokalnie - zero-cloud).
//
// Wywolania konwerterow (pdfjs, mammoth, OCR Chandra) sa WSTRZYKIWANE jako `deps`
// (wzorzec injected-llm z lib/pipeline/defense.ts) - rdzen routingu/detekcji jest
// czysty i testowalny BEZ obecnosci binariow/modelu. Runner produkcyjny (spawn
// subprocess) wstrzykuje sie w punkcie wpiecia (documentIngest).

import { postProcessOcr, type OcrFlag } from "./postprocess";

export type ConvertEngine = "docx" | "pdf-text" | "ocr";

export interface ConvertResult {
    /** Tekst/Markdown gotowy do skanu input-security + indeksacji RAG. */
    markdown: string;
    /** Ktory silnik wyprodukowal wynik (do audytu/telemetrii). */
    engine: ConvertEngine;
    /** Czy uzyto OCR (skan/zdjecie). */
    ocrUsed: boolean;
    /** ADR-0075: flagi post-processingu OCR (podejrzane daty, niska jakosc) -
     * mecenas widzi gdzie zweryfikowac. Pusta/undefined dla pdf-text/docx. */
    flags?: OcrFlag[];
}

/** Zaleznosci ekstrakcji - produkcyjnie pdfjs/mammoth/Chandra, w testach fake. */
export interface ConvertDeps {
    extractPdfText: (buf: ArrayBuffer) => Promise<string>;
    extractDocxText: (buf: Buffer) => Promise<string>;
    /** OCR lokalny (Chandra) dla obrazu lub skanu-PDF. Zwraca tekst/Markdown. */
    ocr: (buf: Buffer, kind: "image" | "pdf", filename: string) => Promise<string>;
}

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"]);
const DOCX_EXT = new Set(["docx", "doc"]);

/**
 * Prog detekcji skanu: PDF z mniejsza liczba "znaczacych" znakow tekstu niz
 * to (po usunieciu markerow [Page N] i whitespace) traktujemy jako skan bez
 * warstwy tekstu -> OCR. Per-page refinement = FAZA 1.
 */
export const SCAN_TEXT_THRESHOLD = 20;

export function suffixOf(filename: string): string {
    return filename.includes(".")
        ? filename.split(".").pop()!.toLowerCase()
        : "";
}

export function isImage(filename: string): boolean {
    return IMAGE_EXT.has(suffixOf(filename));
}

/** Czy format jest obslugiwany przez warstwe konwersji (obraz/pdf/docx/doc). */
export function isSupportedConvertType(filename: string): boolean {
    const s = suffixOf(filename);
    return IMAGE_EXT.has(s) || DOCX_EXT.has(s) || s === "pdf";
}

/**
 * Czy wyekstrahowany tekst PDF ma dosc tresci, by uznac PDF za "tekstowy"
 * (a nie skan). Usuwa markery [Page N] i caly whitespace, liczy reszte.
 */
export function hasEnoughText(extracted: string): boolean {
    const cleaned = extracted
        .replace(/\[Page \d+\]/g, "")
        .replace(/\s+/g, "");
    return cleaned.length >= SCAN_TEXT_THRESHOLD;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
}

/**
 * Konwertuje dokument na tekst/Markdown. Routing:
 *   DOCX/DOC                         -> mammoth (deps.extractDocxText)
 *   PDF z warstwa tekstu             -> pdfjs (deps.extractPdfText)
 *   PDF-skan (brak/malo tekstu)      -> OCR (deps.ocr ..., "pdf")
 *   obraz (jpg/png/tiff/...)         -> OCR (deps.ocr ..., "image")
 * Rzuca dla nieobslugiwanego formatu (wywolujacy decyduje o komunikacie).
 */
export async function convertToMarkdown(
    input: { buffer: Buffer; filename: string },
    deps: ConvertDeps,
): Promise<ConvertResult> {
    const suffix = suffixOf(input.filename);

    if (DOCX_EXT.has(suffix)) {
        const markdown = await deps.extractDocxText(input.buffer);
        return { markdown, engine: "docx", ocrUsed: false };
    }

    if (IMAGE_EXT.has(suffix)) {
        const raw = await deps.ocr(input.buffer, "image", input.filename);
        const pp = postProcessOcr(raw);
        return { markdown: pp.markdown, engine: "ocr", ocrUsed: true, flags: pp.flags };
    }

    if (suffix === "pdf") {
        const text = await deps.extractPdfText(toArrayBuffer(input.buffer));
        if (hasEnoughText(text)) {
            return { markdown: text, engine: "pdf-text", ocrUsed: false };
        }
        // Skan bez warstwy tekstu -> OCR lokalny.
        const raw = await deps.ocr(input.buffer, "pdf", input.filename);
        const pp = postProcessOcr(raw);
        return { markdown: pp.markdown, engine: "ocr", ocrUsed: true, flags: pp.flags };
    }

    throw new Error(`Nieobslugiwany format konwersji: ${suffix || "(brak)"}`);
}
