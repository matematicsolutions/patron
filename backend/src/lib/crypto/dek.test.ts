// Testy DEK / envelope (ADR-0138). Swieza tymczasowa baza SQLite per uruchomienie.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// `any`: shim bez generyka schematu (jak supabase-shim.test.ts).
let db: any;
let mod: typeof import("./dek");
const tmp = path.join(os.tmpdir(), `patron-dek-test-${Date.now()}.db`);
const KEK_SECRET = "test-kek-secret-32+chars-aaaaaaaaaa";

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    process.env.PATRON_FIELD_ENCRYPTION = "on";
    process.env.PATRON_FIELD_ENCRYPTION_KEK = KEK_SECRET;
    const supa = await import("../supabase");
    db = supa.createServerSupabase();
    mod = await import("./dek");
});

beforeEach(() => {
    process.env.PATRON_FIELD_ENCRYPTION_KEK = KEK_SECRET;
    mod.clearDekCache();
});

afterAll(async () => {
    const { closeDb } = await import("../db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

describe("isFieldEncryptionEnabled", () => {
    it("on => true; brak/inne => false", () => {
        const prev = process.env.PATRON_FIELD_ENCRYPTION;
        process.env.PATRON_FIELD_ENCRYPTION = "on";
        expect(mod.isFieldEncryptionEnabled()).toBe(true);
        process.env.PATRON_FIELD_ENCRYPTION = "true";
        expect(mod.isFieldEncryptionEnabled()).toBe(false);
        delete process.env.PATRON_FIELD_ENCRYPTION;
        expect(mod.isFieldEncryptionEnabled()).toBe(false);
        process.env.PATRON_FIELD_ENCRYPTION = prev;
    });
});

describe("loadKek: fail-loud", () => {
    it("brak PATRON_FIELD_ENCRYPTION_KEK -> rzuca", () => {
        delete process.env.PATRON_FIELD_ENCRYPTION_KEK;
        expect(() => mod.loadKek()).toThrow();
    });

    it("KEK ma 32B (HKDF-SHA256)", () => {
        expect(mod.loadKek().length).toBe(32);
    });

    it("KEK deterministyczny dla tego samego sekretu (warunek odwijania DEK)", () => {
        process.env.PATRON_FIELD_ENCRYPTION_KEK = "secret-A-aaaaaaaaaaaaaaaaaaaa";
        const k1 = mod.loadKek();
        const k2 = mod.loadKek();
        expect(k1.equals(k2)).toBe(true);
        process.env.PATRON_FIELD_ENCRYPTION_KEK = "secret-B-bbbbbbbbbbbbbbbbbbbb";
        expect(mod.loadKek().equals(k1)).toBe(false);
    });
});

describe("getOrCreateDek: envelope", () => {
    it("tworzy DEK 32B i przechowuje go OWINIETEGO (nie plaintext)", async () => {
        const dek = await mod.getOrCreateDek(db, "tenant-1");
        expect(dek.length).toBe(32);

        const { data } = await db
            .from("encryption_keys")
            .select("wrapped_dek")
            .eq("tenant_id", "tenant-1")
            .maybeSingle();
        const wrapped = data.wrapped_dek as string;
        // W bazie jest ciphertext fc1:..., NIE goly DEK.
        expect(wrapped.startsWith("fc1:")).toBe(true);
        expect(wrapped).not.toContain(dek.toString("base64"));
    });

    it("drugie wywolanie zwraca TEN SAM DEK (odwija z bazy po wyczyszczeniu cache)", async () => {
        const a = await mod.getOrCreateDek(db, "tenant-2");
        mod.clearDekCache();
        const b = await mod.getOrCreateDek(db, "tenant-2");
        expect(b.equals(a)).toBe(true);
        // tylko jeden wiersz (nie zduplikowano)
        const { data } = await db
            .from("encryption_keys")
            .select("id")
            .eq("tenant_id", "tenant-2");
        expect((data ?? []).length).toBe(1);
    });

    it("rozni tenanci -> rozne DEK", async () => {
        const a = await mod.getOrCreateDek(db, "tenant-A");
        const b = await mod.getOrCreateDek(db, "tenant-B");
        expect(b.equals(a)).toBe(false);
    });

    it("bez KEK -> fail-loud", async () => {
        delete process.env.PATRON_FIELD_ENCRYPTION_KEK;
        mod.clearDekCache();
        await expect(mod.getOrCreateDek(db, "tenant-3")).rejects.toThrow();
    });
});
