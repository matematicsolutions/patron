// B-08 (audyt 2026-09; decyzja wlasciciela produktu 2026-10-06): nieznany
// konektor 3rd-party (spoza APPROVED_PATRON_CONNECTORS) NIE jest rejestrowany
// automatycznie - brama daje `human_review`, a Operator zatwierdza go jednym
// krokiem: `gatewayApproval` (hash definicji + odcisk pochodzenia, ADR-0158) w
// nakladce (ADR-0166). To samo zatwierdzenie dopuszcza wywolania w Ring 2.
//
// Prawdziwa sciezka getMcpTools -> brama -> resolveOperatorApproval ->
// ring-policy. Konektor ZAMOCKOWANY - zero sieci i procesow. Dane syntetyczne.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    computeApprovalHash,
    computeOriginFingerprint,
    type McpServerDefinition,
} from "../mcp-security";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-b08-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
const BASELINE = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = BASELINE;
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");

const NARZEDZIE = {
    name: "add_deadline",
    description: "Dodaje termin procesowy do kalendarza (dane syntetyczne).",
    inputSchema: { type: "object", properties: { note: { type: "string" } } },
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
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
    StreamableHTTPClientTransport: class {},
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

const NAZWA = "kalendarz-terminow-pro";
const URL_ = "https://example.invalid/mcp";
const DEF: McpServerDefinition = { name: NAZWA, transport: "http", url: URL_, tools: [NARZEDZIE] };
const PREFIKS = `${NAZWA}__add_deadline`;

function nakladka(entries: Array<Record<string, unknown>>) {
    fs.writeFileSync(OVERLAY, JSON.stringify(entries));
}
function wpis(extra: Record<string, unknown> = {}) {
    return { name: NAZWA, transport: "http", url: URL_, ...extra };
}

async function swiezyModul() {
    vi.resetModules();
    return import("./index");
}

let warn: { mock: { calls: unknown[][] } };
beforeEach(() => {
    callTool.mockClear();
    gatewayEvents.length = 0;
    ringEvents.length = 0;
    fs.rmSync(BASELINE, { force: true });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("B-08 nieznany konektor 3rd-party w getMcpTools", () => {
    it("bez zatwierdzenia: brak narzedzi u modelu, stan 'czeka na Operatora', wywolanie odrzucone", async () => {
        nakladka([wpis()]);
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).not.toContain(PREFIKS);
        expect(mcp.isMcpTool(PREFIKS)).toBe(false);
        const stan = mcp.getGatewayState(NAZWA);
        expect(stan).toMatchObject({
            gatewayAction: "human_review",
            approval: "missing",
            registered: false,
            unknownThirdPartyOnly: true,
            approvalHash: computeApprovalHash(DEF),
            approvalOrigin: computeOriginFingerprint(DEF),
        });
        expect(mcp.isAwaitingOperatorApproval(stan)).toBe(true);
        expect(gatewayEvents[0]).toMatchObject({ action: "human_review", operatorApproval: { status: "missing" } });
        const r = await mcp.runMcpTool(PREFIKS, { note: "x" });
        expect(r.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
    });

    it("log podaje JEDEN krok Operatora: gatewayApproval z hashem i odciskiem; operatorApproved niepotrzebne", async () => {
        nakladka([wpis()]);
        const mcp = await swiezyModul();
        await mcp.getMcpTools();
        const log = warn.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
        expect(log).toContain("czeka na zatwierdzenie Operatora");
        expect(log).toContain(`"hash": "${computeApprovalHash(DEF)}"`);
        expect(log).toContain(`"origin": "${computeOriginFingerprint(DEF)}"`);
        expect(log).toContain(OVERLAY);
        expect(log).toContain("operatorApproved nie jest potrzebne");
    });

    it("samo operatorApproved=true (bez gatewayApproval) nie rejestruje - zatwierdzenie musi byc przypiete do definicji", async () => {
        nakladka([wpis({ operatorApproved: true })]);
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).not.toContain(PREFIKS);
        expect(mcp.isAwaitingOperatorApproval(mcp.getGatewayState(NAZWA))).toBe(true);
    });

    it("zgodne gatewayApproval (bez operatorApproved): rejestracja i wywolanie w Ring 2", async () => {
        nakladka([
            wpis({
                gatewayApproval: {
                    hash: computeApprovalHash(DEF),
                    origin: computeOriginFingerprint(DEF),
                    approvedAt: "2026-10-06",
                    approvedBy: "operator",
                },
            }),
        ]);
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).toContain(PREFIKS);
        expect(gatewayEvents[0]).toMatchObject({ action: "audit", operatorApproval: { status: "approved" } });
        expect(mcp.isAwaitingOperatorApproval(mcp.getGatewayState(NAZWA))).toBe(false);
        const r = await mcp.runMcpTool(PREFIKS, { note: "x" });
        expect(r.isError).not.toBe(true);
        expect(callTool).toHaveBeenCalledTimes(1);
        expect(ringEvents.at(-1)?.decision).toEqual({
            ring: 2,
            action: "allow",
            reason: "operator-gateway-approval",
        });
    });

    it("zatwierdzenie innej definicji (hash_mismatch): blokada i stan oczekiwania", async () => {
        nakladka([wpis({ gatewayApproval: { hash: "a".repeat(64), origin: computeOriginFingerprint(DEF) } })]);
        const mcp = await swiezyModul();
        expect((await mcp.getMcpTools()).map((t) => t.function.name)).not.toContain(PREFIKS);
        const stan = mcp.getGatewayState(NAZWA);
        expect(stan?.approval).toBe("hash_mismatch");
        expect(mcp.isAwaitingOperatorApproval(stan)).toBe(true);
    });

    it("picker: nieznany konektor bez zatwierdzenia = 'czeka na Operatora' (przed skanem i po nim)", async () => {
        nakladka([wpis(), { name: "saoss", transport: "http", url: URL_ }]);
        vi.resetModules();
        const przed = (await import("./connectors")).getConnectorList();
        expect(przed.find((c) => c.name === NAZWA)).toMatchObject({
            ring: 2,
            toggleable: false,
            gateway: "awaiting_operator_approval",
        });
        // Nazwa mylaca sie z zaufana (dist 1) to blokada, nie oczekiwanie.
        expect(przed.find((c) => c.name === "saoss")?.gateway).toBe("blocked");

        const mcp = await import("./index");
        await mcp.getMcpTools();
        const po = (await import("./connectors")).getConnectorList();
        expect(po.find((c) => c.name === NAZWA)?.gateway).toBe("awaiting_operator_approval");
        expect(po.find((c) => c.name === "saoss")?.gateway).toBe("blocked");
    });

    it("picker: po zgodnym zatwierdzeniu brak stanu oczekiwania", async () => {
        nakladka([wpis({ gatewayApproval: { hash: computeApprovalHash(DEF), origin: computeOriginFingerprint(DEF) } })]);
        vi.resetModules();
        const mcp = await import("./index");
        await mcp.getMcpTools();
        const info = (await import("./connectors")).getConnectorList().find((c) => c.name === NAZWA);
        expect(info).toMatchObject({ ring: 2, toggleable: false });
        expect(info?.gateway).toBeUndefined();
    });

    it("pole 'gatewayApproved' wpisane w pliku nie daje zgody na wywolanie (ustawia je tylko brama)", async () => {
        // Nazwa zaufana z nakladki: brama daje `audit` (pierwszy load), ring-policy
        // Ring 2. Gdyby pole z pliku bylo czytane, wywolanie by przeszlo.
        fs.writeFileSync(
            OVERLAY,
            JSON.stringify([
                {
                    name: "saos",
                    transport: "stdio",
                    command: "node",
                    args: ["mcp-bundled/saos/dist/index.js"],
                    gatewayApproved: true,
                },
            ]),
        );
        const mcp = await swiezyModul();
        await mcp.getMcpTools();
        const r = await mcp.runMcpTool("saos__add_deadline", { note: "x" });
        expect(r.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
        expect(ringEvents.at(-1)?.decision).toMatchObject({ action: "deny", reason: "trusted-name-outside-installer" });
    });
});
