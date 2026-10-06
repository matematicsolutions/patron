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
    // D-14: modele (zwlaszcza lokalne) podaja ref jako string ("1" albo "[1]").
    // Tolerujemy to zamiast gubic cytat - liczba jest jednoznaczna.
    const stringRef =
        typeof c.ref === "string"
            ? Number(c.ref.match(/^\s*\[?\s*(\d+)\s*\]?\s*$/)?.[1])
            : NaN;
    const ref =
        typeof c.ref === "number" && Number.isFinite(c.ref)
            ? c.ref
            : Number.isFinite(stringRef)
              ? stringRef
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
 * Usuwa przecinki wiszace przed `]` / `}` POZA literalami stringow JSON
 * (typowy blad modeli lokalnych: `[{...},]`). Przecinek wewnatrz cytatu
 * (np. "a, ]") zostaje nietkniety.
 */
function stripTrailingCommas(json: string): string {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < json.length; i++) {
        const ch = json[i];
        if (inString) {
            out += ch;
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        if (ch === ",") {
            let j = i + 1;
            while (j < json.length && /\s/.test(json[j])) j++;
            if (json[j] === "]" || json[j] === "}") continue;
        }
        out += ch;
    }
    return out;
}

/** Zdejmuje ogrodzenie markdown (```json ... ```), ktore modele dokladaja do bloku. */
function stripCodeFence(body: string): string {
    const m = body.match(/^\s*```[a-zA-Z]*\s*([\s\S]*?)\s*```\s*$/);
    return m ? m[1] : body;
}

/**
 * Wynik parsowania bloku <CITATIONS> z diagnoza (D-14). `parseError` jest
 * ustawione, gdy model PODAL blok, ale czesc lub calosc cytatow przepadla -
 * wtedy UI dostaje jawny sygnal zamiast ciszy (ADR-0005/0146: brak weryfikacji
 * nigdy nie jest cichy).
 *  - `invalid_json`     - blok nie jest JSON-em nawet po tolerancyjnej naprawie,
 *  - `not_array`        - JSON nie jest lista cytatow,
 *  - `unterminated`     - jest `<CITATIONS>` bez `</CITATIONS>` (np. uciete wyjscie),
 *  - `invalid_records`  - lista sparsowana, ale `dropped` rekordow odrzucono.
 */
export type CitationsParseError = {
    reason: "invalid_json" | "not_array" | "unterminated" | "invalid_records";
    dropped: number;
};

export function parseCitationsDetailed(text: string): {
    citations: ParsedCitation[];
    parseError: CitationsParseError | null;
} {
    const match = text.match(CITATIONS_BLOCK_RE);
    if (!match) {
        return {
            citations: [],
            parseError: text.includes(CITATIONS_OPEN_TAG)
                ? { reason: "unterminated", dropped: 0 }
                : null,
        };
    }
    const body = stripCodeFence(match[1]);
    let raw: unknown;
    try {
        raw = JSON.parse(body);
    } catch {
        try {
            raw = JSON.parse(stripTrailingCommas(body));
        } catch {
            return {
                citations: [],
                parseError: { reason: "invalid_json", dropped: 0 },
            };
        }
    }
    if (!Array.isArray(raw)) {
        return { citations: [], parseError: { reason: "not_array", dropped: 0 } };
    }
    const citations = raw
        .map(normalizeCitation)
        .filter((c): c is ParsedCitation => c !== null);
    const dropped = raw.length - citations.length;
    return {
        citations,
        parseError: dropped > 0 ? { reason: "invalid_records", dropped } : null,
    };
}

/**
 * Wyciagnij blok <CITATIONS> z tekstu LLM i sparsuj wszystkie cytaty.
 * Toleruje typowe bledy modeli (przecinek wiszacy, ref jako string, ogrodzenie
 * ```json). Zwraca puste pole gdy bloku nie ma lub JSON jest nienaprawialny -
 * diagnoza bledu jest w parseCitationsDetailed (D-14).
 */
export function parseCitations(text: string): ParsedCitation[] {
    return parseCitationsDetailed(text).citations;
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
