// Testy getOpenRouterCredits (audyt P3 #17 - saldo w panelu stanu). Mock fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpenRouterCredits } from "./openrouter";

const ENV = process.env.OPENROUTER_API_KEY;
const realFetch = globalThis.fetch;

beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => {
    if (ENV === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = ENV;
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
});

describe("getOpenRouterCredits", () => {
    it("brak klucza -> null (nic do sprawdzenia, bez wywolania sieci)", async () => {
        const spy = vi.fn();
        globalThis.fetch = spy as unknown as typeof fetch;
        expect(await getOpenRouterCredits()).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it("poprawna odpowiedz -> saldo = total_credits - total_usage", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: { total_credits: 12.5, total_usage: 4.5 } }),
        })) as unknown as typeof fetch;
        const c = await getOpenRouterCredits("sk-test");
        expect(c).toEqual({ totalCredits: 12.5, totalUsage: 4.5, balance: 8 });
    });

    it("odpowiedz !ok -> null (best-effort, panel sie nie wywraca)", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            json: async () => ({}),
        })) as unknown as typeof fetch;
        expect(await getOpenRouterCredits("sk-test")).toBeNull();
    });

    it("fetch rzuca (siec/timeout) -> null", async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error("network");
        }) as unknown as typeof fetch;
        expect(await getOpenRouterCredits("sk-test")).toBeNull();
    });
});
