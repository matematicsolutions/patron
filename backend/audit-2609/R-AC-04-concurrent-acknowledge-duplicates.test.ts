// R-AC-04: dwa rownolegle POST /api/audit/chain/acknowledge z tym samym digestem
// (podwojne klikniecie, dwie karty przegladarki, ponowienie zadania przez proxy) zapisuja
// DWA zdarzenia audit.chain.fork_acknowledged. lib/audit-chain-status.ts:127-137: ocena
// (`evaluate` -> loadChainRows, await) i zapis (`appendAuditEvent`) nie sa jedna sekcja
// krytyczna - kolejka w audit.ts porzadkuje tylko insert, nie "sprawdz, czy juz
// potwierdzone". ADR-0165 (Weryfikacja) deklaruje "brak duplikatu"; test
// audit-chain-status.test.ts sprawdza to tylko sekwencyjnie.
// Skutek: dwa oswiadczenia "wiedzielismy o tym w chwili T" dla tych samych ogniw,
// oba 200 dla wolajacego. Szkoda niewielka (weryfikator zniesie duplikat), ale obietnica
// ADR nie trzyma.
// Oczekiwane: dokladnie jedno zdarzenie potwierdzenia; drugie zadanie dostaje odmowe
// (nothing_to_acknowledge albo stale).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { GENESIS_HASH, computeAuditHash } from "../src/lib/audit";
import { SQLITE_SCHEMA } from "../src/lib/db/schema.sqlite";
import { SQLITE_MIGRATIONS } from "../src/lib/db/migrate.sqlite";

const tmp = path.join(os.tmpdir(), `patron-rac04-${process.pid}-${Date.now()}.db`);

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("R-AC-04 rownolegle potwierdzenie rozwidlen", () => {
    it("dwa rownolegle potwierdzenia z tym samym digestem daja jedno zdarzenie", async () => {
        // Baza sprzed straznika: 1-2-3, wyscig pod 3 (4 i 5), dalej z 5 (jak audit-chain-status.test.ts).
        const pre = new Database(tmp);
        pre.exec(SQLITE_SCHEMA);
        pre.pragma(`user_version = ${SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1].version}`);
        const ins = pre.prepare(
            "insert into audit_log (id, ts, actor_user_id, event_type, chat_id, document_id, payload, prev_hash, hash) values (?,?,?,?,?,?,?,?,?)",
        );
        const hashes = new Map<number, string>();
        const add = (id: number, parent: number | null, ts: string) => {
            const base = {
                prev_hash: parent === null ? GENESIS_HASH : hashes.get(parent)!,
                ts,
                event_type: "ring_policy.decision",
                actor_user_id: null,
                chat_id: null,
                document_id: null,
                payload: { n: id },
            };
            const hash = computeAuditHash(base);
            hashes.set(id, hash);
            ins.run(id, ts, null, base.event_type, null, null, JSON.stringify(base.payload), base.prev_hash, hash);
        };
        add(1, null, "2026-01-15T10:00:00.000Z");
        add(2, 1, "2026-01-15T10:00:01.000Z");
        add(3, 2, "2026-01-15T10:00:02.000Z");
        add(4, 3, "2026-01-15T10:00:03.500Z");
        add(5, 3, "2026-01-15T10:00:03.500Z");
        add(6, 5, "2026-01-15T10:00:04.000Z");
        pre.close();

        process.env.PATRON_DB_BACKEND = "sqlite";
        process.env.PATRON_DB_PATH = tmp;
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const mod = await import("../src/lib/audit-chain-status");
        const db = createServerSupabase();

        const s = await mod.getChainStatus(db);
        expect(s.report.verdict).toBe("uwagi");
        const digest = s.pending!.digest;

        const wyniki = await Promise.all([
            mod.acknowledgeForks(db, { actorUserId: "00000000-0000-0000-0000-000000000001", digest }),
            mod.acknowledgeForks(db, { actorUserId: "00000000-0000-0000-0000-000000000001", digest }),
        ]);
        const acks = (
            getDb().prepare("select count(*) c from audit_log where event_type = 'audit.chain.fork_acknowledged'").get() as {
                c: number;
            }
        ).c;
        expect(acks, `wyniki: ${wyniki.map((w) => (w.ok ? "ok" : w.reason)).join(", ")}`).toBe(1);
    });
});
