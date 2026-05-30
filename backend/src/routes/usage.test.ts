import { describe, it, expect } from "vitest";
import {
    toUsageEvents,
    aggregateSummary,
    aggregateByModel,
    aggregateByCase,
    aggregateTimeseries,
    parseWindow,
    readUsageEvents,
    type UsageEvent,
} from "./usage";

function row(ts: string, payload: Record<string, unknown>, asString = false) {
    return { ts, payload: asString ? JSON.stringify(payload) : payload };
}

describe("usage.toUsageEvents", () => {
    it("parsuje payload jako obiekt i jako string JSON", () => {
        const rows = [
            row("2026-05-30T10:00:00Z", {
                model: "claude-opus-4-7",
                provider: "anthropic",
                case_id: "sprawa-1",
                prompt_tokens: 1000,
                completion_tokens: 500,
                cost_usd: 0.12,
            }),
            row(
                "2026-05-30T11:00:00Z",
                {
                    model: "gemini-3-flash-preview",
                    provider: "google",
                    case_id: null,
                    prompt_tokens: 2000,
                    completion_tokens: 1000,
                    cost_usd: null,
                },
                true,
            ),
        ];
        const events = toUsageEvents(rows);
        expect(events).toHaveLength(2);
        // Pierwszy: realny koszt z dostawcy.
        expect(events[0].costUsd).toBe(0.12);
        expect(events[0].costEstimated).toBe(false);
        expect(events[0].caseId).toBe("sprawa-1");
        // Drugi: brak realnego kosztu -> szacowany z cennika (model w tabeli).
        expect(events[1].costEstimated).toBe(true);
        expect(events[1].unpriced).toBe(false);
        expect(events[1].costUsd).toBeGreaterThan(0);
    });

    it("pomija zdarzenie z niepoprawnym payloadem zamiast wywracac panel", () => {
        const rows = [
            { ts: "2026-05-30T10:00:00Z", payload: "{to nie jest json" },
            row("2026-05-30T10:05:00Z", { model: "claude-opus-4-7", prompt_tokens: 1, completion_tokens: 1, cost_usd: 0.01 }),
        ];
        const events = toUsageEvents(rows);
        expect(events).toHaveLength(1);
    });

    it("model spoza cennika bez realnego kosztu -> unpriced", () => {
        const events = toUsageEvents([
            row("2026-05-30T10:00:00Z", { model: "egzotyk-x", prompt_tokens: 100, completion_tokens: 100, cost_usd: null }),
        ]);
        expect(events[0].unpriced).toBe(true);
        expect(events[0].costUsd).toBeNull();
    });
});

function ev(partial: Partial<UsageEvent>): UsageEvent {
    return {
        ts: "2026-05-30T10:00:00Z",
        model: "m",
        provider: "p",
        caseId: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: null,
        costEstimated: false,
        unpriced: false,
        ...partial,
    };
}

describe("usage.aggregateSummary", () => {
    it("sumuje tokeny i rozdziela koszt realny / szacowany / unpriced", () => {
        const events = [
            ev({ promptTokens: 100, completionTokens: 50, costUsd: 0.2, costEstimated: false }),
            ev({ promptTokens: 200, completionTokens: 100, costUsd: 0.1, costEstimated: true }),
            ev({ promptTokens: 10, completionTokens: 5, costUsd: null, unpriced: true }),
        ];
        const s = aggregateSummary(events);
        expect(s.calls).toBe(3);
        expect(s.promptTokens).toBe(310);
        expect(s.completionTokens).toBe(155);
        expect(s.totalTokens).toBe(465);
        expect(s.costRealUsd).toBeCloseTo(0.2, 6);
        expect(s.costEstimatedUsd).toBeCloseTo(0.1, 6);
        expect(s.unpricedCalls).toBe(1);
    });

    it("pusta lista -> zerowe podsumowanie", () => {
        const s = aggregateSummary([]);
        expect(s.calls).toBe(0);
        expect(s.totalTokens).toBe(0);
        expect(s.costRealUsd).toBe(0);
    });
});

describe("usage.aggregateByModel / byCase", () => {
    it("grupuje per model i sortuje malejaco po koszcie", () => {
        const events = [
            ev({ model: "tani", promptTokens: 10, costUsd: 0.01, costEstimated: false }),
            ev({ model: "drogi", promptTokens: 10, costUsd: 5, costEstimated: false }),
            ev({ model: "tani", promptTokens: 10, costUsd: 0.01, costEstimated: false }),
        ];
        const byModel = aggregateByModel(events);
        expect(byModel).toHaveLength(2);
        expect(byModel[0].key).toBe("drogi");
        expect(byModel[1].key).toBe("tani");
        expect(byModel[1].calls).toBe(2);
    });

    it("brak sprawy grupuje pod '(brak sprawy)'", () => {
        const byCase = aggregateByCase([
            ev({ caseId: null, costUsd: 1, costEstimated: false }),
            ev({ caseId: "sprawa-7", costUsd: 2, costEstimated: false }),
        ]);
        const keys = byCase.map((b) => b.key);
        expect(keys).toContain("(brak sprawy)");
        expect(keys).toContain("sprawa-7");
    });
});

describe("usage.aggregateTimeseries", () => {
    it("kubelkuje dziennie i sortuje rosnaco po dacie", () => {
        const events = [
            ev({ ts: "2026-05-30T23:00:00Z", promptTokens: 10 }),
            ev({ ts: "2026-05-28T01:00:00Z", promptTokens: 20 }),
            ev({ ts: "2026-05-30T01:00:00Z", promptTokens: 5 }),
        ];
        const ts = aggregateTimeseries(events);
        expect(ts.map((t) => t.key)).toEqual(["2026-05-28", "2026-05-30"]);
        expect(ts[1].promptTokens).toBe(15); // dwa zdarzenia 30-go
    });
});

describe("usage.parseWindow", () => {
    it("domyslnie okno 30 dni, from < until", () => {
        const w = parseWindow({});
        expect(Date.parse(w.from)).toBeLessThan(Date.parse(w.until));
    });

    it("przepuszcza poprawne from/to", () => {
        const w = parseWindow({ from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
        expect(w.from).toBe("2026-01-01T00:00:00Z");
        expect(w.until).toBe("2026-02-01T00:00:00Z");
    });

    it("odrzuca smieci i wraca do domyslnej daty ISO", () => {
        const w = parseWindow({ from: "smieci", to: "tez-smieci" });
        expect(Number.isNaN(Date.parse(w.from))).toBe(false);
        expect(w.from).not.toBe("smieci");
    });
});

describe("usage.readUsageEvents - READ-ONLY (ADR-0076 bramka)", () => {
    function readOnlyFakeDb(rows: unknown[]) {
        const calls: string[] = [];
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) {
            builder[m] = (..._a: unknown[]) => {
                calls.push(m);
                return builder;
            };
        }
        for (const m of ["insert", "update", "delete", "upsert"]) {
            builder[m] = () => {
                calls.push(m);
                throw new Error(`reader nie moze wywolac ${m}`);
            };
        }
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
        const db = {
            from: (t: string) => {
                calls.push("from:" + t);
                return builder;
            },
        };
        return { db, calls };
    }

    it("czyta llm_route i NIE wykonuje zadnego zapisu (insert/update/delete)", async () => {
        const rows = [
            row("2026-05-30T10:00:00Z", { model: "claude-opus-4-7", prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.1 }),
        ];
        const { db, calls } = readOnlyFakeDb(rows);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = await readUsageEvents(db as any, "2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z");
        expect(events).toHaveLength(1);
        expect(calls).toContain("from:audit_log");
        expect(calls).toContain("select");
        expect(calls).toContain("eq");
        expect(calls).not.toContain("insert");
        expect(calls).not.toContain("update");
        expect(calls).not.toContain("delete");
        expect(calls).not.toContain("upsert");
    });
});
