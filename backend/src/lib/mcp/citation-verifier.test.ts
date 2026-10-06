// R-CC-07 (ADR-0157): narzedzia serwera weryfikatora powolan nie sa narzedziami
// czatu. Rejestracja z nakladki Operatora (jak w ADR-0157 pkt 7), konektor
// ZAMOCKOWANY - zero sieci. Dane syntetyczne.
//
// Pilnujemy trzech drzwi naraz: (1) schematu dla modelu (getMcpTools), (2)
// dispatchu czatu (isMcpTool / runMcpTool - model moze podac nazwe, ktorej nie
// dostal), (3) jedynego wejscia trasy (runCitationVerifier) - tylko tryb listy,
// `text` nie wychodzi nawet wtedy, gdy wolajacy go poda.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeApprovalHash, computeOriginFingerprint, type McpServerDefinition } from "../mcp-security";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-verifier-"));
const OVERLAY = path.join(TMP, "mcp-servers.operator.json");
const NARZEDZIE = {
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
};
// B-08: konektor spoza zaufanego zestawu jest `human_review` do zatwierdzenia;
// Operator wpisuje `gatewayApproval` (hash definicji + odcisk pochodzenia).
const zatwierdzenie = (name: string) => {
    const def: McpServerDefinition = { name, transport: "http", url: "http://127.0.0.1:9/mcp", tools: [NARZEDZIE] };
    return { hash: computeApprovalHash(def), origin: computeOriginFingerprint(def) };
};
const wpis = (name: string) => ({
    name,
    transport: "http",
    url: "http://127.0.0.1:9/mcp",
    trustLevel: "untrusted",
    operatorApproved: true,
    approvedAt: "2026-10-01",
    approvedBy: "operator",
    gatewayApproval: { ...zatwierdzenie(name), approvedAt: "2026-10-06", approvedBy: "operator" },
});
fs.writeFileSync(OVERLAY, JSON.stringify([wpis("repertorium"), wpis("korpus-zewnetrzny-testowy")]));
process.env.PATRON_MCP_OPERATOR_CONFIG = OVERLAY;
process.env.PATRON_MCP_BASELINE_PATH = path.join(TMP, "baseline.json");
process.env.PATRON_MCP_BUNDLED_DEFINITIONS_PATH = path.join(TMP, "brak.json");
delete process.env.PATRON_CITATION_VERIFIER_SERVER;

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
vi.mock("./audit-bridge", () => ({
    recordMcpSecurityEvent: vi.fn(async () => ({ ok: true })),
    recordRingPolicyEvent: vi.fn(async () => ({ ok: true })),
}));

import {
    getMcpTools,
    hasCitationVerifier,
    isMcpTool,
    runCitationVerifier,
    runMcpTool,
} from "./index";
import { sanitizeVerifyArgs } from "./verifier";

const PISMO = "Powod Jan Testowy, PESEL 90010112349, zam. ul. Polna 12/24. Podstawa: art. 471 k.c.";

afterEach(() => {
    callTool.mockClear();
});

describe("R-CC-07 weryfikator powolan poza czatem", () => {
    it("schemat dla modelu: brak narzedzi serwera weryfikatora; inny serwer zostaje (kontrola pozytywna)", async () => {
        const nazwy = (await getMcpTools()).map((t) => t.function.name);
        expect(nazwy.some((n) => n.startsWith("repertorium__"))).toBe(false);
        // Ukrywamy po SERWERZE weryfikatora, nie po nazwie narzedzia.
        expect(nazwy).toContain("korpus-zewnetrzny-testowy__verify_citations");
    });

    it("dispatch czatu: nazwa podana przez model nie prowadzi do wywolania", async () => {
        await getMcpTools();
        expect(isMcpTool("repertorium__verify_citations")).toBe(false);
        expect(isMcpTool("korpus-zewnetrzny-testowy__verify_citations")).toBe(true);
        const r = await runMcpTool("repertorium__verify_citations", { text: PISMO });
        expect(r.isError).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
    });

    it("trasa weryfikatora: zarejestrowany, a `text` i obce pola nie wychodza", async () => {
        await getMcpTools();
        expect(hasCitationVerifier()).toBe(true);
        await runCitationVerifier({
            text: PISMO,
            filename: "pozew-jan-testowy.docx",
            citations: [
                { type: "provision", act_id: "eli:DU/1964/93", article: "471", ref: "c2", context: PISMO },
                { type: "signature", signature: "II CSKP 1/24", date_in_text: "2024-03-12", ref: "c3" },
            ],
            as_of: "2024-01-15",
        });
        expect(callTool).toHaveBeenCalledTimes(1);
        const wyslane = JSON.stringify(callTool.mock.calls);
        expect(wyslane).not.toContain("90010112349");
        expect(wyslane).not.toContain("Jan Testowy");
        expect(wyslane).not.toContain("pozew");
        const arg = (callTool.mock.calls[0] as unknown as [{ name: string; arguments: unknown }])[0];
        expect(arg.name).toBe("verify_citations");
        expect(arg.arguments).toEqual({
            citations: [
                { type: "provision", act_id: "eli:DU/1964/93", article: "471", ref: "c2" },
                { type: "signature", signature: "II CSKP 1/24", date_in_text: "2024-03-12", ref: "c3" },
            ],
            as_of: "2024-01-15",
        });
    });
});

describe("sanitizeVerifyArgs - tryb listy, biala lista pol", () => {
    it("pozycja z dowolnym tekstem w polu identyfikatora jest pomijana", () => {
        const out = sanitizeVerifyArgs({
            citations: [
                { type: "signature", signature: "Jan Testowy PESEL 90010112349", ref: "c1" },
                { type: "signature", signature: "II CSKP 1/24", ref: "c2; drop" },
                { type: "provision", act_id: "Kodeks cywilny", article: "471", ref: "c3" },
                { type: "text", text: PISMO, ref: "c4" },
                null,
                "c5",
                { type: "signature", signature: "II CSKP 1/24", date_in_text: "12.03.1980", ref: "c6" },
            ],
            as_of: "jutro",
        });
        expect(out).toEqual({
            citations: [{ type: "signature", signature: "II CSKP 1/24", ref: "c6" }],
        });
    });

    it("najwyzej 25 pozycji (limit narzedzia); brak tablicy = pusta lista", () => {
        const wiele = Array.from({ length: 40 }, (_, i) => ({
            type: "provision",
            act_id: "eli:DU/1964/93",
            article: String(i + 1),
            ref: `c${i + 1}`,
        }));
        expect((sanitizeVerifyArgs({ citations: wiele }).citations as unknown[]).length).toBe(25);
        expect(sanitizeVerifyArgs({ text: PISMO })).toEqual({ citations: [] });
    });
});
