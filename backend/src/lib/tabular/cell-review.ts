// ADR-0126 (T2.2): warstwa HUMAN-REVIEW komorki tabular review. Komplementarna
// do dwoch istniejacych warstw komorki:
//   - `status` (processing: pending/generating/done/error) - stan wygenerowania,
//   - `grounding` (grounding.ts, ADR-0080) - MECHANICZNA weryfikacja cytatu.
// Tu PRAWNIK akceptuje / odrzuca / poprawia WYNIK ekstrakcji = AKT LUDZKI
// (governance #2: agent generuje, czlowiek decyduje). Per-cell kto/co/kiedy
// zatwierdzil = spine AI Act art. 12 (record-keeping ludzkiego nadzoru).
//
// Wzorzec Open-Source-Legal/OpenContracts Datacell (approved_by/rejected_by/
// corrected_data) - WZORZEC, nie kod (THIRD_PARTY_INSPIRATIONS.md). Czysta
// warstwa (zero IO/LLM, deterministyczna - Konstytucja Art. 1, 3, 7).

export type CellReviewAction = "approved" | "rejected" | "corrected";

/** Rekord ludzkiej weryfikacji komorki. Persystowany obok content/grounding. */
export interface CellReview {
    action: CellReviewAction;
    /** actorId prawnika (odpowiedzialny czlowiek) - art. 12. */
    reviewedBy: string;
    /** Timestamp weryfikacji ISO. */
    reviewedAt: string;
    /** Poprawiona tresc - obecna TYLKO dla `corrected`. */
    correctedContent?: string;
}

/** Bramka human-in-the-loop: actorId musi byc czlowiekiem (nie auto/system). */
function isHumanActor(actorId: string): boolean {
    return !!actorId && actorId !== "analysis" && actorId !== "system";
}

/**
 * Buduje rekord human-review komorki (akt prawnika). Fail-closed:
 *   - `actorId` musi byc czlowiekiem (blokuje auto-akceptacje omijajaca nadzor);
 *   - `corrected` wymaga niepustej `correctedContent`;
 *   - `approved`/`rejected` NIE niosa `correctedContent` (czyszczone, by stan
 *     byl jednoznaczny).
 * Re-review jest dozwolone (prawnik moze zmienic zdanie) - zwraca NOWY rekord,
 * najnowszy nadpisuje poprzedni; pelna historia = audit_log (osobno).
 *
 * @returns CellReview albo null gdy naruszenie reguly.
 */
export function reviewCell(
    action: CellReviewAction,
    actorId: string,
    at: string,
    correctedContent?: string,
): CellReview | null {
    if (!isHumanActor(actorId)) return null;
    if (action === "corrected") {
        if (!correctedContent || correctedContent.trim().length === 0) {
            return null;
        }
        return { action, reviewedBy: actorId, reviewedAt: at, correctedContent };
    }
    return { action, reviewedBy: actorId, reviewedAt: at };
}

/**
 * Efektywna (zaakceptowana przez czlowieka) tresc komorki wg review:
 *   - brak review  -> tresc wygenerowana (jeszcze niezweryfikowana),
 *   - `approved`   -> tresc wygenerowana (zatwierdzona),
 *   - `corrected`  -> `correctedContent` (nadpisana przez prawnika),
 *   - `rejected`   -> null (wynik odrzucony, nie uzywac).
 */
export function effectiveCellContent(
    generated: string | null,
    review: CellReview | null,
): string | null {
    if (!review) return generated;
    if (review.action === "rejected") return null;
    if (review.action === "corrected") return review.correctedContent ?? null;
    return generated;
}

/** Czy komorka przeszla przez ludzka weryfikacje (badge UI / sygnal art. 12). */
export function isCellReviewed(review: CellReview | null): boolean {
    return review !== null;
}
