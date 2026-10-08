// ADR-0167: Operator wlaczyl Repertorium w czacie (`chatTools: true` w nakladce).
// Do czatu wchodza WYLACZNIE narzedzia odczytu z bialej listy; `verify_citations`
// i kazde narzedzie spoza listy zostaja poza czatem (R-CC-07 bez zmian).
// Konektor ZAMOCKOWANY - zero sieci. Dane syntetyczne.
//
// Bez `chatTools` zachowanie pilnuje citation-verifier.test.ts (zero narzedzi w czacie).
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeApprovalHash, computeOriginFingerprint, type McpServerDefinition } from "../mcp-security";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-repertorium-czat-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
const obiekt = (props: Record<string, unknown>) => ({ type: "object", properties: props });
const NARZEDZIA = [
    { name: "verify_citations", description: "Sprawdza sygnatury i przepisy.",
      inputSchema: obiekt({ text: { type: "string" }, citations: { type: "array" } }) },
    { name: "search_law", description: "Szuka w korpusie.", inputSchema: obiekt({ query: { type: "string" } }) },
    { name: "get_citations", description: "Powolania dokumentu.", inputSchema: obiekt({ document_id: { type: "string" } }) },
    { name: "get_act_relations", description: "Relacje aktu.", inputSchema: obiekt({ document_id: { type: "string" } }) },
];
const definicja: McpServerDefinition = {
    name: "repertorium", transport: "http", url: "http://127.0.0.1:9/mcp", tools: NARZEDZIA,
};
fs.writeFileSync(OVERLAY, JSON.stringify([{
    name: "repertorium",
    transport: "http",
    url: "http://127.0.0.1:9/mcp",
    chatTools: true,
    gatewayApproval: {
        hash: computeApprovalHash(definicja),
        origin: computeOriginFingerprint(definicja),
        approvedAt: "2026-10-08",
        approvedBy: "operator",
    },
}]));
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");
delete process.env.PATRON_CITATION_VERIFIER_SERVER;

const { callTool, lista } = vi.hoisted(() => ({
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
    lista: { tools: [] as unknown[] },
}));
lista.tools = NARZEDZIA;
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: class {
        async connect() {}
        async close() {}
        async listTools() {
            return { tools: lista.tools };
        }
        callTool = callTool;
    },
}));
vi.mock("./audit-bridge", () => ({
    recordMcpSecurityEvent: vi.fn(async () => ({ ok: true })),
    recordRingPolicyEvent: vi.fn(async () => ({ ok: true })),
}));

import { getMcpTools, isMcpTool, runCitationVerifier, runMcpTool } from "./index";

const PISMO = "Powod Jan Testowy, PESEL 90010112349. Podstawa: art. 471 k.c.";

afterEach(() => {
    callTool.mockClear();
});

describe("ADR-0167 Repertorium w czacie - tylko narzedzia odczytu", () => {
    it("schemat dla modelu: narzedzia odczytu tak, verify_citations i spoza listy nie", async () => {
        const nazwy = (await getMcpTools()).map((t) => t.function.name);
        expect(nazwy).toContain("repertorium__search_law");
        expect(nazwy).toContain("repertorium__get_citations");
        expect(nazwy).not.toContain("repertorium__verify_citations");
        expect(nazwy).not.toContain("repertorium__get_act_relations");
    });

    it("dispatch: nazwa spoza listy podana przez model nie prowadzi do wywolania", async () => {
        await getMcpTools();
        expect(isMcpTool("repertorium__search_law")).toBe(true);
        expect(isMcpTool("repertorium__verify_citations")).toBe(false);
        expect(isMcpTool("repertorium__get_act_relations")).toBe(false);
        const r = await runMcpTool("repertorium__verify_citations", { text: PISMO });
        expect(r.isError).toBe(true);
        const r2 = await runMcpTool("repertorium__get_act_relations", { document_id: "eli:DU/1964/93" });
        expect(r2.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
    });

    it("narzedzie odczytu z listy dochodzi do serwera", async () => {
        await getMcpTools();
        const r = await runMcpTool("repertorium__search_law", { query: "art. 471 k.c." });
        expect(r.isError).toBeFalsy();
        expect(callTool).toHaveBeenCalledTimes(1);
        const arg = (callTool.mock.calls[0] as unknown as [{ name: string }])[0];
        expect(arg.name).toBe("search_law");
    });

    it("przycisk 'Sprawdz powolania' dalej tylko w trybie listy - `text` nie wychodzi", async () => {
        await getMcpTools();
        await runCitationVerifier({
            text: PISMO,
            citations: [{ type: "provision", act_id: "eli:DU/1964/93", article: "471", ref: "c1" }],
        });
        expect(callTool).toHaveBeenCalledTimes(1);
        const wyslane = JSON.stringify(callTool.mock.calls);
        expect(wyslane).not.toContain("90010112349");
        expect(wyslane).not.toContain("Jan Testowy");
    });
});
