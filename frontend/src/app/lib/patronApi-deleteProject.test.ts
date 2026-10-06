// deleteProject: kasacja sprawy niekompletna (audyt D-03/D-04) wraca z backendu
// jako 500 z { detail, failures }. Widok pokazuje `detail` - nie surowy JSON
// i nie cisze.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
    supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("@/lib/localMode", () => ({ IS_LOCAL_MODE: true, LOCAL_TOKEN: "t" }));
vi.mock("@/lib/apiBase", () => ({ API_BASE: "http://backend.test" }));

import { deleteProject } from "./patronApi";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("deleteProject", () => {
    it("204 -> sukces", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
        await expect(deleteProject("p1")).resolves.toBeUndefined();
    });

    it("500 z detail -> Error z czytelnym komunikatem", async () => {
        const body = {
            detail: "Kasacja sprawy niekompletna - czesc danych nie zostala usunieta.",
            complete: false,
            failures: [{ step: "storage", error: "EBUSY" }],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify(body), { status: 500 })),
        );
        await expect(deleteProject("p1")).rejects.toThrow(
            "Kasacja sprawy niekompletna - czesc danych nie zostala usunieta.",
        );
    });

    it("odpowiedz nie-JSON -> surowy tekst, nie wyjatek parsera", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("Bad Gateway", { status: 502 })),
        );
        await expect(deleteProject("p1")).rejects.toThrow("Bad Gateway");
    });
});
