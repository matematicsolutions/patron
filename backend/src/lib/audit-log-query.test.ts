// Testy pure functions parsowania query + budowania response (ADR-0040 faza 1).

import { describe, expect, it } from "vitest";

import {
    buildResponseEvents,
    computeNextCursor,
    parseAuditLogQuery,
    type AuditLogRow,
} from "./audit-log-query";

const NOW = new Date("2026-05-27T12:00:00.000Z");

describe("parseAuditLogQuery", () => {
    it("brak parametrow -> default since/until/limit", () => {
        const result = parseAuditLogQuery({}, NOW);
        expect(result.ok).toBe(true);
        expect(result.filter?.event_type).toBe(null);
        expect(result.filter?.actor_user_id).toBe(null);
        expect(result.filter?.limit).toBe(50);
        expect(result.filter?.cursor).toBe(null);
        expect(result.filter?.until).toBe("2026-05-27T12:00:00.000Z");
        expect(result.filter?.since).toBe("2026-04-27T12:00:00.000Z");
    });

    it("event_type = 'all' traktowane jak null", () => {
        const result = parseAuditLogQuery({ event_type: "all" }, NOW);
        expect(result.ok).toBe(true);
        expect(result.filter?.event_type).toBe(null);
    });

    it("event_type valid -> typed", () => {
        const result = parseAuditLogQuery(
            { event_type: "mcp_security.gateway" },
            NOW,
        );
        expect(result.ok).toBe(true);
        expect(result.filter?.event_type).toBe("mcp_security.gateway");
    });

    it("event_type invalid -> error", () => {
        const result = parseAuditLogQuery({ event_type: "bogus" }, NOW);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("invalid event_type");
    });

    it("actor_user_id UUID -> typed", () => {
        const uuid = "12345678-1234-1234-1234-123456789012";
        const result = parseAuditLogQuery({ actor_user_id: uuid }, NOW);
        expect(result.ok).toBe(true);
        expect(result.filter?.actor_user_id).toBe(uuid);
    });

    it("actor_user_id non-UUID -> error", () => {
        const result = parseAuditLogQuery({ actor_user_id: "nope" }, NOW);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("not UUID");
    });

    it("limit > MAX -> error", () => {
        const result = parseAuditLogQuery({ limit: "500" }, NOW);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("1-200");
    });

    it("limit valid -> typed", () => {
        const result = parseAuditLogQuery({ limit: "100" }, NOW);
        expect(result.ok).toBe(true);
        expect(result.filter?.limit).toBe(100);
    });

    it("cursor valid -> typed", () => {
        const result = parseAuditLogQuery({ cursor: "12345" }, NOW);
        expect(result.ok).toBe(true);
        expect(result.filter?.cursor).toBe(12345);
    });

    it("cursor invalid -> error", () => {
        const result = parseAuditLogQuery({ cursor: "abc" }, NOW);
        expect(result.ok).toBe(false);
    });

    it("since/until ISO valid -> typed", () => {
        const result = parseAuditLogQuery(
            {
                since: "2026-05-01T00:00:00.000Z",
                until: "2026-05-27T00:00:00.000Z",
            },
            NOW,
        );
        expect(result.ok).toBe(true);
        expect(result.filter?.since).toBe("2026-05-01T00:00:00.000Z");
        expect(result.filter?.until).toBe("2026-05-27T00:00:00.000Z");
    });
});

describe("buildResponseEvents", () => {
    const sampleRow: AuditLogRow = {
        id: 1,
        event_type: "mcp_security.gateway",
        actor_user_id: "12345678-1234-1234-1234-123456789012",
        chat_id: null,
        document_id: null,
        ts: "2026-05-27T11:00:00.000Z",
        hash: "a".repeat(64),
        prev_hash: "b".repeat(64),
        payload: { action: "audit", pesel: "12345678901" },
    };

    it("maskuje payload przez injected funkcje", () => {
        const fakeMask = (p: unknown): unknown => ({ ...(p as object), masked: true });
        const result = buildResponseEvents([sampleRow], fakeMask);
        expect(result.length).toBe(1);
        expect((result[0]!.payload_masked as { masked: boolean }).masked).toBe(true);
    });

    it("zachowuje hash + prev_hash bez zmiany", () => {
        const result = buildResponseEvents([sampleRow], (p) => p);
        expect(result[0]!.hash).toBe(sampleRow.hash);
        expect(result[0]!.prev_hash).toBe(sampleRow.prev_hash);
    });

    it("pusta lista -> pusta lista", () => {
        expect(buildResponseEvents([], (p) => p)).toEqual([]);
    });
});

describe("computeNextCursor", () => {
    function makeRow(id: number): AuditLogRow {
        return {
            id,
            event_type: "chat.message.user",
            actor_user_id: null,
            chat_id: null,
            document_id: null,
            ts: "2026-05-27T11:00:00.000Z",
            hash: "0".repeat(64),
            prev_hash: "0".repeat(64),
            payload: {},
        };
    }

    it("rows.length < limit -> null (ostatnia strona)", () => {
        const rows = [makeRow(10), makeRow(9), makeRow(8)];
        expect(computeNextCursor(rows, 50)).toBe(null);
    });

    it("rows.length === limit -> id ostatniego wiersza", () => {
        const rows = [makeRow(10), makeRow(9), makeRow(8)];
        expect(computeNextCursor(rows, 3)).toBe(8);
    });

    it("pusta lista -> null", () => {
        expect(computeNextCursor([], 50)).toBe(null);
    });
});
