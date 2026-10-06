// D-03: RODO "zapomnij sprawe" (POST /rodo/forget-case, ADR-0061) zwraca 200 i raport
// storageFilesDeleted = 1, choc plik akt NADAL lezy na dysku, gdy system operacyjny
// odmowi usuniecia (EBUSY/EPERM - na Windows plik trzymany przez antywirus, indeksator,
// kopie zapasowa). lib/storage.ts:152-158 (deleteFile, tryb fs) polyka KAZDY blad
// unlink jako "ENOENT", a lib/rodo/forget.ts:107-114 liczy storageFilesDeleted++ po
// kazdym wywolaniu. Rekordy documents/document_versions sa potem kasowane, wiec plik
// staje sie sierota bez sciezki w bazie - nie da sie go juz znalezc z aplikacji.
// Sciezka UI (DELETE /projects/:id, routes/projects.ts:333-339 - jedyna, ktorej uzywa
// frontend, patronApi.ts:341-342) zwraca 204 i raport w ogole nie trafia do uzytkownika.
// Oczekiwane: plik, ktorego nie udalo sie usunac, NIE jest liczony jako usuniety,
// a odpowiedz jawnie sygnalizuje czesciowa porazke (nie 200 "sukces").
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-d03-${Date.now()}.db`);
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d03-store-"));
const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d03-brain-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = tmp;
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = storeDir;
process.env.PATRON_BRAIN_DIR = brainDir;

let server: http.Server;
let base = "";
let projectId = "";
let project2Id = "";
let lockedFile = "";
let lockedFile2 = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { rodoRouter } = await import("../src/routes/rodo");
    const { projectsRouter } = await import("../src/routes/projects");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { uploadFile } = await import("../src/lib/storage");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    const db: any = createServerSupabase();

    const mkCase = async (name: string) => {
        const pid = (await db.from("projects").insert({ user_id: LOCAL_USER_ID, name }).select("id").single()).data.id;
        const docId = (
            await db
                .from("documents")
                .insert({ project_id: pid, user_id: LOCAL_USER_ID, filename: "pozew-jan-testowy.docx", file_type: "docx", status: "ready" })
                .select("id")
                .single()
        ).data.id;
        const key = `documents/${LOCAL_USER_ID}/${docId}/source.docx`;
        await uploadFile(key, new TextEncoder().encode("Pozew Jana Testowego, PESEL 90010112349").buffer as ArrayBuffer, "application/octet-stream");
        await db.from("document_versions").insert({ document_id: docId, storage_path: key, source: "upload", version_number: 1 });
        return { pid, file: path.join(storeDir, key) };
    };
    const c1 = await mkCase("Sprawa Testowy");
    const c2 = await mkCase("Sprawa Testowa 2");
    projectId = c1.pid;
    lockedFile = c1.file;
    project2Id = c2.pid;
    lockedFile2 = c2.file;

    // System odmawia usuniecia tego jednego pliku (plik zablokowany przez inny proces).
    const realUnlink = fs.promises.unlink;
    vi.spyOn(fs.promises, "unlink").mockImplementation(async (p: any) => {
        if ([lockedFile, lockedFile2].map((f) => path.resolve(f)).includes(path.resolve(String(p)))) {
            const e: NodeJS.ErrnoException = new Error("EBUSY: resource busy or locked, unlink");
            e.code = "EBUSY";
            throw e;
        }
        return realUnlink(p);
    });

    const app = express();
    app.use(express.json());
    app.use("/rodo", rodoRouter);
    app.use("/projects", projectsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    vi.restoreAllMocks();
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    fs.rmSync(storeDir, { recursive: true, force: true });
    fs.rmSync(brainDir, { recursive: true, force: true });
});

describe("D-03 forget-case: nieusuniety plik akt", () => {
    it("plik zostal na dysku -> raport go nie liczy i odpowiedz nie jest cichym sukcesem", async () => {
        const res = await fetch(`${base}/rodo/forget-case`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project_id: projectId, confirm: true }),
        });
        const body = await res.json();
        expect(fs.existsSync(lockedFile)).toBe(true); // warunek scenariusza
        const msg = `status=${res.status} body=${JSON.stringify(body)}`;
        expect(body.storageFilesDeleted, msg).toBe(0);
        expect(res.status, msg).not.toBe(200);
    });
    it("sciezka UI (DELETE /projects/:id): plik zostal -> odpowiedz nie jest 204 bez slowa", async () => {
        const res = await fetch(`${base}/projects/${project2Id}`, { method: "DELETE" });
        expect(fs.existsSync(lockedFile2)).toBe(true); // warunek scenariusza
        expect(res.status, `status=${res.status}`).not.toBe(204);
    });
});
