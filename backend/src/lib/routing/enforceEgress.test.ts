import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mockujemy TYLKO appendLlmRouteEvent (zapis audytu) - reszta auditLlmRoute
// (providerLabelForModel) musi zostac realna, bo guard.ts jej uzywa.
vi.mock("./auditLlmRoute", async (importActual) => {
    const actual =
        await importActual<typeof import("./auditLlmRoute")>();
    return { ...actual, appendLlmRouteEvent: vi.fn().mockResolvedValue(undefined) };
});

import { enforceEgressGuard } from "./enforceEgress";
import { appendLlmRouteEvent } from "./auditLlmRoute";

// Fake db zgodny z guard.ts: from(table).select().eq().limit() -> {data,error}.
function fakeDb(result: {
    data?: unknown[] | null;
    error?: { message: string } | null;
}) {
    const chain = {
        select() {
            return chain;
        },
        eq() {
            return chain;
        },
        limit() {
            return Promise.resolve({
                data: result.data ?? null,
                error: result.error ?? null,
            });
        },
    };
    return { from: () => chain } as never;
}

const ENV = process.env.ALLOW_US_PROVIDERS;
beforeEach(() => {
    delete process.env.ALLOW_US_PROVIDERS;
    vi.mocked(appendLlmRouteEvent).mockClear();
});
afterEach(() => {
    if (ENV === undefined) delete process.env.ALLOW_US_PROVIDERS;
    else process.env.ALLOW_US_PROVIDERS = ENV;
});

describe("enforceEgressGuard - wspolny chokepoint egress", () => {
    it("tajemnica + model chmurowy -> BLOK + audyt llm_route(block)", async () => {
        const guard = await enforceEgressGuard({
            db: fakeDb({
                data: [{ classification: "attorney_client_privileged" }],
            }),
            model: "gemini-3-flash-preview",
            projectId: "case-1",
            actorUserId: "user-1",
        });
        expect(guard.allowed).toBe(false);
        expect(guard.decision.reason).toBe("privileged-requires-local");
        expect(guard.blockMessage).toMatch(/tajemnic/i);
        // Helper sam audytuje blokade (action block) - to jest sedno chokepointu.
        expect(appendLlmRouteEvent).toHaveBeenCalledTimes(1);
        expect(vi.mocked(appendLlmRouteEvent).mock.calls[0][1]).toMatchObject({
            action: "block",
            reason: "privileged-requires-local",
            classification: "attorney_client_privileged",
            actorUserId: "user-1",
            caseId: "case-1",
        });
    });

    it("draft ogolny (brak projectId -> internal) + chmura US + ALLOW_US=false -> BLOK + audyt", async () => {
        const guard = await enforceEgressGuard({
            db: fakeDb({ data: [] }),
            model: "gemini-3-flash-preview",
            projectId: null,
            actorUserId: "user-1",
        });
        expect(guard.allowed).toBe(false);
        expect(guard.decision.reason).toBe("us-providers-disabled");
        expect(appendLlmRouteEvent).toHaveBeenCalledTimes(1);
        expect(vi.mocked(appendLlmRouteEvent).mock.calls[0][1]).toMatchObject({
            action: "block",
        });
    });

    it("model lokalny -> ALLOW i ZERO audytu w helperze (allow audytuje wolajacy z usage)", async () => {
        const guard = await enforceEgressGuard({
            db: fakeDb({
                data: [{ classification: "attorney_client_privileged" }],
            }),
            model: "ollama/llama3.3:70b",
            projectId: "case-1",
            actorUserId: "user-1",
        });
        expect(guard.allowed).toBe(true);
        expect(guard.provider).toBe("ollama");
        // Allow NIE jest audytowany w helperze - to robi wolajacy po zakonczeniu
        // (z realnym kosztem/latencja). Helper audytuje wylacznie blokady.
        expect(appendLlmRouteEvent).not.toHaveBeenCalled();
    });

    it("client_general + chmura US + ALLOW_US=true -> ALLOW bez audytu blokady", async () => {
        process.env.ALLOW_US_PROVIDERS = "true";
        const guard = await enforceEgressGuard({
            db: fakeDb({ data: [{ classification: "client_general" }] }),
            model: "claude-3-5-sonnet",
            projectId: "case-1",
            actorUserId: "user-1",
        });
        expect(guard.allowed).toBe(true);
        expect(guard.decision.reason).toBe("us-allowed-by-administrator");
        expect(appendLlmRouteEvent).not.toHaveBeenCalled();
    });
});
