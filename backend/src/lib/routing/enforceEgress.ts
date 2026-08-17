// Wspolny CHOKEPOINT egress data-residency (ADR-0067, rozszerzenie).
//
// Jeden punkt egzekwowania dla KAZDEJ sciezki wychodzacej do LLM: czat
// (lib/chat/stream.ts) i pipeline obrony (routes/draft.ts). Dotad guardEgress
// byl wolany inline tylko w stream.ts, a /draft/refine egressowal BEZ straznika
// data-residency (tylko maskowanie PII) - tajemnica zawodowa mogla wyjsc do
// chmury. Ten helper domyka te luke: obie sciezki importuja te SAMA funkcje
// (AGENTS.md: "nie kopiuj logiki, importuj ja").
//
// Kontrakt: enforceEgressGuard liczy decyzje (guardEgress) i - GDY BLOK -
// emituje od razu zdarzenie audit_log "llm_route" (action: block). Sciezka
// dozwolona (allow) audytuje sie po stronie wolajacego, bo dopiero on zna
// realny koszt/latencje (usage) po zakonczeniu wywolania.

import type { createServerSupabase } from "../supabase";
import { guardEgress, type EgressGuardResult } from "./guard";
import { appendLlmRouteEvent } from "./auditLlmRoute";

export interface EnforceEgressInput {
    db: ReturnType<typeof createServerSupabase>;
    /** Pelny id wybranego modelu (egressForModel mapuje na strefe). */
    model: string;
    /** UUID sprawy (projects.id). null/undefined dla czatu/draftu ogolnego. */
    projectId?: string | null;
    /** UUID uzytkownika (mecenas) do actor_user_id audytu. */
    actorUserId: string | null;
    /** UUID czatu, jesli egress zaszedl w kontekscie czatu. */
    chatId?: string | null;
}

/**
 * Egzekwuje strażnika data-residency dla pojedynczego wywolania LLM i - przy
 * blokadzie - od razu zapisuje audyt "llm_route" (action: block) do hash-chain.
 * Zwraca pelny wynik guardEgress (allowed/decision/provider/blockMessage/
 * suggestedModel), by wolajacy mogl: (a) przy blokadzie pokazac komunikat,
 * (b) przy allow zaudytowac po zakonczeniu z realnym kosztem.
 */
export async function enforceEgressGuard(
    input: EnforceEgressInput,
): Promise<EgressGuardResult> {
    const guard = await guardEgress({
        db: input.db,
        model: input.model,
        projectId: input.projectId,
    });
    if (!guard.allowed) {
        await appendLlmRouteEvent(input.db, {
            actorUserId: input.actorUserId,
            chatId: input.chatId ?? null,
            caseId: input.projectId ?? null,
            model: input.model,
            provider: guard.provider,
            egress: guard.decision.egress,
            classification: guard.decision.classification,
            action: "block",
            reason: guard.decision.reason,
        });
    }
    return guard;
}
