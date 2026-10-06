// C-06: Dwa rownolegle POST /mutation-approvals/:id/approve tej samej karty wykonuja
// mutacje DWA RAZY, gdy zapytania do bazy sa realnie asynchroniczne (tryb serwerowy,
// Postgres przez siec). lib/mutation-approval.ts:309-316 czyta karte (status pending),
// a UPDATE ... eq(status,'pending') (:322-331) NIE sprawdza liczby zmienionych wierszy,
// wiec oba zadania, ktore przeczytaly 'pending' przed pierwszym UPDATE, wolaja executor
// i oba pisza decyzje do audit_log. Desktop (shim SQLite rozwiazuje zapytania w
// mikrozadaniach) jest w tym tescie odporny - zmierzone: ten sam test na czystym shimie
// przechodzi. Tu baze serwerowa symuluje shim z opoznieniem 5 ms na zapytanie.
// Znane i opisane w kodzie (":318-321 mikro-race ... rezerwacja") - test utrwala skutek.
// Ten sam brak atomowosci w reject (:386-393 - UPDATE bez eq(status,'pending')): approve
// i reject rownolegle -> narzedzie WYKONANE, a karta koncowo 'rejected' i w audit_log
// dwie sprzeczne decyzje (approved + rejected) dla jednej karty.
// Oczekiwane: jedna karta = co najwyzej jedno wykonanie narzedzia i jeden wpis
// decyzji w audit_log; drugie zadanie dostaje 409 (atomowe przejscie pending->approved).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = path.join(os.tmpdir(), `patron-c06-${Date.now()}.db`);
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = tmp;

const executions: string[] = [];
// Baza "serwerowa": ten sam shim, ale kazde zapytanie konczy sie po I/O (5 ms), jak
// round-trip do Postgresa. Kolejnosc i semantyka zapytan bez zmian.
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    const delayed = (q: any): any =>
        new Proxy(q, {
            get(t, prop) {
                if (prop === "then") {
                    return (ok: any, ko: any) =>
                        new Promise((r) => setTimeout(r, 5)).then(() => t.then(ok, ko));
                }
                const v = t[prop];
                if (typeof v !== "function") return v;
                return (...args: any[]) => {
                    const out = v.apply(t, args);
                    return out === t ? delayed(t) : out && typeof out === "object" ? delayed(out) : out;
                };
            },
        });
    return {
        ...orig,
        createServerSupabase: () => {
            const c: any = orig.createServerSupabase();
            return { ...c, from: (table: string) => delayed(c.from(table)) };
        },
    };
});

vi.mock("../src/lib/chat/mutation-approval-executor", () => ({
    // Wykonanie narzedzia trwa (odczyt/zapis DOCX, upload wersji).
    executeStagedTool: vi.fn(async (card: { id: string }) => {
        executions.push(card.id);
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, result: { version_id: `v-${executions.length}` } };
    }),
}));

let server: http.Server;
let base = "";
let db: any;
let cardId = "";
let card2Id = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { approvalsRouter } = await import("../src/routes/approvals");
    const { createServerSupabase } = await import("../src/lib/supabase");
    const { stageMutationApproval } = await import("../src/lib/mutation-approval");
    const { LOCAL_USER_ID } = await import("../src/lib/db/supabase-shim");
    db = createServerSupabase();
    const card = await stageMutationApproval(db, {
        userId: LOCAL_USER_ID,
        toolName: "generate_docx",
        toolPayload: { title: "Pismo testowe", sections: [] },
    });
    cardId = card!.id;
    const card2 = await stageMutationApproval(db, {
        userId: LOCAL_USER_ID,
        toolName: "generate_docx",
        toolPayload: { title: "Pismo testowe 2", sections: [] },
    });
    card2Id = card2!.id;
    const app = express();
    app.use(express.json());
    app.use("/mutation-approvals", approvalsRouter);
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

describe("C-06 wyscig podwojnego zatwierdzenia karty (baza z opoznieniem I/O)", () => {
    it("dwa rownolegle approve tej samej karty -> jedno wykonanie, drugie 409", async () => {
        const post = () => fetch(`${base}/mutation-approvals/${cardId}/approve`, { method: "POST" });
        const [a, b] = await Promise.all([post(), post()]);
        const statuses = [a.status, b.status].sort();

        const { data } = await db.from("audit_log").select("*").eq("event_type", "mutation.approval.decision");
        // ZADANE: jedno wykonanie narzedzia.
        expect(executions.length, `wykonan=${executions.length} statusy=${statuses} decyzji w audycie=${(data ?? []).length}`).toBe(1);
        expect(statuses).toEqual([200, 409]);
        expect((data ?? []).length).toBe(1);
    });

    it("approve i reject rownolegle -> stan karty zgodny z tym, co sie wykonalo", async () => {
        const before = executions.length;
        const [a, r] = await Promise.all([
            fetch(`${base}/mutation-approvals/${card2Id}/approve`, { method: "POST" }),
            fetch(`${base}/mutation-approvals/${card2Id}/reject`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ reason: "nie zgadzam sie" }),
            }),
        ]);
        const executed = executions.length - before;
        const { data: rows } = await db.from("mutation_approvals").select("*").eq("id", card2Id);
        const status = rows[0].status;
        const { data: dec } = await db.from("audit_log").select("*").eq("event_type", "mutation.approval.decision");
        const decisions = (dec ?? [])
            .filter((d: any) => d.payload.approval_id === card2Id)
            .map((d: any) => d.payload.decision);
        const msg = `approve=${a.status} reject=${r.status} wykonan=${executed} status=${status} decyzje=${decisions}`;
        // ZADANE: dokladnie jedna decyzja; jesli narzedzie wykonano, karta jest 'approved'.
        expect(decisions.length, msg).toBe(1);
        if (executed > 0) expect(status, msg).toBe("approved");
    });
});
