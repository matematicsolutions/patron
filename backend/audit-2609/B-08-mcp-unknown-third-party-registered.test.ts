// B-08: Nieznany konektor 3rd-party (nazwa odlegla o >4 od zatwierdzonych) dostaje od
// typosquat finding "low" (lib/mcp-security/detectors/typosquat.ts:90-98), scorer mapuje
// low -> "audit" (scorer.ts:41-43), a getMcpTools rejestruje "audit" tak jak "allowed"
// (lib/mcp/index.ts:420-446): definicje narzedzi (opisy + schematy) nieznanego serwera
// trafiaja do listy narzedzi modelu - w tym do providera chmurowego - mimo ze
// ring-policy i tak odrzuci kazde wywolanie (brak operatorApproved). Naglowek
// typosquat.ts obiecuje: "dist > 4 -> nieznany 3rd-party (human_review, finding low)".
// Oczekiwane: nieznany, niezatwierdzony konektor trafia do human_review (nie jest
// rejestrowany automatycznie) - zgodnie z kontraktem w naglowku detektora i ADR-0027.
import { describe, expect, it } from "vitest";
import { buildScanContext, scanMcpServer, type McpServerDefinition } from "../src/lib/mcp-security";

describe("B-08 nieznany konektor 3rd-party przy pierwszym ladowaniu", () => {
    it("niezatwierdzony konektor spoza listy nie dostaje akcji rejestrujacej (audit/allowed)", () => {
        const obcy: McpServerDefinition = {
            name: "kalendarz-terminow-pro",
            transport: "http",
            url: "https://example.invalid/mcp",
            tools: [{ name: "add_deadline", description: "Dodaje termin procesowy do kalendarza.", inputSchema: { type: "object", properties: { note: { type: "string" } } } }],
        };
        const r = scanMcpServer(obcy, buildScanContext(new Map()));
        expect(r.findings.map((f) => f.detector).sort()).toEqual(["drift", "typosquat"]);
        expect(r.action, "nieznany 3rd-party rejestrowany automatycznie").toBe("human_review");
    });
});
