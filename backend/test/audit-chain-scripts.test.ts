// Skrypty lancucha audytu uruchamiane NAPRAWDE (ADR-0161): `audit:verify` i
// `audit:acknowledge-forks` jako osobne procesy tsx na syntetycznej bazie SQLite.
// Sprawdzamy to, czego nie widza testy rdzenia: wybor zrodla, odczyt progu z pliku,
// kody wyjscia trojstanu, zapis przez appendAuditEvent i to, ze weryfikator NIE
// zaklada pustej bazy pod zla sciezka. Dane w calosci syntetyczne.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { GENESIS_HASH, computeAuditHash } from "../src/lib/audit";
import { FORK_ACK_EVENT } from "../src/lib/audit-chain-verify";
import { SQLITE_SCHEMA } from "../src/lib/db/schema.sqlite";
import { ensureAuditChainGuard, SQLITE_MIGRATIONS } from "../src/lib/db/migrate.sqlite";
import { LOCAL_USER_ID } from "../src/lib/db/sqlite-connection";
import { EXIT, parseSourceArgs } from "../scripts/audit-chain-source";

const BACKEND = path.resolve(__dirname, "..");
const TSX = path.join(BACKEND, "node_modules", "tsx", "dist", "cli.mjs");

let dir: string;
let file: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-chain-scripts-"));
    file = path.join(dir, "patron.db");
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Baza po ostatniej migracji, ale BEZ straznika (stan instalacji sprzed ADR-0161):
 * lancuch 1-2-3, rozwidlenie wyscigu pod 3 (ogniwa 4 i 5 w tej samej ms), dalej z 5.
 */
function forkedDb(): void {
    const db = new Database(file);
    db.exec(SQLITE_SCHEMA);
    db.pragma(`user_version = ${SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1].version}`);
    const ins = db.prepare(
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
    db.close();
}

function guard(): void {
    const db = new Database(file);
    ensureAuditChainGuard(db);
    db.close();
}

function sql<T>(q: string): T {
    const db = new Database(file, { readonly: true });
    const r = db.prepare(q).get() as T;
    db.close();
    return r;
}

function run(script: string, ...args: string[]): { code: number | null; out: string } {
    const r = spawnSync(process.execPath, [TSX, path.join("scripts", script), ...args], {
        cwd: BACKEND,
        encoding: "utf8",
        env: { ...process.env, PATRON_DB_BACKEND: "sqlite", PATRON_DB_PATH: file },
        timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const verify = (...a: string[]) => run("verify-audit-chain.ts", "--sqlite", file, ...a);
const ack = (...a: string[]) => run("acknowledge-audit-forks.ts", "--sqlite", file, ...a);

describe("audit:verify jako proces", () => {
    it("rozwidlenie wyscigu bez potwierdzenia: UWAGI, kod 3, bez payloadu w raporcie", () => {
        forkedDb();
        const r = verify();
        expect(r.code).toBe(EXIT.uwagi);
        expect(r.out).toContain("fork_concurrent id=[4,5]");
        expect(r.out).toContain("straznik: brak / nieznany");
        expect(r.out).not.toContain('"n"');
    }, 60_000);

    it("prog straznika czytany z indeksu w pliku", () => {
        forkedDb();
        guard();
        expect(verify().out).toContain("unikalny prev_hash dla id > 6");
    }, 60_000);

    it("brak pliku: kod 2 i ZADNEGO pustego pliku pod ta sciezka", () => {
        const r = verify();
        expect(r.code).toBe(EXIT.error);
        expect(fs.existsSync(file)).toBe(false);
    }, 60_000);

    it("uszkodzony JSON payloadu to BLOKADA (1), nie blad odczytu (2)", () => {
        forkedDb();
        const db = new Database(file);
        db.prepare("update audit_log set payload = '{zepsute' where id = 2").run();
        db.close();
        const r = verify();
        expect(r.code).toBe(EXIT.blokada);
        expect(r.out).toContain("hash_mismatch id=[2]");
    }, 60_000);
});

describe("audit:acknowledge-forks jako proces", () => {
    it("bez straznika: ODMOWA, kod 1, nic nie zapisane", () => {
        forkedDb();
        const r = ack("--tak");
        expect(r.code).toBe(EXIT.blokada);
        expect(r.out).toContain("ODMOWA: brak progu straznika");
        expect(sql<{ c: number }>("select count(*) c from audit_log").c).toBe(6);
    }, 60_000);

    it("przy BLOKADZIE: ODMOWA - potwierdzenie nie wybiela manipulacji", () => {
        forkedDb();
        guard();
        const db = new Database(file);
        db.prepare("delete from audit_log where id = 2").run();
        db.close();
        const r = ack("--tak");
        expect(r.code).toBe(EXIT.blokada);
        expect(r.out).toContain("ODMOWA: lancuch ma BLOKADE");
    }, 60_000);

    it("pelna sciezka: podglad -> zapis -> powtorka -> weryfikacja -> usuniety lisc", () => {
        forkedDb();
        guard();

        const preview = ack();
        expect(preview.code).toBe(EXIT.uwagi);
        expect(preview.out).toContain("do potwierdzenia: poprzednik id=3, ogniwa id=[4,5]");
        expect(sql<{ c: number }>("select count(*) c from audit_log").c).toBe(6);

        const write = ack("--tak");
        expect(write.code).toBe(EXIT.ok);
        const row = sql<{ id: number; actor_user_id: string; payload: string }>(
            `select id, actor_user_id, payload from audit_log where event_type = '${FORK_ACK_EVENT}'`,
        );
        expect(row.id).toBe(7);
        expect(row.actor_user_id).toBe(LOCAL_USER_ID);
        const payload = JSON.parse(row.payload);
        expect(payload).toMatchObject({ schema: "fork-ack/1", guard_after_id: 6 });
        expect(payload.forks[0].siblings.map((s: { id: number }) => s.id)).toEqual([4, 5]);

        const again = ack("--tak");
        expect(again.code).toBe(EXIT.ok);
        expect(again.out).toContain("Nic do potwierdzenia");
        expect(sql<{ c: number }>("select count(*) c from audit_log").c).toBe(7);

        const ok = verify();
        expect(ok.code).toBe(EXIT.ok);
        expect(ok.out).toContain("INFO fork_acknowledged id=[4,5]");

        // Lisc 4 nie ma nastepcy: bez potwierdzenia jego usuniecie byloby niewidoczne.
        const db = new Database(file);
        db.prepare("delete from audit_log where id = 4").run();
        db.close();
        const broken = verify();
        expect(broken.code).toBe(EXIT.blokada);
        expect(broken.out).toContain("ack_missing id=[7,4]");
    }, 120_000);
});

describe("parseSourceArgs", () => {
    it("zrodlo domyslne jak backend: SQLite, chyba ze PATRON_DB_BACKEND=supabase", () => {
        const prev = process.env.PATRON_DB_BACKEND;
        try {
            delete process.env.PATRON_DB_BACKEND;
            expect(parseSourceArgs([]).source).toBe("sqlite");
            process.env.PATRON_DB_BACKEND = "Supabase";
            expect(parseSourceArgs([]).source).toBe("supabase");
            expect(parseSourceArgs(["--sqlite"]).source).toBe("sqlite");
        } finally {
            if (prev === undefined) delete process.env.PATRON_DB_BACKEND;
            else process.env.PATRON_DB_BACKEND = prev;
        }
    });

    it("sciezka, prog, flagi i wartosci dopuszczone przez wolajacego", () => {
        const a = parseSourceArgs(
            ["--sqlite", "x.db", "--guard-after-id", "42", "--tak", "--actor", "u-1"],
            ["--tak"],
            ["--actor"],
        );
        expect(a).toMatchObject({ source: "sqlite", sqlitePath: "x.db", guardAfterId: 42 });
        expect(a.flags.has("--tak")).toBe(true);
        expect(a.values.get("--actor")).toBe("u-1");
        // --sqlite bez sciezki: sciezka z PATRON_DB_PATH (null tutaj), kolejna flaga nie jest sciezka.
        expect(parseSourceArgs(["--sqlite", "--supabase"]).source).toBe("supabase");
        expect(parseSourceArgs(["--sqlite", "--supabase"]).sqlitePath).toBeNull();
    });
});
