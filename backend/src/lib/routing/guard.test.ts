import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    resolveClassification,
    resolveCloudConsent,
    guardEgress,
    allowUsProviders,
} from "./guard";

// Minimalny fake db zgodny z ksztaltem supabase-shim uzywanym w guard.ts:
// db.from(table).select(cols).eq(col,val).limit(n) -> { data, error }.
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
});
afterEach(() => {
    if (ENV === undefined) delete process.env.ALLOW_US_PROVIDERS;
    else process.env.ALLOW_US_PROVIDERS = ENV;
});

describe("allowUsProviders", () => {
    it("default false, true tylko dla 'true'", () => {
        expect(allowUsProviders()).toBe(false);
        process.env.ALLOW_US_PROVIDERS = "1";
        expect(allowUsProviders()).toBe(false);
        process.env.ALLOW_US_PROVIDERS = "true";
        expect(allowUsProviders()).toBe(true);
    });
});

describe("resolveClassification", () => {
    it("brak sprawy (czat ogolny) -> internal", async () => {
        const c = await resolveClassification(fakeDb({ data: [] }), null);
        expect(c).toBe("internal");
    });

    it("sprawa z klasyfikacja -> ta klasyfikacja", async () => {
        const c = await resolveClassification(
            fakeDb({ data: [{ classification: "client_general" }] }),
            "case-1",
        );
        expect(c).toBe("client_general");
    });

    it("sprawa nieznaleziona -> fail-closed privileged", async () => {
        const c = await resolveClassification(fakeDb({ data: [] }), "case-x");
        expect(c).toBe("attorney_client_privileged");
    });

    it("blad odczytu DB -> fail-closed privileged", async () => {
        const c = await resolveClassification(
            fakeDb({ error: { message: "boom" } }),
            "case-1",
        );
        expect(c).toBe("attorney_client_privileged");
    });

    it("nieznana wartosc klasyfikacji -> fail-closed privileged", async () => {
        const c = await resolveClassification(
            fakeDb({ data: [{ classification: "smieci" }] }),
            "case-1",
        );
        expect(c).toBe("attorney_client_privileged");
    });
});

describe("guardEgress", () => {
    it("model lokalny dozwolony nawet dla sprawy z tajemnica", async () => {
        const r = await guardEgress({
            db: fakeDb({ data: [{ classification: "attorney_client_privileged" }] }),
            model: "ollama/llama3.3:70b",
            projectId: "case-1",
        });
        expect(r.allowed).toBe(true);
        expect(r.provider).toBe("ollama");
    });

    it("tajemnica + model chmurowy -> blok z komunikatem", async () => {
        const r = await guardEgress({
            db: fakeDb({ data: [{ classification: "attorney_client_privileged" }] }),
            model: "gemini-3-flash-preview",
            projectId: "case-1",
        });
        expect(r.allowed).toBe(false);
        expect(r.decision.reason).toBe("privileged-requires-local");
        expect(r.blockMessage).toMatch(/tajemnic/i);
    });

    it("czat ogolny (internal) + chmura US + ALLOW_US=false -> blok", async () => {
        const r = await guardEgress({
            db: fakeDb({ data: [] }),
            model: "gpt-5.5",
            projectId: null,
        });
        expect(r.allowed).toBe(false);
        expect(r.decision.reason).toBe("us-providers-disabled");
    });

    it("client_general + chmura US + ALLOW_US=true -> dozwolony", async () => {
        process.env.ALLOW_US_PROVIDERS = "true";
        const r = await guardEgress({
            db: fakeDb({ data: [{ classification: "client_general" }] }),
            model: "openrouter/anthropic/claude-3.7",
            projectId: "case-1",
        });
        expect(r.allowed).toBe(true);
        expect(r.decision.reason).toBe("us-allowed-by-administrator");
        expect(r.provider).toBe("openrouter");
    });

    it("tajemnica + zgoda chmury PER-SPRAWA (cloud_consent=1) -> dozwolony, mimo globalnego env off (ADR-0117)", async () => {
        delete process.env.PATRON_ALLOW_PRIVILEGED_CLOUD;
        const r = await guardEgress({
            db: fakeDb({
                data: [
                    {
                        classification: "attorney_client_privileged",
                        cloud_consent: 1,
                    },
                ],
            }),
            model: "gemini-3-flash-preview",
            projectId: "case-1",
        });
        expect(r.allowed).toBe(true);
        expect(r.decision.reason).toBe("privileged-cloud-by-operator");
    });
});

describe("resolveCloudConsent (P2 #6 / ADR-0117)", () => {
    it("brak projectId -> false (czat ogolny)", async () => {
        expect(await resolveCloudConsent(fakeDb({ data: [] }), null)).toBe(false);
    });
    it("cloud_consent=1 -> true", async () => {
        expect(
            await resolveCloudConsent(fakeDb({ data: [{ cloud_consent: 1 }] }), "c1"),
        ).toBe(true);
    });
    it("cloud_consent=0 -> false (fail-closed)", async () => {
        expect(
            await resolveCloudConsent(fakeDb({ data: [{ cloud_consent: 0 }] }), "c1"),
        ).toBe(false);
    });
    it("blad odczytu / brak sprawy -> false (fail-closed)", async () => {
        expect(
            await resolveCloudConsent(
                fakeDb({ error: { message: "boom" } }),
                "c1",
            ),
        ).toBe(false);
        expect(await resolveCloudConsent(fakeDb({ data: [] }), "c1")).toBe(false);
    });
});
