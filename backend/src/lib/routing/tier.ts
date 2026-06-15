// Tier-governance egress dla operacji WIELOMODELOWYCH (envelope_tier / tier-floor).
//
// Adaptacja koncepcji z LegalQuants/lq-ai (Apache-2.0) - clean-room, zero kodu
// konkurenta. Patrz THIRD_PARTY_INSPIRATIONS.md.
//
// PROBLEM: `decideRoute` (ADR-0067) jest straznikiem POJEDYNCZEGO modelu. Gdy
// jedno zadanie rozszerza sie na WIELE wywolan modeli (przyszly ensemble
// groundingu cytatow, tabular multi-model), latwo wpiac straznik tylko dla
// modelu "glownego" i po cichu rozeslac TA SAMA tresc do pozostalych modeli z
// wyzsza strefa egress. Dla tajemnicy zawodowej (PoA art. 6, URP art. 3) to
// jest przeciek.
//
// ROZWIAZANIE: `envelope_tier` = NAJWYZSZA (najgorsza) strefa egress w calym
// zbiorze modeli. `tier-floor` (ceiling) = maksymalna DOZWOLONA strefa dla danej
// klasyfikacji. Operacja przechodzi tylko, gdy envelope_tier <= ceiling - inaczej
// blok PRZED jakimkolwiek wyjsciem do providera.
//
// SPOJNOSC z decideRoute (jedno zrodlo semantyki): `tierFloorFor` odwzorowuje
// dokladnie polityke decideRoute, a `guardEnvelopeTier` dla JEDNEGO modelu daje
// identyczna decyzje allow/block co decideRoute (zakute testem parytetu w
// tier.test.ts). Docelowe ujednolicenie - decideRoute deleguje tutaj - to
// rezerwacja (future-unify); na teraz dwie funkcje, jedna prawda semantyczna.
//
// FAIL-CLOSED: nieznany model -> us-with-dpa (z egressForModel) -> najwyzszy tier.

import type { DataClassification, EgressFlag } from "../llm/provider";
import { egressForModel } from "./egress";

/**
 * Tier egress = strefa, w ktorej fizycznie ladzie request. Alias na EgressFlag
 * (slownik ADR-0014) - tier NIE jest nowym wymiarem, to ta sama strefa
 * uporzadkowana relacja "surowosci".
 */
export type EgressTier = EgressFlag;

/**
 * Porzadek tierow: nizsza liczba = bardziej restrykcyjny (bezpieczniejszy) egress.
 * no-egress (0) < eu-only (1) < us-with-dpa (2). Stabilny - nie zmieniaj bez ADR.
 */
export const EGRESS_TIER_ORDER: Record<EgressTier, number> = {
    "no-egress": 0,
    "eu-only": 1,
    "us-with-dpa": 2,
};

/**
 * envelope_tier - najwyzsza (najgorsza) strefa egress w zbiorze tierow.
 * Pusty zbior (brak modeli = brak ruchu na zewnatrz) -> no-egress (0).
 * Czysta funkcja.
 */
export function maxTier(tiers: readonly EgressTier[]): EgressTier {
    let worst: EgressTier = "no-egress";
    for (const t of tiers) {
        if (EGRESS_TIER_ORDER[t] > EGRESS_TIER_ORDER[worst]) worst = t;
    }
    return worst;
}

/**
 * tier-floor (ceiling) - maksymalna DOZWOLONA strefa egress dla danej
 * klasyfikacji danych. Lustro polityki decideRoute (ADR-0067):
 *   - attorney_client_privileged: TYLKO no-egress (podloga = sufit, bez wyjatku;
 *     ALLOW_US_PROVIDERS NIE odblokowuje tajemnicy).
 *   - public / internal / client_general: eu-only zawsze dozwolone; us-with-dpa
 *     tylko gdy Administrator wlaczyl allowUsProviders (swiadomy transfer + DPA/DPF).
 * Czysta funkcja, zero IO.
 */
export function tierFloorFor(
    classification: DataClassification,
    allowUsProviders: boolean,
): EgressTier {
    if (classification === "attorney_client_privileged") return "no-egress";
    return allowUsProviders ? "us-with-dpa" : "eu-only";
}

export interface EnvelopeTierInput {
    /** Klasyfikacja danych sprawy/czatu (najsurowsza obowiazujaca). */
    classification: DataClassification;
    /** Wszystkie modele uzyte w operacji wielomodelowej (np. lista sedziow ensemble). */
    models: readonly string[];
    /** Czy Administrator wlaczyl transfer do US (DPA + DPF). NIE odblokowuje tajemnicy. */
    allowUsProviders: boolean;
}

/**
 * Powod decyzji envelope - stabilne wartosci do payload audit_log. Nie zmieniaj bez ADR.
 */
export type EnvelopeTierReason =
    | "within-ceiling" // allow: envelope_tier <= ceiling
    | "envelope-exceeds-ceiling"; // block: ktorys model przekracza dozwolona strefe

export interface EnvelopeTierDecision {
    allowed: boolean;
    reason: EnvelopeTierReason;
    /** Najwyzsza strefa egress w zbiorze modeli. */
    envelopeTier: EgressTier;
    /** Maksymalna dozwolona strefa dla klasyfikacji. */
    ceiling: EgressTier;
    /** Pierwszy model przekraczajacy ceiling (gdy block) - do diagnostyki/audytu. */
    offendingModel?: string;
}

/**
 * Straznik tier-governance dla operacji WIELOMODELOWEJ. N-arna wersja decideRoute:
 * gwarantuje, ze ZADEN model w zbiorze nie wyjdzie na strefe wyzsza niz dopuszcza
 * klasyfikacja. Liczy envelope PRZED jakimkolwiek wywolaniem - blok = nic nie wyszlo.
 *
 * Dla jednego modelu daje decyzje identyczna z decideRoute (parytet zakuty testem).
 * Czysta funkcja, zero IO.
 */
export function guardEnvelopeTier(
    input: EnvelopeTierInput,
): EnvelopeTierDecision {
    const ceiling = tierFloorFor(input.classification, input.allowUsProviders);
    const ceilingOrder = EGRESS_TIER_ORDER[ceiling];

    const tiered = input.models.map((model) => ({
        model,
        tier: egressForModel(model),
    }));
    const envelopeTier = maxTier(tiered.map((x) => x.tier));

    if (EGRESS_TIER_ORDER[envelopeTier] <= ceilingOrder) {
        return { allowed: true, reason: "within-ceiling", envelopeTier, ceiling };
    }

    const offending = tiered.find(
        (x) => EGRESS_TIER_ORDER[x.tier] > ceilingOrder,
    );
    return {
        allowed: false,
        reason: "envelope-exceeds-ceiling",
        envelopeTier,
        ceiling,
        offendingModel: offending?.model,
    };
}
