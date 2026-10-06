// R-TI-02: POST /tabular-review/:reviewId/regenerate-cell (routes/tabular.ts ~l. 960-1053)
// wysyla PELNA tresc dokumentu do LLM po decyzji ALLOW straznika. Gdy samo wywolanie
// padnie u dostawcy (completeText rzuca; queryTabularCell lapie to i zwraca null,
// l. ~1835-1845), route zwraca 500 (l. 1020) PRZED appendLlmRouteEvent (l. ~1042) -
// egress nastapil, a w audit hash chain nie ma zadnego llm_route. Ta sama poprawka
// zostala swiadomie zrobiona w POST /prompt w tym samym zakresie zmian (komentarz
// l. ~425-433: "AI Act art. 12 chce sladu wywolania, nie samych udanych wywolan"),
// ale nie w regenerate-cell. Oczekiwane: po ALLOW + nieudanym wywolaniu llm_route jest.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls, state, routeEvents } = vi.hoisted(() => ({
    calls: [] as { model: string }[],
    routeEvents: [] as unknown[],
    state: { db: null as any },
}));

vi.mock("../src/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/llm")>();
    return {
        ...orig,
        completeText: vi.fn(async (p: { model: string }) => {
            calls.push({ model: p.model });
            throw new Error("503 upstream overloaded"); // dostawca padl PO wyslaniu tresci
        }),
    };
});
vi.mock("../src/lib/routing", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/routing")>();
    return {
        ...orig,
        enforceEgressGuard: vi.fn(async () => ({
            allowed: true,
            provider: "gemini",
            decision: { egress: "cloud-eu", classification: "attorney_client_privileged", reason: "consent" },
        })),
        appendLlmRouteEvent: vi.fn(async (_db: unknown, ev: unknown) => {
            routeEvents.push(ev);
        }),
    };
});
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../src/lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        title_model: "gemini-3-flash-preview",
        tabular_model: "gemini-3-flash-preview",
        api_keys: { gemini: "k" },
    })),
    getUserApiKeys: vi.fn(async () => ({})),
}));
vi.mock("../src/lib/access", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/access")>();
    return {
        ...orig,
        ensureReviewAccess: vi.fn(async () => ({ ok: true })),
        filterAccessibleDocumentIds: vi.fn(async (ids: string[]) => ids),
    };
});
vi.mock("../src/lib/documentVersions", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/documentVersions")>();
    return { ...orig, loadActiveVersion: vi.fn(async () => ({ storage_path: "documents/u1/d1/source.docx" })) };
});
vi.mock("../src/lib/storage", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/storage")>();
    return { ...orig, downloadFile: vi.fn(async () => new ArrayBuffer(8)) };
});

import { tabularRouter } from "../src/routes/tabular";

function fakeDb() {
    const rows: Record<string, any> = {
        tabular_reviews: {
            id: "r1",
            project_id: "p1",
            user_id: "u1",
            title: "Przeglad umow",
            columns_config: [{ index: 0, name: "Kwota", prompt: "Podaj kwote", format: "text" }],
        },
        documents: { id: "d1", filename: "umowa-jan-testowy.docx", file_type: "docx" },
    };
    const db: any = {
        from(table: string) {
            const b: any = {
                select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
                update: () => b, insert: () => b,
                single: async () => ({ data: rows[table] ?? null, error: null }),
                maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
                // Od poprawki D-11 dokument bez tekstu nie idzie do modelu; tekst
                // z OCR (doc_chunks) zastepuje pusta ekstrakcje 8-bajtowego pliku.
                then: (res: any, rej: any) =>
                    Promise.resolve({
                        data: table === "doc_chunks" ? [{ content: "Umowa najmu. Kwota 1000 zl." }] : [],
                        error: null,
                    }).then(res, rej),
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

describe("R-TI-02 regenerate-cell: nieudane wywolanie po ALLOW nie zostawia llm_route", () => {
    beforeEach(() => {
        calls.length = 0;
        routeEvents.length = 0;
        state.db = fakeDb();
    });

    it("egress nastapil (completeText wywolany) -> llm_route zapisany", async () => {
        const handler = handlerFor(tabularRouter, "post", "/:reviewId/regenerate-cell");
        let status = 200;
        const res: any = {
            locals: { userId: "u1", userEmail: "operator@example.test" },
            status: (s: number) => { status = s; return res; },
            json: () => res,
        };
        await handler({ params: { reviewId: "r1" }, body: { document_id: "d1", column_index: 0 } }, res);

        expect(calls.length, "warunek scenariusza: tresc poszla do modelu").toBe(1);
        expect(status, "warunek scenariusza: wywolanie padlo").toBe(500);
        expect(routeEvents.length, "egress po ALLOW bez sladu llm_route").toBeGreaterThanOrEqual(1);
    });
});
