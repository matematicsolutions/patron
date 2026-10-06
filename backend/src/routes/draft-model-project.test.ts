// Audyt 2026-09, A-05 (strona backendu): /draft/refine.
//
// Panel draftu wysylal zadanie bez `model` i bez `project_id`. Backend robil
// wtedy resolveModel(undefined, DEFAULT_MAIN_MODEL), czyli bral CHMUROWY model
// domyslny, a straznik egress klasyfikowal tresc jako "internal" (brak sprawy).
// Tu pilnujemy kontraktu po poprawce:
//  - brak albo nieznany model = 400 i ZERO wywolan LLM (fail-closed, nie cichy
//    wybor chmury za Operatora);
//  - model rozmowy jest uzywany doslownie (lokalny zostaje lokalny);
//  - project_id trafia do straznika: sprawa objeta tajemnica blokuje model
//    chmurowy (bez zgody), choc ten sam tekst bez sprawy przechodzi jako internal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls, state } = vi.hoisted(() => ({
    calls: [] as { model: string }[],
    state: { db: null as any },
}));

vi.mock("../lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../lib/llm")>();
    return {
        ...orig,
        completeText: vi.fn(async (p: { model: string }) => {
            calls.push({ model: p.model });
            return "Poprawione pismo.";
        }),
    };
});
vi.mock("../lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../lib/userApiKeys", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../lib/userApiKeys")>();
    return { ...orig, getUserApiKeys: vi.fn(async () => ({ openrouter: "sk-or-test-key" })) };
});

import { draftRouter } from "./draft";

function fakeDb(tables: Record<string, any[]>) {
    const db: any = {
        from(table: string) {
            const rows = tables[table] ?? [];
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, neq: () => b, is: () => b, insert: () => b,
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

async function refine(body: Record<string, unknown>) {
    const handler = handlerFor(draftRouter, "post", "/refine");
    const out: { status: number; body: any } = { status: 200, body: null };
    const res: any = {
        locals: { userId: "u1" },
        status: (s: number) => { out.status = s; return res; },
        json: (b: unknown) => { out.body = b; return res; },
    };
    await handler({ body: { text: "Pan Jan Testowy wnosi o oddalenie powodztwa.", stages: ["pisz-po-ludzku"], ...body } }, res);
    return out;
}

const CLOUD = "openrouter/google/gemini-3-flash-preview";
const LOCAL = "ollama/llama3.3:70b";

describe("A-05 /draft/refine: model i sprawa", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        // Serwer z transferem US, ale BEZ zgody na chmure dla tajemnicy.
        process.env.ALLOW_US_PROVIDERS = "true";
        delete process.env.PATRON_ALLOW_PRIVILEGED_CLOUD;
        state.db = fakeDb({
            projects: [{ id: "p-tajemnica", user_id: "u1", shared_with: [], classification: "attorney_client_privileged", cloud_consent: 0 }],
        });
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("cudza sprawa: 404, zero wywolan LLM (granica sprawy, ADR-0148)", async () => {
        state.db = fakeDb({
            projects: [{ id: "p-tajemnica", user_id: "inny", shared_with: [], classification: "internal", cloud_consent: 1 }],
        });
        const r = await refine({ model: LOCAL, project_id: "p-tajemnica" });
        expect(r.status).toBe(404);
        expect(calls).toEqual([]);
    });

    it("brak modelu: 400 model_required, zero wywolan LLM (nie ma cichego DEFAULT_MAIN_MODEL)", async () => {
        const r = await refine({});
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("model_required");
        expect(calls).toEqual([]);
    });

    it("nieznany model: 400 model_unknown, zero wywolan LLM", async () => {
        const r = await refine({ model: "gpt-nieistniejacy" });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("model_unknown");
        expect(calls).toEqual([]);
    });

    it("model rozmowy (lokalny) jest uzywany doslownie, takze w sprawie objetej tajemnica", async () => {
        const r = await refine({ model: LOCAL, project_id: "p-tajemnica" });
        expect(r.status).toBe(200);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((c) => c.model === LOCAL)).toBe(true);
    });

    it("project_id trafia do straznika: tajemnica + chmura bez zgody = 403, zero wywolan", async () => {
        const r = await refine({ model: CLOUD, project_id: "p-tajemnica" });
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("egress_blocked");
        expect(calls).toEqual([]);
    });

    it("kontrola: ten sam model bez sprawy przechodzi jako internal (roznica = project_id)", async () => {
        const r = await refine({ model: CLOUD });
        expect(r.status).toBe(200);
        expect(calls.every((c) => c.model === CLOUD)).toBe(true);
    });
});
