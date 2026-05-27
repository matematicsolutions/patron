// Testy pure helperow compute-now (ADR-0048).

import { describe, expect, it } from "vitest";

import {
    FORCE_COUNT_THRESHOLD,
    FORCE_INTERVAL_MS,
    buildComputeNowResponse,
    parseComputerByLabel,
} from "./audit-merkle-compute-now";
import type {
    MerkleRootRow,
    RunAutoComputeResult,
} from "./audit-merkle-roots";

describe("FORCE_* thresholds", () => {
    it("count=1 wymusza compute przy kazdym nowym evencie", () => {
        expect(FORCE_COUNT_THRESHOLD).toBe(1);
    });

    it("interval=0 bypassuje wymog wieku ostatniego roota", () => {
        expect(FORCE_INTERVAL_MS).toBe(0);
    });
});

describe("parseComputerByLabel", () => {
    it("uzywa email gdy obecny", () => {
        expect(parseComputerByLabel("admin@kancelaria.pl", null)).toBe(
            "manual-ui:admin@kancelaria.pl",
        );
    });

    it("fallback na user_id gdy brak email", () => {
        expect(parseComputerByLabel(null, "11111111-2222-3333-4444-555555555555")).toBe(
            "manual-ui:11111111-2222-3333-4444-555555555555",
        );
    });

    it("fallback na 'unknown' gdy brak obu", () => {
        expect(parseComputerByLabel(null, null)).toBe("manual-ui:unknown");
    });

    it("usuwa znaki nowej linii (anti log-injection)", () => {
        const tainted = "admin@kancelaria.pl\n[FAKE LOG ENTRY]";
        const label = parseComputerByLabel(tainted, null);
        expect(label).not.toContain("\n");
        expect(label).toContain("admin@kancelaria.pl");
    });

    it("usuwa znaki kontrolne x00-x1f", () => {
        const tainted = "admin\x00@kancelaria.pl";
        const label = parseComputerByLabel(tainted, null);
        expect(label).not.toContain("\x00");
    });

    it("trimuje do 100 znakow", () => {
        const long = "a".repeat(200) + "@kancelaria.pl";
        const label = parseComputerByLabel(long, null);
        expect(label.length).toBeLessThanOrEqual(100);
        expect(label.startsWith("manual-ui:")).toBe(true);
    });

    it("trimuje whitespace dookola", () => {
        expect(parseComputerByLabel("   admin@kancelaria.pl   ", null)).toBe(
            "manual-ui:admin@kancelaria.pl",
        );
    });

    it("pusty string po sanityzacji -> unknown", () => {
        expect(parseComputerByLabel("\n\t\r", null)).toBe("manual-ui:unknown");
    });
});

describe("buildComputeNowResponse", () => {
    const FIX_ROOT: MerkleRootRow = {
        id: 7,
        chain_block_start: 12001,
        chain_block_end: 13000,
        merkle_root: "a".repeat(64),
        event_count: 1000,
        computed_at: "2026-05-27T19:00:00.000Z",
        computed_by: "manual-ui:admin@kancelaria.pl",
    };

    it("skip: decision.compute=false -> computed=false z reason", () => {
        const input: RunAutoComputeResult = {
            decision: { compute: false, reason: "no_new_events" },
        };
        const response = buildComputeNowResponse(input);
        expect(response).toEqual({ computed: false, reason: "no_new_events" });
    });

    it("success: compute=true + ok -> computed=true z root", () => {
        const input: RunAutoComputeResult = {
            decision: {
                compute: true,
                reason: "count_threshold",
                blockStart: 12001,
                blockEnd: 13000,
            },
            computeResult: { ok: true, root: FIX_ROOT },
        };
        const response = buildComputeNowResponse(input);
        expect(response.computed).toBe(true);
        expect(response.reason).toBe("count_threshold");
        expect(response.root).toEqual({
            id: 7,
            chain_block_start: 12001,
            chain_block_end: 13000,
            merkle_root: "a".repeat(64),
            event_count: 1000,
            computed_at: "2026-05-27T19:00:00.000Z",
            computed_by: "manual-ui:admin@kancelaria.pl",
        });
        expect(response.error).toBeUndefined();
    });

    it("compute failure: ok=false -> computed=false z error", () => {
        const input: RunAutoComputeResult = {
            decision: { compute: true, reason: "initial_root" },
            computeResult: { ok: false, error: "insert failed: connection lost" },
        };
        const response = buildComputeNowResponse(input);
        expect(response.computed).toBe(false);
        expect(response.reason).toBe("initial_root");
        expect(response.error).toContain("insert failed");
        expect(response.root).toBeUndefined();
    });

    it("defensive: compute=true ale brak computeResult -> error", () => {
        const input: RunAutoComputeResult = {
            decision: { compute: true, reason: "interval_threshold" },
        };
        const response = buildComputeNowResponse(input);
        expect(response.computed).toBe(false);
        expect(response.error).toContain("defensive");
    });

    it("ok=true ale brak root -> error (degraded)", () => {
        const input: RunAutoComputeResult = {
            decision: { compute: true, reason: "count_threshold" },
            computeResult: { ok: true } as { ok: true },
        };
        const response = buildComputeNowResponse(input);
        expect(response.computed).toBe(false);
        expect(response.error).toBeDefined();
    });

    it("zachowuje reason 'below_thresholds' (FORCE thresholds == 1/0 nie powinien tego dac, defensive)", () => {
        const input: RunAutoComputeResult = {
            decision: { compute: false, reason: "below_thresholds" },
        };
        const response = buildComputeNowResponse(input);
        expect(response.reason).toBe("below_thresholds");
    });
});
