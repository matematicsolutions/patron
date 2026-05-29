// Straznik data-residency (ADR-0014 router T3 / ADR-alpha straznik 1).
//
// Czysta funkcja decyzyjna, wzorowana na `decideRing` (ADR-0027 lib/mcp/ring-policy.ts):
// zero IO, zero side-effects, w pelni testowalna w izolacji. Punkt egzekwowania
// (lib/chat/stream.ts) wola ja PRZED kazdym wyjsciem do providera i blokuje
// wywolanie, gdy decyzja to "block".
//
// Polityka (lustro doc w lib/llm/provider.ts DataClassification):
//   - attorney_client_privileged (tajemnica zawodowa, Pr.Adw. art.6, Pr.RP art.3):
//       TYLKO no-egress (model lokalny). Kazda chmura = blok. Bez wyjatku - flaga
//       ALLOW_US_PROVIDERS NIE odblokowuje tajemnicy.
//   - client_general (dane klienta nieobjete tajemnica):
//       no-egress lub eu-only zawsze; us-with-dpa tylko gdy Administrator wlaczyl
//       ALLOW_US_PROVIDERS (swiadoma decyzja transferu poza EOG + DPA/DPF).
//   - internal / public (dane wewnetrzne kancelarii / publiczne):
//       no-egress lub eu-only zawsze; us-with-dpa tylko gdy ALLOW_US_PROVIDERS.
//
// FAIL-CLOSED: nieznana strefa modelu jest mapowana na us-with-dpa juz w
// egressForModel, wiec tutaj nie ma "domyslnie przepusc".

import type { DataClassification, EgressFlag } from "../llm/provider";

export type RouteAction = "allow" | "block";

/**
 * Powod decyzji - string union czytany przez audytora w payload.reason
 * zdarzenia audit_log "llm_route". Stabilne wartosci (nie zmieniaj bez ADR).
 */
export type RouteReason =
    | "local-no-egress" // allow: model lokalny, dane nie opuszczaja maszyny
    | "eu-within-allowed-zone" // allow: eu-only dla klasyfikacji ktora to dopuszcza
    | "us-allowed-by-administrator" // allow: us-with-dpa + ALLOW_US_PROVIDERS=true
    | "privileged-requires-local" // block: tajemnica do nie-lokalnego modelu
    | "us-providers-disabled" // block: us-with-dpa ale ALLOW_US_PROVIDERS=false
    | "egress-zone-not-permitted"; // block: strefa niedozwolona dla klasyfikacji

export interface RouteDecisionInput {
    /** Klasyfikacja danych sprawy/czatu. Patrz DataClassification (ADR-0014). */
    classification: DataClassification;
    /** Strefa egress wybranego modelu (egressForModel). */
    egress: EgressFlag;
    /**
     * Czy Administrator kancelarii wlaczyl transfer do US (DPA + DPF).
     * Default false. NIE odblokowuje attorney_client_privileged.
     */
    allowUsProviders: boolean;
}

export interface RouteDecision {
    action: RouteAction;
    reason: RouteReason;
    classification: DataClassification;
    egress: EgressFlag;
}

/**
 * Decyzja straznika data-residency. Pure function.
 *
 * @returns RouteDecision do propagacji do audit_log (event_type "llm_route")
 *          i do egzekwowania w punkcie wyjscia do providera.
 */
export function decideRoute(input: RouteDecisionInput): RouteDecision {
    const { classification, egress, allowUsProviders } = input;
    const base = { classification, egress } as const;

    // Model lokalny zawsze dozwolony - dane nie opuszczaja maszyny kancelarii.
    if (egress === "no-egress") {
        return { action: "allow", reason: "local-no-egress", ...base };
    }

    // Tajemnica zawodowa: tylko lokalnie. Zadna chmura, niezaleznie od flagi.
    if (classification === "attorney_client_privileged") {
        return {
            action: "block",
            reason: "privileged-requires-local",
            ...base,
        };
    }

    // Strefa UE: dozwolona dla wszystkich klasyfikacji ponizej tajemnicy.
    if (egress === "eu-only") {
        return { action: "allow", reason: "eu-within-allowed-zone", ...base };
    }

    // Strefa US (us-with-dpa): wymaga swiadomej zgody Administratora.
    if (egress === "us-with-dpa") {
        if (allowUsProviders) {
            return {
                action: "allow",
                reason: "us-allowed-by-administrator",
                ...base,
            };
        }
        return { action: "block", reason: "us-providers-disabled", ...base };
    }

    // Nieosiagalne przy obecnym EgressFlag, ale fail-closed na wszelki wypadek
    // (np. gdyby dodano nowa strefe bez aktualizacji tej funkcji).
    return { action: "block", reason: "egress-zone-not-permitted", ...base };
}
