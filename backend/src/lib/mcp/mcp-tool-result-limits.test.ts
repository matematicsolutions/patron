// Przeglad 2026-10-08: wynik narzedzia MCP dla modelu ma sufit rozmiaru (konektor liczy
// wiersze albo dokumenty, nie bajty), a blad wywolania MCP oddaje modelowi biala liste
// pol - bez komunikatu klienta (bywa w nim adres konektora z kluczem). Konektor
// ZAMOCKOWANY - zero sieci. Dane syntetyczne.
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { computeApprovalHash, computeOriginFingerprint, type McpServerDefinition } from "../mcp-security";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-limity-wyniku-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
const obiekt = { type: "object", properties: { q: { type: "string" } } };
const NARZEDZIA = [
    { name: "duzy_wynik", description: "Zwraca duzo tekstu.", inputSchema: obiekt },
    { name: "pada", description: "Zawsze konczy sie bledem.", inputSchema: obiekt },
];
const def: McpServerDefinition = {
    name: "korpus-zewnetrzny-testowy", transport: "http", url: "http://127.0.0.1:9/mcp", tools: NARZEDZIA,
};
fs.writeFileSync(OVERLAY, JSON.stringify([{
    name: "korpus-zewnetrzny-testowy",
    transport: "http",
    url: "http://127.0.0.1:9/mcp",
    gatewayApproval: {
        hash: computeApprovalHash(def), origin: computeOriginFingerprint(def),
        approvedAt: "2026-10-08", approvedBy: "operator",
    },
}]));
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");

const KLUCZ = "SEKRETNYKLUCZ0123456789abcdef";
const { lista } = vi.hoisted(() => ({ lista: { tools: [] as unknown[] } }));
lista.tools = NARZEDZIA;
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: class {
        async connect() {}
        async close() {}
        async listTools() {
            return { tools: lista.tools };
        }
        async callTool({ name }: { name: string }) {
            if (name === "duzy_wynik") return { content: [{ type: "text", text: "y".repeat(250_000) }] };
            throw Object.assign(
                new Error(`Error POSTing to https://repertorium.example/mcp/${KLUCZ}: no such table: tajna_tabela`),
                { code: 401 },
            );
        }
    },
}));
vi.mock("./audit-bridge", () => ({
    recordMcpSecurityEvent: vi.fn(async () => ({ ok: true })),
    recordRingPolicyEvent: vi.fn(async () => ({ ok: true })),
}));

import { getMcpTools, MAX_MCP_TEXT, runMcpTool } from "./index";

describe("wynik narzedzia MCP dla modelu", () => {
    it("gruby wynik: przyciety do MAX_MCP_TEXT z jawna informacja", async () => {
        await getMcpTools();
        const r = await runMcpTool("korpus-zewnetrzny-testowy__duzy_wynik", { q: "x" });
        expect(r.text.length).toBeLessThan(MAX_MCP_TEXT + 300);
        expect(r.text).toContain("wynik narzedzia obciety");
        expect(r.text).toContain("250000");
    });

    it("blad wywolania: bez klucza z adresu i bez schematu, z kodem HTTP i klasa", async () => {
        await getMcpTools();
        const r = await runMcpTool("korpus-zewnetrzny-testowy__pada", { q: "x" });
        expect(r.isError).toBe(true);
        expect(r.text).not.toContain(KLUCZ);
        expect(r.text).not.toContain("tajna_tabela");
        expect(JSON.parse(r.text)).toMatchObject({
            error: "mcp_tool_failed", tool: "korpus-zewnetrzny-testowy__pada", http_status: 401,
        });
    });
});
