// Regresja audytu 2026-09 (kopia czerwonego testu po naprawie).
// A-06: POST /chat/:chatId/generate-title (routes/chat.ts:386-437) wysyla pierwsze 500 znakow
// wiadomosci uzytkownika do title_model, ktory jest ZAWSZE chmurowy (userSettings.ts:21-26 -
// nigdy Ollama), bez pseudonimizacji i bez wpisu "llm_route" (allow) do lancucha audytu.
// Na desktopie (PATRON_ALLOW_PRIVILEGED_CLOUD=true z instalatora) straznik przepuszcza to
// takze dla sprawy objetej tajemnica, w ktorej Operator prowadzi czat modelem LOKALNYM.
// Oczekiwane: tresc wysylana do chmurowego modelu tytulu jest maskowana, a dozwolone
// wywolanie chmurowe zostawia slad llm_route w audit_log (parytet z czatem/draftem/tabular).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna
const MESSAGE = `Klient Pan Jan Testowy, PESEL ${PESEL}, chce pozwac pracodawce o zalegle wynagrodzenie.`;

const { calls, state } = vi.hoisted(() => ({
    calls: [] as { model: string; user: string }[],
    state: { db: null as any },
}));

vi.mock("../lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../lib/llm")>();
    return {
        ...orig,
        completeText: vi.fn(async (p: { model: string; user: string }) => {
            calls.push({ model: p.model, user: p.user });
            return "Zalegle wynagrodzenie";
        }),
    };
});
vi.mock("../lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../lib/userSettings", async () => {
    const { DEFAULT_TITLE_MODEL } = await import("../lib/llm/models");
    return {
        getUserModelSettings: vi.fn(async () => ({
            title_model: DEFAULT_TITLE_MODEL,
            tabular_model: DEFAULT_TITLE_MODEL,
            api_keys: {},
        })),
        getUserApiKeys: vi.fn(async () => ({})),
    };
});

import { chatRouter } from "../routes/chat";

function fakeDb(tables: Record<string, any[]>) {
    const inserts: { table: string; row: any }[] = [];
    const db: any = {
        inserts,
        from(table: string) {
            const rows = tables[table] ?? [];
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, neq: () => b, is: () => b,
                insert: (row: any) => { inserts.push({ table, row }); return b; },
                single: async () => ({ data: rows[0] ?? null, error: null }),
                maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
            };
            return b;
        },
    };
    return db;
}

function handlerFor(router: any, method: string, path: string) {
    const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle;
}

async function callTitle() {
    const handler = handlerFor(chatRouter, "post", "/:chatId/generate-title");
    let body: any;
    const res: any = {
        locals: { userId: "u1", userEmail: "operator@example.test" },
        status: () => res,
        json: (b: any) => { body = b; return res; },
    };
    await handler({ params: { chatId: "c1" }, body: { message: MESSAGE } }, res);
    return body;
}

describe("A-06 generate-title: egress bez maskowania i bez audytu", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        // Domyslne ustawienia instalatora desktop (desktop/main.js:211-212).
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
        state.db = fakeDb({
            chats: [{ id: "c1", user_id: "u1", project_id: "p1", title: null }],
            projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }],
        });
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("tresc wiadomosci wyslana do chmurowego modelu tytulu jest zamaskowana", async () => {
        await callTitle();
        expect(calls.length).toBe(1);
        expect(calls[0]!.model).toMatch(/^openrouter\//); // model chmurowy
        expect(calls[0]!.user).not.toContain(PESEL);
        expect(calls[0]!.user).not.toContain("Jan Testowy");
    });

    it("dozwolone wywolanie chmurowe generate-title zostawia llm_route w audit_log", async () => {
        await callTitle();
        expect(calls.length).toBe(1);
        const audit = state.db.inserts.filter(
            (i: any) => i.table === "audit_log" && i.row.event_type === "llm_route",
        );
        expect(audit.length).toBeGreaterThanOrEqual(1);
    });
});
