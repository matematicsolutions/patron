// R-CC-04: `coverage_note` z odpowiedzi serwera trafia do serverNotes bez sprawdzenia
// typu (index.ts: `if (koperta.coverage_note) base.serverNotes.push(...)`). Obiekt
// przechodzi do przegladarki: CitationCheckView renderuje `<p>{n}</p>` (React:
// "Objects are not valid as a React child" - widok pada), a buildReportHtml wola
// esc(n) -> n.replace is not a function (raport sie nie generuje).
// Oczekiwane: serverNotes zawiera wylacznie napisy.
import { describe, expect, it } from "vitest";
import { checkDocumentCitations } from "../src/lib/citation-check";

describe("R-CC-04 nota serwera nie-napis przechodzi do UI", () => {
    it("serverNotes to wylacznie stringi", async () => {
        const r = await checkDocumentCitations({
            text: "Podstawa: art. 471 k.c.",
            callTool: async (args) => ({
                text: JSON.stringify({
                    result: {
                        citations: (args.citations as { ref: string }[]).map((c) => ({
                            ref: c.ref,
                            status: "no_known_changes_after_date",
                        })),
                    },
                    coverage_note: { html: "<b>x</b>" },
                }),
            }),
        });
        expect(r.serverNotes.every((n) => typeof n === "string")).toBe(true);
    });
});
