// Testy czystych funkcji panelu stanu (audyt P3 #17). Endpoint Express =
// rezerwacja po dodaniu supertest (Konstytucja Art. 4 - brak nowych npm).

import { afterEach, describe, expect, it } from "vitest";
import { readConsents, buildStatusPayload } from "./health";

const ENV_KEYS = [
    "PATRON_ALLOW_PRIVILEGED_CLOUD",
    "ALLOW_US_PROVIDERS",
    "PATRON_PSEUDONIM_EGRESS",
    "PATRON_RAG_CROSS_CASE",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe("readConsents", () => {
    it("domyslne (fabryka): chmura OFF, pseudonim ON, cross-case OFF", () => {
        delete process.env.PATRON_ALLOW_PRIVILEGED_CLOUD;
        delete process.env.ALLOW_US_PROVIDERS;
        delete process.env.PATRON_PSEUDONIM_EGRESS;
        delete process.env.PATRON_RAG_CROSS_CASE;
        expect(readConsents()).toEqual({
            privilegedCloud: false,
            usProviders: false,
            pseudonimEgress: true,
            ragCrossCase: false,
        });
    });

    it("flagi env przelaczaja zgody", () => {
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_PSEUDONIM_EGRESS = "false";
        process.env.PATRON_RAG_CROSS_CASE = "true";
        expect(readConsents()).toEqual({
            privilegedCloud: true,
            usProviders: true,
            pseudonimEgress: false,
            ragCrossCase: true,
        });
    });
});

describe("buildStatusPayload", () => {
    const base = {
        vectorEnabled: true,
        ocrConfigured: false,
        embedderModel: "Xenova/multilingual-e5-small",
        embedderDim: "384",
        apiKeys: { openrouter: true },
        consents: readConsents(),
        openrouterConfigured: true,
    };

    it("saldo dodatnie -> depleted=false", () => {
        const p = buildStatusPayload({
            ...base,
            credits: { totalCredits: 10, totalUsage: 3, balance: 7 },
        });
        expect(p.openrouter.depleted).toBe(false);
        expect(p.vector.enabled).toBe(true);
        expect(p.embedder.dim).toBe("384");
    });

    it("saldo <=0 -> depleted=true (wczesny sygnal incydentu)", () => {
        const p = buildStatusPayload({
            ...base,
            credits: { totalCredits: 5, totalUsage: 5, balance: 0 },
        });
        expect(p.openrouter.depleted).toBe(true);
    });

    it("brak salda (null) -> depleted=null", () => {
        const p = buildStatusPayload({ ...base, credits: null });
        expect(p.openrouter.depleted).toBeNull();
        expect(p.openrouter.credits).toBeNull();
    });
});
