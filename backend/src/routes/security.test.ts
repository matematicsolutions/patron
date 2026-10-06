// Testy pure functions z security.ts (ADR-0042 UI banner MCP Security).
//
// Pokrycie:
//   - readGatewayMode: zawsze 'enforce', env ignorowane (ADR-0160)
//   - countAuditActions: 3 scenariusze (pusta lista, mix akcji, ignorowanie nieznanych)
//   - buildStatusPayload: 2 scenariusze (mode off -> active false, mode enforce -> active true)
//
// Integration test endpointu (Express + Supabase) = rezerwacja po dodaniu
// supertest do stosu (Konstytucja Art. 4 - brak nowych npm w tej iteracji).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    buildStatusPayload,
    countAuditActions,
    countAwaitingOperatorApproval,
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

    // ADR-0160: getMcpTools egzekwuje brame zawsze, wiec baner tez zawsze mowi
    // "enforce". Zmienna env nie moze sprawic, ze baner oglosi "wylaczony" albo
    // "narzedzia NIE sa blokowane", gdy sa blokowane.
    it.each([undefined, "off", "audit", "enforce", "bogus_mode", "  OFF  "])(
        "zwraca 'enforce' niezaleznie od MCP_SECURITY_GATEWAY_MODE=%s",
        (wartosc) => {
            if (wartosc === undefined) delete process.env.MCP_SECURITY_GATEWAY_MODE;
            else process.env.MCP_SECURITY_GATEWAY_MODE = wartosc;
            expect(readGatewayMode()).toBe("enforce");
            expect(buildStatusPayload(readGatewayMode(), { audit: 0, human_review: 0, denied: 0 }).gateway.active).toBe(true);
        },
    );
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

describe("countAwaitingOperatorApproval (B-08)", () => {
    const nowy = {
        action: "human_review",
        findings: [
            { detector: "typosquat", severity: "medium", message: "nie na liscie" },
            { detector: "drift", severity: "low", message: "pierwszy load" },
        ],
        operator_approval: { status: "missing" },
    };

    it("nowy 3rd-party bez zatwierdzenia = oczekiwanie", () => {
        expect(countAwaitingOperatorApproval([{ payload: nowy }])).toBe(1);
    });

    it("dryf, podobna nazwa, tool-poisoning, hash_mismatch i denied NIE sa zwyklym oczekiwaniem", () => {
        const rows = [
            { payload: { ...nowy, findings: [{ detector: "drift", severity: "high" }] } },
            { payload: { ...nowy, findings: [{ detector: "typosquat", severity: "high" }] } },
            { payload: { ...nowy, findings: [...nowy.findings, { detector: "tool-poisoning", severity: "medium" }] } },
            { payload: { ...nowy, operator_approval: { status: "hash_mismatch" } } },
            { payload: { ...nowy, action: "denied" } },
            { payload: { ...nowy, operator_approval: undefined } },
            { payload: null },
            { payload: { ...nowy, findings: "zly ksztalt" } },
        ];
        expect(countAwaitingOperatorApproval(rows)).toBe(0);
    });

    it("payload statusu: oczekiwanie jest podzbiorem human_review", () => {
        const p = buildStatusPayload("enforce", { audit: 0, human_review: 2, denied: 1 }, 1);
        expect(p.audit_summary_24h.awaiting_operator_approval).toBe(1);
        expect(buildStatusPayload("enforce", { audit: 0, human_review: 0, denied: 0 }, 3).audit_summary_24h.awaiting_operator_approval).toBe(0);
        expect(buildStatusPayload("enforce", { audit: 0, human_review: 0, denied: 0 }).audit_summary_24h.awaiting_operator_approval).toBe(0);
    });
});
