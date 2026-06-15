// ADR-0097 (biblioteka): kaskadowy grounding cytatow - warstwa SEMANTYCZNA nad
// deterministycznym verifyOne (ADR-0005). Adaptacja koncepcji z LegalQuants/lq-ai
// (Apache-2.0, paraphrase-judge) - clean-room, zero kodu konkurenta. Patrz
// THIRD_PARTY_INSPIRATIONS.md.
//
// PROBLEM (paper Stanford/Magesh): deterministyczny string-match lapie "cytat nie
// istnieje w zrodle", ale NIE lapie najgrozniejszego przypadku - prawdziwy,
// doslownie istniejacy fragment podstawiony pod FALSZYWA teze ("zrodlo to mowi,
// ale nie o tym"). Wtedy verifyOne zwraca ZWERYFIKOWANY/green = falszywe poczucie
// ugruntowania. Paraphrase-judge (LLM) ocenia, czy zrodlo NAPRAWDE wspiera teze.
//
// ARCHITEKTURA (kaskada, short-circuit):
//   Etap 1 EXACT / Etap 2 TOLERANT - verifyOne (deterministyczne, offline).
//   Etap 3 PARAPHRASE-JUDGE - opcjonalny, TYLKO gdy wstrzyknieto judge i znana
//     jest teza (claim). Judge moze: (a) ZDEGRADOWAC tekstowo-zielony do red, gdy
//     zrodlo nie wspiera tezy (lapie Stanford); (b) URATOWAC tekstowo-czerwony do
//     yellow, gdy zrodlo wspiera teze sensem (parafraza, nie verbatim).
//
// GRANICE (governance, ADR-0097):
//   - decision (verified/unverified/blocked) z verifyOne ZOSTAJE deterministyczna
//     i jest zrodlem prawdy dla BLOKADY deliverable. verdict (green/yellow/red) to
//     warstwa DORADCZA dla UI/audytu. Czy verdict ma blokowac = decyzja governance
//     (rezerwacja - patrz ADR).
//   - judge to akt WEWNETRZNY (ocena). Egress judge podlega data-residency
//     (enforceEgress.ts, ADR-0095): dla tajemnicy wylacznie model lokalny; brak
//     lokalnego = etap 3 sie NIE odpala (fail-closed), verdict zostaje tekstowy.
//   - judgeReason (uzasadnienie LLM) moze zawierac tresc cytatu = PII -> NIGDY do
//     audit_log; tylko do UI tooltipa.
//
// To jest BIBLIOTEKA. Wpiecie w szwy (chat ground-citations.ts, tabular), adapter
// realnego judge (judge.ts), OCR-aware tolerant i UX zoltego stanu = rezerwacje.

import type { ParsedCitation } from "../chat/types";
import { verifyOne, normalize, type GroundingResult } from "./grounding";

/** Werdykt 3-kolorowy - warstwa doradcza nad deterministyczna decision. */
export type CascadeVerdict = "green" | "yellow" | "red";

/** Werdykt sedziego LLM (structured output). PL, zgodnie z prompt-template. */
export interface JudgeVerdict {
    verdict: "tak" | "czesciowo" | "nie";
    confidence: "wysoka" | "srednia" | "niska";
    uzasadnienie: string;
}

export interface JudgeInput {
    /** Cytat dokladnie tak, jak wystepuje w odpowiedzi. */
    quote: string;
    /** Teza/twierdzenie, pod ktore cytat jest uzyty (do oceny wsparcia). */
    claim: string;
    /** Wycinek zrodla +/- contextWindow wokol najlepszego dopasowania. */
    sourceContext: string;
}

/**
 * Port sedziego - wstrzykiwany (deps-injection jak SourceResolver/LlmCompleteFn).
 * Adapter realnego LLM (judge.ts) = rezerwacja; testy podaja deterministyczny fake.
 */
export type JudgeFn = (input: JudgeInput) => Promise<JudgeVerdict>;

export interface CascadeOptions {
    /** Sedzia LLM. Brak = kaskada konczy na etapie 1/2 (no-op semantyczny). */
    judge?: JudgeFn;
    /** Teza, pod ktore cytat jest uzyty. Bez niej etap 3 sie nie odpala. */
    claim?: string;
    /** Szerokosc kontekstu wokol dopasowania (znaki, default 200). */
    contextWindow?: number;
}

export interface CascadeResult extends GroundingResult {
    /** Werdykt 3-kolorowy (doradczy). green=ugruntowany, yellow=czesciowo/parafraza, red=brak. */
    verdict: CascadeVerdict;
    /** Ktory etap rozstrzygnal (1 exact, 2 tolerant, 3 judge). Do audytu/debugu. */
    stage: 1 | 2 | 3;
    /** Pewnosc [0..1]. Etap 1/2 z dopasowania tekstu; etap 3 z confidence sedziego. */
    confidence: number;
    /** True gdy zrodlo wspiera teze tylko czesciowo / przez parafraze. */
    partial: boolean;
    /** Uzasadnienie sedziego - TYLKO UI, NIGDY audit (moze zawierac PII). */
    judgeReason?: string;
}

/** Mapowanie pewnosci slownej sedziego na liczbe (LQ.AI: tak/czesciowo/nie). */
const JUDGE_CONFIDENCE: Record<JudgeVerdict["confidence"], number> = {
    wysoka: 0.9,
    srednia: 0.7,
    niska: 0.5,
};

function textVerdict(result: GroundingResult): CascadeVerdict {
    switch (result.status) {
        case "ZWERYFIKOWANY":
            return "green";
        case "ZMODYFIKOWANY":
            return "yellow";
        case "NIEZWERYFIKOWANY":
        case "BRAK_ZRODLA":
            return "red";
    }
}

function textConfidence(result: GroundingResult): number {
    if (result.status === "ZWERYFIKOWANY") return 1;
    const c = 1 - result.worstRatio;
    return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Wycinek znormalizowanego zrodla wokol offsetu (kontekst dla sedziego). */
function sourceContextAround(
    sourceText: string | null,
    offset: number,
    quoteLen: number,
    window: number,
): string {
    const src = normalize(sourceText);
    if (src.length === 0) return "";
    if (offset < 0) return src.slice(0, window * 2);
    const start = Math.max(0, offset - window);
    const end = Math.min(src.length, offset + quoteLen + window);
    return src.slice(start, end);
}

/**
 * Kaskadowy grounding pojedynczego cytatu. Bez judge = zachowanie verifyOne
 * opakowane w werdykt 3-kolorowy (no-op semantyczny). Z judge + claim = etap 3
 * koryguje werdykt (degraduje Stanford-FALSE-UNDER-TRUE, ratuje parafraze).
 *
 * decision (deterministyczna, blokada) NIE jest zmieniana - to robi wiring wg
 * decyzji governance. verdict to warstwa doradcza.
 */
export async function groundCascade(
    citation: ParsedCitation,
    sourceText: string | null,
    opts: CascadeOptions = {},
): Promise<CascadeResult> {
    const text = verifyOne(citation, sourceText);
    const exactStage: 1 | 2 =
        text.status === "ZWERYFIKOWANY" && text.worstRatio === 0 ? 1 : 2;

    let verdict = textVerdict(text);
    let confidence = textConfidence(text);
    let partial = verdict === "yellow";
    let stage: 1 | 2 | 3 = exactStage;
    let judgeReason: string | undefined;

    // Etap 3 tylko gdy: jest sedzia, znana teza, i zrodlo istnieje (BRAK_ZRODLA
    // pozostaje red - nie ma czego oceniac semantycznie).
    if (opts.judge && opts.claim && text.status !== "BRAK_ZRODLA") {
        const ctx = sourceContextAround(
            sourceText,
            text.offset,
            normalize(citation.quote).length,
            opts.contextWindow ?? 200,
        );
        let jv: JudgeVerdict;
        try {
            jv = await opts.judge({
                quote: citation.quote,
                claim: opts.claim,
                sourceContext: ctx,
            });
        } catch {
            // FAIL-CLOSED: sedzia niedostepny / blad parsowania -> NIE eskalujemy,
            // zostaje werdykt deterministyczny (etap 1/2). Judge nie moze zepsuc
            // groundingu - w najgorszym razie nie poprawia.
            return { ...text, verdict, stage, confidence, partial };
        }
        stage = 3;
        confidence = JUDGE_CONFIDENCE[jv.confidence];
        judgeReason = jv.uzasadnienie;
        if (jv.verdict === "nie") {
            // Zrodlo NIE wspiera tezy - nawet jesli cytat istnieje doslownie
            // (Stanford/Magesh). Konserwatywnie: red. false-positive gorszy.
            verdict = "red";
            partial = false;
        } else if (jv.verdict === "czesciowo") {
            verdict = "yellow";
            partial = true;
        } else {
            // "tak": green gdy tekst tez sie zgadzal; yellow gdy wsparcie sensem
            // (parafraza) bez dokladnego dopasowania tekstowego.
            verdict = text.status === "ZWERYFIKOWANY" ? "green" : "yellow";
            partial = verdict === "yellow";
        }
    }

    return { ...text, verdict, stage, confidence, partial, judgeReason };
}
