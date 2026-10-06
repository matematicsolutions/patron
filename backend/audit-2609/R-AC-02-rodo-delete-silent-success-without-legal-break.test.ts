// R-AC-02: rodo-delete.ts zrywa lancuch (UPDATE actor_user_id = NULL) ZANIM zapisze
// deklaracje `audit.chain.legal_break`, a wynik tego zapisu ignoruje:
//   scripts/rodo-delete.ts:157-160  UPDATE (zerwanie) - nieodwracalne,
//   scripts/rodo-delete.ts:173      `await appendAuditEvent(...)` - wynik { ok:false } wyrzucony,
//   scripts/rodo-delete.ts:187-190  i tak drukuje "zapisano zdarzenie audit.chain.legal_break",
//   scripts/rodo-delete.ts:207      "[rodo:delete] OK", kod wyjscia 0.
// appendAuditEvent z zalozenia NIE rzuca (zwraca ok:false), wiec main().catch tego nie lapie.
// Realny przypadek: serwer Postgres bez migracji 025 (CHECK bez legal_break - komentarz
// DOWN w 025 sam to opisuje), przegrany wyscig (8 prob), blad odczytu ostatniego hasha.
// Skutek: lancuch zerwany BEZ deklaracji (weryfikator: BLOKADA hash_mismatch, nie do
// odroznienia od sabotazu - dokladnie to, czemu ADR-0164 mial zapobiec), a Operator
// dostaje komunikat, ze deklaracja zostala zapisana.
// Oczekiwane: nieudany zapis deklaracji = kod wyjscia != 0 i brak falszywego "zapisano".
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-rac02-${process.pid}-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;
process.env.SUPABASE_URL = "http://synthetic.invalid";
process.env.SUPABASE_SECRET_KEY = "synthetic";

// Klient bazy = shim SQLite, z jedna roznica: CHECK event_type bez legal_break
// (jak Postgres sprzed migracji 025). Kod bledu jak w PostgreSQL (23514).
vi.mock("@supabase/supabase-js", async () => {
    const { createSqliteClient } = await import("../src/lib/db/supabase-shim");
    return {
        createClient: () => {
            const real = createSqliteClient();
            return {
                ...real,
                from(table: string) {
                    const q = real.from(table) as any;
                    if (table === "audit_log") {
                        const orig = q.insert.bind(q);
                        q.insert = (row: { event_type?: string }) =>
                            row.event_type === "audit.chain.legal_break"
                                ? Promise.resolve({
                                      data: null,
                                      error: {
                                          code: "23514",
                                          message:
                                              'new row for relation "audit_log" violates check constraint "audit_log_event_type_whitelist"',
                                      },
                                  })
                                : orig(row);
                    }
                    return q;
                },
            };
        },
    };
});

afterAll(async () => {
    const { closeDb } = await import("../src/lib/db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
});

const USER = "11111111-2222-3333-4444-555555555555"; // syntetyczny

describe("R-AC-02 rodo-delete a nieudany zapis deklaracji legal_break", () => {
    it("nieudany zapis audit.chain.legal_break nie moze konczyc sie komunikatem sukcesu i kodem 0", async () => {
        const { appendAuditEvent } = await import("../src/lib/audit");
        const { createServerSupabase } = await import("../src/lib/supabase");
        const { getDb } = await import("../src/lib/db/sqlite-connection");
        const { verifyAuditChain } = await import("../src/lib/audit-chain-verify");
        const db = createServerSupabase();
        for (let i = 0; i < 3; i++) {
            const r = await appendAuditEvent(db, { event_type: "chat.message.user", actor_user_id: USER, payload: { i } });
            expect(r.ok).toBe(true);
        }

        const exits: number[] = [];
        vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
            exits.push(c ?? 0);
            return undefined as never;
        }) as never);
        const logs: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
        process.argv = ["node", "rodo-delete.ts", "--user", USER, "--confirm"];
        // Scenariusz to tryb SERWEROWY (Postgres bez migracji 025). Od 2026-10-06 skrypt
        // w trybie SQLite idzie przez createServerSupabase (desktop, R5), wiec awarie
        // wstrzyknieta w createClient trzeba podac sciezka serwerowa - inaczej test
        // mierzylby zdrowa baze SQLite, a nie przypadek z tytulu.
        process.env.PATRON_DB_BACKEND = "supabase";
        await import("../scripts/rodo-delete");
        process.env.PATRON_DB_BACKEND = "sqlite";
        await vi.waitFor(
            () => expect(logs.some((l) => l.includes("[rodo:delete] OK")) || exits.length > 0).toBe(true),
            { timeout: 10_000 },
        );

        const rows = (getDb().prepare("select * from audit_log order by id").all() as any[]).map((r) => ({
            ...r,
            payload: JSON.parse(r.payload),
        }));
        const rep = verifyAuditChain(rows, { guardAfterId: 0 });
        const stan = `werdykt=${rep.verdict}, znaleziska=${rep.findings.map((f) => `${f.kind}[${f.ids}]`).join(" ")}, legal_break w bazie=${rows.some((r) => r.event_type === "audit.chain.legal_break")}`;

        // ZADANE: skrypt nie twierdzi, ze zapisal deklaracje, ktorej nie ma.
        expect(
            logs.filter((l) => l.includes("zapisano zdarzenie audit.chain.legal_break")),
            `falszywy komunikat; ${stan}`,
        ).toEqual([]);
        // ZADANE: kod wyjscia != 0 (Operator i automat widza porazke).
        expect(exits.some((c) => c !== 0), `kody exit: [${exits}]; ${stan}`).toBe(true);
    });
});
