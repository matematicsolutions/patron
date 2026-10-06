// R-AC-07: RODO art. 17 dla uzytkownika z wiecej niz 500 wpisami audytu konczy sie
// TRWALA BLOKADA lancucha, czyli wykonanie obowiazku prawnego wyglada jak sabotaz -
// dokladnie to, czemu ADR-0164 mial zapobiec.
//   scripts/rodo-delete.ts:172,183  `affected_ids: zerwaneIds.slice(0, 500)` - JEDNA deklaracja,
//                                   lista obcieta, reszta tylko jako first_id/last_id/licznik.
//   audit-chain-verify.ts:364-366   za "z mocy prawa" uznaje WYLACZNIE id z affected_ids;
//                                   zakres first_id..last_id nie jest uzywany.
//   audit-chain-verify.ts:399-404   pozostale zerwane wiersze -> hash_mismatch, BLOKADA.
// 500 wpisow to kilkadziesiat tur czatu (kazda tura: wiadomosci, llm_route, ring_policy...).
// Dodatkowo BLOKADA wylacza potwierdzanie rozwidlen (audit-chain-status.ts:128 `blocked`),
// wiec na takiej instalacji ogniwa boczne zostaja bez ochrony na zawsze, a panel audytu
// swieci na czerwono przy kazdym wejsciu (wariant D z ADR-0161, odrzucony jako zmeczenie
// alarmem).
// Oczekiwane: po samym RODO (bez innych ingerencji) werdykt UWAGI, nie BLOKADA.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-rac07-${process.pid}-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;
process.env.SUPABASE_URL = "http://synthetic.invalid";
process.env.SUPABASE_SECRET_KEY = "synthetic";

vi.mock("@supabase/supabase-js", async () => {
    const { createSqliteClient } = await import("../src/lib/db/supabase-shim");
    return { createClient: () => createSqliteClient() };
});

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

const USER = "11111111-2222-3333-4444-555555555555"; // syntetyczny

describe("R-AC-07 RODO art. 17 dla uzytkownika z >500 wpisami audytu", () => {
    it("sama anonimizacja 505 wpisow daje UWAGI z mocy prawa, nie BLOKADE", async () => {
        const { appendAuditEvent } = await import("../src/lib/audit");
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const { verifyAuditChain } = await import("../src/lib/audit-chain-verify");
        const { readAuditChainGuardThreshold } = await import("../src/lib/db/migrate.sqlite");
        const db = createServerSupabase();
        for (let i = 0; i < 505; i++) {
            const r = await appendAuditEvent(db, { event_type: "chat.message.user", actor_user_id: USER, payload: { i } });
            expect(r.ok).toBe(true);
        }

        vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
            throw new Error(`process.exit(${c})`);
        }) as never);
        const logs: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        vi.spyOn(console, "error").mockImplementation(() => {});
        process.argv = ["node", "rodo-delete.ts", "--user", USER, "--confirm"];
        await import("../scripts/rodo-delete");
        await vi.waitFor(() => expect(logs.some((l) => l.includes("[rodo:delete] OK"))).toBe(true), { timeout: 20_000 });

        const rows = (getDb().prepare("select * from audit_log order by id").all() as any[]).map((r) => ({
            ...r,
            payload: JSON.parse(r.payload),
        }));
        const rep = verifyAuditChain(rows, { guardAfterId: readAuditChainGuardThreshold(getDb()) });
        const blokady = rep.findings.filter((f) => f.severity === "blokada");
        expect(
            rep.verdict,
            `BLOKADY po samym RODO: ${blokady.length} (${[...new Set(blokady.map((f) => f.kind))]} id ${blokady.map((f) => f.ids[0]).join(",")})`,
        ).toBe("uwagi");
    }, 60_000);
});
