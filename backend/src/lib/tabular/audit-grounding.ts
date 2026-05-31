// ADR-0082: propagacja werdyktu groundingu tabular (ADR-0080) do audit hash-chain.
//
// ADR-0080 weryfikuje cytaty inline komorek i zapisuje werdykt NA komorce -
// stan mutowalny (nadpisywany przy regeneracji). Ten modul dokleja rownolegly,
// NIEZMIENNY slad: kazdy przebieg generacji/regeneracji loguje rollup werdyktu
// do audit_log (hash-chain ADR-0001 + Merkle ADR-0026). Zaden nowy mechanizm
// audytu - tylko nowy event_type "tabular.grounding".
//
// Builder i agregator to CZYSTE funkcje (testowalne bez DB). Appender owija
// appendAuditEvent.
//
// UWAGA: payload to wylacznie liczby werdyktu - NIE wkladamy tu tresci cytatu
// ani fragmentu dokumentu (konwencja audit.ts; cytat moglby zawierac dane klienta).

import { appendAuditEvent, type AuditEventInput } from "../audit";
import type { createServerSupabase } from "../supabase";
import type { TabularCellGrounding } from "./grounding";

/** Zagregowany rollup werdyktow groundingu z jednego przebiegu. */
export interface TabularGroundingAggregate {
    /** Komorki, ktore mialy >=1 cytat inline (werdykt niepusty). */
    cells_grounded: number;
    /** Komorki z najgorszym stanem "unverified" (potencjalna halucynacja). */
    cells_unverified: number;
    /** Suma cytatow inline po wszystkich komorkach. */
    citations_total: number;
    verified: number;
    modified: number;
    unverified: number;
}

/**
 * Sumuje werdykty komorek do jednego rollupu. `undefined` (komorka bez cytatow
 * albo bez zrodla) nie liczy sie jako ugruntowana. Czysta funkcja.
 */
export function aggregateGrounding(
    verdicts: readonly (TabularCellGrounding | undefined)[],
): TabularGroundingAggregate {
    const agg: TabularGroundingAggregate = {
        cells_grounded: 0,
        cells_unverified: 0,
        citations_total: 0,
        verified: 0,
        modified: 0,
        unverified: 0,
    };
    for (const v of verdicts) {
        if (!v) continue;
        agg.cells_grounded++;
        if (v.status === "unverified") agg.cells_unverified++;
        agg.citations_total += v.total;
        agg.verified += v.verified;
        agg.modified += v.modified;
        agg.unverified += v.unverified;
    }
    return agg;
}

export interface TabularGroundingAuditInput {
    /** UUID uzytkownika (mecenas). Trafia do actor_user_id. */
    actorUserId: string | null;
    /** UUID przegladu tabular (tabular_reviews.id). Identyfikator, nie PII. */
    reviewId: string;
    /** Liczba dokumentow objetych przebiegiem. */
    documents: number;
    /** Rollup werdyktow (aggregateGrounding). */
    aggregate: TabularGroundingAggregate;
    /** "generate" (przebieg wsadowy) albo "regenerate_cell" (pojedyncza komorka). */
    trigger: "generate" | "regenerate_cell";
}

/**
 * Buduje AuditEventInput "tabular.grounding". Czysta funkcja. Wszystkie liczby
 * werdyktu ida do payload; actor do kolumny audit_log. Bez tresci cytatu.
 */
export function buildTabularGroundingEvent(
    input: TabularGroundingAuditInput,
): AuditEventInput {
    const a = input.aggregate;
    return {
        event_type: "tabular.grounding",
        actor_user_id: input.actorUserId,
        payload: {
            review_id: input.reviewId,
            trigger: input.trigger,
            documents: input.documents,
            cells_grounded: a.cells_grounded,
            cells_unverified: a.cells_unverified,
            citations_total: a.citations_total,
            verified: a.verified,
            modified: a.modified,
            unverified: a.unverified,
        },
    };
}

/**
 * Dopisuje zdarzenie "tabular.grounding" do audit_log (hash-chain). Nie rzuca -
 * audyt nie moze blokowac sciezki produktowej (kontrakt appendAuditEvent).
 * No-op gdy nie sprawdzono zadnego cytatu (citations_total === 0) - brak
 * substancji do zaswiadczenia.
 */
export async function appendTabularGroundingEvent(
    db: ReturnType<typeof createServerSupabase>,
    input: TabularGroundingAuditInput,
): Promise<void> {
    if (input.aggregate.citations_total === 0) return;
    await appendAuditEvent(db, buildTabularGroundingEvent(input));
}
