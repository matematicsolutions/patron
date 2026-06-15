// Testy klasyfikatora high-stakes (ADR-0004 Faza 5 T1).
//
// Pokrywamy 3 bramki + edge cases + konfiguracja z env.

import { describe, expect, it } from "vitest";
import {
    DEFAULT_CONFIG,
    classifyHighStakes,
    configFromEnv,
    isInputSufficient,
} from "./classifier";

describe("classifyHighStakes - bramka 1 (explicitFlag)", () => {
    it("explicitFlag=true eskaluje niezaleznie od reszty", () => {
        const r = classifyHighStakes({ explicitFlag: true });
        expect(r.isHighStakes).toBe(true);
        expect(r.reasons).toContain("explicitFlag=true");
    });

    it("explicitFlag=false NIE eskaluje (gdy brak innych powodow)", () => {
        const r = classifyHighStakes({ explicitFlag: false });
        expect(r.isHighStakes).toBe(false);
    });

    it("explicitFlag pominiety = NIE eskaluje (gdy brak innych powodow)", () => {
        const r = classifyHighStakes({});
        expect(r.isHighStakes).toBe(false);
    });
});

describe("classifyHighStakes - bramka 2 (alwaysHighStakesTypes)", () => {
    it.each(["opinia", "umowa_M&A", "umowa_DD", "umowa_finansowa"] as const)(
        "%s zawsze eskaluje niezaleznie od wartosci",
        (documentType) => {
            const r = classifyHighStakes({ documentType });
            expect(r.isHighStakes).toBe(true);
            expect(r.reasons.some((x) => x.includes(documentType))).toBe(true);
        },
    );

    it("umowa_DD bez cm_value tez eskaluje", () => {
        const r = classifyHighStakes({ documentType: "umowa_DD" });
        expect(r.isHighStakes).toBe(true);
    });
});

describe("classifyHighStakes - bramka 3 (typ eskalowalny + wartosc)", () => {
    it("umowa_handlowa z cmValue=500000 eskaluje (>= 100000 default)", () => {
        const r = classifyHighStakes({
            documentType: "umowa_handlowa",
            projectCmValue: 500_000,
        });
        expect(r.isHighStakes).toBe(true);
        expect(r.reasons.some((x) => x.includes("projectCmValue"))).toBe(true);
    });

    it("umowa_handlowa z cmValue=50000 NIE eskaluje (< 100000)", () => {
        const r = classifyHighStakes({
            documentType: "umowa_handlowa",
            projectCmValue: 50_000,
        });
        expect(r.isHighStakes).toBe(false);
    });

    it("umowa_handlowa z cmValue=100000 eskaluje (granicznie >=)", () => {
        const r = classifyHighStakes({
            documentType: "umowa_handlowa",
            projectCmValue: 100_000,
        });
        expect(r.isHighStakes).toBe(true);
    });

    it("pismo_procesowe z duza cm_value eskaluje", () => {
        const r = classifyHighStakes({
            documentType: "pismo_procesowe",
            projectCmValue: 2_000_000,
        });
        expect(r.isHighStakes).toBe(true);
    });

    it("notatka z duza cm_value NIE eskaluje (typ nieeskalowalny)", () => {
        const r = classifyHighStakes({
            documentType: "notatka",
            projectCmValue: 10_000_000,
        });
        expect(r.isHighStakes).toBe(false);
    });

    it("research czat o art. 415 KC NIE eskaluje", () => {
        const r = classifyHighStakes({
            documentType: "research",
            projectCmValue: 1_000_000,
        });
        expect(r.isHighStakes).toBe(false);
    });
});

describe("classifyHighStakes - kombinacje bramek", () => {
    it("explicitFlag + always-type laczy oba powody", () => {
        const r = classifyHighStakes({
            explicitFlag: true,
            documentType: "opinia",
        });
        expect(r.isHighStakes).toBe(true);
        expect(r.reasons).toHaveLength(2);
    });

    it("appliedThreshold zwracany dla audit log", () => {
        const r = classifyHighStakes({});
        expect(r.appliedThreshold).toBe(100_000);
    });
});

describe("classifyHighStakes - custom config", () => {
    it("custom threshold dziala", () => {
        const r = classifyHighStakes(
            { documentType: "umowa_handlowa", projectCmValue: 60_000 },
            { cmValueThreshold: 50_000, alwaysHighStakesTypes: new Set() },
        );
        expect(r.isHighStakes).toBe(true);
        expect(r.appliedThreshold).toBe(50_000);
    });

    it("custom alwaysHighStakesTypes pominiete = brak eskalacji per typ", () => {
        const r = classifyHighStakes(
            { documentType: "opinia" },
            { cmValueThreshold: 100_000, alwaysHighStakesTypes: new Set() },
        );
        expect(r.isHighStakes).toBe(false);
    });
});

describe("isInputSufficient", () => {
    it("ma documentType znany = wystarczy", () => {
        expect(isInputSufficient({ documentType: "opinia" })).toBe(true);
    });

    it("ma explicitFlag=true = wystarczy", () => {
        expect(isInputSufficient({ explicitFlag: true })).toBe(true);
    });

    it("documentType=inny + brak flag = NIE wystarczy", () => {
        expect(isInputSufficient({ documentType: "inny" })).toBe(false);
    });

    it("pusty input = NIE wystarczy", () => {
        expect(isInputSufficient({})).toBe(false);
    });
});

describe("configFromEnv", () => {
    it("pusty env zwraca default", () => {
        const c = configFromEnv({});
        expect(c.cmValueThreshold).toBe(100_000);
        expect(c.alwaysHighStakesTypes.has("opinia")).toBe(true);
        expect(c.alwaysHighStakesTypes.has("umowa_M&A")).toBe(true);
    });

    it("HIGH_STAKES_CM_VALUE_THRESHOLD nadpisuje prog", () => {
        const c = configFromEnv({ HIGH_STAKES_CM_VALUE_THRESHOLD: "250000" });
        expect(c.cmValueThreshold).toBe(250_000);
    });

    it("HIGH_STAKES_CM_VALUE_THRESHOLD non-liczba ignorowane, fallback default", () => {
        const c = configFromEnv({ HIGH_STAKES_CM_VALUE_THRESHOLD: "abc" });
        expect(c.cmValueThreshold).toBe(DEFAULT_CONFIG.cmValueThreshold);
    });

    it("HIGH_STAKES_ALWAYS_TYPES nadpisuje typy", () => {
        const c = configFromEnv({ HIGH_STAKES_ALWAYS_TYPES: "opinia,umowa_DD" });
        expect(c.alwaysHighStakesTypes.has("opinia")).toBe(true);
        expect(c.alwaysHighStakesTypes.has("umowa_DD")).toBe(true);
        expect(c.alwaysHighStakesTypes.has("umowa_M&A")).toBe(false);
    });
});
