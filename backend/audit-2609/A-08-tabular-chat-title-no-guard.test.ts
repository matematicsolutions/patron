// A-08: Czat tabular (routes/tabular.ts:1374-1575) generuje tytul przez generateChatTitle
// (tabular.ts:1732-1758) wolajac completeText na title_model (zawsze chmurowy) BEZ straznika
// egress, bez maskowania i bez audytu. W sprawie objetej tajemnica bez zgody na chmure
// (serwer: brak PATRON_ALLOW_PRIVILEGED_CLOUD, brak cloud_consent) straznik BLOKUJE sam czat
// (runLLMStream -> egress_blocked), ale tytul i tak jest generowany po powrocie z bloku i
// wysyla do chmury pierwsza wiadomosc uzytkownika + nazwe sprawy + tytul przegladu.
// Oczekiwane: gdy straznik egress nie dopuszcza modelu tytulu dla tej sprawy, zadna tresc
// nie trafia do modelu chmurowego (tak jak w /chat/:id/generate-title, chat.ts:409-420).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna

const { calls, state } = vi.hoisted(() => ({
    calls: [] as { model: string; user: string }[],
    state: { db: null as any },
}));

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        completeText: vi.fn(async (p: { model: string; user: string }) => {
            calls.push({ model: p.model, user: p.user });
            return "Tytul";
        }),
    };
});
vi.mock("../src/lib/mcp", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/mcp")>();
    return { ...orig, getMcpTools: vi.fn(async () => []) };
});
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../src/lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        title_model: "openrouter/google/gemini-3-flash-preview",
        tabular_model: "openrouter/google/gemini-3-flash-preview",
        api_keys: { gemini: "k", openai: "k", claude: "k", openrouter: "k" },
    })),
    getUserApiKeys: vi.fn(async () => ({})),
}));
vi.mock("../src/lib/access", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/access")>();
    return { ...orig, ensureReviewAccess: vi.fn(async () => ({ ok: true })) };
});

import { tabularRouter } from "../src/routes/tabular";

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

describe("A-08 tabular chat: tytul do chmury z pominieciem straznika egress", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        // Tryb rygorystyczny: transfer US dozwolony, ale bez zgody na chmure dla tajemnicy.
        process.env.ALLOW_US_PROVIDERS = "true";
        delete process.env.PATRON_ALLOW_PRIVILEGED_CLOUD;
        state.db = fakeDb({
            tabular_reviews: [{ id: "r1", user_id: "u1", project_id: "p1", title: "Przeglad umow", columns_config: [] }],
            tabular_cells: [],
            tabular_review_chats: [{ id: "tc1", title: null, review_id: "r1", user_id: "u1" }],
            projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }],
        });
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("tytul czatu tabular nie idzie do modelu chmurowego, gdy straznik go nie dopuszcza", async () => {
        const handler = handlerFor(tabularRouter, "post", "/:reviewId/chat");
        const written: string[] = [];
        const res: any = {
            locals: { userId: "u1", userEmail: "operator@example.test" },
            setHeader: () => {}, flushHeaders: () => {}, end: () => {},
            write: (l: string) => { written.push(l); return true; },
            status: () => res, json: () => res,
        };
        await handler({
            params: { reviewId: "r1" },
            body: {
                messages: [{ role: "user", content: `Czy Pan Jan Testowy (PESEL ${PESEL}) jest najemca?` }],
                project_name: "Sprawa Testowy przeciwko Probny",
            },
        }, res);
        // Sanity: straznik zablokowal sam czat dla tej sprawy.
        expect(written.join("")).toContain("egress_blocked");
        // ZADANE: zadna tresc nie idzie do chmurowego modelu tytulu.
        expect(calls.map((c) => c.model)).toEqual([]);
    });
});
