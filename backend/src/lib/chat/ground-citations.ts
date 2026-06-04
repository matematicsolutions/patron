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
import {
    deriveProvenance,
    type Provenance,
    type ProvenanceTag,
} from "../citation/provenance";
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
    /**
     * ADR-0102 (A): dolacz tag proweniencji per cytat (flaga PATRON_PROVENANCE_TAGS,
     * default OFF). Deterministyczne (z rodzaju zrodla), zero egressu/PII. Oś
     * ortogonalna do verdict (ADR-0097). Brak = zero zmiany zachowania.
     */
    provenanceTags?: boolean;
}

/** Wynik groundingu cytatu, opcjonalnie wzbogacony o proweniencje (ADR-0102 A). */
export type GroundedCitation = GroundingResult & { provenance?: Provenance };

/** Okno kontekstu (znaki) po obu stronach znacznika [ref]. */
const CLAIM_WINDOW = 250;

/**
 * Wyciaga "teze" dla cytatu [ref] - fragment odpowiedzi wokol znacznika [ref].
 * To jest to, co odpowiedz TWIERDZI cytatem; sedzia ocenia, czy zrodlo to wspiera.
 * Brak znacznika -> "" (sedzia sie nie odpala dla tego cytatu).
 *
 * Okno ZNAKOWE (nie zdaniowe): polski tekst prawniczy jest pelen skrotow
 * ("art. ", "ust. ", "tj. ", "np. "), wiec dzielenie po kropce+spacji ucinaloby
 * teze w polowie. Okno przycinamy do granicy AKAPITU (newline), by nie wciagnac
 * sasiednich twierdzen. Blok <CITATIONS> (JSON na koncu odpowiedzi) odcinamy -
 * inaczej [ref] moglby trafic w surowy JSON zamiast w proze.
 */
export function extractClaim(
    answerText: string | undefined,
    ref: number,
): string {
    if (!answerText) return "";
    const tagPos = answerText.search(/<CITATIONS/i);
    const prose = tagPos >= 0 ? answerText.slice(0, tagPos) : answerText;
    const marker = `[${ref}]`;
    const pos = prose.indexOf(marker);
    if (pos === -1) return "";
    let start = Math.max(0, pos - CLAIM_WINDOW);
    let end = Math.min(prose.length, pos + marker.length + CLAIM_WINDOW);
    // Nie przekraczaj granicy akapitu - teza zwykle mieszci sie w jednym akapicie.
    const nlBefore = prose.lastIndexOf("\n", pos);
    if (nlBefore >= 0 && nlBefore + 1 > start) start = nlBefore + 1;
    const nlAfter = prose.indexOf("\n", pos);
    if (nlAfter !== -1 && nlAfter < end) end = nlAfter;
    return prose.slice(start, end).trim().slice(0, 600);
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

    const parsed: ParsedCitation[] = citations.map((c) => ({
        ref: c.ref,
        doc_id: c.doc_id,
        page: 1,
        quote: c.quote,
    }));

    // ADR-0102 (A): mapa ref->quote do detekcji pinpoint (sciezka deterministyczna
    // nie niesie cytatu w GroundingResult). sourceKind = client-doc (poziom 1
    // ADR-0005; poziom 2/3 SAOS/ISAP/EUR-Lex poda wlasny sourceKind przy wpieciu
    // resolverow). Tag wyprowadzany deterministycznie - zero egressu, zero PII.
    const quoteByRef = new Map(parsed.map((p) => [p.ref, p.quote]));
    const withProvenance = opts?.provenanceTags === true;
    const byRef: Record<number, GroundedCitation> = {};

    // Etap 3 (ADR-0097) tylko gdy wstrzyknieto sedziego. Inaczej deterministyczny
    // verifyCitations jak dotad (zero zmiany zachowania - flaga PATRON_CITATION_JUDGE).
    if (opts?.judge) {
        for (const c of parsed) {
            const source = textByDocId.get(c.doc_id) ?? null;
            const claim = extractClaim(opts.answerText, c.ref);
            // groundCascade lapie bledy sedziego wewnetrznie (fail-closed -> deterministyczny).
            const r = await groundCascade(c, source, {
                judge: opts.judge,
                claim: claim || undefined,
            });
            byRef[c.ref] = withProvenance
                ? { ...r, provenance: deriveProvenance("client-doc", c.quote) }
                : r;
        }
        return byRef;
    }

    // Sciezka deterministyczna (domyslna): synchroniczny resolver na mapie.
    const report = verifyCitations(parsed, (id) => textByDocId.get(id) ?? null);
    for (const r of report.results) {
        byRef[r.ref] = withProvenance
            ? {
                  ...r,
                  provenance: deriveProvenance("client-doc", quoteByRef.get(r.ref)),
              }
            : r;
    }
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

/** Statystyka proweniencji (ADR-0102 A) - liczby per tag, zero tresci/PII. */
export interface ProvenanceAuditSummary {
    saos: number;
    isap: number;
    eurlex: number;
    uzytkownik: number;
    model: number;
    /** Ile cytatow to pinpoint (numer jednostki redakcyjnej) - zawsze do weryfikacji. */
    pinpoint: number;
}

/**
 * Zwiezle podsumowanie werdyktow do payloadu audit_log (AI Act art. 12).
 * Bez tresci cytatow - tylko liczby decyzji (record-keeping, nie PII). Gdy
 * dzialal sedzia (ADR-0097), dolacza statystyke werdyktow semantycznych; gdy
 * dolaczono tagi proweniencji (ADR-0102 A), dolacza ich rozklad.
 */
export function groundingSummary(
    grounding: Record<number, GroundingResult>,
): {
    total: number;
    verified: number;
    unverified: number;
    blocked: number;
    judge?: JudgeAuditSummary;
    provenance?: ProvenanceAuditSummary;
} {
    const vals = Object.values(grounding);
    // CascadeResult (ADR-0097) dokleja verdict/stage; ADR-0102 dokleja provenance.
    // GroundingResult ich nie ma - czytamy przez optional cast (nie modyfikujemy rdzenia).
    type Maybe = GroundingResult & {
        verdict?: "green" | "yellow" | "red";
        stage?: number;
        provenance?: Provenance;
    };
    const out: {
        total: number;
        verified: number;
        unverified: number;
        blocked: number;
        judge?: JudgeAuditSummary;
        provenance?: ProvenanceAuditSummary;
    } = {
        total: vals.length,
        verified: vals.filter((r) => r.decision === "verified").length,
        unverified: vals.filter((r) => r.decision === "unverified").length,
        blocked: vals.filter((r) => r.decision === "blocked").length,
    };

    const judged = vals.filter((r) => (r as Maybe).stage === 3);
    if (judged.length > 0) {
        const v = (r: GroundingResult) => (r as Maybe).verdict;
        out.judge = {
            judged: judged.length,
            green: judged.filter((r) => v(r) === "green").length,
            yellow: judged.filter((r) => v(r) === "yellow").length,
            red: judged.filter((r) => v(r) === "red").length,
            downgraded: judged.filter(
                (r) => v(r) === "red" && r.decision === "verified",
            ).length,
        };
    }

    const provs = vals
        .map((r) => (r as Maybe).provenance)
        .filter((p): p is Provenance => p != null);
    if (provs.length > 0) {
        const count = (t: ProvenanceTag) =>
            provs.filter((p) => p.tag === t).length;
        out.provenance = {
            saos: count("saos"),
            isap: count("isap"),
            eurlex: count("eurlex"),
            uzytkownik: count("uzytkownik"),
            model: count("model"),
            pinpoint: provs.filter((p) => p.pinpoint).length,
        };
    }

    return out;
}
