// R-CC-02 (ADR-0157 pkt 6, zasada ADR-0146): brak weryfikacji nigdy nie daje stanu "ok".
// index.ts: anyMissing liczy tylko not_checked / unknown / not_sent - pozycje
// odrzucone przez serwer (`rejected`) nie. Gdy serwer odrzuci WSZYSTKIE pozycje,
// wynik ma status "ok", a statusNote(ok) === null, wiec ekran nie pokazuje noty
// "sprawdzono czesc" - przy ZERO sprawdzonych powolan.
import { describe, expect, it } from "vitest";
import { checkDocumentCitations } from "../src/lib/citation-check";

describe("R-CC-02 wszystkie pozycje odrzucone = status ok", () => {
    it("zero sprawdzonych powolan nie moze dac statusu ok", async () => {
        const r = await checkDocumentCitations({
            text: "Podstawa: art. 471 k.c. oraz wyrok SN II CSKP 1/24.",
            callTool: async (args) => ({
                text: JSON.stringify({
                    result: {
                        citations: [],
                        rejected: (args.citations as { ref: string }[]).map((c) => ({
                            ref: c.ref,
                            reason: "limit",
                        })),
                    },
                }),
            }),
        });
        // sanity: rzeczywiscie nic nie sprawdzono
        expect(r.citations.every((c) => c.status === "rejected")).toBe(true);
        expect(r.status).not.toBe("ok");
    });
});
