// US5 / ADR-0093: audit zdarzenia cost-cap (event_type "cost_cap").
//
// Dedykowany typ zdarzenia (nie llm_route) - budzet to inna semantyka niz
// data-residency. Wchodzi do tego samego hash-chain (ADR-0001) + Merkle
// (ADR-0026) + audit pack (ADR-0047), dowod nalezytej starannosci AI Act art. 12.
// Builder czysta funkcja (testowalna bez DB). Appender owija appendAuditEvent.
//
// UWAGA: payload to metadane budzetu (sprawa, model, koszt, prog, decyzja) -
// bez tresci promptu ani danych klienta (konwencja audit.ts).

import { appendAuditEvent, type AuditEventInput } from "../audit";
import type { createServerSupabase } from "../supabase";

export interface CostCapAuditInput {
    /** UUID uzytkownika (mecenas). Trafia do actor_user_id. */
    actorUserId: string | null;
    chatId?: string | null;
    /** UUID sprawy (projects.id), ktorej dotyczy limit. */
    caseId: string;
    model: string;
    /** Skumulowany koszt sprawy w chwili decyzji (USD). */
    spentUsd: number;
    /** Prog z PATRON_CASE_COST_CAP_USD (USD). */
    capUsd: number;
    /** 'block' - zatrzymano wywolanie; 'override' - operator swiadomie kontynuowal. */
    action: "block" | "override";
}

/** Buduje AuditEventInput "cost_cap". Czysta funkcja. */
export function buildCostCapEvent(input: CostCapAuditInput): AuditEventInput {
    return {
        event_type: "cost_cap",
        actor_user_id: input.actorUserId,
        chat_id: input.chatId ?? null,
        payload: {
            case_id: input.caseId,
            model: input.model,
            spent_usd: input.spentUsd,
            cap_usd: input.capUsd,
            action: input.action,
        },
    };
}

/**
 * Dopisuje zdarzenie "cost_cap" do audit_log (hash-chain). Nie rzuca -
 * audyt nie moze blokowac sciezki produktowej (kontrakt appendAuditEvent).
 */
export async function appendCostCapEvent(
    db: ReturnType<typeof createServerSupabase>,
    input: CostCapAuditInput,
): Promise<void> {
    await appendAuditEvent(db, buildCostCapEvent(input));
}
