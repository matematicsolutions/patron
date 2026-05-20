// Parsowanie cytatow z bloku <CITATIONS> w odpowiedzi LLM + resolwery
// dokumentow. Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3.

import type { DocIndex, DocStore, ParsedCitation } from "./types";

export const CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;
export const CITATIONS_OPEN_TAG = "<CITATIONS>";

/**
 * Normalizuje pojedynczy obiekt cytatu z JSON-a. Akceptuje wariant historyczny
 * z polami "marker" / "text" zamiast "ref" / "quote".
 * Zwraca null jesli rekord jest niepoprawny - parseCitations je odfiltruje.
 */
export function normalizeCitation(raw: unknown): ParsedCitation | null {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;
    const markerRef =
        typeof c.marker === "string"
            ? Number(c.marker.match(/^\[(\d+)\]$/)?.[1])
            : NaN;
    const ref =
        typeof c.ref === "number"
            ? c.ref
            : Number.isFinite(markerRef)
              ? markerRef
              : null;
    if (typeof ref !== "number" || typeof c.doc_id !== "string") return null;
    const quote = typeof c.quote === "string" ? c.quote : c.text;
    if (typeof quote !== "string" || !quote) return null;
    let page: number | string;
    if (typeof c.page === "number") {
        page = c.page;
    } else if (typeof c.page === "string" && /^\d+\s*-\s*\d+$/.test(c.page)) {
        page = c.page;
    } else {
        const n = parseInt(String(c.page ?? ""), 10);
        if (!Number.isFinite(n)) page = 1;
        else page = n;
    }
    return { ref, doc_id: c.doc_id, page, quote };
}

/**
 * Wyciagnij blok <CITATIONS> z tekstu LLM i sparsuj wszystkie cytaty.
 * Zwraca puste pole gdy bloku nie ma lub JSON jest zepsuty.
 */
export function parseCitations(text: string): ParsedCitation[] {
    const match = text.match(CITATIONS_BLOCK_RE);
    if (!match) return [];
    try {
        const raw = JSON.parse(match[1]);
        if (!Array.isArray(raw)) return [];
        return raw
            .map(normalizeCitation)
            .filter((c): c is ParsedCitation => c !== null);
    } catch {
        return [];
    }
}

export function resolveDoc(rawId: string, docIndex: DocIndex) {
    return docIndex[rawId];
}

/**
 * Resolve whatever identifier the model passed (`doc-N` slug, filename, or
 * document UUID) back to a chat-local doc label. Generated docs surface in
 * tool results with both `doc_id` (slug) and `document_id` (UUID), so the
 * model often picks the wrong one — without this fallback `read_document`
 * silently returns "not found" and the model gives up and re-generates.
 */
export function resolveDocLabel(
    rawId: string,
    docStore: DocStore,
    docIndex?: DocIndex,
): string | null {
    if (docStore.has(rawId)) return rawId;
    for (const [label, info] of docStore.entries()) {
        if (info.filename === rawId) return label;
    }
    if (docIndex) {
        for (const [label, info] of Object.entries(docIndex)) {
            if (info.document_id === rawId) return label;
        }
    }
    return null;
}
