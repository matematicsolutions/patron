// R-CC-08 (ADR-0157 pkt 6, zasada ADR-0146 "brak sprawdzenia nigdy nie jest zielony"):
// scalanie wyniku (index.ts, petla po `wyniki`) przyjmuje status dla KAZDEGO `ref`
// znanego lokalnie, a nie tylko dla pozycji wyslanych w tej partii. `ref` to kolejne
// c1..cN po WSZYSTKICH cytatach, takze `act_not_recognized` (nigdy nie wyslane) i
// `not_sent` (ponad limit 100), wiec odpowiedz serwera (blad, echo, zgadywanie) moze
// nadac "found" / "no_known_changes_after_date" powolaniu, ktorego nikt nie sprawdzal.
// Oczekiwane: status z serwera tylko dla ref z wyslanej partii.
import { describe, expect, it } from "vitest";
import { checkDocumentCitations } from "../src/lib/citation-check";

describe("R-CC-08 wynik dla niewyslanego ref nadaje zielony stan", () => {
    it("ustawa nierozpoznana (nie wyslana) nie dostaje statusu serwera", async () => {
        const text =
            "Podstawa: art. 5 ustawy o ochronie zabytkow i opiece nad zabytkami oraz art. 471 k.c.";
        const r = await checkDocumentCitations({
            text,
            callTool: async () => ({
                text: JSON.stringify({
                    result: {
                        citations: ["c1", "c2", "c3"].map((ref) => ({ ref, status: "found" })),
                    },
                }),
            }),
        });
        const nierozp = r.citations.find((c) => c.kind === "unrecognized_act");
        expect(nierozp).toBeDefined(); // sanity
        expect(r.sent.flat().map((s) => s.ref)).not.toContain(nierozp!.ref); // nie wyslano
        expect(nierozp!.status).toBe("act_not_recognized");
    });
});
