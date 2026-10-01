// Stan lancucha i potwierdzanie rozwidlen z aplikacji (ADR-0165) - na prawdziwym
// pliku SQLite przez shim, tak jak w zainstalowanym desktopie. Baza startuje w stanie
// instalacji sprzed ADR-0161 (rozwidlenie wyscigu, bez straznika); pierwszy dostep
// przechodzi bootstrap aplikacji (migracje + straznik). Dane syntetyczne.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENESIS_HASH, computeAuditHash } from "./audit";
import { FORK_ACK_EVENT } from "./audit-chain-verify";
import { SQLITE_SCHEMA } from "./db/schema.sqlite";
import { SQLITE_MIGRATIONS } from "./db/migrate.sqlite";

const tmp = path.join(os.tmpdir(), `patron-chain-status-${process.pid}-${Date.now()}.db`);

type Mod = typeof import("./audit-chain-status");
let mod: Mod;
let db: ReturnType<typeof import("./supabase").createServerSupabase>;
let raw: () => Database.Database;
let ensureGuard: typeof import("./db/migrate.sqlite").ensureAuditChainGuard;

beforeAll(async () => {
    // Plik w stanie sprzed straznika: lancuch 1-2-3, wyscig pod 3 (4 i 5), dalej z 5.
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
    const supa = await import("./supabase");
    const conn = await import("./db/sqlite-connection");
    ({ ensureAuditChainGuard: ensureGuard } = await import("./db/migrate.sqlite"));
    mod = await import("./audit-chain-status");
    db = supa.createServerSupabase();
    raw = conn.getDb;
});

afterAll(async () => {
    const { closeDb } = await import("./db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

const count = () => (raw().prepare("select count(*) c from audit_log").get() as { c: number }).c;

describe("stan lancucha i potwierdzenie z aplikacji (kolejnosc ma znaczenie)", () => {
    let digest = "";

    it("stan po starcie: UWAGI, straznik z progiem 6, jedno rozwidlenie do potwierdzenia", async () => {
        const s = await mod.getChainStatus(db);
        expect(s.report.verdict).toBe("uwagi");
        expect(s.guardKnown).toBe(true);
        expect(s.report.guardAfterId).toBe(6);
        expect(s.pending?.forks).toEqual([{ parentId: 3, siblingIds: [4, 5] }]);
        expect(s.pending?.digest).toMatch(/^[0-9a-f]{64}$/);
        // Odpowiedz nie niesie tresci zdarzen - tylko id i opisy znalezisk.
        expect(JSON.stringify(s)).not.toContain('"n":');
        digest = s.pending!.digest;
    });

    it("bez straznika: odmowa no_guard, nic nie zapisane", async () => {
        raw().exec("drop index uq_audit_log_prev_hash");
        const r = await mod.acknowledgeForks(db, { actorUserId: "op-1", digest });
        expect(r).toMatchObject({ ok: false, reason: "no_guard" });
        expect(count()).toBe(6);
        ensureGuard(raw(), 6);
    });

    it("digest inny niz to, co wychodzi z oceny teraz: odmowa stale (409), nic nie zapisane", async () => {
        const r = await mod.acknowledgeForks(db, { actorUserId: "op-1", digest: "0".repeat(64) });
        expect(r).toMatchObject({ ok: false, reason: "stale" });
        expect(mod.ackHttpStatus(r)).toBe(409);
        expect(count()).toBe(6);
    });

    it("digest z podgladu: jedno zdarzenie z aktorem, stan po zapisie OK", async () => {
        const r = await mod.acknowledgeForks(db, { actorUserId: "op-1", digest });
        expect(r.ok).toBe(true);
        expect(mod.ackHttpStatus(r)).toBe(200);
        if (r.ok) {
            expect(r.status.report.verdict).toBe("ok");
            expect(r.status.pending).toBeNull();
        }
        const row = raw()
            .prepare("select actor_user_id, payload from audit_log where event_type = ?")
            .get(FORK_ACK_EVENT) as { actor_user_id: string; payload: string };
        expect(row.actor_user_id).toBe("op-1");
        expect(JSON.parse(row.payload)).toMatchObject({ schema: "fork-ack/1", guard_after_id: 6, tool: "ui:audit-chain" });
        expect(count()).toBe(7);
    });

    it("powtorka tym samym digestem: nothing_to_acknowledge, bez duplikatu", async () => {
        const r = await mod.acknowledgeForks(db, { actorUserId: "op-1", digest });
        expect(r).toMatchObject({ ok: false, reason: "nothing_to_acknowledge" });
        expect(count()).toBe(7);
    });

    it("KONTROLA POZYTYWNA: usuniety potwierdzony lisc -> BLOKADA w stanie, potwierdzenie odmawia", async () => {
        raw().prepare("delete from audit_log where id = 4").run();
        const s = await mod.getChainStatus(db);
        expect(s.report.verdict).toBe("blokada");
        expect(s.report.findings.some((f) => f.kind === "ack_missing")).toBe(true);
        const r = await mod.acknowledgeForks(db, { actorUserId: "op-1", digest });
        expect(r).toMatchObject({ ok: false, reason: "blocked" });
    });
});

describe("walidacja wejscia i kody HTTP", () => {
    it("digest: tylko 64 znaki hex", () => {
        expect(mod.isAckDigest("a".repeat(64))).toBe(true);
        expect(mod.isAckDigest("A".repeat(64))).toBe(false);
        expect(mod.isAckDigest("a".repeat(63))).toBe(false);
        expect(mod.isAckDigest(undefined)).toBe(false);
    });

    it("awaria zapisu to 500, kazda odmowa to 409", () => {
        expect(mod.ackHttpStatus({ ok: false, reason: "write_failed" })).toBe(500);
        for (const reason of ["blocked", "no_guard", "nothing_to_acknowledge", "stale"] as const) {
            expect(mod.ackHttpStatus({ ok: false, reason })).toBe(409);
        }
    });
});
