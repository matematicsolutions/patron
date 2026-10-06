// Pakiet dowodowy deliverable (GET /api/audit/bundle/:messageId, ADR-0152)
// wobec wlasnego weryfikatora i tresci dziennika (audyt 2026-09: D-01, D-02, D-08).
//
// D-01: wyciag jest filtrowany po czacie, wiec jest NIECIAGLY (miedzy turami
// leza zdarzenia innych spraw i systemowe). Pakiet prosto z eksportu musi przejsc
// wlasny weryfikator z jawna informacja o lukach, a zmiana wpisu w bazie musi
// zatrzymac eksport (odbiorca nie przeliczy hasha wpisu zamaskowanego).
// D-02: model_versions.model to model, ktory napisal TE odpowiedz.
// D-08: werdykt red cytatu MCP trafia do pakietu jako blocked.
// RODO art. 17 (decyzja 2026-10-06): wpisy zanonimizowane przez rodo-delete wychodza
// ze znacznikiem legal_break i deklaracja w pakiecie (ostatni blok).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawnSync, execFileSync } from "child_process";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-bundle-route-${process.pid}-${Date.now()}.db`);
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
let sql: import("better-sqlite3").Database;
let msg1 = "";
let msg2 = "";
let msgMcp = "";

beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const express = (await import("express")).default;
    const { auditRouter } = await import("./audit");
    const { createServerSupabase } = await import("../lib/supabase");
    const { appendAuditEvent } = await import("../lib/audit");
    const { LOCAL_USER_ID } = await import("../lib/db/supabase-shim");
    const { getDb } = await import("../lib/db/sqlite-connection");
    const db = createServerSupabase() as any;
    sql = getDb();

    const nowyCzat = async () =>
        ((await db.from("chats").insert({ user_id: LOCAL_USER_ID, title: "Czat testowy" }).select("id").single()).data
            .id as string);
    const zdarzenie = (chat: string | null, event_type: string, payload: Record<string, unknown>) =>
        appendAuditEvent(db, { event_type: event_type as never, actor_user_id: LOCAL_USER_ID, chat_id: chat, payload });
    const odpowiedz = async (chat: string, content: string, annotations: unknown[] = []) =>
        (await db.from("chat_messages").insert({ chat_id: chat, role: "assistant", content, annotations }).select("id").single())
            .data.id as string;
    const pauza = () => new Promise((r) => setTimeout(r, 5));

    const chat = await nowyCzat();
    // Tura 1
    await zdarzenie(chat, "chat.message.user", { content_len: 20, file_count: 0, workflow_id: null });
    await zdarzenie(null, "llm_route", { model: "model-pierwszej-tury", action: "allow" });
    msg1 = await odpowiedz(chat, "Pierwsza odpowiedz.");
    await zdarzenie(chat, "chat.message.assistant", { model: "model-pierwszej-tury", full_text_len: 19 });
    // Miedzy turami: upload i inny czat
    await zdarzenie(null, "input_security_scan", { report_id: "r1", action: "allowed" });
    await zdarzenie(await nowyCzat(), "chat.message.user", { content_len: 5 });
    // Tura 2 - payload z e-mailem (w pakiecie zamaskowany)
    await pauza();
    await zdarzenie(chat, "chat.message.user", { content_len: 30, kontakt: "jan.testowy@example.pl" });
    msg2 = await odpowiedz(chat, "Druga odpowiedz.");
    await zdarzenie(chat, "chat.message.assistant", { model: "model-drugiej-tury", full_text_len: 16 });

    // D-08: osobny czat z odpowiedzia, w ktorej cytat MCP ma werdykt red
    const chatMcp = await nowyCzat();
    await zdarzenie(chatMcp, "chat.message.user", { content_len: 12 });
    msgMcp = await odpowiedz(chatMcp, "> Roszczenie nie przedawnia sie nigdy.", [
        {
            type: "mcp_grounding",
            quotes: [
                {
                    quote: "Roszczenie nie przedawnia sie nigdy.",
                    kind: "blockquote",
                    verdict: "red",
                    status: "NIEZWERYFIKOWANY",
                    ratio: 0.4,
                    source: { server: "saos", tool: "search_judgments" },
                },
            ],
            summary: { quotes: 1, green: 0, yellow: 0, red: 1, sources: 1, cards: 0 },
        },
    ]);
    await zdarzenie(chatMcp, "chat.message.assistant", { model: "model-mcp", full_text_len: 38 });

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

async function pobierz(messageId: string): Promise<{ status: number; json?: any; zip?: Record<string, Buffer>; body?: any }> {
    const r = await fetch(`${base}/api/audit/bundle/${messageId}`);
    if (r.status !== 200) return { status: r.status, body: await r.json().catch(() => null) };
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const files: Record<string, Buffer> = {};
    for (const n of Object.keys(zip.files)) files[n] = await zip.file(n)!.async("nodebuffer");
    const jsonName = Object.keys(files).find((n) => n.endsWith(".json"))!;
    return { status: 200, json: JSON.parse(files[jsonName].toString("utf8")), zip: files };
}

function verifyPy(files: Record<string, Buffer>): { kod: number; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-bundle-route-"));
    for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
    const json = Object.keys(files).find((n) => n.endsWith(".json"))!;
    const w = spawnSync(PYTHON as string, [path.join(dir, "verify.py"), path.join(dir, json)], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });
    return { kod: w.status ?? -1, out: w.stdout };
}

describe("pakiet dowodowy z wyciagiem nieciaglym (D-01)", () => {
    it("nienaruszony pakiet przechodzi weryfikacje produkcyjna i verify.py, luki jawne", async () => {
        const r = await pobierz(msg2);
        expect(r.status).toBe(200);
        const w = r.json.audit_log_excerpt as Array<Record<string, unknown>>;
        // tylko wpisy tego czatu, po id
        const ids = w.map((e) => e.id as number);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        expect(w.every((e) => typeof e.parent_in_excerpt === "boolean")).toBe(true);
        // wpis z e-mailem: zamaskowany, hash nie do przeliczenia z pliku
        expect(w.filter((e) => e.hash_inputs_complete === false)).toHaveLength(1);

        const { verifyAuditBundle } = await import("../lib/audit-bundle");
        const v = verifyAuditBundle(r.json);
        expect(v.ok, JSON.stringify(v.excerpt)).toBe(true);
        expect(v.excerpt.gaps).toBeGreaterThan(0);
        if (PYTHON) {
            const py = verifyPy(r.zip!);
            expect(py.kod, py.out).toBe(0);
            expect(py.out).toContain("WYCIAG, NIE PELNY LANCUCH");
        }
    });

    it("drugi eksport (wyciag zawiera slad pierwszego) tez przechodzi", async () => {
        const r = await pobierz(msg2);
        expect(r.status).toBe(200);
        expect(
            (r.json.audit_log_excerpt as Array<{ event_type: string }>).some(
                (e) => e.event_type === "deliverable.bundle_export",
            ),
        ).toBe(true);
        const { verifyAuditBundle } = await import("../lib/audit-bundle");
        expect(verifyAuditBundle(r.json).ok).toBe(true);
        if (PYTHON) expect(verifyPy(r.zip!).kod).toBe(0);
    });
});

describe("wersja modelu (D-02)", () => {
    it("model to ten, ktory napisal TE odpowiedz - z jej zdarzenia asystenta", async () => {
        const r1 = await pobierz(msg1);
        expect(r1.json.model_versions).toEqual({ model: "model-pierwszej-tury", model_source: "chat.message.assistant" });
        const r2 = await pobierz(msg2);
        expect(r2.json.model_versions).toEqual({ model: "model-drugiej-tury", model_source: "chat.message.assistant" });
    });
});

describe("werdykty cytatow MCP na poziomie cytatu (D-08)", () => {
    it("cytat MCP z werdyktem red jest w pakiecie jako blocked, z tekstem cytatu", async () => {
        const r = await pobierz(msgMcp);
        expect(r.status).toBe(200);
        expect(r.json.citation_verification.summary).toMatchObject({ total: 1, blocked: 1 });
        expect(r.json.citation_verification.items[0]).toMatchObject({
            decision: "blocked",
            status: "NIEZWERYFIKOWANY",
            quote: "Roszczenie nie przedawnia sie nigdy.",
            doc_id: "saos|search_judgments|",
        });
    });
});

describe("manipulacja w bazie zatrzymuje pakiet (D-01 / C-04)", () => {
    it("zmieniony payload wpisu ZAMASKOWANEGO: 409 excerpt_hash_mismatch i slad odmowy", async () => {
        // Wpis z e-mailem - odbiorca nie przeliczylby jego hasha z pliku; sprawdza serwer.
        const row = sql
            .prepare("select id, payload from audit_log where payload like '%jan.testowy%'")
            .get() as { id: number; payload: string };
        const p = JSON.parse(row.payload) as Record<string, unknown>;
        p.content_len = 999;
        sql.prepare("update audit_log set payload = ? where id = ?").run(JSON.stringify(p), row.id);

        const r = await pobierz(msg2);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ error: "excerpt_hash_mismatch", event_ids: [row.id] });
        const odmowy = (
            sql.prepare("select payload from audit_log where event_type = 'deliverable.bundle_export'").all() as Array<{
                payload: string;
            }>
        )
            .map((x) => JSON.parse(x.payload) as Record<string, unknown>)
            .filter((x) => x.phase === "refused");
        expect(odmowy).toContainEqual(expect.objectContaining({ reason: "excerpt_hash_mismatch", message_id: msg2 }));
    });

    it("usuniety poprzednik spoza wyciagu: 409 excerpt_parent_missing", async () => {
        // Czat MCP: chat.message.user (bez zmian) poprzedza w lancuchu wpis spoza czatu.
        const pierwszy = sql
            .prepare("select id, prev_hash from audit_log where chat_id = (select chat_id from chat_messages where id = ?) order by id limit 1")
            .get(msgMcp) as { id: number; prev_hash: string };
        sql.prepare("delete from audit_log where hash = ?").run(pierwszy.prev_hash);
        const r = await pobierz(msgMcp);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ error: "excerpt_parent_missing", event_ids: [pierwszy.id] });
    });
});

// ---------------------------------------------------------------------------
// RODO art. 17 w pakiecie deliverable (ADR-0164, decyzja 2026-10-06). Prawdziwy
// scripts/rodo-delete.ts przez shim SQLite (wzor: audit-2609/R-AC-01). Czat nalezy
// do LOCAL, ale wpisy w nim zapisala osoba, ktora potem skorzystala z art. 17 -
// jej wpisy wyciagu sa zanonimizowane, a pakiet ma wyjsc ze znacznikiem.
// ---------------------------------------------------------------------------

const OSOBA = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"; // syntetyczny
const OSOBA_STARA = "12121212-3434-5656-7878-909090909090"; // syntetyczny

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

describe("RODO art. 17: pakiet z wpisami zanonimizowanymi (ADR-0164, decyzja 2026-10-06)", () => {
    let msgLb = "";
    let msgStary = "";
    let wpisyOsoby: number[] = [];
    let deklaracja = 0;

    beforeAll(async () => {
        const { createServerSupabase } = await import("../lib/supabase");
        const { appendAuditEvent } = await import("../lib/audit");
        const { LOCAL_USER_ID } = await import("../lib/db/supabase-shim");
        const db = createServerSupabase() as any;
        const nowyCzat = async () =>
            ((await db.from("chats").insert({ user_id: LOCAL_USER_ID, title: "Czat RODO" }).select("id").single()).data
                .id as string);
        const zdarzenie = async (chat: string | null, actor: string | null, event_type: string, payload: Record<string, unknown>) => {
            const r = await appendAuditEvent(db, { event_type: event_type as never, actor_user_id: actor, chat_id: chat, payload });
            expect(r.ok).toBe(true);
            return (sql.prepare("select max(id) as m from audit_log").get() as { m: number }).m;
        };
        const odpowiedz = async (chat: string, content: string) =>
            (await db.from("chat_messages").insert({ chat_id: chat, role: "assistant", content, annotations: [] }).select("id").single())
                .data.id as string;

        const chat = await nowyCzat();
        wpisyOsoby.push(await zdarzenie(chat, OSOBA, "chat.message.user", { content_len: 21, file_count: 0, workflow_id: null }));
        await zdarzenie(null, null, "ring_policy.decision", { action: "allow" });
        // payload z e-mailem: w pakiecie zamaskowany
        wpisyOsoby.push(await zdarzenie(chat, OSOBA, "chat.message.user", { content_len: 8, kontakt: "ola.testowa@example.pl" }));
        msgLb = await odpowiedz(chat, "Odpowiedz w sprawie, w ktorej pisala osoba zapomniana.");
        wpisyOsoby.push(await zdarzenie(chat, OSOBA, "chat.message.assistant", { model: "model-rodo", full_text_len: 55 }));
        await zdarzenie(chat, LOCAL_USER_ID, "chat.message.user", { content_len: 4 });

        // Czat z deklaracja w STARYM formacie (bez affected_hashes_after) i
        // anonimizacja SQL-em - tak jak robila to poprzednia wersja rodo-delete.
        const chatStary = await nowyCzat();
        const stary = await zdarzenie(chatStary, OSOBA_STARA, "chat.message.user", { content_len: 6 });
        msgStary = await odpowiedz(chatStary, "Odpowiedz w starej sprawie.");
        await zdarzenie(chatStary, LOCAL_USER_ID, "chat.message.assistant", { model: "model-rodo", full_text_len: 27 });
        await zdarzenie(null, null, "audit.chain.legal_break", {
            reason: "rodo_art_17_anonymization",
            field: "actor_user_id",
            affected_count: 1,
            first_id: stary,
            last_id: stary,
            affected_ids: [stary],
            affected_ids_truncated: false,
        });
        sql.prepare("update audit_log set actor_user_id = null where id = ?").run(stary);

        await uruchomRodoDelete(OSOBA);
        deklaracja = (
            sql
                .prepare("select max(id) as m from audit_log where event_type = 'audit.chain.legal_break'")
                .get() as { m: number }
        ).m;
        expect(deklaracja).toBeGreaterThan(Math.max(...wpisyOsoby));
    });

    it("wazna deklaracja: 200, wpisy osoby ze znacznikiem, deklaracja w pakiecie, verify.py kod 3", async () => {
        const r = await pobierz(msgLb);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const w = r.json.audit_log_excerpt as Array<Record<string, any>>;
        const zMarkerem = w.filter((e) => e.legal_break);
        expect(zMarkerem.map((e) => e.id)).toEqual(wpisyOsoby);
        expect(zMarkerem.every((e) => e.legal_break.declaration_event_id === deklaracja && e.actor_user_id === null)).toBe(true);
        expect((r.json.legal_break_declarations as Array<{ id: number }>).map((d) => d.id)).toEqual([deklaracja]);
        expect((r.json.manifest.parts as Array<{ name: string }>).map((x) => x.name)).toContain("legal_break_declarations");

        const { verifyAuditBundle } = await import("../lib/audit-bundle");
        const v = verifyAuditBundle(r.json);
        expect(v.verdict, JSON.stringify(v.excerpt)).toBe("legal_break");
        expect(v.excerpt.legal_breaks).toBe(3);
        if (PYTHON) {
            const py = verifyPy(r.zip!);
            expect(py.kod, py.out).toBe(3);
            expect(py.out).toContain(`WYNIK: OK - zerwanie z mocy prawa (RODO art. 17), zadeklarowane zdarzeniem #${deklaracja}.`);
        }
        // slad wyniesienia mowi o zerwaniach
        const slad = (
            sql.prepare("select payload from audit_log where event_type = 'deliverable.bundle_export' order by id desc limit 1").get() as {
                payload: string;
            }
        ).payload;
        expect(JSON.parse(slad)).toMatchObject({ phase: "requested", legal_breaks: 3, legal_break_declaration_ids: [deklaracja] });
    });

    it("deklaracja w starym formacie: 409 excerpt_hash_mismatch (old_format)", async () => {
        const r = await pobierz(msgStary);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("excerpt_hash_mismatch");
        expect(r.body.legal_break).toEqual([
            expect.objectContaining({ status: "old_format", declaration_event_id: expect.any(Number) }),
        ]);
    });

    it("zmiana payloadu PO anonimizacji: 409 (content_differs), tylko ten wpis", async () => {
        const id = wpisyOsoby[2];
        const przed = (sql.prepare("select payload from audit_log where id = ?").get(id) as { payload: string }).payload;
        sql.prepare("update audit_log set payload = ? where id = ?").run(
            JSON.stringify({ model: "inny-model", full_text_len: 55 }),
            id,
        );
        try {
            const r = await pobierz(msgLb);
            expect(r.status).toBe(409);
            expect(r.body).toMatchObject({
                error: "excerpt_hash_mismatch",
                event_ids: [id],
                legal_break: [{ event_id: id, status: "content_differs", declaration_event_id: deklaracja }],
            });
        } finally {
            sql.prepare("update audit_log set payload = ? where id = ?").run(przed, id);
        }
        expect((await pobierz(msgLb)).status).toBe(200);
    });

    it("zmieniona sama deklaracja: nie wybiela niczego - 409 dla wszystkich wpisow osoby", async () => {
        const row = sql.prepare("select payload from audit_log where id = ?").get(deklaracja) as { payload: string };
        const p = JSON.parse(row.payload) as Record<string, unknown>;
        (p.affected_ids as number[]).push(1);
        sql.prepare("update audit_log set payload = ? where id = ?").run(JSON.stringify(p), deklaracja);
        const r = await pobierz(msgLb);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("excerpt_hash_mismatch");
        expect(r.body.event_ids).toEqual(wpisyOsoby);
    });
});
