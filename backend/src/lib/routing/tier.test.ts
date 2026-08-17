import { describe, it, expect } from "vitest";
import {
    EGRESS_TIER_ORDER,
    maxTier,
    tierFloorFor,
    guardEnvelopeTier,
    type EgressTier,
} from "./tier";
import { decideRoute } from "./decideRoute";
import type { DataClassification, EgressFlag } from "../llm/provider";

const CLASSIFICATIONS: DataClassification[] = [
    "public",
    "internal",
    "client_general",
    "attorney_client_privileged",
];
const TIERS: EgressTier[] = ["no-egress", "eu-only", "us-with-dpa"];

// Modele probne (egressForModel mapuje wg prefiksu): lokalny vs chmurowe.
const LOCAL = "ollama/llama3"; // no-egress
const CLOUD_CLAUDE = "claude-3-5-sonnet"; // us-with-dpa
const CLOUD_GPT = "gpt-4o"; // us-with-dpa
const UNKNOWN = "jakis-nieznany-model"; // fail-closed -> us-with-dpa

describe("tier - BASELINE: luka straznika per-model dla operacji wielomodelowej", () => {
    // Eval-first (ADR-0087): dokumentujemy lukE stanu obecnego PRZED nowym strażnikiem.
    // Dzis istnieje TYLKO decideRoute (per JEDEN model). Operacja wielomodelowa
    // (ensemble groundingu, tabular multi-model) nie ma zadnego strażnika
    // agregujacego - latwo wpiac guard dla modelu "glownego" i przepuscic reszte.
    it("LUKA: naiwny guard tylko modelu glownego (lokalnego) PRZEPUSZCZA mieszany zbior z tajemnica", () => {
        // Tajemnica + zbior [lokalny, chmura]. Model "glowny" = lokalny.
        const primary = decideRoute({
            classification: "attorney_client_privileged",
            egress: "no-egress", // egress modelu glownego (lokalnego)
            allowUsProviders: false,
        });
        // Per-model guard modelu glownego mowi ALLOW - i tu konczy sie ochrona w
        // naiwnej implementacji. Tresc tajemnicy poszlaby tez do CLOUD_CLAUDE.
        expect(primary.action).toBe("allow"); // <- to jest wlasnie przeciek
    });

    it("ZAMKNIECIE LUKI: guardEnvelopeTier ocenia CALY zbior i blokuje przeciek", () => {
        const d = guardEnvelopeTier({
            classification: "attorney_client_privileged",
            models: [LOCAL, CLOUD_CLAUDE],
            allowUsProviders: false,
        });
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe("envelope-exceeds-ceiling");
        expect(d.envelopeTier).toBe("us-with-dpa");
        expect(d.ceiling).toBe("no-egress");
        expect(d.offendingModel).toBe(CLOUD_CLAUDE);
    });
});

describe("tier - EGRESS_TIER_ORDER i maxTier", () => {
    it("porzadek: no-egress < eu-only < us-with-dpa", () => {
        expect(EGRESS_TIER_ORDER["no-egress"]).toBeLessThan(
            EGRESS_TIER_ORDER["eu-only"],
        );
        expect(EGRESS_TIER_ORDER["eu-only"]).toBeLessThan(
            EGRESS_TIER_ORDER["us-with-dpa"],
        );
    });

    it("maxTier pustego zbioru = no-egress (brak modeli = brak ruchu na zewnatrz)", () => {
        expect(maxTier([])).toBe("no-egress");
    });

    it("maxTier zwraca najwyzszy (najgorszy) tier ze zbioru", () => {
        expect(maxTier(["no-egress", "us-with-dpa", "eu-only"])).toBe(
            "us-with-dpa",
        );
        expect(maxTier(["no-egress", "eu-only"])).toBe("eu-only");
        expect(maxTier(["no-egress", "no-egress"])).toBe("no-egress");
    });
});

describe("tier - tierFloorFor (ceiling per klasyfikacja)", () => {
    it("tajemnica: ceiling = no-egress NIEZALEZNIE od allowUsProviders", () => {
        for (const allowUsProviders of [false, true]) {
            expect(
                tierFloorFor("attorney_client_privileged", allowUsProviders),
            ).toBe("no-egress");
        }
    });

    it("pozostale klasyfikacje: eu-only bez ALLOW_US, us-with-dpa z ALLOW_US", () => {
        for (const c of [
            "public",
            "internal",
            "client_general",
        ] as DataClassification[]) {
            expect(tierFloorFor(c, false)).toBe("eu-only");
            expect(tierFloorFor(c, true)).toBe("us-with-dpa");
        }
    });
});

describe("tier - guardEnvelopeTier (straznik wielomodelowy)", () => {
    it("blokuje gdy DOWOLNY model w zbiorze przekracza ceiling", () => {
        const d = guardEnvelopeTier({
            classification: "client_general",
            models: [LOCAL, LOCAL, CLOUD_GPT], // jeden chmurowy psuje caly zbior
            allowUsProviders: false, // ceiling = eu-only
        });
        expect(d.allowed).toBe(false);
        expect(d.offendingModel).toBe(CLOUD_GPT);
    });

    it("przepuszcza zbior w pelni lokalny dla tajemnicy", () => {
        const d = guardEnvelopeTier({
            classification: "attorney_client_privileged",
            models: [LOCAL, LOCAL],
            allowUsProviders: false,
        });
        expect(d.allowed).toBe(true);
        expect(d.reason).toBe("within-ceiling");
        expect(d.envelopeTier).toBe("no-egress");
    });

    it("przepuszcza zbior chmurowy dla client_general gdy Administrator wlaczyl ALLOW_US", () => {
        const d = guardEnvelopeTier({
            classification: "client_general",
            models: [LOCAL, CLOUD_CLAUDE],
            allowUsProviders: true, // ceiling = us-with-dpa
        });
        expect(d.allowed).toBe(true);
    });

    it("FAIL-CLOSED: nieznany model traktowany jak us-with-dpa", () => {
        const d = guardEnvelopeTier({
            classification: "client_general",
            models: [LOCAL, UNKNOWN],
            allowUsProviders: false,
        });
        expect(d.allowed).toBe(false);
        expect(d.offendingModel).toBe(UNKNOWN);
    });

    it("pusty zbior modeli = brak egressu = allow (envelope no-egress)", () => {
        const d = guardEnvelopeTier({
            classification: "attorney_client_privileged",
            models: [],
            allowUsProviders: false,
        });
        expect(d.allowed).toBe(true);
        expect(d.envelopeTier).toBe("no-egress");
    });
});

describe("tier - PARYTET z decideRoute (jedno zrodlo semantyki, anty-dryf)", () => {
    // Dla JEDNEGO modelu guardEnvelopeTier MUSI dac te sama decyzje allow/block
    // co decideRoute. Ten test pilnuje, by obie funkcje nie rozjechaly sie bez ADR.
    const SINGLE_MODELS: Array<{ model: string; egress: EgressFlag }> = [
        { model: LOCAL, egress: "no-egress" },
        { model: CLOUD_CLAUDE, egress: "us-with-dpa" },
        { model: CLOUD_GPT, egress: "us-with-dpa" },
        { model: UNKNOWN, egress: "us-with-dpa" },
    ];

    it("guardEnvelopeTier([model]).allowed == (decideRoute(model).action === 'allow')", () => {
        for (const classification of CLASSIFICATIONS) {
            for (const allowUsProviders of [false, true]) {
                for (const { model, egress } of SINGLE_MODELS) {
                    const route = decideRoute({
                        classification,
                        egress,
                        allowUsProviders,
                    });
                    const env = guardEnvelopeTier({
                        classification,
                        models: [model],
                        allowUsProviders,
                    });
                    expect(env.allowed).toBe(route.action === "allow");
                }
            }
        }
    });
});
