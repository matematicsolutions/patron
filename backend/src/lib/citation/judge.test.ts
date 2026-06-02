import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeJudge, parseJudgeResponse, type CompleteTextFn } from "./judge";

// Fake db zgodny z guard.ts: from().select().eq().limit() -> {data,error}.
function fakeDb(result: { data?: unknown[] | null }) {
    const chain = {
        select() {
            return chain;
        },
        eq() {
            return chain;
        },
        limit() {
            return Promise.resolve({ data: result.data ?? null, error: null });
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

describe("parseJudgeResponse", () => {
    it("parsuje czysty JSON", () => {
        const v = parseJudgeResponse(
            '{"verdict":"tak","confidence":"wysoka","uzasadnienie":"ok"}',
        );
        expect(v).toEqual({
            verdict: "tak",
            confidence: "wysoka",
            uzasadnienie: "ok",
        });
    });

    it("zdejmuje ogrodzenie ```json", () => {
        const v = parseJudgeResponse(
            '```json\n{"verdict":"czesciowo","confidence":"srednia","uzasadnienie":"x"}\n```',
        );
        expect(v.verdict).toBe("czesciowo");
    });

    it("rzuca przy niepoprawnym verdict", () => {
        expect(() =>
            parseJudgeResponse(
                '{"verdict":"maybe","confidence":"wysoka","uzasadnienie":"x"}',
            ),
        ).toThrow();
    });

    it("rzuca przy nie-JSON", () => {
        expect(() => parseJudgeResponse("to nie jest json")).toThrow();
    });
});

describe("makeJudge - fail-closed przez guardEgress", () => {
    it("tajemnica + model chmurowy -> null (sedzia niedostepny, grounding deterministyczny)", async () => {
        const judge = await makeJudge({
            db: fakeDb({ data: [{ classification: "attorney_client_privileged" }] }),
            model: "gemini-3-flash-preview",
            projectId: "case-1",
        });
        expect(judge).toBeNull();
    });

    it("model lokalny -> JudgeFn dziala (parsuje wynik fake completeText)", async () => {
        const complete: CompleteTextFn = async () =>
            '{"verdict":"nie","confidence":"wysoka","uzasadnienie":"zrodlo nie wspiera tezy"}';
        const judge = await makeJudge({
            db: fakeDb({ data: [{ classification: "attorney_client_privileged" }] }),
            model: "ollama/llama3.3:70b",
            projectId: "case-1",
            complete,
        });
        expect(judge).not.toBeNull();
        const v = await judge!({
            quote: "oddalił powództwo",
            claim: "Sąd uwzględnił powództwo.",
            sourceContext: "Sąd oddalił powództwo w całości.",
        });
        expect(v.verdict).toBe("nie");
        expect(v.confidence).toBe("wysoka");
    });

    it("client_general + chmura + ALLOW_US=true -> JudgeFn dostepny", async () => {
        process.env.ALLOW_US_PROVIDERS = "true";
        const complete: CompleteTextFn = async () =>
            '{"verdict":"tak","confidence":"srednia","uzasadnienie":"ok"}';
        const judge = await makeJudge({
            db: fakeDb({ data: [{ classification: "client_general" }] }),
            model: "claude-3-5-sonnet",
            projectId: "case-1",
            complete,
        });
        expect(judge).not.toBeNull();
    });

    it("JudgeFn propaguje blad parsowania (cascade go zlapie -> fail-closed)", async () => {
        const complete: CompleteTextFn = async () => "smieci nie-json";
        const judge = await makeJudge({
            db: fakeDb({ data: [] }), // brak sprawy -> internal
            model: "ollama/llama3.3:70b",
            projectId: null,
            complete,
        });
        await expect(
            judge!({ quote: "q", claim: "c", sourceContext: "s" }),
        ).rejects.toThrow();
    });
});
