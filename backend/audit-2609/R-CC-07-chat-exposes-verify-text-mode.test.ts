// R-CC-07 (ADR-0157 "Tryb listy istnieje wlasnie po to, zeby oprogramowanie kancelarii
// nie wysylalo pisma"): ADR kaze Operatorowi zarejestrowac Repertorium jako zwykly
// serwer MCP w nakladce (pkt 7). getMcpTools (lib/mcp/index.ts) rejestruje WSZYSTKIE
// narzedzia serwera, a lib/chat/stream.ts:173-176 podaje je modelowi czatu - w tym
// `repertorium__verify_citations` z trybem `text` (cale pismo). runMcpTool
// (lib/mcp/index.ts:597-600) przekazuje argumenty 1:1. Model, ktory przeczytal pismo
// (read_document) i dostal prosbe "sprawdz powolania w tym pismie", ma wiec sciezke
// wyslania CALEJ tresci pisma do zewnetrznego serwera - obok przycisku, ktory tego
// pilnuje. Ta sama klasa co B-11, tu otwarta przez konfiguracje z ADR-0157.
// Oczekiwane: tryb `text` weryfikatora nie wychodzi z PATRONA (ani w schemacie dla
// modelu, ani w wywolaniu). Konektor ZAMOCKOWANY, zero sieci. Dane syntetyczne.
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rcc07-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
fs.writeFileSync(
    OVERLAY,
    JSON.stringify([
        {
            name: "repertorium",
            transport: "http",
            url: "http://127.0.0.1:9/mcp",
            trustLevel: "untrusted",
            operatorApproved: true,
            approvedAt: "2026-10-01",
            approvedBy: "operator",
        },
    ]),
);
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");

const { callTool } = vi.hoisted(() => ({
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: class {
        async connect() {}
        async close() {}
        async listTools() {
            return {
                tools: [
                    {
                        name: "verify_citations",
                        description: "Sprawdza sygnatury i przepisy w korpusie.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                text: { type: "string" },
                                citations: { type: "array" },
                                as_of: { type: "string" },
                            },
                        },
                    },
                ],
            };
        }
        callTool = callTool;
    },
}));
vi.mock("../src/lib/mcp/audit-bridge", () => ({
    recordMcpSecurityEvent: vi.fn(async () => ({ ok: true })),
    recordRingPolicyEvent: vi.fn(async () => ({ ok: true })),
}));

import { getMcpTools, runMcpTool } from "../src/lib/mcp";

const PISMO = "Powod Jan Testowy, PESEL 90010112349, zam. ul. Polna 12/24. Podstawa: art. 471 k.c.";

describe("R-CC-07 czat dostaje tryb text weryfikatora (cale pismo)", () => {
    it("pismo nie wychodzi przez repertorium__verify_citations", async () => {
        const tools = await getMcpTools();
        // Od poprawki R-CC-07 (2026-10-02) narzedzia serwera weryfikatora NIE sa
        // narzedziami czatu - jedyne wejscie to trasa "Sprawdz powolania".
        expect(tools.map((t) => t.function.name)).not.toContain("repertorium__verify_citations");
        await runMcpTool("repertorium__verify_citations", { text: PISMO });
        const wyslane = JSON.stringify(callTool.mock.calls);
        expect(wyslane).not.toContain("90010112349");
        expect(wyslane).not.toContain("Jan Testowy");
    });
});
