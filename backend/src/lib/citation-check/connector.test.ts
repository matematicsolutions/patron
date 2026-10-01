// Polaczenie "Sprawdz powolania" z konektorem MCP (ADR-0157): nazwa serwera
// weryfikatora z env i to, ze brak / blokada konektora daje null - nigdy
// wywolanie innego narzedzia ani cichy sukces.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMcpTools = vi.fn();
const isMcpTool = vi.fn();
const runMcpTool = vi.fn();
vi.mock("../mcp", () => ({
    getMcpTools: (...a: unknown[]) => getMcpTools(...a),
    isMcpTool: (...a: unknown[]) => isMcpTool(...a),
    runMcpTool: (...a: unknown[]) => runMcpTool(...a),
}));

import { resolveVerifyToolCall, verifierServerName, VERIFY_TOOL } from "./connector";

const ENV = "PATRON_CITATION_VERIFIER_SERVER";
let poprzedni: string | undefined;

beforeEach(() => {
    poprzedni = process.env[ENV];
    delete process.env[ENV];
    getMcpTools.mockReset().mockResolvedValue([]);
    isMcpTool.mockReset();
    runMcpTool.mockReset();
});
afterEach(() => {
    if (poprzedni === undefined) delete process.env[ENV];
    else process.env[ENV] = poprzedni;
});

describe("verifierServerName", () => {
    it("domyslnie repertorium", () => {
        expect(verifierServerName()).toBe("repertorium");
    });

    it("bierze poprawna nazwe z env (przyciete spacje)", () => {
        process.env[ENV] = "  weryfikator-2 ";
        expect(verifierServerName()).toBe("weryfikator-2");
    });

    it("nazwa spoza wzorca wraca do domyslnej - env nie wstrzyknie innego narzedzia", () => {
        for (const zla of ["", "saos__search", "a b", "../x", "x".repeat(65), "repertorium;rm"]) {
            process.env[ENV] = zla;
            expect(verifierServerName()).toBe("repertorium");
        }
    });
});

describe("resolveVerifyToolCall", () => {
    it("narzedzie nie zarejestrowane (brak konektora albo blokada bramy) = null", async () => {
        isMcpTool.mockReturnValue(false);
        expect(await resolveVerifyToolCall()).toBeNull();
        expect(isMcpTool).toHaveBeenCalledWith(`repertorium__${VERIFY_TOOL}`);
    });

    it("blad przy ladowaniu konektorow = null, nie wyjatek", async () => {
        getMcpTools.mockRejectedValue(new Error("brak sieci"));
        expect(await resolveVerifyToolCall()).toBeNull();
        expect(isMcpTool).not.toHaveBeenCalled();
    });

    it("wola WLASNIE serwer z env i oddaje text / structured / isError", async () => {
        process.env[ENV] = "weryfikator-2";
        isMcpTool.mockReturnValue(true);
        runMcpTool.mockResolvedValue({ text: "{}", citations: [], structured: { ok: 1 }, isError: undefined });
        const call = await resolveVerifyToolCall();
        expect(call).not.toBeNull();
        const r = await call!({ citations: [] });
        expect(runMcpTool).toHaveBeenCalledWith(`weryfikator-2__${VERIFY_TOOL}`, { citations: [] });
        expect(r).toEqual({ text: "{}", structured: { ok: 1 }, isError: undefined });
    });
});
