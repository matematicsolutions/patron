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
import { groundCascade, type JudgeFn } from "../citation/cascade";
import type { ParsedCitation } from "./types";
import type { DocIndex, DocStore } from "./types";
import { getDocumentTextForGrounding } from "./tool-dispatch";
import type { createServerSupabase } from "../supabase";

/** Minimalny ksztalt cytatu potrzebny do groundingu (wspolny dla obu galezi stream). */
type GroundableCitation = { ref: number; doc_id: string; quote: string };

/** Opcje semantycznego etapu (ADR-0097). Bez nich grounding pozostaje deterministyczny. */
export interface GroundOptions {
    /** Tekst odpowiedzi - zrodlo tezy (claim) dla sedziego. */
    answerText?: string;
    /** Sedzia LLM (makeJudge). null/brak = etap 3 sie nie odpala (deterministyczny). */
    judge?: JudgeFn | null;
}

const SENTENCE_BOUNDARY = /[.!?]\s|\n/;

/**
 * Wyciaga "teze" dla cytatu [ref] - zdanie odpowiedzi zawierajace znacznik [ref].
 * To jest to, co odpowiedz TWIERDZI cytatem; sedzia ocenia, czy zrodlo to wspiera.
 * Brak znacznika -> "" (sedzia sie nie odpala dla tego cytatu).
 */
export function extractClaim(
    answerText: string | undefined,
    ref: number,
): string {
    if (!answerText) return "";
    const marker = `[${ref}]`;
    const pos = answerText.indexOf(marker);
    if (pos === -1) return "";
    // Granica zdania w lewo i w prawo wokol znacznika.
    let start = 0;
    for (let i = pos; i > 0; i--) {
        if (SENTENCE_BOUNDARY.test(answerText.slice(i - 1, i + 1))) {
            start = i;
            break;
        }
    }
    let end = answerText.length;
    for (let i = pos + marker.length; i < answerText.length - 1; i++) {
        if (SENTENCE_BOUNDARY.test(answerText.slice(i, i + 2))) {
            end = i + 1;
            break;
        }
    }
    return answerText.slice(start, end).trim().slice(0, 600);
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
    opts?: GroundOptions,
): Promise<Record<number, GroundingResult>> {
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

    const parsed: ParsedCitation[] = citations.map((c) => ({
        ref: c.ref,
        doc_id: c.doc_id,
        page: 1,
        quote: c.quote,
    }));

    const byRef: Record<number, GroundingResult> = {};

    // Etap 3 (ADR-0097) tylko gdy wstrzyknieto sedziego. Inaczej deterministyczny
    // verifyCitations jak dotad (zero zmiany zachowania - flaga PATRON_CITATION_JUDGE).
    if (opts?.judge) {
        for (const c of parsed) {
            const source = textByDocId.get(c.doc_id) ?? null;
            const claim = extractClaim(opts.answerText, c.ref);
            // groundCascade lapie bledy sedziego wewnetrznie (fail-closed -> deterministyczny).
            byRef[c.ref] = await groundCascade(c, source, {
                judge: opts.judge,
                claim: claim || undefined,
            });
        }
        return byRef;
    }

    // Sciezka deterministyczna (domyslna): synchroniczny resolver na mapie.
    const report = verifyCitations(parsed, (id) => textByDocId.get(id) ?? null);
    for (const r of report.results) byRef[r.ref] = r;
    return byRef;
}

/** Statystyka semantycznego etapu (ADR-0097) - tylko liczby/enumy, zero PII. */
export interface JudgeAuditSummary {
    /** Ile cytatow przeszlo przez sedziego (stage 3). */
    judged: number;
    green: number;
    yellow: number;
    red: number;
    /**
     * KLUCZOWA metryka moatu: ile cytatow sedzia ZDEGRADOWAL do red mimo
     * tekstowo poprawnego trafienia (decision=verified) - czyli zlapany przypadek
     * "cytat doslowny pod falszywa teza" (Stanford/Magesh). Dowod wartosci judge
     * dla audytu AI Act art. 12 i dla ewaluacji.
     */
    downgraded: number;
}

/**
 * Zwiezle podsumowanie werdyktow do payloadu audit_log (AI Act art. 12).
 * Bez tresci cytatow - tylko liczby decyzji (record-keeping, nie PII). Gdy
 * dzialal sedzia (ADR-0097), dolacza statystyke werdyktow semantycznych.
 */
export function groundingSummary(
    grounding: Record<number, GroundingResult>,
): {
    total: number;
    verified: number;
    unverified: number;
    blocked: number;
    judge?: JudgeAuditSummary;
} {
    const vals = Object.values(grounding);
    const base = {
        total: vals.length,
        verified: vals.filter((r) => r.decision === "verified").length,
        unverified: vals.filter((r) => r.decision === "unverified").length,
        blocked: vals.filter((r) => r.decision === "blocked").length,
    };
    // CascadeResult (ADR-0097) dokleja verdict/stage; GroundingResult ich nie ma.
    type Maybe = GroundingResult & {
        verdict?: "green" | "yellow" | "red";
        stage?: number;
    };
    const judged = vals.filter((r) => (r as Maybe).stage === 3);
    if (judged.length === 0) return base;
    const v = (r: GroundingResult) => (r as Maybe).verdict;
    return {
        ...base,
        judge: {
            judged: judged.length,
            green: judged.filter((r) => v(r) === "green").length,
            yellow: judged.filter((r) => v(r) === "yellow").length,
            red: judged.filter((r) => v(r) === "red").length,
            downgraded: judged.filter(
                (r) => v(r) === "red" && r.decision === "verified",
            ).length,
        },
    };
}
