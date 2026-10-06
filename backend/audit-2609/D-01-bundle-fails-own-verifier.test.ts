// D-01: Pakiet dowodowy (GET /api/audit/bundle/:messageId, ADR-0152) dla ZWYKLEGO
// czatu z dwiema turami, miedzy ktorymi w kancelarii zaszlo cokolwiek innego (upload
// dokumentu -> input_security_scan bez chat_id, inny czat, bramka MCP), NIE przechodzi
// wlasnego weryfikatora: verify.py z tego samego ZIP zwraca kod 1 "naruszony"
// ("ciaglosc lancucha: PRZERWANA ... wpis ze srodka usunieto"). Przyczyna:
// routes/audit.ts:562-566 bierze wyciag audit_log filtrowany po chat_id (wpisy NIE
// sa kolejnymi ogniwami globalnego lancucha), a verify_chain_links
// (lib/audit-verifier-assets.ts:694-722, JS: :278-292) wymaga, by kazdy wpis
// wskazywal na poprzedni wpis W PLIKU. Nienaruszony dowod jest raportowany
// odbiorcy (klient/regulator) jako sfalszowany. W realnym czacie przerwa jest ZAWSZE,
// nawet przy jednej turze: llm_route (lib/chat/stream.ts:590, bez chat_id) lezy w
// lancuchu miedzy chat.message.user a chat.message.assistant.
// Oczekiwane: nienaruszony pakiet prosto z eksportu -> verify.py kod 0.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execFileSync } from "child_process";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d01-${Date.now()}.db`);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d01-zip-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;

let server: http.Server;
let base = "";
let assistantMsgId = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { auditRouter } = await import("../src/routes/audit");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { appendAuditEvent } = await import("../src/lib/audit");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();

    const chat = await db
        .from("chats")
        .insert({ user_id: LOCAL_USER_ID, title: "Czat testowy" })
        .select("id")
        .single();
    const chatId = chat.data.id as string;

    // Tura 1
    await appendAuditEvent(db, {
        event_type: "chat.message.user",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { content_len: 20, file_count: 0, workflow_id: null },
    });
    await appendAuditEvent(db, {
        event_type: "chat.message.assistant",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { model: "gemini-3-flash-preview", full_text_len: 100 },
    });
    // Miedzy turami: mecenas wgrywa dokument (ingest -> input_security_scan, bez chat_id).
    await appendAuditEvent(db, {
        event_type: "input_security_scan",
        actor_user_id: LOCAL_USER_ID,
        document_id: "doc-syntetyczny",
        payload: { report_id: "r1", action: "allowed", findings: [] },
    });
    // Tura 2
    await appendAuditEvent(db, {
        event_type: "chat.message.user",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { content_len: 30, file_count: 0, workflow_id: null },
    });
    const msg = await db
        .from("chat_messages")
        .insert({
            chat_id: chatId,
            role: "assistant",
            content: "Opinia dla Jana Testowego: roszczenie przedawnione.",
            annotations: [],
        })
        .select("id")
        .single();
    assistantMsgId = msg.data.id as string;
    await appendAuditEvent(db, {
        event_type: "chat.message.assistant",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { model: "gemini-3-flash-preview", full_text_len: 52 },
    });

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
    fs.rmSync(outDir, { recursive: true, force: true });
});

describe("D-01 pakiet dowodowy vs jego wlasny weryfikator", () => {
    it("nienaruszony pakiet z eksportu przechodzi verify.py (kod 0)", async () => {
        const res = await fetch(`${base}/api/audit/bundle/${assistantMsgId}`);
        expect(res.status).toBe(200);
        const buf = Buffer.from(await res.arrayBuffer());
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buf);
        const names = Object.keys(zip.files);
        expect(names).toContain("verify.py");
        expect(names).toContain("SPRAWDZ-TEN-PLIK.html");
        const jsonName = names.find((n) => n.endsWith(".json"))!;
        for (const n of ["verify.py", jsonName]) {
            fs.writeFileSync(path.join(outDir, n), await zip.file(n)!.async("nodebuffer"));
        }
        let code = 0;
        let out = "";
        try {
            out = execFileSync("python3", [path.join(outDir, "verify.py"), path.join(outDir, jsonName)], {
                encoding: "utf8",
            });
        } catch (e: any) {
            code = e.status;
            out = String(e.stdout ?? "");
        }
        expect(code, out).toBe(0);
    });
});
