// RODO art. 17 na desktopie (SQLite) - prawdziwy skrypt, prawdziwy proces, bez mockow.
// Do 2026-10-06 scripts/rodo-delete.ts znal tylko Supabase i na domyslnej instalacji
// konczyl sie "FATAL: brak SUPABASE_URL" kodem 2; testy tras przechodzily, bo
// podmienialy klienta na shim (weryfikacja desktop, R5). Ten test uruchamia skrypt
// tak, jak Operator: osobny proces, PATRON_DB_BACKEND=sqlite, PATRON_DB_PATH.
import { spawnSync } from "child_process";
import net from "net";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BACKEND = path.resolve(__dirname, "..", "..");
const TSX = path.join(BACKEND, "node_modules", "tsx", "dist", "cli.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rodo-sqlite-"));
const dbPath = path.join(dir, "patron.db");
const UZYTKOWNIK = "11111111-2222-4333-8444-555555555555";
const INNY = "99999999-8888-4777-8666-555555555555";
const envBackup = { ...process.env };

// Port "backendu PATRONa": zajety (atrapa nasluchujaca) i wolny (nikt nie slucha).
let portZajety = 0;
let portWolny = 0;
let atrapa: net.Server | null = null;

function uruchom(skrypt: string, args: string[], extraEnv: Record<string, string> = {}) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
        if (v !== undefined && !k.startsWith("SUPABASE") && k !== "NEXT_PUBLIC_SUPABASE_URL") env[k] = v;
    Object.assign(env, { PATRON_DB_BACKEND: "sqlite", PATRON_DB_PATH: dbPath, PORT: String(portWolny), ...extraEnv });
    const r = spawnSync(process.execPath, [TSX, skrypt, ...args], {
        cwd: BACKEND, env, encoding: "utf8", timeout: 120_000,
    });
    return { kod: r.status, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(async () => {
    atrapa = net.createServer(() => { /* polaczenie przyjete przez system */ });
    await new Promise<void>((r) => atrapa!.listen(0, "127.0.0.1", () => r()));
    portZajety = (atrapa.address() as net.AddressInfo).port;
    const chwilowy = net.createServer();
    await new Promise<void>((r) => chwilowy.listen(0, "127.0.0.1", () => r()));
    portWolny = (chwilowy.address() as net.AddressInfo).port;
    await new Promise<void>((r) => chwilowy.close(() => r()));

    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = dbPath;
    const { createServerSupabase } = await import("./supabase");
    const { appendAuditEvent } = await import("./audit");
    const db = createServerSupabase();
    for (const [aktor, i] of [[UZYTKOWNIK, 1], [INNY, 2], [UZYTKOWNIK, 3], [UZYTKOWNIK, 4]] as const) {
        const r = await appendAuditEvent(db, {
            event_type: "chat.message.user",
            actor_user_id: aktor,
            payload: { n: i },
        });
        expect(r.ok).toBe(true);
    }
    const { closeDb } = await import("./db/sqlite-connection");
    closeDb();
}, 60_000);

afterAll(() => {
    atrapa?.close();
    process.env = { ...envBackup };
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("rodo-delete.ts na SQLite (desktop)", () => {
    it("bez --confirm nic nie robi (kod 2)", () => {
        const r = uruchom("scripts/rodo-delete.ts", ["--user", UZYTKOWNIK]);
        expect(r.kod, r.out).toBe(2);
        const db = new Database(dbPath, { readonly: true });
        const n = db.prepare("select count(*) c from audit_log where actor_user_id = ?").get(UZYTKOWNIK) as { c: number };
        db.close();
        expect(n.c).toBe(3);
    }, 120_000);

    it("gdy backend PATRONa slucha na porcie: STOP kodem 2, baza nietknieta", () => {
        const r = uruchom("scripts/rodo-delete.ts", ["--user", UZYTKOWNIK, "--confirm"], { PORT: String(portZajety) });
        expect(r.kod, r.out).toBe(2);
        expect(r.out).toMatch(/Zamknij aplikacje PATRON/);
        const db = new Database(dbPath, { readonly: true });
        const n = db.prepare("select count(*) c from audit_log where actor_user_id = ?").get(UZYTKOWNIK) as { c: number };
        const lb = db.prepare("select count(*) c from audit_log where event_type = 'audit.chain.legal_break'").get() as { c: number };
        db.close();
        expect(n.c).toBe(3);
        expect(lb.c).toBe(0);
    }, 120_000);

    it("anonimizuje wpisy uzytkownika, deklaruje zerwanie z lista i hashami po anonimizacji, nie rusza innych", () => {
        const r = uruchom("scripts/rodo-delete.ts", ["--user", UZYTKOWNIK, "--confirm"]);
        expect(r.kod, r.out).toBe(0);
        expect(r.out).toMatch(/lancuch zerwany w 3 wierszach/);
        expect(r.out).not.toMatch(/FATAL/);

        const db = new Database(dbPath, { readonly: true });
        const zostalo = db.prepare("select count(*) c from audit_log where actor_user_id = ?").get(UZYTKOWNIK) as { c: number };
        const inny = db.prepare("select count(*) c from audit_log where actor_user_id = ?").get(INNY) as { c: number };
        const deklaracje = db.prepare("select id, payload from audit_log where event_type = 'audit.chain.legal_break'").all() as { id: number; payload: string }[];
        const rodo = db.prepare("select count(*) c from audit_log where event_type = 'rodo.delete'").get() as { c: number };
        const pierwszyZerwany = db.prepare("select min(id) m from audit_log where event_type = 'chat.message.user' and actor_user_id is null").get() as { m: number };
        db.close();

        expect(zostalo.c).toBe(0);
        expect(inny.c).toBe(1);
        expect(deklaracje).toHaveLength(1);
        const p = JSON.parse(deklaracje[0].payload) as { affected_ids: number[]; affected_hashes_after: string[]; reason: string };
        expect(p.reason).toBe("rodo_art_17_anonymization");
        expect(p.affected_ids).toHaveLength(3);
        expect(p.affected_hashes_after).toHaveLength(3);
        // Payload deklaracji nie niesie identyfikatora uzytkownika.
        expect(deklaracje[0].payload).not.toContain(UZYTKOWNIK);
        expect(pierwszyZerwany.m).toBeLessThan(deklaracje[0].id);
        expect(rodo.c).toBe(1);
    }, 120_000);

    it("weryfikator lancucha na tej bazie: UWAGI z mocy prawa (kod 3), nie BLOKADA", () => {
        const r = uruchom("scripts/verify-audit-chain.ts", []);
        expect(r.kod, r.out).toBe(3);
    }, 120_000);

    it("kontrola: zmiana tresci zanonimizowanego wpisu po fakcie = BLOKADA (kod 1)", () => {
        const db = new Database(dbPath);
        db.prepare("update audit_log set payload = ? where event_type = 'chat.message.user' and actor_user_id is null and id = (select min(id) from audit_log where actor_user_id is null and event_type = 'chat.message.user')")
            .run(JSON.stringify({ n: 999 }));
        db.close();
        const r = uruchom("scripts/verify-audit-chain.ts", []);
        expect(r.kod, r.out).toBe(1);
    }, 120_000);
});
