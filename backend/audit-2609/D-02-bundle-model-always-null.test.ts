// D-02: Pakiet dowodowy (ADR-0152) podaje model_versions.model = null dla KAZDEJ
// odpowiedzi czatu, choc model jest znany i zapisany w audit_log. Przyczyna:
// lib/audit-bundle-source.ts:138-152 (modelFromAuditRows) czyta model WYLACZNIE ze
// zdarzen llm_route w wyciagu filtrowanym po chat_id (routes/audit.ts:562-566),
// a czat zapisuje llm_route BEZ chat_id (lib/chat/stream.ts:590-601 - brak chatId;
// por. C-02). Model z chat.message.assistant.payload.model jest ignorowany.
// Skutek: "wersje modelu" - jedna z czterech obietnic pakietu (AGENTS.md, ADR-0152) -
// sa cicho puste; odbiorca nie wie, jaki model napisal opinie.
// Oczekiwane: model_versions.model = model, ktory wygenerowal odpowiedz.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d02-${Date.now()}.db`);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d02-zip-"));
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

    const { appendLlmRouteEvent } = await import("../src/lib/routing");
    await appendAuditEvent(db, {
        event_type: "chat.message.user",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { content_len: 20, file_count: 0, workflow_id: null },
    });
    // Dokladnie jak lib/chat/stream.ts:590 (allow, bez chatId).
    await appendLlmRouteEvent(db, {
        actorUserId: LOCAL_USER_ID,
        caseId: null,
        model: "gemini-3-flash-preview",
        provider: "google",
        egress: "eu",
        classification: "internal",
        action: "allow",
        reason: "eu-within-allowed-zone",
    } as any);
    const msg = await db
        .from("chat_messages")
        .insert({ chat_id: chatId, role: "assistant", content: "Opinia testowa.", annotations: [] })
        .select("id")
        .single();
    assistantMsgId = msg.data.id as string;
    await appendAuditEvent(db, {
        event_type: "chat.message.assistant",
        actor_user_id: LOCAL_USER_ID,
        chat_id: chatId,
        payload: { model: "gemini-3-flash-preview", full_text_len: 15 },
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

describe("D-02 pakiet dowodowy - wersja modelu", () => {
    it("model_versions.model to model, ktory napisal odpowiedz", async () => {
        const res = await fetch(`${base}/api/audit/bundle/${assistantMsgId}`);
        expect(res.status).toBe(200);
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
        const jsonName = Object.keys(zip.files).find((n) => n.endsWith(".json"))!;
        const bundle = JSON.parse(await zip.file(jsonName)!.async("string"));
        expect(bundle.model_versions.model).toBe("gemini-3-flash-preview");
    });
});
