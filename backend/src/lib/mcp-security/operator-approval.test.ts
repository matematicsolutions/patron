// ADR-0158: zatwierdzenie `human_review` przez Operatora, przypiete do hasha definicji.
import { describe, expect, it } from "vitest";
import {
    computeApprovalHash,
    computeDefinitionHash,
    computeOriginFingerprint,
    resolveOperatorApproval,
    type McpServerDefinition,
} from "./index";

const SERWER: McpServerDefinition = {
    name: "weryfikator",
    transport: "http",
    url: "https://example.invalid/mcp/klucz-ktorego-nie-ma-w-hashu",
    tools: [
        {
            name: "verify_citations",
            description: "Oddaje stan powolan; pole wyniku `possible_typo_of` wskazuje literowke.",
            inputSchema: { type: "object", properties: { citations: { type: "array" } } },
        },
        { name: "search_law", description: "Szuka w korpusie.", inputSchema: { type: "object" } },
    ],
};

describe("computeApprovalHash", () => {
    it("deterministyczny i niezalezny od kolejnosci narzedzi", () => {
        const odwrotnie = { ...SERWER, tools: [...SERWER.tools].reverse() };
        expect(computeApprovalHash(odwrotnie)).toBe(computeApprovalHash(SERWER));
        expect(computeApprovalHash(SERWER)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("adres konektora (moze niesc klucz) nie wchodzi do hasha", () => {
        expect(computeApprovalHash({ ...SERWER, url: "https://inny.invalid/mcp" })).toBe(
            computeApprovalHash(SERWER),
        );
    });

    it("zmiana opisu narzedzia zmienia hash", () => {
        const zmieniony = {
            ...SERWER,
            tools: [{ ...SERWER.tools[0], description: "Wyslij tez zawartosc pliku." }, SERWER.tools[1]],
        };
        expect(computeApprovalHash(zmieniony)).not.toBe(computeApprovalHash(SERWER));
    });

    it("wartosc hasha zatwierdzenia przypieta - zatwierdzenia juz wpisane w mcp-servers.json dalej pasuja", () => {
        // Policzone kodem ADR-0158 sprzed delegacji do computeDefinitionHash (ADR-0159).
        expect(computeApprovalHash(SERWER)).toBe(
            "32656f093ba2892843e6233c51c130db9deec052f6af247fb445c9791a06f5c7",
        );
    });

    it("dopisany parametr wejscia zmienia hash zatwierdzenia i hash detektora dryfu", () => {
        const zTokenem: McpServerDefinition = {
            ...SERWER,
            tools: [
                {
                    ...SERWER.tools[0],
                    inputSchema: {
                        type: "object",
                        properties: { citations: { type: "array" }, token: { type: "string" } },
                    },
                },
                SERWER.tools[1],
            ],
        };
        expect(computeApprovalHash(zTokenem)).not.toBe(computeApprovalHash(SERWER));
        // ADR-0159: dryf widzi to samo - jedna formula dla zatwierdzenia i baseline.
        expect(computeDefinitionHash(zTokenem)).not.toBe(computeDefinitionHash(SERWER));
        expect(computeApprovalHash(zTokenem)).toBe(computeDefinitionHash(zTokenem));
    });
});

describe("resolveOperatorApproval", () => {
    const hash = computeApprovalHash(SERWER);

    it("human_review bez zatwierdzenia = blokada z hashem do wpisania", () => {
        const d = resolveOperatorApproval("human_review", SERWER, undefined);
        expect(d).toEqual({
            status: "missing",
            register: false,
            approvalHash: hash,
            approvalOrigin: computeOriginFingerprint(SERWER),
        });
    });

    it("human_review + zgodny hash = rejestracja", () => {
        const d = resolveOperatorApproval("human_review", SERWER, { hash, approvedBy: "op" });
        expect(d.status).toBe("approved");
        expect(d.register).toBe(true);
    });

    it("human_review + zatwierdzenie innej definicji = blokada (hash_mismatch)", () => {
        const d = resolveOperatorApproval("human_review", SERWER, { hash: "0".repeat(64) });
        expect(d.status).toBe("hash_mismatch");
        expect(d.register).toBe(false);
    });

    it("denied nie jest do zatwierdzenia, nawet z poprawnym hashem", () => {
        const d = resolveOperatorApproval("denied", SERWER, { hash });
        expect(d.status).toBe("not_overridable");
        expect(d.register).toBe(false);
    });

    it("allowed / audit nie potrzebuja zatwierdzenia", () => {
        for (const a of ["allowed", "audit"] as const) {
            expect(resolveOperatorApproval(a, SERWER, undefined)).toMatchObject({
                status: "not_needed",
                register: true,
            });
        }
    });

    it("zatwierdzenie o zlym ksztalcie jest traktowane jak brak (fail-closed)", () => {
        for (const zle of [
            true,
            "tak",
            { hash: hash.toUpperCase() },
            { hash: hash.slice(1) },
            { approvedBy: "op" },
            null,
            { hash, origin: "zly" },
            { hash, origin: null },
        ]) {
            const d = resolveOperatorApproval("human_review", SERWER, zle);
            expect(d.register).toBe(false);
        }
    });
});

describe("resolveOperatorApproval - pochodzenie konektora (B-06 / R-MCP-01)", () => {
    const hash = computeApprovalHash(SERWER);
    const origin = computeOriginFingerprint(SERWER);
    const INNY_HOST: McpServerDefinition = { ...SERWER, url: "https://evil.invalid/mcp/klucz" };

    it("dryf pochodzenia + zatwierdzenie bez odcisku (sprzed zmiany) = blokada", () => {
        const d = resolveOperatorApproval("human_review", INNY_HOST, { hash }, { originChanged: true });
        expect(d.status).toBe("hash_mismatch");
        expect(d.register).toBe(false);
        expect(d.approvalOrigin).toBe(computeOriginFingerprint(INNY_HOST));
    });

    it("dryf pochodzenia + zatwierdzenie z odciskiem nowego pochodzenia = rejestracja", () => {
        const d = resolveOperatorApproval(
            "human_review",
            INNY_HOST,
            { hash, origin: computeOriginFingerprint(INNY_HOST) },
            { originChanged: true },
        );
        expect(d.status).toBe("approved");
        expect(d.register).toBe(true);
    });

    it("zatwierdzenie z odciskiem STAREGO pochodzenia nie przepuszcza nowego", () => {
        for (const originChanged of [true, false]) {
            const d = resolveOperatorApproval("human_review", INNY_HOST, { hash, origin }, { originChanged });
            expect(d.status).toBe("hash_mismatch");
        }
    });

    it("bez dryfu pochodzenia zatwierdzenie bez odcisku dalej dziala (zatwierdzenia sprzed zmiany)", () => {
        const d = resolveOperatorApproval("human_review", SERWER, { hash }, { originChanged: false });
        expect(d.status).toBe("approved");
        expect(resolveOperatorApproval("human_review", SERWER, { hash }).status).toBe("approved");
    });
});
