// C-07: Rownolegle wywolania appendAuditEvent rozwidlaja hash-chain rowniez w domyslnym
// trybie desktop (SQLite). lib/audit.ts:240-282 czyta ostatni hash (getLastHash) i
// dopiero po await wstawia wiersz; retry opiera sie na kolizji UNIQUE(hash) (:272-277),
// ktora nie zachodzi, bo dwa rozne zdarzenia maja rozne hashe - oba wiersze dostaja
// TEN SAM prev_hash. Sciezka produkcyjna: lib/chat/stream.ts:542 uruchamia narzedzia MCP
// jednej tury przez Promise.all, a kazde runMcpTool (lib/mcp/index.ts:519) robi
// `void recordRingPolicyEvent(...)` (ring_policy.decision) przed pierwszym await;
// podobnie startup MCP (lib/mcp/index.ts:431/457, petla z void recordMcpSecurityEvent).
// Skutek: weryfikator lancucha zglasza "srodkowy wpis zmodyfikowany lub usuniety" dla
// legalnej historii i zatrzymuje sie na pierwszym bledzie (falszywy alarm maskuje realne
// manipulacje dalej w logu); ADR-0001 twierdzi, ze wyscig jest obsluzony.
// Oczekiwane: po dwoch rownoleglych zdarzeniach ring-policy (dwa narzedzia MCP w jednej
// turze) lancuch jest liniowy - prev_hash kazdego wpisu = hash poprzedniego.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c07-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("C-07 rownolegle zapisy audytu a ciaglosc hash-chain", () => {
    it("dwa rownolegle ring_policy.decision (dwa narzedzia MCP w turze) nie rozwidlaja lancucha", async () => {
        const { recordRingPolicyEvent } = await import("../src/lib/mcp/audit-bridge");
        const { GENESIS_HASH, computeAuditHash } = await import("../src/lib/audit");
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const decision = { ring: 1, action: "allow", reason: "trusted" } as any;
        // Tak jak stream.ts:542 (Promise.all) -> runMcpTool -> void recordRingPolicyEvent.
        const res = await Promise.all([
            recordRingPolicyEvent({ toolName: "saos__search_judgments", serverName: "saos", decision }),
            recordRingPolicyEvent({ toolName: "isap__search_acts", serverName: "isap", decision }),
        ]);
        // Sanity: oba zapisy "sie udaly" (brak sygnalu bledu dla wolajacego).
        expect(res.every((r) => r.ok)).toBe(true);

        const rows = getDb().prepare("select * from audit_log order by id").all() as any[];
        expect(rows.length).toBe(2);
        // Sanity: kazdy wpis z osobna ma poprawny hash tresci.
        for (const r of rows) {
            expect(computeAuditHash({ ...r, payload: JSON.parse(r.payload) })).toBe(r.hash);
        }
        // ZADANE: lancuch liniowy (algorytm scripts/verify-audit-chain.ts:75-86).
        let prev = GENESIS_HASH;
        const breaks: number[] = [];
        for (const r of rows) {
            if (r.prev_hash !== prev) breaks.push(r.id);
            prev = r.hash;
        }
        expect(breaks, `wpisy z zerwanym ogniwem: ${breaks.join(",")}`).toEqual([]);
    });
});
