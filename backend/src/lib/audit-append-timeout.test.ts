// R-AC-03 (przeglad 2026-10-02): zawieszony zapis audytu nie blokuje kolejki procesu.
import { afterEach, describe, expect, it } from "vitest";
import { appendAuditEvent, auditAppendTimeoutMs } from "./audit";

function db(hang: boolean, inserts: unknown[]) {
    const b: any = {
        select: () => b, order: () => b,
        limit: async () => ({ data: [], error: null }),
        insert: (row: unknown) =>
            hang ? new Promise(() => {}) : (inserts.push(row), Promise.resolve({ error: null })),
    };
    return { from: () => b } as any;
}

afterEach(() => { delete process.env.PATRON_AUDIT_APPEND_TIMEOUT_MS; });

describe("kolejka zapisow audytu z limitem czasu", () => {
    it("domyslny limit jest skonczony i nadpisywalny z env", () => {
        expect(auditAppendTimeoutMs()).toBe(4_000);
        process.env.PATRON_AUDIT_APPEND_TIMEOUT_MS = "50";
        expect(auditAppendTimeoutMs()).toBe(50);
    });

    it("zawieszony insert konczy sie ok:false, a kolejny zapis przechodzi", async () => {
        process.env.PATRON_AUDIT_APPEND_TIMEOUT_MS = "50";
        const inserts: unknown[] = [];
        const pierwszy = appendAuditEvent(db(true, inserts), { event_type: "llm_route", payload: {} });
        const drugi = appendAuditEvent(db(false, inserts), { event_type: "llm_route", payload: {} });
        expect(await pierwszy).toMatchObject({ ok: false });
        expect(await drugi).toMatchObject({ ok: true });
        expect(inserts).toHaveLength(1);
    });
});
