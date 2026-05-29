// Per-call audit straznika routingu (ADR-0067 / ADR-alpha straznik 2).
//
// Buduje zdarzenie audit_log "llm_route" dla kazdego wywolania LLM: ktory model,
// dostawca, strefa egress, klasyfikacja danych sprawy, decyzja straznika
// (allow/block), realny koszt, latencja, actor, sprawa. Wchodzi do istniejacego
// hash-chain (ADR-0001) + Merkle (ADR-0026/0036) + audit pack (ADR-0047/0048) -
// zaden nowy mechanizm audytu, tylko nowy typ zdarzenia.
//
// Builder jest CZYSTA funkcja (testowalna bez DB). Appender owija appendAuditEvent.
//
// UWAGA: payload to wylacznie metadane routingu - NIE wkladamy tu tresci promptu
// ani danych klienta (zgodnie z konwencja audit.ts).

import { appendAuditEvent, type AuditEventInput } from "../audit";
import type { createServerSupabase } from "../supabase";
import type { DataClassification, EgressFlag } from "../llm/provider";
import type { RouteAction, RouteReason } from "./decideRoute";
import { OPENROUTER_PREFIX } from "../llm/models";
import { OLLAMA_PREFIX } from "./egress";

/** Realne zuzycie zwrocone przez dostawce (OpenRouter zwraca koszt; reszta nie). */
export interface LlmRouteUsage {
    promptTokens?: number | null;
    completionTokens?: number | null;
    /** Realny koszt w USD z odpowiedzi dostawcy. null = niedostepny (szacunek/brak). */
    costUsd?: number | null;
}

export interface LlmRouteAuditInput {
    /** UUID uzytkownika (mecenas). Trafia do actor_user_id. */
    actorUserId: string | null;
    /** UUID czatu, jesli zdarzenie zaszlo w kontekscie czatu. */
    chatId?: string | null;
    /** UUID sprawy (projects.id). null dla czatu ogolnego. */
    caseId?: string | null;
    /** Pelny id modelu (np. "gemini-3-flash-preview", "ollama/llama3.3:70b"). */
    model: string;
    /** Etykieta dostawcy meaningful dla residency (providerLabelForModel). */
    provider: string;
    egress: EgressFlag;
    classification: DataClassification;
    action: RouteAction;
    reason: RouteReason;
    latencyMs?: number | null;
    usage?: LlmRouteUsage | null;
}

/**
 * Etykieta dostawcy istotna dla residency - inna niz wewnetrzny `Provider`
 * (claude/gemini/openai/openrouter), bo wyroznia Ollama (lokalny) i nieznane.
 */
export function providerLabelForModel(model: string): string {
    if (model.startsWith(OLLAMA_PREFIX)) return "ollama";
    if (model.startsWith(OPENROUTER_PREFIX)) return "openrouter";
    if (model.startsWith("claude")) return "anthropic";
    if (model.startsWith("gpt-")) return "openai";
    if (model.startsWith("gemini")) return "google";
    return "unknown";
}

/**
 * Buduje AuditEventInput "llm_route". Czysta funkcja. Wszystkie pola routingu
 * (model/dostawca/strefa/klasyfikacja/decyzja/koszt/latencja/sprawa) ida do
 * payload; actor i chat do kolumn audit_log.
 */
export function buildLlmRouteEvent(input: LlmRouteAuditInput): AuditEventInput {
    const usage = input.usage ?? {};
    const costUsd = usage.costUsd ?? null;
    return {
        event_type: "llm_route",
        actor_user_id: input.actorUserId,
        chat_id: input.chatId ?? null,
        payload: {
            model: input.model,
            provider: input.provider,
            egress: input.egress,
            classification: input.classification,
            decision: input.action,
            reason: input.reason,
            case_id: input.caseId ?? null,
            prompt_tokens: usage.promptTokens ?? null,
            completion_tokens: usage.completionTokens ?? null,
            cost_usd: costUsd,
            // Brak realnego kosztu z dostawcy = oznaczamy ze NIE jest to koszt
            // rzeczywisty (AC2.3). Statyczna tabela cen to rezerwacja ADR-beta.
            cost_estimated: costUsd === null,
            latency_ms: input.latencyMs ?? null,
        },
    };
}

/**
 * Dopisuje zdarzenie "llm_route" do audit_log (hash-chain). Nie rzuca -
 * audyt nie moze blokowac sciezki produktowej (kontrakt appendAuditEvent).
 */
export async function appendLlmRouteEvent(
    db: ReturnType<typeof createServerSupabase>,
    input: LlmRouteAuditInput,
): Promise<void> {
    await appendAuditEvent(db, buildLlmRouteEvent(input));
}
