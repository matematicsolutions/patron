// A-07: Tabular review (routes/tabular.ts: regenerate-cell 773-940 -> queryTabularCell 1661-1688,
// generate 944-1180 -> queryTabularAllColumns 1822-1891) wysyla do modelu chmurowego PELNA tresc
// dokumentu sprawy (do 120 000 znakow) bez zadnej pseudonimizacji - jedyna ochrona to straznik
// egress, ktory na desktopie (PATRON_ALLOW_PRIVILEGED_CLOUD=true) przepuszcza kazda klase.
// Oczekiwane: tresc dokumentu wysylana do modelu chmurowego przechodzi przez maskowanie PII
// (PESEL / e-mail / osoba po kotwicy nie wychodza jawnym tekstem), jak w czacie.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PESEL = "90010112349"; // syntetyczny, poprawna suma kontrolna
const EMAIL = "jan.testowy@example.com";

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
            return JSON.stringify({ summary: "Not Found", flag: "grey", reasoning: "" });
        }),
    };
});
vi.mock("../src/lib/supabase", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/supabase")>();
    return { ...orig, createServerSupabase: () => state.db };
});
vi.mock("../src/lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        title_model: "openrouter/google/gemini-3-flash-preview",
        tabular_model: "openrouter/google/gemini-3-flash-preview",
        api_keys: { openrouter: "sk-test-syntetyczny" },
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
    return { ...orig, loadActiveVersion: vi.fn(async () => ({ storage_path: "s/umowa.docx" })) };
});
vi.mock("../src/lib/storage", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/storage")>();
    return { ...orig, downloadFile: vi.fn(async () => new Uint8Array([80, 75, 3, 4]).buffer) };
});
vi.mock("../src/lib/convert", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../src/lib/convert")>();
    return { ...orig, normalizeDocxZipPaths: vi.fn(async (b: Buffer) => b) };
});
vi.mock("mammoth", () => {
    const convertToHtml = vi.fn(async () => ({
        value: `<p>Najemca: Pan Jan Testowy, PESEL ${PESEL}, e-mail ${EMAIL}.</p>`,
    }));
    return { default: { convertToHtml }, convertToHtml };
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

describe("A-07 tabular: pelna tresc dokumentu do chmury bez maskowania", () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        calls.length = 0;
        process.env.ALLOW_US_PROVIDERS = "true";
        process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
        state.db = fakeDb({
            tabular_reviews: [{
                id: "r1", user_id: "u1", project_id: "p1", title: "Przeglad umow",
                columns_config: [{ index: 0, name: "Strony", prompt: "Kto jest najemca?", format: "text" }],
            }],
            documents: [{ id: "d1", filename: "umowa.docx", file_type: "docx" }],
            projects: [{ id: "p1", classification: "attorney_client_privileged", cloud_consent: 0 }],
        });
    });
    afterEach(() => {
        process.env = { ...envBackup };
    });

    it("regenerate-cell: dokument wyslany do modelu chmurowego nie zawiera jawnych identyfikatorow", async () => {
        const handler = handlerFor(tabularRouter, "post", "/:reviewId/regenerate-cell");
        const res: any = {
            locals: { userId: "u1", userEmail: "operator@example.test" },
            status: () => res,
            json: () => res,
        };
        await handler({ params: { reviewId: "r1" }, body: { document_id: "d1", column_index: 0 } }, res);
        expect(calls.length).toBe(1);
        expect(calls[0]!.model).toMatch(/^openrouter\//);
        // Sanity: tresc dokumentu faktycznie jest w prompcie.
        expect(calls[0]!.user).toContain("Najemca");
        expect(calls[0]!.user).not.toContain(PESEL);
        expect(calls[0]!.user).not.toContain(EMAIL);
        expect(calls[0]!.user).not.toContain("Jan Testowy");
    });
});
