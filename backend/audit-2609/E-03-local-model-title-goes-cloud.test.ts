// E-03: README ("Bring your own model ... With a local model the conversation stays on the
// machine") i Konstytucja Art. 1/5 (dane nie opuszczaja kancelarii bez swiadomej decyzji) vs
// generowanie tytulu czatu. Frontend po PIERWSZEJ wiadomosci kazdego czatu bezwarunkowo wola
// POST /chat/:id/generate-title z trescia wiadomosci + nazwami zalaczonych plikow
// (frontend/src/app/hooks/useAssistantChat.ts:1023-1032), niezaleznie od wybranego modelu.
// Backend wybiera title_model WYLACZNIE po kluczach API (lib/userSettings.ts:21-26) - gdy
// Operator ma zapisany jakikolwiek klucz chmurowy, tytul idzie do chmury (OpenRouter/OpenAI/Claude),
// nawet jesli rozmowe w sprawie prowadzi modelem lokalnym (ollama/...). Na desktopie straznik
// przepuszcza to dla tajemnicy (PATRON_ALLOW_PRIVILEGED_CLOUD=true z desktop/main.js:212),
// bo "wybor modelu chmurowego = zgoda" - a Operator wybral model LOKALNY.
// Oczekiwane: gdy rozmowa jest prowadzona modelem lokalnym, jej tresc nie trafia do modelu
// chmurowego (tytul generowany lokalnie albo skrot wiadomosci).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna
const MESSAGE =
    `Pan Jan Testowy (PESEL ${PESEL}) - przygotuj odpowiedz na pozew.\n` +
    "Files: Pozew_Jan_Testowy.pdf";

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
            return "Odpowiedz na pozew";
        }),
    };
});
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
// Operator zapisal klucz OpenRouter (domyslny dostawca chmurowy Patrona, models.ts:32-34), ale TEN czat prowadzi lokalnie.
vi.mock("../src/lib/userApiKeys", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/userApiKeys")>();
    return { ...orig, getUserApiKeys: vi.fn(async () => ({ openrouter: "sk-or-test-key" })) };
});

import { chatRouter } from "../src/routes/chat";

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

describe("E-03 rozmowa na modelu lokalnym a tytul czatu w chmurze", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        // Domyslne srodowisko instalatora desktop (desktop/main.js:211-212).
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
        state.db = fakeDb({
            chats: [{ id: "c1", user_id: "u1", project_id: "p1", title: null }],
            projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }],
            chat_messages: [
                { id: "m1", chat_id: "c1", role: "user", content: MESSAGE },
                { id: "m2", chat_id: "c1", role: "assistant", content: "...", model: "ollama/bielik-11b" },
            ],
            user_profiles: [{ user_id: "u1", tabular_model: "ollama/bielik-11b" }],
        });
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("tresc czatu prowadzonego modelem lokalnym nie jest wysylana do modelu chmurowego", async () => {
        const handler = handlerFor(chatRouter, "post", "/:chatId/generate-title");
        const res: any = {
            locals: { userId: "u1", userEmail: "operator@example.test" },
            status: () => res,
            json: () => res,
        };
        // Dokladnie to, co wysyla frontend (useAssistantChat.ts:1024-1032) - bez informacji o modelu.
        await handler({ params: { chatId: "c1" }, body: { message: MESSAGE } }, res);
        const cloud = calls.filter((c) => !c.model.startsWith("ollama/"));
        expect(cloud.map((c) => c.model)).toEqual([]);
    });
});
