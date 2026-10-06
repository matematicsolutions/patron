// A-24: podglad DOCX (DocxView -> docx-preview 0.3.7) renderuje czesc altChunk
// (HTML osadzony w .docx) jako <iframe srcdoc> BEZ atrybutu sandbox. Opcja
// renderAltChunks domyslnie true (node_modules/docx-preview .../docx-preview.mjs:3973),
// a DocxView (src/app/components/shared/DocxView.tsx:369) NIE ustawia jej na false.
// Iframe srcdoc dziedziczy origin aplikacji i laduje zewnetrzne zasoby bez klikniecia,
// wiec sam podglad dokumentu podeslanego przez strone przeciwna wysyla zadanie sieciowe
// (kanal eksfiltracji / pixel sledzacy). Payload w tescie jest NIESZKODLIWY (tylko obraz).
// Oczekiwane zachowanie: podglad nie tworzy iframe niesandboksowanego, a HTML z altChunk
// nie trafia do srcdoc z zewnetrznym zasobem.
import { render, waitFor } from "@testing-library/react";
// jsdom nie ma ResizeObserver (DocxView go uzywa do skalowania stron).
class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? RO;
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
    supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

let docxBytes: ArrayBuffer | null = null;
vi.mock("@/app/hooks/useFetchDocxBytes", () => ({
    useFetchDocxBytes: () => ({
        bytes: docxBytes,
        downloadUrl: null,
        loading: false,
        error: null,
    }),
}));

import { DocxView } from "../src/app/components/shared/DocxView";

// HTML czesci altChunk - tylko obraz z zewnetrznego hosta (bez skryptu).
// Obecnosc tego src w srcdoc = przegladarka pobierze go przy renderze podgladu.
const ALT_HTML =
    "<html><body><p>Zalacznik</p>" +
    "<img src=\"https://atakujacy.example/pixel.gif\"></body></html>";

async function buildDocxWithAltChunk(): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
            "<Override PartName=\"/word/afchunk.html\" ContentType=\"text/html\"/>" +
            "</Types>",
    );
    zip.file(
        "_rels/.rels",
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
            "</Relationships>",
    );
    zip.folder("word");
    zip.file(
        "word/document.xml",
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" " +
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
            "<w:body><w:altChunk r:id=\"rIdChunk\"/></w:body></w:document>",
    );
    zip.file(
        "word/_rels/document.xml.rels",
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rIdChunk\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk\" Target=\"afchunk.html\"/>" +
            "</Relationships>",
    );
    zip.file("word/afchunk.html", ALT_HTML);
    const u8 = await zip.generateAsync({ type: "uint8array" });
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe("A-24 - podglad DOCX nie renderuje altChunk jako niesandboksowanego iframe", () => {
    it("altChunk z HTML nie tworzy <iframe> laczacego z zewnetrznym zrodlem", async () => {
        docxBytes = await buildDocxWithAltChunk();
        const { container } = render(
            <DocxView documentId="d1" versionId="v1" />,
        );
        // Czekaj az docx-preview wstawi strony (async render).
        await waitFor(
            () => {
                expect(container.querySelector(".docx-wrapper")).not.toBeNull();
            },
            { timeout: 4000 },
        );
        const iframes = Array.from(container.querySelectorAll("iframe"));
        const unsandboxed = iframes.filter((f) => !f.hasAttribute("sandbox"));
        const leaks = iframes.filter((f) =>
            (f.getAttribute("srcdoc") ?? "").includes("atakujacy.example"),
        );
        expect(unsandboxed).toEqual([]);
        expect(leaks).toEqual([]);
    });
});
