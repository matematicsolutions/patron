// Polaczenie "Sprawdz powolania" z konektorem MCP (ADR-0157): nazwa serwera
// weryfikatora z env i to, ze brak / blokada konektora daje null - nigdy
// wywolanie innego narzedzia ani cichy sukces.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMcpTools = vi.fn();
const hasCitationVerifier = vi.fn();
const runCitationVerifier = vi.fn();
const runMcpTool = vi.fn();
const getGatewayState = vi.fn();
vi.mock("../mcp", async (importOriginal) => {
    // isAwaitingOperatorApproval jest czysta - test mierzy te sama regule co produkcja.
    const prawdziwy = await importOriginal<typeof import("../mcp")>();
    return {
        getMcpTools: (...a: unknown[]) => getMcpTools(...a),
        hasCitationVerifier: (...a: unknown[]) => hasCitationVerifier(...a),
        runCitationVerifier: (...a: unknown[]) => runCitationVerifier(...a),
        runMcpTool: (...a: unknown[]) => runMcpTool(...a),
        getGatewayState: (...a: unknown[]) => getGatewayState(...a),
        isAwaitingOperatorApproval: prawdziwy.isAwaitingOperatorApproval,
    };
});

import { resolveVerifyToolCall, verifierPendingApproval, verifierServerName } from "./connector";

const ENV = "PATRON_CITATION_VERIFIER_SERVER";
let poprzedni: string | undefined;

beforeEach(() => {
    poprzedni = process.env[ENV];
    delete process.env[ENV];
    getMcpTools.mockReset().mockResolvedValue([]);
    hasCitationVerifier.mockReset();
    runCitationVerifier.mockReset();
    runMcpTool.mockReset();
    getGatewayState.mockReset();
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
        hasCitationVerifier.mockReturnValue(false);
        expect(await resolveVerifyToolCall()).toBeNull();
        expect(hasCitationVerifier).toHaveBeenCalled();
    });

    it("blad przy ladowaniu konektorow = null, nie wyjatek", async () => {
        getMcpTools.mockRejectedValue(new Error("brak sieci"));
        expect(await resolveVerifyToolCall()).toBeNull();
        expect(hasCitationVerifier).not.toHaveBeenCalled();
    });

    it("wola wejscie weryfikatora (R-CC-07), nie sciezke czatu, i oddaje text / structured / isError", async () => {
        hasCitationVerifier.mockReturnValue(true);
        runCitationVerifier.mockResolvedValue({ text: "{}", citations: [], structured: { ok: 1 }, isError: undefined });
        const call = await resolveVerifyToolCall();
        expect(call).not.toBeNull();
        const r = await call!({ citations: [] });
        expect(runCitationVerifier).toHaveBeenCalledWith({ citations: [] });
        expect(runMcpTool).not.toHaveBeenCalled();
        expect(r).toEqual({ text: "{}", structured: { ok: 1 }, isError: undefined });
    });
});

describe("verifierPendingApproval (B-08)", () => {
    const stan = (o: Record<string, unknown>) => ({
        gatewayAction: "human_review",
        approval: "missing",
        registered: false,
        unknownThirdPartyOnly: true,
        approvalHash: "a".repeat(64),
        approvalOrigin: "b".repeat(64),
        ...o,
    });

    it("human_review bez zatwierdzenia: wartosci do wpisania dla serwera weryfikatora", () => {
        getGatewayState.mockReturnValue(stan({}));
        expect(verifierPendingApproval()).toEqual({
            server: "repertorium",
            hash: "a".repeat(64),
            origin: "b".repeat(64),
            reason: "missing",
        });
        expect(getGatewayState).toHaveBeenCalledWith("repertorium");
    });

    it("zatwierdzenie innej definicji: reason hash_mismatch", () => {
        getGatewayState.mockReturnValue(stan({ approval: "hash_mismatch" }));
        expect(verifierPendingApproval()?.reason).toBe("hash_mismatch");
    });

    it("nie czeka: brak skanu, denied, zarejestrowany", () => {
        getGatewayState.mockReturnValue(undefined);
        expect(verifierPendingApproval()).toBeNull();
        getGatewayState.mockReturnValue(stan({ gatewayAction: "denied", approval: "not_overridable" }));
        expect(verifierPendingApproval()).toBeNull();
        getGatewayState.mockReturnValue(stan({ approval: "approved", registered: true }));
        expect(verifierPendingApproval()).toBeNull();
    });
});
