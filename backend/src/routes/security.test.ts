// Testy pure functions z security.ts (ADR-0042 UI banner MCP Security).
//
// Pokrycie:
//   - readGatewayMode: 4 scenariusze (enforce, audit, off, brak env / nieznana wartosc)
//   - countAuditActions: 3 scenariusze (pusta lista, mix akcji, ignorowanie nieznanych)
//   - buildStatusPayload: 2 scenariusze (mode off -> active false, mode enforce -> active true)
//
// Integration test endpointu (Express + Supabase) = rezerwacja po dodaniu
// supertest do stosu (Konstytucja Art. 4 - brak nowych npm w tej iteracji).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    buildStatusPayload,
    countAuditActions,
    readGatewayMode,
    type AuditCounts,
} from "./security";

describe("readGatewayMode", () => {
    const originalEnv = process.env.MCP_SECURITY_GATEWAY_MODE;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.MCP_SECURITY_GATEWAY_MODE;
        } else {
            process.env.MCP_SECURITY_GATEWAY_MODE = originalEnv;
        }
    });

    it("zwraca 'enforce' gdy env ustawione na 'enforce'", () => {
        process.env.MCP_SECURITY_GATEWAY_MODE = "enforce";
        expect(readGatewayMode()).toBe("enforce");
    });

    it("zwraca 'audit' gdy env ustawione na 'audit'", () => {
        process.env.MCP_SECURITY_GATEWAY_MODE = "audit";
        expect(readGatewayMode()).toBe("audit");
    });

    it("zwraca 'off' fail-safe gdy env nie ustawione", () => {
        delete process.env.MCP_SECURITY_GATEWAY_MODE;
        expect(readGatewayMode()).toBe("off");
    });

    it("zwraca 'off' fail-safe gdy env ma nieznana wartosc", () => {
        process.env.MCP_SECURITY_GATEWAY_MODE = "bogus_mode";
        expect(readGatewayMode()).toBe("off");
    });

    it("ignoruje case + trim spacji w env", () => {
        process.env.MCP_SECURITY_GATEWAY_MODE = "  ENFORCE  ";
        expect(readGatewayMode()).toBe("enforce");
    });
});

describe("countAuditActions", () => {
    it("zwraca zera dla pustej listy", () => {
        expect(countAuditActions([])).toEqual({
            audit: 0,
            human_review: 0,
            denied: 0,
        });
    });

    it("liczy mix akcji audit/human_review/denied", () => {
        const rows = [
            { payload: { action: "audit" } },
            { payload: { action: "audit" } },
            { payload: { action: "human_review" } },
            { payload: { action: "denied" } },
            { payload: { action: "denied" } },
            { payload: { action: "denied" } },
        ];
        expect(countAuditActions(rows)).toEqual({
            audit: 2,
            human_review: 1,
            denied: 3,
        });
    });

    it("ignoruje wiersze z nieznana akcja (np. allowed-clean) lub bez payload", () => {
        const rows = [
            { payload: { action: "audit" } },
            { payload: { action: "allowed-clean" } },
            { payload: null },
            { payload: {} },
            { payload: { action: "denied" } },
        ];
        expect(countAuditActions(rows)).toEqual({
            audit: 1,
            human_review: 0,
            denied: 1,
        });
    });
});

describe("buildStatusPayload", () => {
    const zeroCounts: AuditCounts = { audit: 0, human_review: 0, denied: 0 };

    it("mode 'off' -> active false, decisions_total 0", () => {
        const payload = buildStatusPayload("off", zeroCounts);
        expect(payload.gateway.active).toBe(false);
        expect(payload.gateway.mode).toBe("off");
        expect(payload.audit_summary_24h.decisions_total).toBe(0);
    });

    it("mode 'enforce' + counts mix -> active true, decisions_total sumuje", () => {
        const counts: AuditCounts = { audit: 5, human_review: 2, denied: 3 };
        const payload = buildStatusPayload("enforce", counts);
        expect(payload.gateway.active).toBe(true);
        expect(payload.gateway.mode).toBe("enforce");
        expect(payload.audit_summary_24h.decisions_total).toBe(10);
        expect(payload.audit_summary_24h.by_action).toEqual(counts);
    });

    it("mode 'audit' -> active true (audit-only to nadal aktywny)", () => {
        const payload = buildStatusPayload("audit", zeroCounts);
        expect(payload.gateway.active).toBe(true);
        expect(payload.gateway.mode).toBe("audit");
    });
});
