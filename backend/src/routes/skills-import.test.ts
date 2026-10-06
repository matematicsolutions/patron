// B-10: import paczki skilla - (a) napis w polu signature nie jest podpisem,
// (b) skill z egress do chmury nie wlacza sie bez jawnej zgody (confirm_egress).
// Prawdziwa baza SQLite w katalogu tymczasowym, autoryzacja zamockowana, zero sieci.
// Dane syntetyczne.

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "skills-import-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");

vi.mock("../middleware/auth", () => ({
    requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
        res.locals.userId = "u1";
        next();
    },
}));

let server: http.Server;
let base = "";
let store: typeof import("../lib/skills/store");
let db: ReturnType<typeof import("../lib/supabase").createServerSupabase>;

beforeAll(async () => {
    const express = (await import("express")).default;
    const { skillsRouter } = await import("./skills");
    store = await import("../lib/skills/store");
    db = (await import("../lib/supabase")).createServerSupabase();
    const app = express();
    app.use(express.json());
    app.use("/api/skills", skillsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    (await import("../lib/db/sqlite-connection")).closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

function paczka(id: string, extra: Record<string, unknown> = {}) {
    return {
        manifest_version: 1,
        id,
        name: "Styl pism",
        version: "1.0.0",
        surface: "draft-stage",
        prompt: { system: "Popraw styl pisma procesowego.", user: "{{text}}" },
        ...extra,
    };
}

async function importuj(body: Record<string, unknown>) {
    const res = await fetch(`${base}/api/skills/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function aktywne(): Promise<string[]> {
    return (await store.loadEnabledDraftStageSkills(db)).map((s) => s.id);
}

describe("B-10 POST /skills/import - zgoda na egress", () => {
    it("cloud-allowed bez confirm_egress: import jako WYLACZONY + jawne requires_egress_consent", async () => {
        const r = await importuj({ manifest: paczka("chmura-bez-zgody", { egress: "cloud-allowed" }) });
        expect(r.status).toBe(201);
        expect(r.body).toMatchObject({ id: "chmura-bez-zgody", enabled: false, requires_egress_consent: true });
        expect(await aktywne()).not.toContain("chmura-bez-zgody");
    });

    it("cloud-allowed z confirm_egress=true: aktywny", async () => {
        const r = await importuj({
            manifest: paczka("chmura-ze-zgoda", { egress: "cloud-allowed" }),
            confirm_egress: true,
        });
        expect(r.status).toBe(201);
        expect(r.body).toMatchObject({ enabled: true, requires_egress_consent: false });
        expect(await aktywne()).toContain("chmura-ze-zgoda");
    });

    it("zgoda tylko jako boolean true - napis 'true' albo 1 to brak zgody (fail-closed)", async () => {
        for (const [i, zgoda] of ["true", 1, "tak"].entries()) {
            const id = `chmura-zgoda-zly-typ-${i}`;
            const r = await importuj({ manifest: paczka(id, { egress: "cloud-allowed" }), confirm_egress: zgoda });
            expect(r.body).toMatchObject({ enabled: false, requires_egress_consent: true });
            expect(await aktywne()).not.toContain(id);
        }
    });

    it("re-import wlaczonego skilla cloud-allowed bez zgody go wylacza (upsert moze podmienic prompt)", async () => {
        await importuj({ manifest: paczka("chmura-reimport", { egress: "cloud-allowed" }), confirm_egress: true });
        expect(await aktywne()).toContain("chmura-reimport");
        const r = await importuj({
            manifest: paczka("chmura-reimport", {
                egress: "cloud-allowed",
                version: "1.0.1",
                prompt: { system: "Inny prompt.", user: "{{text}}" },
            }),
        });
        expect(r.body).toMatchObject({ enabled: false, requires_egress_consent: true });
        expect(await aktywne()).not.toContain("chmura-reimport");
    });

    it("kontrola: no-egress wlacza sie bez zgody", async () => {
        const r = await importuj({ manifest: paczka("lokalny-bez-zgody") });
        expect(r.body).toMatchObject({ enabled: true, requires_egress_consent: false });
        expect(await aktywne()).toContain("lokalny-bez-zgody");
    });

    it("PATCH dalej wymaga zgody przy wlaczaniu skilla cloud-allowed", async () => {
        await importuj({ manifest: paczka("chmura-patch", { egress: "cloud-allowed" }) });
        const bez = await fetch(`${base}/api/skills/chmura-patch`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
        });
        expect(bez.status).toBe(409);
        const ze = await fetch(`${base}/api/skills/chmura-patch`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true, confirm_egress: true }),
        });
        expect(ze.status).toBe(200);
        expect(await aktywne()).toContain("chmura-patch");
    });
});

describe("B-10 podpis paczki nie jest weryfikowany - signed=false wszedzie", () => {
    it("dowolny napis w signature: API mowi 'unverified', audyt dostaje signed=false", async () => {
        const r = await importuj({
            manifest: paczka("falszywy-podpis", { signature: "nie-jest-to-podpis", publisher: "MateMatic" }),
        });
        expect(r.body).toMatchObject({ signed: false, signature_status: "unverified" });
        const s = (await store.loadEnabledDraftStageSkills(db)).find((x) => x.id === "falszywy-podpis")!;
        expect(store.toSkillAuditRecord(s).signed).toBe(false);

        const lista = (await (await fetch(`${base}/api/skills`)).json()) as {
            installed: Array<{ id: string; signed: boolean; signature_status: string }>;
        };
        expect(lista.installed.find((x) => x.id === "falszywy-podpis")).toMatchObject({
            signed: false,
            signature_status: "unverified",
        });
    });

    it("paczka bez podpisu: signature_status 'absent'", async () => {
        const r = await importuj({ manifest: paczka("bez-podpisu") });
        expect(r.body).toMatchObject({ signed: false, signature_status: "absent" });
    });
});
