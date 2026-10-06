// Eksport paczki audytora wobec tresci dziennika (audyt 2026-09: C-04 i uwaga
// o najnowszym korzeniu Merkle). Pakiet deliverable: audit-bundle-route.test.ts.
//
// C-04: lisciem Merkle jest KOLUMNA hash, wiec dowod nie widzi zmiany payloadu
// zrobionej SQL-em. Serwer przelicza hash z tresci wiersza przed wydaniem paczki
// i przy niezgodnosci ODMAWIA (409), zostawiajac slad w dzienniku.
// Korzen: fetchProofForEvent wybieral NAJNOWSZY korzen obejmujacy wpis - nowy
// korzen dopisany po zmianie wpisu dawal zgodny dowod. Teraz kazdy korzen musi
// sie zgadzac, a paczka wskazuje najstarsza pieczec.
// RODO art. 17 (decyzja 2026-10-06): wpis zanonimizowany przez rodo-delete wychodzi
// ze znacznikiem legal_break, gdy obejmuje go wazna deklaracja (ostatni blok).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawnSync, execFileSync } from "child_process";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-export-integrity-${process.pid}-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
// scripts/rodo-delete.ts czyta klienta Supabase z env - podmieniony na shim SQLite.
process.env.SUPABASE_URL = "http://synthetic.invalid";
process.env.SUPABASE_SECRET_KEY = "synthetic";

vi.mock("@supabase/supabase-js", async () => {
    const { createSqliteClient } = await import("../lib/db/supabase-shim");
    return { createClient: () => createSqliteClient() };
});

function pythonDostepny(): string | null {
    for (const k of ["python3", "python"]) {
        try {
            execFileSync(k, ["--version"], { stdio: "ignore" });
            return k;
        } catch {
            /* nastepny */
        }
    }
    return null;
}
const PYTHON = pythonDostepny();

let server: http.Server;
let base = "";
type Db = ReturnType<typeof import("../lib/supabase").createServerSupabase>;
let db: Db;
let sql: import("better-sqlite3").Database;
let chatId = "";
let LOCAL = "";

beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const express = (await import("express")).default;
    const { auditRouter } = await import("./audit");
    const { createServerSupabase } = await import("../lib/supabase");
    const { appendAuditEvent } = await import("../lib/audit");
    const { computeAndStoreRoot } = await import("../lib/audit-merkle-roots");
    const { LOCAL_USER_ID } = await import("../lib/db/supabase-shim");
    const { getDb } = await import("../lib/db/sqlite-connection");
    LOCAL = LOCAL_USER_ID;
    db = createServerSupabase();
    sql = getDb();

    // id 1..5: decyzje straznika egress, objete korzeniem [1, 5]
    for (let i = 1; i <= 5; i++) {
        const r = await appendAuditEvent(db, {
            event_type: "llm_route",
            actor_user_id: "u-test",
            payload: { model: "gemini-x", decision: "block", n: i },
        });
        expect(r.ok).toBe(true);
    }
    expect((await computeAndStoreRoot(db, 1, 5, "service")).ok).toBe(true);

    // id 6..10: czat z dwiema turami; miedzy nimi upload (bez chat_id).
    const chat = await (db as any).from("chats").insert({ user_id: LOCAL, title: "Czat testowy" }).select("id").single();
    chatId = chat.data.id as string;
    const zdarzenie = (event_type: string, payload: Record<string, unknown>, chat: string | null = chatId) =>
        appendAuditEvent(db, { event_type: event_type as never, actor_user_id: LOCAL, chat_id: chat, payload });

    await zdarzenie("chat.message.user", { content_len: 20, file_count: 0, workflow_id: null });
    await zdarzenie("chat.message.assistant", { model: "model-pierwszej-tury", full_text_len: 19 });
    await zdarzenie("input_security_scan", { report_id: "r1", action: "allowed" }, null);
    // payload z adresem e-mail: w pakiecie zamaskowany, hash nie do przeliczenia z pliku
    await zdarzenie("chat.message.user", { content_len: 30, kontakt: "jan.testowy@example.pl" });
    await zdarzenie("chat.message.assistant", { model: "model-drugiej-tury", full_text_len: 16 });

    const app = express();
    app.use(express.json());
    app.use("/api/audit", auditRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    const { closeDb } = await import("../lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

async function pobierzJson(url: string): Promise<{ status: number; json?: any; zip?: Record<string, Buffer>; body?: any }> {
    const r = await fetch(url);
    if (r.status !== 200) return { status: r.status, body: await r.json().catch(() => null) };
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const files: Record<string, Buffer> = {};
    for (const n of Object.keys(zip.files)) files[n] = await zip.file(n)!.async("nodebuffer");
    const jsonName = Object.keys(files).find((n) => n.endsWith(".json"))!;
    return { status: 200, json: JSON.parse(files[jsonName].toString("utf8")), zip: files };
}

function uruchomVerifyPy(files: Record<string, Buffer>): { kod: number; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-export-integrity-"));
    for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
    const json = Object.keys(files).find((n) => n.endsWith(".json"))!;
    const w = spawnSync(PYTHON as string, [path.join(dir, "verify.py"), path.join(dir, json)], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });
    return { kod: w.status ?? -1, out: w.stdout };
}

function odmowyWDzienniku(eventType: string): Array<Record<string, unknown>> {
    return (sql.prepare("select payload from audit_log where event_type = ?").all(eventType) as Array<{ payload: string }>)
        .map((r) => JSON.parse(r.payload) as Record<string, unknown>)
        .filter((p) => p.phase === "refused");
}

describe("GET /api/audit/export/:eventId - kontrola tresci przed wydaniem (C-04)", () => {
    it("nienaruszony wpis: 200, hash przeliczalny z pliku, verify.py kod 0", async () => {
        const r = await pobierzJson(`${base}/api/audit/export/2`);
        expect(r.status).toBe(200);
        expect(r.json.event.hash_inputs_complete).toBe(true);
        expect(r.json.event.hash).toBe(r.json.merkle_proof_bundle.event_hash);
        const { verifyPackEventBinding } = await import("../lib/audit-pack");
        expect(verifyPackEventBinding(r.json)).toMatchObject({ ok: true, recomputed: true });
        if (PYTHON) expect(uruchomVerifyPy(r.zip!).kod).toBe(0);
    });

    it("kilka zgodnych korzeni nad tym samym blokiem: paczka wskazuje NAJSTARSZA pieczec", async () => {
        const { computeAndStoreRoot } = await import("../lib/audit-merkle-roots");
        await new Promise((r) => setTimeout(r, 5));
        const dup = await computeAndStoreRoot(db, 1, 5, "service");
        expect(dup.ok).toBe(true);
        const r = await pobierzJson(`${base}/api/audit/export/2`);
        expect(r.status).toBe(200);
        const najstarszy = (sql.prepare("select min(id) as id from audit_merkle_roots").get() as { id: number }).id;
        expect(r.json.merkle_proof_bundle.merkle_root_id).toBe(najstarszy);
        expect(r.json.merkle_proof_bundle.merkle_root_id).not.toBe(dup.root!.id);
    });

    it("payload zmieniony SQL-em: 409 event_hash_mismatch i slad odmowy w dzienniku", async () => {
        sql.prepare("update audit_log set payload = ? where id = 3").run(
            JSON.stringify({ model: "gemini-x", decision: "allow", n: 3 }),
        );
        const r = await pobierzJson(`${base}/api/audit/export/3`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("event_hash_mismatch");
        expect(odmowyWDzienniku("admin.access.audit_export")).toContainEqual(
            expect.objectContaining({ event_id: 3, reason: "event_hash_mismatch" }),
        );
    });

    it("ts zmieniony SQL-em: 409", async () => {
        sql.prepare("update audit_log set ts = ? where id = 4").run("2020-01-01T00:00:00.000Z");
        const r = await pobierzJson(`${base}/api/audit/export/4`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("event_hash_mismatch");
    });

    it("hash w bazie przeliczony po zmianie (wpis 5 + nowy korzen nad tym samym blokiem): 409 merkle_root_mismatch", async () => {
        const { computeAuditHash } = await import("../lib/audit");
        const { computeAndStoreRoot } = await import("../lib/audit-merkle-roots");
        const row = sql.prepare("select * from audit_log where id = 5").get() as Record<string, string>;
        const payload = { model: "gemini-x", decision: "allow", n: 5 };
        const hash = computeAuditHash({
            prev_hash: row.prev_hash,
            ts: row.ts,
            event_type: row.event_type,
            actor_user_id: row.actor_user_id,
            chat_id: row.chat_id,
            document_id: row.document_id,
            payload,
        });
        sql.prepare("update audit_log set payload = ?, hash = ? where id = 5").run(JSON.stringify(payload), hash);
        // Zwykla sciezka aplikacji: nowy korzen nad [1, 5] po zmianie. Najnowszy
        // korzen sie zgadza - stary (najwczesniejsza pieczec) juz nie.
        await new Promise((r) => setTimeout(r, 5));
        expect((await computeAndStoreRoot(db, 1, 5, "service")).ok).toBe(true);
        const r = await pobierzJson(`${base}/api/audit/export/5`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("merkle_root_mismatch");
        const v = await fetch(`${base}/api/audit/merkle/verify/5`);
        expect(v.status).toBe(409);
    });

    it("usuniety poprzednik: 409 event_parent_missing", async () => {
        const { computeAndStoreRoot } = await import("../lib/audit-merkle-roots");
        // korzen nad wpisami czatu (6..), zeby dowod istnial
        const maxId = (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m;
        expect((await computeAndStoreRoot(db, 6, maxId, "service")).ok).toBe(true);
        const ok = await pobierzJson(`${base}/api/audit/export/7`);
        expect(ok.status).toBe(200);
        // Usuniecie wpisu 6 (poprzednika 7) SQL-em. Korzen [6, max] liczony po
        // usunieciu tez by sie domknal - poprzednika sprawdza osobna kontrola.
        sql.prepare("delete from audit_log where id = 6").run();
        const maxPo = (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m;
        sql.prepare("delete from audit_merkle_roots where chain_block_start = 6").run();
        expect((await computeAndStoreRoot(db, 7, maxPo, "service")).ok).toBe(true);
        const r = await pobierzJson(`${base}/api/audit/export/7`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("event_parent_missing");
    });
});

// ---------------------------------------------------------------------------
// RODO art. 17: wpis zanonimizowany prawdziwym scripts/rodo-delete.ts (klient
// Supabase podmieniony na shim SQLite - wzor: audit-2609/R-AC-01). Decyzja
// wlasciciela produktu 2026-10-06: eksport wychodzi ZE ZNACZNIKIEM zerwania z
// mocy prawa, gdy obejmuje go wazna deklaracja; inaczej odmowa jak dotad.
// ---------------------------------------------------------------------------

const OSOBA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"; // syntetyczny
const OSOBA_STARA = "99999999-8888-7777-6666-555555555555"; // syntetyczny

async function uruchomRodoDelete(user: string): Promise<void> {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
        throw new Error(`process.exit(${c})`);
    }) as never);
    const logi: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
        logi.push(a.join(" "));
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const argv = process.argv;
    process.argv = ["node", "rodo-delete.ts", "--user", user, "--confirm"];
    try {
        // Sciezka przez zmienna: scripts/ lezy poza rootDir tsconfig (src/), a
        // test ma uruchomic PRAWDZIWY skrypt, nie jego kopie.
        const skrypt = "../../scripts/rodo-delete";
        await import(/* @vite-ignore */ skrypt);
        await vi.waitFor(() => expect(logi.some((l) => l.includes("[rodo:delete] OK"))).toBe(true), {
            timeout: 10_000,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    } finally {
        process.argv = argv;
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errSpy.mockRestore();
    }
}

describe("RODO art. 17: eksport wpisu zanonimizowanego (ADR-0164, decyzja 2026-10-06)", () => {
    let wpisPelny = 0;
    let wpisZamaskowany = 0;
    let wpisDoZmiany = 0;
    let wpisStaryFormat = 0;
    let deklaracja = 0;

    beforeAll(async () => {
        const { appendAuditEvent, computeAuditHash } = await import("../lib/audit");
        const { computeAndStoreRoot } = await import("../lib/audit-merkle-roots");
        const zapisz = async (actor: string | null, payload: Record<string, unknown>, event_type = "llm_route") => {
            const r = await appendAuditEvent(db, { event_type: event_type as never, actor_user_id: actor, payload });
            expect(r.ok).toBe(true);
            return (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m;
        };
        const start = (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m + 1;
        wpisPelny = await zapisz(OSOBA, { model: "gemini-x", decision: "allow", n: 101 });
        wpisZamaskowany = await zapisz(OSOBA, { model: "gemini-x", kontakt: "ewa.testowa@example.pl" });
        await zapisz("u-test", { model: "gemini-x", decision: "block", n: 102 });
        wpisDoZmiany = await zapisz(OSOBA, { model: "gemini-x", decision: "allow", n: 103 });

        // Deklaracja w STARYM formacie (sprzed R-AC-01, bez affected_hashes_after),
        // tak jak zapisywala ja poprzednia wersja rodo-delete, i anonimizacja SQL-em.
        wpisStaryFormat = await zapisz(OSOBA_STARA, { model: "gemini-x", decision: "allow", n: 104 });
        await zapisz(null, {
            reason: "rodo_art_17_anonymization",
            field: "actor_user_id",
            affected_count: 1,
            first_id: wpisStaryFormat,
            last_id: wpisStaryFormat,
            affected_ids: [wpisStaryFormat],
            affected_ids_truncated: false,
        }, "audit.chain.legal_break");
        sql.prepare("update audit_log set actor_user_id = null where id = ?").run(wpisStaryFormat);

        await uruchomRodoDelete(OSOBA);
        deklaracja = (
            sql
                .prepare("select max(id) as m from audit_log where event_type = 'audit.chain.legal_break'")
                .get() as { m: number }
        ).m;
        expect(deklaracja).toBeGreaterThan(wpisDoZmiany);
        const wiersz = sql.prepare("select * from audit_log where id = ?").get(wpisPelny) as Record<string, string>;
        expect(wiersz.actor_user_id).toBeNull();
        // kontrola: hash wiersza NIE zgadza sie juz z trescia (zerwanie jest realne)
        expect(
            computeAuditHash({
                prev_hash: wiersz.prev_hash,
                ts: wiersz.ts,
                event_type: wiersz.event_type,
                actor_user_id: null,
                chat_id: wiersz.chat_id,
                document_id: wiersz.document_id,
                payload: JSON.parse(wiersz.payload),
            }),
        ).not.toBe(wiersz.hash);

        const koniec = (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m;
        expect((await computeAndStoreRoot(db, start, koniec, "service")).ok).toBe(true);
    });

    it("wazna deklaracja: 200, znacznik legal_break, deklaracja w paczce, dowod dla ORYGINALNEGO hasha, verify.py kod 3", async () => {
        const r = await pobierzJson(`${base}/api/audit/export/${wpisPelny}`);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const oryginalny = (sql.prepare("select hash from audit_log where id = ?").get(wpisPelny) as { hash: string }).hash;
        expect(r.json.event.hash).toBe(oryginalny);
        expect(r.json.merkle_proof_bundle.event_hash).toBe(oryginalny);
        expect(r.json.event.actor_user_id).toBeNull();
        expect(r.json.event.hash_inputs_complete).toBe(true);
        expect(r.json.event.legal_break).toMatchObject({
            declaration_event_id: deklaracja,
            reason: "rodo_art_17_anonymization",
            field: "actor_user_id",
        });
        expect(r.json.legal_break_declaration).toMatchObject({
            id: deklaracja,
            event_type: "audit.chain.legal_break",
            hash_inputs_complete: true,
        });
        const { verifyAuditPack } = await import("../lib/audit-pack");
        expect(verifyAuditPack(r.json).verdict).toBe("legal_break");
        if (PYTHON) {
            const py = uruchomVerifyPy(r.zip!);
            expect(py.kod, py.out).toBe(3);
            expect(py.out).toContain(`WYNIK: OK - zerwanie z mocy prawa (RODO art. 17), zadeklarowane zdarzeniem #${deklaracja}.`);
        }
    });

    it("wpis z payloadem zamaskowanym: 200, znacznik, tresc nie do przeliczenia z pliku, verify.py kod 3", async () => {
        const r = await pobierzJson(`${base}/api/audit/export/${wpisZamaskowany}`);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.json.event.hash_inputs_complete).toBe(false);
        expect(r.json.event.legal_break.declaration_event_id).toBe(deklaracja);
        const { verifyAuditPack } = await import("../lib/audit-pack");
        expect(verifyAuditPack(r.json).verdict).toBe("legal_break");
        if (PYTHON) expect(uruchomVerifyPy(r.zip!).kod).toBe(3);
    });

    it("zmiana payloadu PO anonimizacji: 409 event_hash_mismatch (content_differs) i slad odmowy", async () => {
        sql.prepare("update audit_log set payload = ? where id = ?").run(
            JSON.stringify({ model: "gemini-x", decision: "block", n: 103 }),
            wpisDoZmiany,
        );
        const r = await pobierzJson(`${base}/api/audit/export/${wpisDoZmiany}`);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({
            error: "event_hash_mismatch",
            legal_break: { status: "content_differs", declaration_event_id: deklaracja },
        });
        expect(odmowyWDzienniku("admin.access.audit_export")).toContainEqual(
            expect.objectContaining({ event_id: wpisDoZmiany, reason: "event_hash_mismatch" }),
        );
    });

    it("deklaracja w starym formacie (bez affected_hashes_after): serwer odmawia 409 (old_format)", async () => {
        const r = await pobierzJson(`${base}/api/audit/export/${wpisStaryFormat}`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("event_hash_mismatch");
        expect(r.body.legal_break.status).toBe("old_format");
        expect(r.body.detail).toContain("starym");
    });

    it("zmieniona sama deklaracja: nie wybiela niczego - 409", async () => {
        const row = sql.prepare("select payload from audit_log where id = ?").get(deklaracja) as { payload: string };
        const p = JSON.parse(row.payload) as Record<string, unknown>;
        p.reason = "inny_powod";
        sql.prepare("update audit_log set payload = ? where id = ?").run(JSON.stringify(p), deklaracja);
        const r = await pobierzJson(`${base}/api/audit/export/${wpisPelny}`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("event_hash_mismatch");
        // deklaracja z niezgodnym wlasnym hashem nie liczy sie wcale
        expect(r.body.legal_break).toBeUndefined();
    });
});
