// D-04: RODO "zapomnij sprawe" (POST /rodo/forget-case) zwraca 200 i raport kasacji,
// choc NIC nie zostalo usuniete, gdy zapisy do bazy koncza sie bledem (SQLITE_BUSY -
// inny proces trzyma blokade zapisu dluzej niz busy_timeout; analogicznie SQLITE_FULL
// przy pelnym dysku). Shim zwraca bledy jako { error } (lib/db/supabase-shim.ts:655-657),
// a lib/rodo/forget.ts:61-156 nie sprawdza `error` ANI JEDNEGO zapytania; route
// (routes/rodo.ts:74-78) nie sprawdza tez wyniku appendAuditEvent. Skutek: mecenas
// dostaje "sukces", sprawa, czat i wiadomosci zostaja w bazie, a w hash-chain nie ma
// nawet sladu proby. (busy_timeout skrocony w tescie do 100 ms tylko po to, by nie
// czekac 5 s na kazde zapytanie - semantyka ta sama.)
// Oczekiwane: blad zapisu przy kasacji -> odpowiedz != 200 z informacja o porazce.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d04-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d04-store-"));
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d04-brain-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = storeDir;
process.env.PATRON_BRAIN_DIR = brainDir;

let server: http.Server;
let base = "";
let projectId = "";
let other: any;

beforeAll(async () => {
    const express = (await import("express")).default;
    const { rodoRouter } = await import("../src/routes/rodo");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();

    projectId = (
        await db.from("projects").insert({ user_id: LOCAL_USER_ID, name: "Sprawa Testowy" }).select("id").single()
    ).data.id;
    const chatId = (
        await db.from("chats").insert({ project_id: projectId, user_id: LOCAL_USER_ID, title: "Rozwod Jana Testowego" }).select("id").single()
    ).data.id;
    await db.from("chat_messages").insert({ chat_id: chatId, role: "user", content: "Jan Testowy, PESEL 90010112349 - czy pozew o rozwod?" });

    // Inny proces trzyma blokade zapisu (druga instancja/kopia zapasowa/przegladarka bazy).
    const { getDb } = await import("../src/lib/db/sqlite-connection");
    getDb().pragma("busy_timeout = 100");
    const Database = (await import("better-sqlite3")).default;
    other = new Database(tmp);
    other.prepare("BEGIN IMMEDIATE").run();

    const app = express();
    app.use(express.json());
    app.use("/rodo", rodoRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    try { other?.prepare("ROLLBACK").run(); other?.close(); } catch { /* ignore */ }
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(storeDir, { recursive: true, force: true });
    fs.rmSync(brainDir, { recursive: true, force: true });
});

describe("D-04 forget-case: bledy zapisu bazy", () => {
    it("zadne DELETE sie nie udalo -> nie wolno zwrocic 200", async () => {
        const res = await fetch(`${base}/rodo/forget-case`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project_id: projectId, confirm: true }),
        });
        const body = await res.json();
        other.prepare("ROLLBACK").run();
        const { createServerSupabase } = await import("../src/lib/supabase");
        const db: any = createServerSupabase();
        const { data: still } = await db.from("projects").select("id").eq("id", projectId);
        const { data: msgs } = await db.from("chat_messages").select("id");
        const msg = `status=${res.status} body=${JSON.stringify(body)} projekt_w_bazie=${(still ?? []).length} wiadomosci=${(msgs ?? []).length}`;
        expect((still ?? []).length, msg).toBe(1); // warunek scenariusza: nic nie usunieto
        expect(res.status, msg).not.toBe(200);
    });
});
