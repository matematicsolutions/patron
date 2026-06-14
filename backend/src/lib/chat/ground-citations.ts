// ADR-0005: warstwa wpiecia mechanicznej weryfikacji cytatow w pipeline czatu.
//
// Spina czysty deterministyczny weryfikator (lib/citation/grounding.ts) z asynchronicznym
// odczytem tekstu zrodlowego dokumentu klienta (tool-dispatch.getDocumentTextForGrounding).
// Wzorzec: prefetch tekstow cytowanych dokumentow do mapy (I/O async, raz na doc_id),
// potem synchroniczny resolver na mapie - weryfikator pozostaje czysty i testowalny.

import {
    type GroundingResult,
    verifyCitations,
} from "../citation/grounding";
import {
    type CitationLocator,
    locatorFromCollapsedQuote,
    locatorFromQuote,
} from "../citation/locator";
import type { ParsedCitation } from "./types";
import type { DocIndex, DocStore } from "./types";
import { getDocumentTextForGrounding } from "./tool-dispatch";
import type { createServerSupabase } from "../supabase";

/** Minimalny ksztalt cytatu potrzebny do groundingu (wspolny dla obu galezi stream). */
type GroundableCitation = { ref: number; doc_id: string; quote: string };

/**
 * Werdykt groundingu (ADR-0005) wzbogacony o trwaly lokator cytatu (ADR-0116).
 * `locator` powstaje gdy cytat wystepuje DOSLOWNIE w surowym zrodle (typowe dla
 * ZWERYFIKOWANY) - daje persystowalna, re-kotwiczalna pozycje pod highlight i
 * audit bundle (AI Act art. 12). null gdy nie da sie verbatim (fail-closed).
 * UWAGA: lokator (zawiera rawText=cytat) leci do SSE/persistence, NIE do
 * audit_log - audyt dostaje groundingSummary (same liczby).
 */
export interface GroundedCitation extends GroundingResult {
    locator: CitationLocator | null;
}

/**
 * Bezpieczna ekstrakcja {ref, doc_id, quote} z nieznanego rekordu cytatu.
 * stream.ts buduje cytaty dwiema galeziami (buildCitations / parseCitations.map),
 * obie zwracaja unknown[] - tu redukujemy do minimum potrzebnego do groundingu.
 */
function toGroundable(raw: unknown): GroundableCitation | null {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;
    if (
        typeof c.ref !== "number" ||
        typeof c.doc_id !== "string" ||
        typeof c.quote !== "string"
    ) {
        return null;
    }
    return { ref: c.ref, doc_id: c.doc_id, quote: c.quote };
}

/**
 * Weryfikuje cytaty z odpowiedzi wzgledem tekstu dokumentow klienta i zwraca
 * werdykt per `ref`. Poziom 1 ADR-0005 (dokumenty klienta, offline - kluczowe
 * dla Desktop zero-cloud). Poziomy 2/3 (orzeczenia SAOS / przepisy ISAP-EUR-Lex)
 * to przyszle resolvery dopinane analogicznie.
 *
 * Deterministyczne i bezpieczne: blad odczytu pojedynczego dokumentu izoluje sie
 * do BRAK_ZRODLA dla jego cytatow (decision=blocked), nie wywraca calej odpowiedzi.
 */
export async function groundCitationsByRef(
    rawCitations: readonly unknown[],
    docStore: DocStore,
    docIndex?: DocIndex,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<Record<number, GroundedCitation>> {
    const citations = rawCitations
        .map(toGroundable)
        .filter((c): c is GroundableCitation => c !== null);
    if (citations.length === 0) return {};

    // 1) prefetch tekstu zrodlowego raz na unikalny doc_id (async I/O)
    const distinctDocIds = [...new Set(citations.map((c) => c.doc_id))];
    const textByDocId = new Map<string, string | null>();
    await Promise.all(
        distinctDocIds.map(async (docId) => {
            try {
                textByDocId.set(
                    docId,
                    await getDocumentTextForGrounding(docId, docStore, docIndex, db),
                );
            } catch {
                textByDocId.set(docId, null);
            }
        }),
    );

    // 2) synchroniczny resolver na prefetchowanej mapie -> czysty weryfikator
    const parsed: ParsedCitation[] = citations.map((c) => ({
        ref: c.ref,
        doc_id: c.doc_id,
        page: 1,
        quote: c.quote,
    }));
    const report = verifyCitations(parsed, (id) => textByDocId.get(id) ?? null);

    // 3) trwaly lokator (ADR-0116) z surowego, juz prefetchowanego zrodla.
    // Bez dodatkowego I/O - textByDocId trzyma raw text. Lokator powstaje gdy
    // cytat jest verbatim w zrodle (locatorFromQuote = exact-or-null).
    const citByRef = new Map(citations.map((c) => [c.ref, c]));
    const byRef: Record<number, GroundedCitation> = {};
    for (const r of report.results) {
        const cit = citByRef.get(r.ref);
        const src = cit ? (textByDocId.get(cit.doc_id) ?? null) : null;
        // Najpierw exact (cytat verbatim), potem tolerancja bialych znakow
        // (cytat LLM rozni sie od zrodla tylko zwijaniem spacji/nowych linii).
        const locator =
            cit && src
                ? (locatorFromQuote(cit.quote, src) ??
                  locatorFromCollapsedQuote(cit.quote, src))
                : null;
        byRef[r.ref] = { ...r, locator };
    }
    return byRef;
}

/**
 * Zwiezle podsumowanie werdyktow do payloadu audit_log (AI Act art. 12).
 * Bez tresci cytatow - tylko liczby decyzji (record-keeping, nie PII).
 */
export function groundingSummary(
    grounding: Record<number, GroundingResult>,
): { total: number; verified: number; unverified: number; blocked: number } {
    const vals = Object.values(grounding);
    return {
        total: vals.length,
        verified: vals.filter((r) => r.decision === "verified").length,
        unverified: vals.filter((r) => r.decision === "unverified").length,
        blocked: vals.filter((r) => r.decision === "blocked").length,
    };
}
