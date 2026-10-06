// Konsument zdarzen SSE `POST /tabular-review/:id/generate` jako czysta funkcja.
//
// Backend (routes/tabular.ts) wysyla:
// - `cell_update` {document_id, column_index, content, status, reason?} - reason
//   "document_no_text" (audyt 2026-09, D-11) gdy dokument nie ma tekstu ani OCR;
// - `document_truncated` {document_id, truncated, chars_sent, chars_total}
//   (audyt 2026-09, D-15) gdy model dostal tylko poczatek dokumentu.
// Do 2026-10 frontend znal tylko `cell_update` i gubil `reason`, wiec komorka
// bez tekstu wygladala jak zwykla awaria modelu, a obciecie bylo niewidoczne.
import type {
    TabularCell,
    TabularCellContent,
    TabularCellCoverage,
    TabularCellErrorReason,
} from "../shared/types";

const KNOWN_ERROR_REASONS: ReadonlySet<string> = new Set<TabularCellErrorReason>([
    "document_no_text",
]);

export function knownErrorReason(
    reason: unknown,
): TabularCellErrorReason | undefined {
    return typeof reason === "string" && KNOWN_ERROR_REASONS.has(reason)
        ? (reason as TabularCellErrorReason)
        : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

/** Poprawne pokrycie albo `undefined` (zly ksztalt nie udaje obciecia). */
export function parseCoverage(v: unknown): TabularCellCoverage | undefined {
    if (!isRecord(v) || v.truncated !== true) return undefined;
    const { chars_sent, chars_total } = v;
    if (
        typeof chars_sent !== "number" ||
        typeof chars_total !== "number" ||
        !Number.isFinite(chars_sent) ||
        !Number.isFinite(chars_total)
    ) {
        return undefined;
    }
    return { truncated: true, chars_sent, chars_total };
}

/** Pokrycie, ktore komorka ma pokazac: z wyniku albo ze zdarzenia dokumentu. */
export function cellCoverage(cell: TabularCell): TabularCellCoverage | undefined {
    return parseCoverage(cell.content?.coverage) ?? cell.document_coverage;
}

/** Naklada jedno zdarzenie SSE na stan komorek. Nieznane zdarzenie = bez zmian. */
export function applyTabularStreamEvent(
    cells: TabularCell[],
    data: unknown,
): TabularCell[] {
    if (!isRecord(data) || typeof data.document_id !== "string") return cells;
    const docId = data.document_id;

    if (data.type === "cell_update") {
        const colIndex = data.column_index;
        const status = data.status as TabularCell["status"];
        const reason =
            status === "error" ? knownErrorReason(data.reason) : undefined;
        return cells.map((c) =>
            c.document_id === docId && c.column_index === colIndex
                ? {
                      ...c,
                      content: (data.content ?? null) as TabularCellContent | null,
                      status,
                      error_reason: reason,
                  }
                : c,
        );
    }

    if (data.type === "document_truncated") {
        const coverage = parseCoverage(data);
        if (!coverage) return cells;
        return cells.map((c) =>
            c.document_id === docId ? { ...c, document_coverage: coverage } : c,
        );
    }

    return cells;
}

/**
 * Powod z odpowiedzi 422 regenerate-cell. `apiRequest` rzuca Error z trescia
 * odpowiedzi jako komunikatem: {"code":"document_no_text","detail":"..."}.
 */
export function regenerateErrorReason(
    err: unknown,
): TabularCellErrorReason | undefined {
    if (!(err instanceof Error)) return undefined;
    try {
        const body: unknown = JSON.parse(err.message);
        return isRecord(body) ? knownErrorReason(body.code) : undefined;
    } catch {
        return undefined;
    }
}
