// Punkt egzekwowania straznika data-residency (ADR-0067).
//
// Spina rejestr egress + decideRoute + konfiguracje srodowiska i rozwiazanie
// klasyfikacji sprawy z bazy. Zwraca decyzje + gotowy komunikat dla uzytkownika.
// SAM NIE loguje audytu - to robi punkt wywolania (lib/chat/stream.ts), ktory ma
// actor/chat/latency/usage. Tu trzymamy tylko logike decyzji + I/O klasyfikacji.

import type { createServerSupabase } from "../supabase";
import type { DataClassification } from "../llm/provider";
import { DataClassificationSchema } from "../llm/provider.schema";
import { egressForModel } from "./egress";
import { decideRoute, type RouteDecision } from "./decideRoute";
import { providerLabelForModel } from "./auditLlmRoute";

/**
 * Czy Administrator wlaczyl transfer do dostawcow US (DPA + DPF). Default false
 * (fail-closed). Konstytucja Art. 2/4: transfer poza EOG = swiadoma decyzja.
 */
export function allowUsProviders(): boolean {
    return process.env.ALLOW_US_PROVIDERS === "true";
}

/**
 * Czy Operator wyrazil swiadoma zgode na model chmurowy dla spraw objetych
 * tajemnica zawodowa (PATRON_ALLOW_PRIVILEGED_CLOUD). Na desktopie single-user
 * adwokat jest Operatorem na wlasnej maszynie - jego wybor modelu chmurowego
 * (Libra/Anthropic) jest ta zgoda; instalator ustawia ja domyslnie. Egress i tak
 * jest audytowany (dowod). Default false (fabryka serwerowa = rygor).
 */
export function allowPrivilegedCloud(): boolean {
    return process.env.PATRON_ALLOW_PRIVILEGED_CLOUD === "true";
}

/**
 * Sugerowany model lokalny (no-egress) do zaproponowania przy blokadzie.
 * Env PATRON_LOCAL_MODEL (np. "ollama/llama3.3:70b"). null jesli nieustawiony.
 */
export function defaultLocalModel(): string | null {
    return process.env.PATRON_LOCAL_MODEL?.trim() || null;
}

/**
 * Rozwiazuje klasyfikacje danych dla czatu. Sprawa (projectId) -> kolumna
 * projects.classification. Czat ogolny bez sprawy -> 'internal'. Sprawa
 * nieznaleziona lub blad odczytu -> fail-closed 'attorney_client_privileged'.
 */
export async function resolveClassification(
    db: ReturnType<typeof createServerSupabase>,
    projectId?: string | null,
): Promise<DataClassification> {
    if (!projectId) return "internal";
    try {
        const { data, error } = await db
            .from("projects")
            .select("classification")
            .eq("id", projectId)
            .limit(1);
        if (error) return "attorney_client_privileged";
        const row = data?.[0] as { classification?: string } | undefined;
        const parsed = DataClassificationSchema.safeParse(row?.classification);
        if (parsed.success) return parsed.data;
        // Brak kolumny / nieznana wartosc / sprawa nieznaleziona -> fail-closed.
        return "attorney_client_privileged";
    } catch {
        return "attorney_client_privileged";
    }
}

export interface EgressGuardResult {
    allowed: boolean;
    decision: RouteDecision;
    /** Etykieta dostawcy (providerLabelForModel) - do audytu. */
    provider: string;
    /** Komunikat PL dla uzytkownika, gdy zablokowano. */
    blockMessage?: string;
    /** Sugerowany model lokalny zastepczy, gdy zablokowano i jest skonfigurowany. */
    suggestedModel?: string;
}

function blockMessageFor(decision: RouteDecision, suggested: string | null): string {
    const tail = suggested
        ? ` Sugerowany model lokalny: ${suggested}.`
        : " Wybierz model lokalny (Ollama) albo zmien ustawienia sprawy.";
    switch (decision.reason) {
        case "privileged-requires-local":
            return (
                "Ta sprawa jest oznaczona jako objeta tajemnica zawodowa. " +
                "Dozwolony jest wylacznie model lokalny - dane nie moga opuscic urzadzenia." +
                tail
            );
        case "us-providers-disabled":
            return (
                "Wybrany model dziala u dostawcy spoza UE (USA). Transfer danych poza " +
                "EOG jest wylaczony. Administrator kancelarii moze go wlaczyc " +
                "(ALLOW_US_PROVIDERS) po zawarciu DPA, albo " +
                tail.trimStart()
            );
        default:
            return (
                "Routing do wybranego modelu zostal zablokowany przez polityke " +
                "data-residency." +
                tail
            );
    }
}

/**
 * Brama egress dla pojedynczego wywolania LLM. Rozwiazuje klasyfikacje sprawy,
 * mapuje model na strefe egress, podejmuje decyzje decideRoute i przygotowuje
 * komunikat blokady. Czysta z perspektywy audytu (nie loguje).
 */
export async function guardEgress(args: {
    db: ReturnType<typeof createServerSupabase>;
    model: string;
    projectId?: string | null;
}): Promise<EgressGuardResult> {
    const classification = await resolveClassification(args.db, args.projectId);
    const egress = egressForModel(args.model);
    const decision = decideRoute({
        classification,
        egress,
        allowUsProviders: allowUsProviders(),
        allowPrivilegedCloud: allowPrivilegedCloud(),
    });
    const provider = providerLabelForModel(args.model);
    if (decision.action === "allow") {
        return { allowed: true, decision, provider };
    }
    const suggested = defaultLocalModel();
    return {
        allowed: false,
        decision,
        provider,
        blockMessage: blockMessageFor(decision, suggested),
        suggestedModel: suggested ?? undefined,
    };
}
