// C-04: Eksport zdarzenia audytowego (GET /api/audit/export/:eventId, ADR-0047/0142)
// wydaje paczke, ktora dolaczony weryfikator (verify.py / SPRAWDZ-TEN-PLIK.html)
// uznaje za NIENARUSZONA, choc tresc wpisu (payload / ts / event_type) zmieniono w
// bazie po fakcie. Dowod Merkle jest liczony z KOLUMNY hash (lib/audit-merkle-roots.ts:48-58,
// fetchProofForEvent :262-293), a nie z tresci, i ani endpoint (routes/audit.ts:274-330),
// ani weryfikator nie przeliczaja computeAuditHash z tresci wiersza. Tymczasem
// instrukcja paczki (lib/audit-pack.ts:74) i verify.py (audit-verifier-assets.ts:700-702)
// obiecuja: "Merkle proof bundle weryfikuje ze event nie zostal zmieniony w audit_log".
// Oczekiwane: dla wpisu, ktorego tresc nie zgadza sie z jego hashem, eksport odmawia
// albo weryfikator z archiwum zwraca "naruszony" (kod wyjscia != 0).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execFileSync } from "child_process";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c04-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

let server: http.Server;
let base = "";
let db: any;

beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const express = (await import("express")).default;
    const { auditRouter } = await import("../src/routes/audit");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { appendAuditEvent } = await import("../src/lib/audit");
    const { computeAndStoreRoot } = await import("../src/lib/audit-merkle-roots");
    db = createServerSupabase();
    // Piec decyzji straznika egress: model chmurowy ZABLOKOWANY dla sprawy objetej tajemnica.
    for (let i = 1; i <= 5; i++) {
        const r = await appendAuditEvent(db, {
            event_type: "llm_route",
            actor_user_id: "u-test",
            payload: { model: "gemini-x", decision: "block", classification: "attorney_client_privileged", n: i },
        });
        expect(r.ok).toBe(true);
    }
    const root = await computeAndStoreRoot(db, 1, 5, "service");
    expect(root.ok).toBe(true);

    const app = express();
    app.use(express.json());
    app.use("/api/audit", auditRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

async function exportAndVerify(eventId: number): Promise<{ status: number; pyExit: number | null; out: string }> {
    const r = await fetch(`${base}/api/audit/export/${eventId}`);
    if (r.status !== 200) return { status: r.status, pyExit: null, out: await r.text() };
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(Buffer.from(await r.arrayBuffer()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c04-"));
    zip.extractAllTo(dir, true);
    const json = fs.readdirSync(dir).find((f) => f.endsWith(".json"))!;
    try {
        const out = execFileSync("python3", [path.join(dir, "verify.py"), path.join(dir, json)], { stdio: "pipe" }).toString();
        return { status: 200, pyExit: 0, out };
    } catch (e: any) {
        return { status: 200, pyExit: e.status, out: String(e.stdout) };
    }
}

describe("C-04 eksport paczki audytowej po manipulacji trescia wpisu", () => {
    it("sanity: nienaruszony wpis przechodzi weryfikacje z archiwum", async () => {
        const v = await exportAndVerify(2);
        expect(v.status).toBe(200);
        expect(v.pyExit).toBe(0);
    });

    it("zmiana payloadu wpisu SQL-em (block -> allow) nie przechodzi jako nienaruszona", async () => {
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        getDb()
            .prepare("update audit_log set payload = ? where id = 3")
            .run(JSON.stringify({ model: "gemini-x", decision: "allow", classification: "public", n: 3 }));
        const v = await exportAndVerify(3);
        // ZADANE: albo eksport odmawia, albo weryfikator z archiwum mowi "naruszony".
        const detected = v.status !== 200 || v.pyExit !== 0;
        expect(detected, `status=${v.status} verify.py exit=${v.pyExit}\n${v.out}`).toBe(true);
    });
});
