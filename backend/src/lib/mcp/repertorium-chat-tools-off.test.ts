// ADR-0167: Repertorium z narzedziami odczytu, ale BEZ `chatTools` w nakladce.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-repertorium-bez-czatu-"));
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

describe("ADR-0167 bez chatTools - narzedzia odczytu NIE wchodza do czatu", () => {
    it("schemat: zero narzedzi serwera weryfikatora", async () => {
        const nazwy = (await getMcpTools()).map((t) => t.function.name);
        expect(nazwy.some((n) => n.startsWith("repertorium__"))).toBe(false);
    });

    it("dispatch: narzedzie odczytu podane przez model nie prowadzi do wywolania", async () => {
        await getMcpTools();
        expect(isMcpTool("repertorium__search_law")).toBe(false);
        const r = await runMcpTool("repertorium__search_law", { query: "art. 471 k.c." });
        expect(r.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
    });

    it("przycisk dalej dziala (weryfikator zarejestrowany)", async () => {
        await getMcpTools();
        await runCitationVerifier({ citations: [{ type: "provision", act_id: "eli:DU/1964/93", article: "471", ref: "c1" }] });
        expect(callTool).toHaveBeenCalledTimes(1);
    });
});
