// Testy agregatu liczników audit_log per event_type (lib/db/audit-log-counts).
//
// Dwa kontrakty, ktore latwo cicho zlamac:
//   1. wynik jest PELNA lista typow (zera dla typow bez wpisow) - metryka
//      Prometheusa ma staly zestaw serii, znikajaca seria to nie "zero",
//      tylko dziura w wykresie;
//   2. koszt: sciezka SQLite to JEDNO zapytanie (GROUP BY), sciezka PostgREST
//      to JEDNA FALA rownoleglych COUNT-ow - a nie N rund w szeregu. Dokladnie
//      ta petla urosla 7 -> 21 zapytan na scrape po naprawie parytetu listy.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TYPY = ["chat.message.user", "llm_route", "rodo.export"] as const;

let countAuditLogByEventType: typeof import("./audit-log-counts").countAuditLogByEventType;
// `any`: shim rzutowany na SupabaseClient - luzny typ w tescie jest celowy.
let db: any;
let appendAuditEvent: typeof import("../audit").appendAuditEvent;
const tmp = path.join(os.tmpdir(), `patron-counts-test-${Date.now()}.db`);

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const supa = await import("../supabase");
    db = supa.createServerSupabase();
    ({ appendAuditEvent } = await import("../audit"));
    ({ countAuditLogByEventType } = await import("./audit-log-counts"));
});

afterAll(async () => {
    const { closeDb } = await import("./sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

describe("countAuditLogByEventType - sciezka SQLite (GROUP BY)", () => {
    it("zwraca PELNA liste typow z zerami, gdy tabela pusta", async () => {
        const out = await countAuditLogByEventType(db, TYPY);
        expect(Object.keys(out).sort()).toEqual([...TYPY].sort());
        expect(Object.values(out)).toEqual([0, 0, 0]);
    });

    it("liczy wpisy per typ i nie miesza typow", async () => {
        for (let i = 0; i < 3; i++) {
            await appendAuditEvent(db, {
                event_type: "llm_route",
                actor_user_id: null,
                payload: { i },
            });
        }
        await appendAuditEvent(db, {
            event_type: "rodo.export",
            actor_user_id: null,
            payload: {},
        });
        const out = await countAuditLogByEventType(db, TYPY);
        expect(out).toEqual({
            "chat.message.user": 0,
            llm_route: 3,
            "rodo.export": 1,
        });
    });

    it("typ spoza podanej listy nie przecieka do wyniku", async () => {
        await appendAuditEvent(db, {
            event_type: "admin.access.metrics",
            actor_user_id: null,
            payload: {},
        });
        const out = await countAuditLogByEventType(db, TYPY);
        expect(Object.keys(out).sort()).toEqual([...TYPY].sort());
    });
});

describe("countAuditLogByEventType - sciezka PostgREST (jedna fala, nie szereg)", () => {
    /**
     * Atrapa klienta: kazde zapytanie rozwiazuje sie dopiero, gdy zwolnimy
     * `bramka`. Jesli implementacja odpala COUNT-y sekwencyjnie (await w
     * petli), w locie bedzie zawsze 1 - i test to zlapie.
     */
    function atrapa(liczby: Record<string, number>) {
        let wLocie = 0;
        let maxWLocie = 0;
        const czekajace: Array<() => void> = [];
        const klient = {
            from() {
                return {
                    select() {
                        return {
                            eq(_col: string, val: string) {
                                wLocie += 1;
                                maxWLocie = Math.max(maxWLocie, wLocie);
                                return new Promise((resolve) => {
                                    czekajace.push(() => {
                                        wLocie -= 1;
                                        resolve({ count: liczby[val] ?? 0 });
                                    });
                                });
                            },
                        };
                    },
                };
            },
        };
        return {
            klient,
            zwolnij: () => {
                while (czekajace.length) czekajace.shift()!();
            },
            maxWLocie: () => maxWLocie,
            zapytania: () => czekajace.length,
        };
    }

    it("blad zapytania NIE jest zerem - rzuca zamiast pokazac audytorowi 0", async () => {
        // `count ?? 0` przy bledzie zapytania dawal serie nieodrozialna od
        // prawdy: "0 zdarzen tego typu" zamiast "nie wiem". routes/metrics.ts
        // lapie wyjatek i renderuje jednolicie pusty snapshot - degradacja
        // widoczna zamiast jednej po cichu falszywej liczby.
        process.env.PATRON_DB_BACKEND = "supabase";
        try {
            const klient = {
                from: () => ({
                    select: () => ({
                        eq: async () => ({
                            count: null,
                            error: { message: "connection refused" },
                        }),
                    }),
                }),
            };
            await expect(
                countAuditLogByEventType(klient as never, TYPY),
            ).rejects.toThrow(/connection refused/);
        } finally {
            process.env.PATRON_DB_BACKEND = "sqlite";
        }
    });

    it("wysyla wszystkie COUNT-y rownolegle i skleja pelna liste", async () => {
        process.env.PATRON_DB_BACKEND = "supabase";
        try {
            const a = atrapa({ llm_route: 5 });
            const p = countAuditLogByEventType(a.klient as never, TYPY);
            // Mikrotick: wszystkie eq() zdazyly wystartowac przed pierwszym
            // rozwiazaniem - to jest wlasnie "jedna fala".
            await Promise.resolve();
            expect(a.zapytania()).toBe(TYPY.length);
            a.zwolnij();
            const out = await p;
            expect(a.maxWLocie()).toBe(TYPY.length);
            expect(out).toEqual({
                "chat.message.user": 0,
                llm_route: 5,
                "rodo.export": 0,
            });
        } finally {
            process.env.PATRON_DB_BACKEND = "sqlite";
        }
    });
});
