// Router REST API dla panelu zuzycia i kosztow AI (ADR-0076).
//
// READ-ONLY reader nad zdarzeniami `llm_route` (ADR-0067) w `audit_log`. NIE
// zapisuje nic, NIE liczy Merkle - czyta, parsuje payload, agreguje. Koszt
// rozstrzyga `resolveCost` (realny `cost_usd` z dostawcy albo szacowany z
// `pricing.ts`). Funkcje agregujace sa czyste (eksportowane do testow).
//
// Autoryzacja: `requireAuth` + `requireAdmin` - parytet z audit viewer
// (ADR-0076 bramka), bo payload niesie `case_id` (dane wrazliwe). W trybie
// desktop single-user requireAdmin grantuje (operator = admin kancelarii).

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { resolveCost } from "../lib/llm/pricing";

export const usageRouter = Router();

/** Twardy limit liczby zdarzen w oknie - zabezpieczenie przed nieograniczonym skanem. */
const MAX_EVENTS = 100_000;
const DEFAULT_WINDOW_DAYS = 30;

interface LlmRoutePayload {
    model?: string;
    provider?: string;
    case_id?: string | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    cost_usd?: number | null;
}

interface AuditRow {
    ts: string;
    payload: unknown;
}

/** Zdarzenie llm_route po sparsowaniu i rozstrzygnieciu kosztu. */
export interface UsageEvent {
    ts: string;
    model: string;
    provider: string;
    caseId: string | null;
    promptTokens: number;
    completionTokens: number;
    /** Koszt USD (realny lub szacowany) albo null gdy model bez ceny. */
    costUsd: number | null;
    /** true = policzony z tabeli cen; false = realny z dostawcy. */
    costEstimated: boolean;
    /** true = model spoza cennika i bez realnego kosztu. */
    unpriced: boolean;
}

/**
 * Czysta transformacja: surowe wiersze audit_log -> UsageEvent[] z kosztem
 * rozstrzygnietym przez pricing.ts. Payload w SQLite bywa stringiem JSON,
 * w Postgres obiektem - obsluga obu.
 */
export function toUsageEvents(rows: AuditRow[]): UsageEvent[] {
    const out: UsageEvent[] = [];
    for (const r of rows) {
        let p: LlmRoutePayload;
        try {
            p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as LlmRoutePayload;
        } catch {
            continue; // payload niepoprawny - pomijamy zdarzenie, nie wywracamy panelu
        }
        if (!p || typeof p !== "object") continue;
        const model = p.model ?? "(nieznany)";
        const promptTokens = p.prompt_tokens ?? 0;
        const completionTokens = p.completion_tokens ?? 0;
        const cost = resolveCost(model, promptTokens, completionTokens, p.cost_usd ?? null);
        out.push({
            ts: r.ts,
            model,
            provider: p.provider ?? "(nieznany)",
            caseId: p.case_id ?? null,
            promptTokens,
            completionTokens,
            costUsd: cost.costUsd,
            costEstimated: cost.estimated,
            unpriced: cost.unpriced,
        });
    }
    return out;
}

export interface UsageSummary {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Suma kosztu realnego (z dostawcy). */
    costRealUsd: number;
    /** Suma kosztu szacowanego (z tabeli cen). */
    costEstimatedUsd: number;
    /** Liczba wywolan bez zadnego kosztu (model spoza cennika). */
    unpricedCalls: number;
}

function emptySummary(): UsageSummary {
    return {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costRealUsd: 0,
        costEstimatedUsd: 0,
        unpricedCalls: 0,
    };
}

function addEvent(s: UsageSummary, e: UsageEvent): void {
    s.calls += 1;
    s.promptTokens += e.promptTokens;
    s.completionTokens += e.completionTokens;
    s.totalTokens += e.promptTokens + e.completionTokens;
    if (e.costUsd === null) {
        s.unpricedCalls += 1;
    } else if (e.costEstimated) {
        s.costEstimatedUsd += e.costUsd;
    } else {
        s.costRealUsd += e.costUsd;
    }
}

/** Suma globalna w oknie. */
export function aggregateSummary(events: UsageEvent[]): UsageSummary {
    const s = emptySummary();
    for (const e of events) addEvent(s, e);
    return s;
}

/** Rozbicie wg dowolnego klucza, posortowane malejaco po koszcie+tokenach. */
export function aggregateByKey(
    events: UsageEvent[],
    keyFn: (e: UsageEvent) => string,
): Array<{ key: string } & UsageSummary> {
    const map = new Map<string, UsageSummary>();
    for (const e of events) {
        const k = keyFn(e);
        let s = map.get(k);
        if (!s) {
            s = emptySummary();
            map.set(k, s);
        }
        addEvent(s, e);
    }
    return [...map.entries()]
        .map(([key, s]) => ({ key, ...s }))
        .sort((a, b) => {
            const ca = a.costRealUsd + a.costEstimatedUsd;
            const cb = b.costRealUsd + b.costEstimatedUsd;
            return cb - ca || b.totalTokens - a.totalTokens;
        });
}

export function aggregateByModel(events: UsageEvent[]): Array<{ key: string } & UsageSummary> {
    return aggregateByKey(events, (e) => e.model);
}

export function aggregateByCase(events: UsageEvent[]): Array<{ key: string } & UsageSummary> {
    return aggregateByKey(events, (e) => e.caseId ?? "(brak sprawy)");
}

/** Szereg czasowy z kubelkiem dziennym (klucz YYYY-MM-DD), rosnaco po dacie. */
export function aggregateTimeseries(
    events: UsageEvent[],
): Array<{ key: string } & UsageSummary> {
    return aggregateByKey(events, (e) => e.ts.slice(0, 10)).sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
}

/** Parsuje okno czasu z query (?from&to ISO). Domyslnie ostatnie 30 dni. */
export function parseWindow(query: Record<string, unknown>): { from: string; until: string } {
    const now = new Date();
    const defFrom = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const fromRaw = typeof query.from === "string" ? query.from : null;
    const toRaw = typeof query.to === "string" ? query.to : null;
    const from = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? fromRaw : defFrom.toISOString();
    const until = toRaw && !Number.isNaN(Date.parse(toRaw)) ? toRaw : now.toISOString();
    return { from, until };
}

/** Czyta zdarzenia llm_route z audit_log w oknie i mapuje na UsageEvent[]. READ-ONLY. */
export async function readUsageEvents(
    db: ReturnType<typeof createServerSupabase>,
    from: string,
    until: string,
): Promise<UsageEvent[]> {
    const { data, error } = await db
        .from("audit_log")
        .select("ts, payload")
        .eq("event_type", "llm_route")
        .gte("ts", from)
        .lte("ts", until)
        .order("id", { ascending: false })
        .limit(MAX_EVENTS);
    if (error) throw new Error(error.message);
    return toUsageEvents((data ?? []) as AuditRow[]);
}

type Handler = (events: UsageEvent[]) => unknown;

/** Wspolny szkielet endpointu: okno -> DB read-only -> agregacja -> JSON. */
function usageEndpoint(aggregate: Handler) {
    return async (req: Request, res: Response): Promise<void> => {
        const { from, until } = parseWindow(req.query as Record<string, unknown>);
        let db: ReturnType<typeof createServerSupabase>;
        try {
            db = createServerSupabase();
        } catch (e) {
            res.status(500).json({ error: "supabase_unavailable", detail: e instanceof Error ? e.message : String(e) });
            return;
        }
        try {
            const events = await readUsageEvents(db, from, until);
            res.status(200).json({ from, until, count: events.length, data: aggregate(events) });
        } catch (err) {
            res.status(500).json({ error: "usage_query_failed", detail: err instanceof Error ? err.message : "unknown" });
        }
    };
}

usageRouter.get("/summary", requireAuth, requireAdmin, usageEndpoint((e) => aggregateSummary(e)));
usageRouter.get("/by-model", requireAuth, requireAdmin, usageEndpoint((e) => aggregateByModel(e)));
usageRouter.get("/by-case", requireAuth, requireAdmin, usageEndpoint((e) => aggregateByCase(e)));
usageRouter.get("/timeseries", requireAuth, requireAdmin, usageEndpoint((e) => aggregateTimeseries(e)));
