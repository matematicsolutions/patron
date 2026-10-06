// E-02: README ("an egress guard checks every outbound call against the case's
// classification", "every model interaction hash-chained") i AGENTS.md ("Audit-first - every
// new LLM interaction goes through backend/src/lib/audit/") vs POST /tabular-review/prompt
// (routes/tabular.ts:277-345): completeText na title_model (zawsze chmurowy, userSettings.ts:21-26)
// BEZ enforceEgressGuard i BEZ appendLlmRouteEvent. W trybie serwerowym, gdzie Administrator NIE
// wlaczyl ALLOW_US_PROVIDERS (guard.ts:19-21, default false), straznik zablokowalby kazde inne
// wywolanie do OpenRoutera (us-with-dpa, egress.ts) - ta sciezka i tak wysyla tresc do USA
// i nie zostawia sladu w audit_log.
// Oczekiwane: przy ALLOW_US_PROVIDERS!=true wywolanie chmurowe nie nastepuje, a decyzja
// (allow albo block) laduje w audit_log jako llm_route.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
            return JSON.stringify({ prompt: "Wyodrebnij kwote zadluzenia." });
        }),
    };
});
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../src/lib/userSettings", async () => {
    const { DEFAULT_TITLE_MODEL } = await import("../src/lib/llm/models");
    return {
        getUserModelSettings: vi.fn(async () => ({
            title_model: DEFAULT_TITLE_MODEL,
            tabular_model: DEFAULT_TITLE_MODEL,
            api_keys: { openrouter: "sk-test" },
        })),
        getUserApiKeys: vi.fn(async () => ({})),
    };
});

import { tabularRouter } from "../src/routes/tabular";

function fakeDb() {
    const inserts: { table: string; row: any }[] = [];
    const db: any = {
        inserts,
        from(table: string) {
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b,
                insert: (row: any) => { inserts.push({ table, row }); return b; },
                single: async () => ({ data: null, error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
                then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
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

async function callPrompt() {
    const handler = handlerFor(tabularRouter, "post", "/prompt");
    let status = 200;
    let body: any;
    const res: any = {
        locals: { userId: "u1", userEmail: "operator@example.test" },
        status: (s: number) => { status = s; return res; },
        json: (b: any) => { body = b; return res; },
    };
    // Body jak z frontendu (AddColumnModal.tsx:155 - title + format; documentName frontend NIE wysyla).
    // Od 40cea92 route wymaga `scope` (lib/tabular/prompt-scope.ts); bez niego 400 i nic nie wychodzi,
    // wiec test bez scope bylby czerwony/zielony z niewlasciwego powodu.
    await handler(
        { body: { title: "Kwota zadluzenia Jana Testowego", format: "monetary_amount", scope: "workflow_template" } },
        res,
    );
    expect(status).not.toBe(400);
    return { status, body };
}

describe("E-02 /tabular-review/prompt: egress bez straznika i bez audytu", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        // Tryb serwerowy / fabryczny: Administrator NIE zgodzil sie na transfer do USA.
        delete process.env.ALLOW_US_PROVIDERS;
        delete process.env.PATRON_ALLOW_PRIVILEGED_CLOUD;
        state.db = fakeDb();
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("bez ALLOW_US_PROVIDERS nie wysyla nic do dostawcy spoza EOG", async () => {
        await callPrompt();
        const cloud = calls.filter((c) => !c.model.startsWith("ollama/"));
        expect(cloud).toEqual([]);
    });

    it("kazde wywolanie LLM z tej sciezki zostawia llm_route w audit_log", async () => {
        await callPrompt();
        const audit = state.db.inserts.filter(
            (i: any) => i.table === "audit_log" && i.row.event_type === "llm_route",
        );
        expect(audit.length).toBeGreaterThanOrEqual(1);
    });
});
