import type { ColumnConfig } from "../shared/types";

export type PillSegment =
    | { type: "text"; content: string }
    | { type: "pill"; content: string };

/** Sequential colors assigned to tags by their position in the tags array.
 *
 * ADR-0149: tecza Tailwinda zeszla do palety systemowej - tagi rozroznia
 * triada semantyczna + zloto pieczeci + dwa neutralne, wiec tabela mowi tym
 * samym jezykiem co reszta produktu i przelacza sie z motywem. Rozroznialnosc
 * zostaje (6 tonow w cyklu), krzyk znika. */
export const TAG_COLORS = [
    "bg-seal-soft text-seal",
    "bg-ok-soft text-ok",
    "bg-warn-soft text-warn",
    "bg-bad-soft text-bad",
    "bg-gray-200 text-gray-800",
    "bg-gray-100 text-gray-600",
];

export function getPillClass(content: string, column?: ColumnConfig): string {
    if (column?.format === "yes_no") {
        const lower = content.toLowerCase();
        if (lower === "yes") return "bg-ok-soft text-ok";
        if (lower === "no") return "bg-bad-soft text-bad";
        return "bg-gray-100 text-gray-700";
    }
    if (column?.format === "currency") {
        // Waluta to metadana, nie stan - jeden spokojny ton zamiast teczy.
        return "bg-gray-100 text-gray-700";
    }
    if (column?.format === "tag" && column.tags?.length) {
        const idx = column.tags.findIndex(
            (t) => t.toLowerCase() === content.toLowerCase(),
        );
        if (idx >= 0) return TAG_COLORS[idx % TAG_COLORS.length]!;
    }
    return "bg-gray-100 text-gray-700";
}

/** Split text on [[...]] pill markers, preserving surrounding text. */
export function parsePills(text: string): PillSegment[] {
    const segments: PillSegment[] = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
        }
        segments.push({ type: "pill", content: match[1] });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        segments.push({ type: "text", content: text.slice(lastIndex) });
    }
    return segments;
}
