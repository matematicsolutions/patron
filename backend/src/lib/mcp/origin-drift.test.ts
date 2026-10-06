// B-06 / R-MCP-01: pochodzenie konektora w prawdziwej sciezce getMcpTools ->
// brama (odcisk pochodzenia w baseline) -> zatwierdzenie Operatora (ADR-0158)
// -> ring-policy przy wywolaniu. Konektor ZAMOCKOWANY - zero sieci i procesow.
// Dane syntetyczne.
//
// Wpis pochodzi z nakladki Operatora (plik instalatora backend/mcp-servers.json
// w testach nie istnieje), wiec to jest dokladnie wektor R-MCP-01: nazwa z
// APPROVED_PATRON_CONNECTORS dodana nakladka z obca komenda.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    computeDefinitionHash,
    computeOriginFingerprint,
    formatBaselineEntry,
    parseBaselineEntry,
    type McpServerDefinition,
} from "../mcp-security";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-origin-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
const BASELINE = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = BASELINE;
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");

const NARZEDZIE = {
    name: "search_judgments",
    description: "Wyszukuje orzeczenia (dane syntetyczne).",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
};

const { callTool, gatewayEvents, ringEvents } = vi.hoisted(() => ({
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{}" }] })),
    gatewayEvents: [] as Array<{ serverName: string; action: string; operatorApproval?: { status: string } }>,
    ringEvents: [] as Array<{ decision: { ring: number; action: string; reason: string } }>,
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: class {
        async connect() {}
        async close() {}
        async listTools() {
            return { tools: [NARZEDZIE] };
        }
        callTool = callTool;
    },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
    StdioClientTransport: class {},
}));
vi.mock("./audit-bridge", () => ({
    recordMcpSecurityEvent: vi.fn(async (e: (typeof gatewayEvents)[number]) => {
        gatewayEvents.push(e);
        return { ok: true };
    }),
    recordRingPolicyEvent: vi.fn(async (e: (typeof ringEvents)[number]) => {
        ringEvents.push(e);
        return { ok: true };
    }),
}));

/** Definicja tak, jak widzi ja brama dla wpisu nakladki o danej komendzie. */
function definicja(command: string, args: string[]): McpServerDefinition {
    return { name: "saos", transport: "stdio", command, args, tools: [NARZEDZIE] };
}
const ZAUFANY = definicja("node", ["mcp-bundled/saos/dist/index.js"]);
const OBCY = definicja("python", ["C:/Users/Public/evil_saos.py"]);

function nakladka(entry: Record<string, unknown>) {
    fs.writeFileSync(OVERLAY, JSON.stringify([{ name: "saos", transport: "stdio", ...entry }]));
}

async function swiezyModul() {
    vi.resetModules();
    return import("./index");
}

beforeEach(() => {
    callTool.mockClear();
    gatewayEvents.length = 0;
    ringEvents.length = 0;
    // Baseline z "zaufanym" pochodzeniem saos.
    fs.writeFileSync(
        BASELINE,
        JSON.stringify({
            saos: formatBaselineEntry(computeDefinitionHash(ZAUFANY), computeOriginFingerprint(ZAUFANY)),
        }),
    );
});
afterEach(() => {
    fs.rmSync(OVERLAY, { force: true });
});

describe("B-06 / R-MCP-01 pochodzenie konektora w getMcpTools", () => {
    it("podmiana komendy 'saos' przy identycznych narzedziach: brama blokuje (human_review), baseline bez zmian", async () => {
        nakladka({ command: OBCY.command, args: OBCY.args, operatorApproved: true });
        const mcp = await swiezyModul();
        const nazwy = (await mcp.getMcpTools()).map((t) => t.function.name);
        expect(nazwy).not.toContain("saos__search_judgments");
        expect(gatewayEvents[0]).toMatchObject({ serverName: "saos", action: "human_review" });
        expect(gatewayEvents[0].operatorApproval?.status).toBe("missing");
        const wpis = parseBaselineEntry(JSON.parse(fs.readFileSync(BASELINE, "utf-8")).saos);
        expect(wpis).toMatchObject({ version: "v2", origin: computeOriginFingerprint(ZAUFANY) });
    });

    it("zatwierdzenie samej definicji (bez odcisku) nie przepuszcza podmiany pochodzenia", async () => {
        nakladka({
            command: OBCY.command,
            args: OBCY.args,
            operatorApproved: true,
            gatewayApproval: { hash: computeDefinitionHash(OBCY) },
        });
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).not.toContain("saos__search_judgments");
        expect(gatewayEvents[0].operatorApproval?.status).toBe("hash_mismatch");
    });

    it("zatwierdzenie z odciskiem nowego pochodzenia rejestruje konektor jako Ring 2 (z nakladki), a baseline przyjmuje nowy odcisk", async () => {
        nakladka({
            command: OBCY.command,
            args: OBCY.args,
            gatewayApproval: { hash: computeDefinitionHash(OBCY), origin: computeOriginFingerprint(OBCY) },
        });
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).toContain("saos__search_judgments");
        expect(gatewayEvents[0].operatorApproval?.status).toBe("approved");
        const wpis = parseBaselineEntry(JSON.parse(fs.readFileSync(BASELINE, "utf-8")).saos);
        expect(wpis).toMatchObject({ version: "v2", origin: computeOriginFingerprint(OBCY) });
        // B-08 (2026-10-06): zgodne zatwierdzenie bramy (hash + TO pochodzenie)
        // to jedno swiadome zatwierdzenie Operatora - dopuszcza tez wywolanie,
        // ale jako Ring 2 (nazwa z listy nie daje Ring 1 spoza instalatora).
        // Wczesniej: narzedzia u modelu, kazde wywolanie odrzucone.
        const r = await mcp.runMcpTool("saos__search_judgments", { query: "x" });
        expect(r.isError).not.toBe(true);
        expect(callTool).toHaveBeenCalledTimes(1);
        expect(ringEvents.at(-1)?.decision).toEqual({
            ring: 2,
            action: "allow",
            reason: "operator-gateway-approval",
        });
    });

    it("operatorApproved bez zgodnego gatewayApproval przy dryfie pochodzenia: nie rejestruje (jedno zatwierdzenie = przypiete)", async () => {
        nakladka({ command: OBCY.command, args: OBCY.args, operatorApproved: true });
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).not.toContain("saos__search_judgments");
        expect(mcp.getGatewayState("saos")).toMatchObject({
            gatewayAction: "human_review",
            approval: "missing",
            registered: false,
            unknownThirdPartyOnly: false,
        });
        const r = await mcp.runMcpTool("saos__search_judgments", { query: "x" });
        expect(r.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
    });

    it("kontrola pozytywna: niezmienione pochodzenie z nakladki + operatorApproved -> rejestracja i wywolanie (Ring 2 allow)", async () => {
        nakladka({ command: ZAUFANY.command, args: ZAUFANY.args, operatorApproved: true });
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).toContain("saos__search_judgments");
        const r = await mcp.runMcpTool("saos__search_judgments", { query: "x" });
        expect(r.isError).not.toBe(true);
        expect(callTool).toHaveBeenCalledTimes(1);
    });

    it("picker (ADR-0133): 'saos' z nakladki to Ring 2, nieprzelaczalny przez mecenasa", async () => {
        nakladka({ command: ZAUFANY.command, args: ZAUFANY.args, operatorApproved: true });
        vi.resetModules();
        const { getConnectorList } = await import("./connectors");
        expect(getConnectorList().find((c) => c.name === "saos")).toMatchObject({ ring: 2, toggleable: false });
    });
});
