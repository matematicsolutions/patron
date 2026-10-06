// R-AC-01: deklaracja `audit.chain.legal_break` (ADR-0164) wybiela KAZDA pozniejsza
// zmiane tresci zadeklarowanego wiersza, nie tylko wyzerowanie aktora.
//
// audit-chain-verify.ts:378-388 (classifyContentBreaks): wiersz z niezgodnym hashem
// dostaje UWAGI "z mocy prawa", jesli (a) jest na liscie affected_ids deklaracji i
// (b) pole z deklaracji (`actor_user_id`) jest NULL. Nic nie sprawdza, ze to WYLACZNIE
// wyzerowanie aktora tlumaczy niezgodnosc. Po wykonaniu RODO art. 17 dla uzytkownika X
// kazdy wiersz X jest wiec trwale bez ochrony: zmiana payloadu / event_type / ts
// jednym UPDATE-em (hash wiersza zostaje, krawedzie lancucha i liscie Merkle tez)
// daje DOKLADNIE ten sam raport co nietkniety wiersz po anonimizacji.
//
// Sciezka: prawdziwy scripts/rodo-delete.ts (klient Supabase podmieniony na shim
// SQLite - ten sam klient, ktorego uzywa backend desktopu), potem manipulacja
// payloadu jednego zanonimizowanego wpisu, potem verifyAuditChain.
// Oczekiwane: manipulacja tresci poza polem z deklaracji = BLOKADA.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-rac01-${process.pid}-${Date.now()}.db`);
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

describe("R-AC-01 legal_break a manipulacja tresci zanonimizowanego wiersza", () => {
    it("zmiana payloadu wiersza objetego deklaracja RODO nie moze dawac UWAGI 'z mocy prawa'", async () => {
        const { appendAuditEvent } = await import("../src/lib/audit");
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const { verifyAuditChain } = await import("../src/lib/audit-chain-verify");
        const { readAuditChainGuardThreshold } = await import("../src/lib/db/migrate.sqlite");
        const db = createServerSupabase();

        // Historia: trzy zdarzenia uzytkownika X i jedno systemowe.
        for (const [et, actor, payload] of [
            ["chat.message.user", USER, { len: 10 }],
            ["llm_route", USER, { decision: "local", case_id: null }],
            ["ring_policy.decision", null, { action: "allow" }],
            ["mutation.approval.decision", USER, { decision: "rejected" }],
        ] as const) {
            const r = await appendAuditEvent(db, { event_type: et, actor_user_id: actor, payload: { ...payload } });
            expect(r.ok).toBe(true);
        }

        // RODO art. 17 - prawdziwy skrypt.
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
            throw new Error(`process.exit(${c})`);
        }) as never);
        const logs: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        vi.spyOn(console, "error").mockImplementation(() => {});
        process.argv = ["node", "rodo-delete.ts", "--user", USER, "--confirm"];
        await import("../scripts/rodo-delete");
        await vi.waitFor(() => expect(logs.some((l) => l.includes("[rodo:delete] OK"))).toBe(true), { timeout: 10_000 });
        expect(exitSpy).not.toHaveBeenCalled();

        const load = () =>
            (getDb().prepare("select * from audit_log order by id").all() as any[]).map((r) => ({
                ...r,
                payload: JSON.parse(r.payload),
            }));
        const guard = readAuditChainGuardThreshold(getDb());

        // Kontrola: sama anonimizacja = UWAGI z mocy prawa (tak obiecuje ADR-0164).
        const before = verifyAuditChain(load(), { guardAfterId: guard });
        expect(before.verdict).toBe("uwagi");
        expect(before.findings.filter((f) => f.kind === "hash_mismatch_legal_break").map((f) => f.ids[0])).toEqual([1, 2, 4]);

        // Manipulacja: decyzja w karcie zatwierdzenia "rejected" -> "approved".
        getDb()
            .prepare("update audit_log set payload = ? where id = 4")
            .run(JSON.stringify({ decision: "approved" }));

        const after = verifyAuditChain(load(), { guardAfterId: guard });
        const row4 = after.findings.find((f) => f.ids.includes(4));
        // ZADANE: zmiana poza polem z deklaracji nie jest "z mocy prawa".
        expect(row4?.kind, `wiersz 4 po zmianie payloadu: ${row4?.kind} / werdykt ${after.verdict}`).not.toBe(
            "hash_mismatch_legal_break",
        );
        expect(after.verdict).toBe("blokada");
    });
});
