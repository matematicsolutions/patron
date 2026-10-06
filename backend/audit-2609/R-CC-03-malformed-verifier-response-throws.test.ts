// R-CC-03: odpowiedz zdalnego (Ring 2, untrusted) weryfikatora jest parsowana bez
// walidacji ksztaltu. index.ts: `typeof w.ref` dla elementu null w result.citations
// oraz `for (const rj of koperta.result?.rejected ?? [])` dla rejected niebedacego
// tablica rzucaja TypeError POZA try/catch. Trasa /api/citations/check-document
// (routes/citations.ts) to async handler Express 4 bez catch, a backend nie ma
// process.on("unhandledRejection") - odrzucona obietnica konczy proces Node 22.
// Oczekiwane: zly ksztalt odpowiedzi = failedCalls/status "failed", nigdy wyjatek.
import { describe, expect, it } from "vitest";
import { checkDocumentCitations, type ToolCallResult } from "../src/lib/citation-check";

async function z(odp: unknown): Promise<unknown> {
    return checkDocumentCitations({
        text: "Podstawa: art. 471 k.c.",
        callTool: async (): Promise<ToolCallResult> => ({ text: JSON.stringify(odp) }),
    }).catch((e: unknown) => e);
}

describe("R-CC-03 znieksztalcona odpowiedz weryfikatora rzuca wyjatek", () => {
    it("null w result.citations", async () => {
        const r = await z({ result: { citations: [null] } });
        expect(r).not.toBeInstanceOf(Error);
    });
    it("rejected nie jest tablica", async () => {
        const r = await z({ result: { citations: [], rejected: 5 } });
        expect(r).not.toBeInstanceOf(Error);
    });
});
