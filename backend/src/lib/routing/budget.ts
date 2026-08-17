// US5 / ADR-0093: twarde cost-caps per sprawa.
//
// Prog kosztu na sprawe z env PATRON_CASE_COST_CAP_USD (domyslnie WYLACZONY -
// brak zmiany zachowania, operator opt-in). Po przekroczeniu progu wywolanie LLM
// jest blokowane PRZED guardEgress (lib/chat/stream.ts), chyba ze operator
// swiadomie nadpisze (allowBudgetOverride). Kazda decyzja (block/override) idzie
// do audit_log jako event_type "cost_cap" (hash-chain, AI Act art. 12).
//
// Spend liczony z istniejacych zdarzen "llm_route" (ADR-0067) per sprawa,
// kosztem rozstrzyganym przez pricing.ts (realny z dostawcy albo szacowany).
// Funkcja oceny (evaluateBudget) jest czysta - testowalna bez DB.

import type { createServerSupabase } from "../supabase";
import { resolveCost } from "../llm/pricing";

const CAP_ENV = "PATRON_CASE_COST_CAP_USD";
/** Twardy limit skanu audit_log (parytet z usage.ts). */
const MAX_EVENTS = 100_000;

/** Prog kosztu per sprawa (USD) z env. null = cap wylaczony. */
export function caseCostCapUsd(): number | null {
    const raw = process.env[CAP_ENV];
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export interface BudgetDecision {
    capActive: boolean;
    capUsd: number | null;
    spentUsd: number;
    exceeded: boolean;
    /**
     * 'allow'    - ponizej progu albo cap wylaczony,
     * 'override' - przekroczony, operator swiadomie kontynuuje,
     * 'block'    - przekroczony, brak zgody operatora.
     */
    action: "allow" | "override" | "block";
}

/** Czysta ocena budzetu sprawy. */
export function evaluateBudget(args: {
    capUsd: number | null;
    spentUsd: number;
    override: boolean;
}): BudgetDecision {
    const { capUsd, spentUsd, override } = args;
    if (capUsd === null) {
        return { capActive: false, capUsd: null, spentUsd, exceeded: false, action: "allow" };
    }
    const exceeded = spentUsd >= capUsd;
    if (!exceeded) {
        return { capActive: true, capUsd, spentUsd, exceeded: false, action: "allow" };
    }
    return {
        capActive: true,
        capUsd,
        spentUsd,
        exceeded: true,
        action: override ? "override" : "block",
    };
}

interface AuditRow {
    payload: unknown;
}
interface LlmRoutePayload {
    model?: string;
    case_id?: string | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    cost_usd?: number | null;
}

/**
 * Suma kosztu (realny + szacowany) zdarzen "llm_route" dla danej sprawy. READ-ONLY.
 * Skanuje audit_log i filtruje po payload.case_id w JS (payload bywa stringiem w
 * SQLite, obiektem w Postgres - obsluga obu). Koszt jak w panelu zuzycia (pricing.ts).
 */
export async function getCaseSpentUsd(
    db: ReturnType<typeof createServerSupabase>,
    caseId: string,
): Promise<number> {
    const { data, error } = await db
        .from("audit_log")
        .select("payload")
        .eq("event_type", "llm_route")
        .order("id", { ascending: false })
        .limit(MAX_EVENTS);
    if (error) throw new Error(error.message);
    let total = 0;
    for (const r of (data ?? []) as AuditRow[]) {
        let p: LlmRoutePayload;
        try {
            p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as LlmRoutePayload;
        } catch {
            continue;
        }
        if (!p || typeof p !== "object" || (p.case_id ?? null) !== caseId) continue;
        const c = resolveCost(
            p.model ?? "",
            p.prompt_tokens ?? 0,
            p.completion_tokens ?? 0,
            p.cost_usd ?? null,
        );
        if (c.costUsd !== null) total += c.costUsd;
    }
    return total;
}
