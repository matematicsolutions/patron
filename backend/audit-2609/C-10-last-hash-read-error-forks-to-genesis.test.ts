// C-10: Gdy odczyt ostatniego hasha sie nie powiedzie (blad bazy, np. przejsciowy blad
// polaczenia z Postgresem), getLastHash zwraca GENESIS_HASH (lib/audit.ts:213-224), a
// appendAuditEvent WSTAWIA wpis z prev_hash = 64 zera i zwraca ok:true (:240-270).
// W niepustym dzienniku to ciche rozwidlenie lancucha: wolajacy dostaje sukces, a
// weryfikator lancucha zglosi pozniej "srodkowy wpis zmodyfikowany lub usuniety".
// Oczekiwane: przy bledzie odczytu poprzednika zapis nie udaje sukcesu - albo ok:false
// (bez wstawienia), albo wpis poprawnie wskazuje na faktyczny ostatni hash.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c10-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("C-10 blad odczytu poprzednika w appendAuditEvent", () => {
    it("przejsciowy blad odczytu ostatniego hasha nie tworzy po cichu drugiego genesis", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { appendAuditEvent, GENESIS_HASH } = await import("../src/lib/audit");
        const real: any = createServerSupabase();
        const first = await appendAuditEvent(real, { event_type: "llm_route", payload: { n: 1 } });
        expect(first.ok).toBe(true);

        // Jeden przejsciowy blad odczytu audit_log (select hash); insert dziala normalnie.
        let failOnce = true;
        const flaky: any = {
            from(table: string) {
                const q = real.from(table);
                if (table !== "audit_log") return q;
                const origSelect = q.select.bind(q);
                q.select = (...a: any[]) => {
                    const sel = origSelect(...a);
                    if (!failOnce) return sel;
                    failOnce = false;
                    const chain: any = {
                        order: () => chain,
                        limit: () => chain,
                        then: (ok: any, ko: any) =>
                            Promise.resolve({ data: null, error: { message: "connection reset" } }).then(ok, ko),
                    };
                    return chain;
                };
                return q;
            },
        };
        const second = await appendAuditEvent(flaky, { event_type: "llm_route", payload: { n: 2 } });

        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const rows = getDb().prepare("select id, prev_hash, hash from audit_log order by id").all() as any[];
        const secondRow = rows[1];
        const silentFork = second.ok === true && secondRow?.prev_hash === GENESIS_HASH;
        // ZADANE: brak cichego rozwidlenia (sukces zgloszony, a prev_hash = genesis).
        expect(silentFork, `ok=${second.ok} prev_hash=${secondRow?.prev_hash?.slice(0, 12)}`).toBe(false);
    });
});
