// C-05: Jedyny weryfikator CALEGO lancucha (npm run audit:verify ->
// scripts/verify-audit-chain.ts) laczy sie wylacznie z Supabase (createClient,
// :15-35) i wymaga SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY. W domyslnej
// konfiguracji desktop (SQLite, ADR-0053) konczy sie kodem 2 bez sprawdzenia
// czegokolwiek, a w trybie serwerowym skonfigurowanym wg .env.example
// (SUPABASE_SECRET_KEY) tez nie znajduje klucza. ADR-0001 obiecuje, ze modyfikacje
// wykrywa "npm run audit:verify ... w sekundy"; w kodzie aplikacji nic innego nie
// przelicza computeAuditHash (patrz C-04: Merkle/eksport tego nie robia).
// Oczekiwane: audit:verify weryfikuje baze desktopowa (PATRON_DB_PATH): kod 0 dla
// nienaruszonego lancucha i kod 1 po zmianie payloadu wpisu.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c05-${Date.now()}.db`);
const backendDir = path.resolve(__dirname, "..");

function runVerify(extraEnv: Record<string, string> = {}) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !k.startsWith("SUPABASE")) env[k] = v;
    }
    Object.assign(env, { PATRON_DB_PATH: tmp, ...extraEnv });
    delete env.PATRON_DB_BACKEND; // domyslnie sqlite (lib/supabase.ts:12-14)
    const r = spawnSync(
        process.execPath,
        [path.join(backendDir, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/verify-audit-chain.ts"],
        { cwd: backendDir, env, encoding: "utf8", timeout: 120_000 },
    );
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { appendAuditEvent } = await import("../src/lib/audit");
    const db: any = createServerSupabase();
    for (let i = 1; i <= 3; i++) {
        const r = await appendAuditEvent(db, { event_type: "llm_route", actor_user_id: "u-test", payload: { n: i } });
        expect(r.ok).toBe(true);
    }
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
});

afterAll(() => {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

describe("C-05 audit:verify w domyslnej konfiguracji desktop", () => {
    it("weryfikuje nienaruszony lancuch w bazie SQLite (kod 0)", () => {
        const r = runVerify();
        expect(r.code, r.out).toBe(0);
    });

    it("tryb serwerowy skonfigurowany wg .env.example (SUPABASE_SECRET_KEY) nie konczy sie bledem konfiguracji", () => {
        // Adres nieosiagalny celowo: oczekujemy bledu ODCZYTU (2 z komunikatem read failed),
        // a nie odmowy startu z powodu innej nazwy zmiennej niz reszta backendu.
        const r = runVerify({
            PATRON_DB_BACKEND: "supabase",
            SUPABASE_URL: "http://127.0.0.1:9",
            SUPABASE_SECRET_KEY: "dummy",
        });
        expect(r.out).not.toContain("Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY");
    });
});
