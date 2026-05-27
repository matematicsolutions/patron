// Testy helper logowania dostepu admin (ADR-0043).

import { describe, expect, it } from "vitest";

import { buildAdminAccessPayload } from "./audit-admin-access";

describe("buildAdminAccessPayload", () => {
    it("minimalny payload: tylko method + path", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/api/audit/log",
        });
        expect(payload).toEqual({ method: "GET", path: "/api/audit/log" });
    });

    it("pomija query gdy puste {}", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/api/audit/log",
            query: {},
        });
        expect(payload.query).toBeUndefined();
    });

    it("dodaje query gdy nie-puste", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/api/audit/log",
            query: { event_type: "mcp_security.gateway", limit: "50" },
        });
        expect(payload.query).toEqual({
            event_type: "mcp_security.gateway",
            limit: "50",
        });
    });

    it("dodaje remote_ip gdy podany (dla metrics endpoint)", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/metrics",
            remote_ip: "10.0.0.5",
        });
        expect(payload.remote_ip).toBe("10.0.0.5");
    });

    it("dodaje actor_email gdy podany", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/api/security/mcp-status",
            actor_email: "admin@kancelaria.pl",
        });
        expect(payload.actor_email).toBe("admin@kancelaria.pl");
    });

    it("kombinacja: wszystkie pola opcjonalne razem", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/api/audit/log",
            query: { limit: "100" },
            remote_ip: "192.168.1.10",
            actor_email: "audytor@kancelaria.pl",
        });
        expect(payload).toEqual({
            method: "GET",
            path: "/api/audit/log",
            query: { limit: "100" },
            remote_ip: "192.168.1.10",
            actor_email: "audytor@kancelaria.pl",
        });
    });

    it("actor_email null nie dodaje pola", () => {
        const payload = buildAdminAccessPayload({
            method: "GET",
            path: "/metrics",
            actor_email: null,
        });
        expect(payload.actor_email).toBeUndefined();
    });
});
