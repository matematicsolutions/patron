// Testy middleware IP whitelist (ADR-0037).

import { describe, expect, it } from "vitest";

import { isMetricsAllowed } from "./metrics-allow";

describe("isMetricsAllowed", () => {
    it("IP w whitelist -> true", () => {
        expect(isMetricsAllowed("10.0.0.5", "10.0.0.5,192.168.1.100")).toBe(true);
        expect(isMetricsAllowed("192.168.1.100", "10.0.0.5,192.168.1.100")).toBe(true);
    });

    it("IP NIE w whitelist -> false", () => {
        expect(isMetricsAllowed("172.16.0.1", "10.0.0.5,192.168.1.100")).toBe(false);
    });

    it("brak env -> false (endpoint disabled)", () => {
        expect(isMetricsAllowed("10.0.0.5", undefined)).toBe(false);
        expect(isMetricsAllowed("10.0.0.5", "")).toBe(false);
        expect(isMetricsAllowed("10.0.0.5", "   ")).toBe(false);
    });

    it("brak remoteIp -> false", () => {
        expect(isMetricsAllowed(undefined, "10.0.0.5")).toBe(false);
        expect(isMetricsAllowed("", "10.0.0.5")).toBe(false);
    });

    it("env z trim spacji", () => {
        expect(isMetricsAllowed("10.0.0.5", " 10.0.0.5 , 192.168.1.100 ")).toBe(true);
    });

    it("env z pustymi entries miedzy przecinkami pomijane", () => {
        expect(isMetricsAllowed("10.0.0.5", "10.0.0.5,,,192.168.1.100")).toBe(true);
        expect(isMetricsAllowed("", "10.0.0.5,,,192.168.1.100")).toBe(false);
    });
});
