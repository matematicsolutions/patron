// Ekstrakcja tekstu z PDF przez pdfjs-dist (legacy build).
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 iteracja 2.

import path from "path";

const STANDARD_FONT_DATA_URL = (() => {
    try {
        const pkgPath = require.resolve("pdfjs-dist/package.json");
        return path.join(path.dirname(pkgPath), "standard_fonts") + path.sep;
    } catch {
        return undefined;
    }
})();

/** Pozycja zakladki (outline) PDF - tyle, ile potrzebuje drzewo struktury. */
export interface PdfOutlineItem {
    title?: string;
}

/**
 * Wszystko, co ingest potrzebuje od pdfjs dla jednego PDF-a: tekst, liczba
 * stron i zakladki. ADR-0156: JEDNO otwarcie dokumentu zamiast trzech.
 */
export interface PdfExtraction {
    /** Tekst stron z markerami `[Page N]`; pusty przy bledzie. */
    text: string;
    /** Liczba stron albo null, gdy dokumentu nie udalo sie otworzyc. */
    pageCount: number | null;
    /** Zakladki dokumentu; null gdy brak albo dokument sie nie otworzyl. */
    outline: PdfOutlineItem[] | null;
}

interface PdfDocumentProxyLike {
    numPages: number;
    getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: { str?: string }[] }>;
    }>;
    getOutline: () => Promise<PdfOutlineItem[] | null>;
}

/**
 * Otwiera PDF RAZ i zbiera z tego samego `PDFDocumentProxy` tekst, liczbe stron
 * i zakladki.
 *
 * Tekst: strona po stronie, kazda poprzedzona markerem `[Page N]`
 * (1-indeksowany) - format zgodny z umowa cytowania w SYSTEM_PROMPT
 * (pole `page` w bloku <CITATIONS>).
 *
 * Nigdy nie rzuca: przy bledzie zwraca `{ text: "", pageCount: null, outline: null }`,
 * czyli dokladnie to, co dawaly wczesniej trzy osobne funkcje, kazda ze swoim
 * `catch`.
 */
export async function extractPdfDocument(
    buf: ArrayBuffer,
): Promise<PdfExtraction> {
    try {
        const pdfjsLib = await import(
            "pdfjs-dist/legacy/build/pdf.mjs" as string
        );
        const pdf: PdfDocumentProxyLike = await (
            pdfjsLib as unknown as {
                getDocument: (opts: unknown) => {
                    promise: Promise<PdfDocumentProxyLike>;
                };
            }
        ).getDocument({
            data: new Uint8Array(buf),
            standardFontDataUrl: STANDARD_FONT_DATA_URL,
        }).promise;

        const parts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            parts.push(
                `[Page ${i}]\n${textContent.items.map((it) => it.str ?? "").join(" ")}`,
            );
        }

        // Zakladki sa opcjonalne i tanie (metadane katalogu, nie tresc stron) -
        // ich brak nie moze zabrac tekstu, ktory juz mamy.
        let outline: PdfOutlineItem[] | null = null;
        try {
            outline = (await pdf.getOutline()) ?? null;
        } catch {
            outline = null;
        }

        return { text: parts.join("\n\n"), pageCount: pdf.numPages, outline };
    } catch {
        return { text: "", pageCount: null, outline: null };
    }
}

/**
 * Sam tekst PDF - cienka nakladka na `extractPdfDocument` dla wolajacych,
 * ktorych struktura dokumentu nie interesuje (czat, narzedzia agenta).
 *
 * Zwraca pusty string przy bledzie - nigdy nie rzuca.
 */
export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
    return (await extractPdfDocument(buf)).text;
}
