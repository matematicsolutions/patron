// ADR-0097 (adapter): realny paraphrase-judge dla kaskady groundingu (cascade.ts).
//
// Buduje JudgeFn wywolujacy LLM przez istniejacy completeText, ALE dopiero po
// przejsciu strażnika data-residency (guardEgress, ADR-0067/0095). FAIL-CLOSED:
// gdy klasyfikacja sprawy nie dopuszcza modelu (tajemnica + model chmurowy),
// makeJudge zwraca null -> kaskada nie dostaje sedziego -> werdykt zostaje
// deterministyczny. Tresc cytatu/zrodla NIE trafia do modelu, ktorego residency
// nie dopuszcza.
//
// Prompt-template PL z twarda kalibracja "false-positive gorszy niz false-negative"
// (LQ.AI/Stanford). Wyjscie: structured JSON {verdict, confidence, uzasadnienie}.
// Parsowanie nieudane -> throw -> cascade.ts lapie i degraduje do werdyktu
// deterministycznego (sedzia nie moze zepsuc groundingu).

import type { createServerSupabase } from "../supabase";
import type { UserApiKeys } from "../llm";
import { completeText } from "../llm";
import { guardEgress } from "../routing";
import type { JudgeFn, JudgeVerdict } from "./cascade";

/** Wstrzykiwalny wariant completeText (testy podaja fake). */
export type CompleteTextFn = (params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}) => Promise<string>;

export interface MakeJudgeOptions {
    db: ReturnType<typeof createServerSupabase>;
    /** Model sedziego (zwykle ten sam co model czatu - dziedziczy residency). */
    model: string;
    apiKeys?: UserApiKeys;
    /** Sprawa - do rozwiazania klasyfikacji (guardEgress). null = czat ogolny. */
    projectId?: string | null;
    /** Wstrzykiwany completeText (default realny). */
    complete?: CompleteTextFn;
}

const SYSTEM_PROMPT =
    "Jestes sedzia weryfikacji cytatu w polskim tekscie prawniczym. Oceniasz WYLACZNIE, " +
    "czy ZRODLO faktycznie wspiera TEZE, pod ktora cytat zostal uzyty. NIE oceniasz " +
    "meritum prawnego ani sluszynosci - tylko czy zrodlo mowi to, co twierdzi teza. " +
    "Gdy niepewny, wybierz 'nie' albo 'czesciowo' - falszywe potwierdzenie jest GORSZE " +
    "niz falszywy alarm. Odpowiedz WYLACZNIE jednym obiektem JSON, bez komentarza, bez " +
    'markdown: {"verdict":"tak|czesciowo|nie","confidence":"wysoka|srednia|niska",' +
    '"uzasadnienie":"jedno-dwa zdania"}. ' +
    "verdict: tak = zrodlo wspiera cala teze; czesciowo = wspiera czesc / z zastrzezeniem; " +
    "nie = nie wspiera lub przeczy.";

function buildUserPrompt(input: {
    quote: string;
    claim: string;
    sourceContext: string;
}): string {
    return (
        `ZRODLO (wycinek):\n${input.sourceContext}\n\n` +
        `CYTAT uzyty w odpowiedzi:\n${input.quote}\n\n` +
        `TEZA, pod ktora cytat zostal uzyty:\n${input.claim}\n\n` +
        "Czy ZRODLO wspiera TEZE? Zwroc sam JSON."
    );
}

const VERDICTS = new Set(["tak", "czesciowo", "nie"]);
const CONFIDENCES = new Set(["wysoka", "srednia", "niska"]);

/** Parsuje odpowiedz sedziego. Rzuca przy niepoprawnym JSON / polach (cascade lapie). */
export function parseJudgeResponse(raw: string): JudgeVerdict {
    // Zdejmij ewentualne ogrodzenie ```json ... ```
    const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const verdict = obj.verdict;
    const confidence = obj.confidence;
    const uzasadnienie = obj.uzasadnienie;
    if (
        typeof verdict !== "string" ||
        !VERDICTS.has(verdict) ||
        typeof confidence !== "string" ||
        !CONFIDENCES.has(confidence)
    ) {
        throw new Error("judge: niepoprawny werdykt/confidence");
    }
    return {
        verdict: verdict as JudgeVerdict["verdict"],
        confidence: confidence as JudgeVerdict["confidence"],
        uzasadnienie: typeof uzasadnienie === "string" ? uzasadnienie : "",
    };
}

/**
 * Tworzy sedziego LLM dla kaskady. Zwraca null, gdy strażnik data-residency nie
 * dopuszcza modelu dla klasyfikacji sprawy (fail-closed - kaskada zostaje
 * deterministyczna, tresc nie wychodzi do niedozwolonego modelu).
 */
export async function makeJudge(
    opts: MakeJudgeOptions,
): Promise<JudgeFn | null> {
    const guard = await guardEgress({
        db: opts.db,
        model: opts.model,
        projectId: opts.projectId,
    });
    if (!guard.allowed) return null;

    const complete = opts.complete ?? completeText;
    return async (input) => {
        const raw = await complete({
            model: opts.model,
            systemPrompt: SYSTEM_PROMPT,
            user: buildUserPrompt({
                quote: input.quote,
                claim: input.claim,
                sourceContext: input.sourceContext,
            }),
            maxTokens: 400,
            apiKeys: opts.apiKeys,
        });
        return parseJudgeResponse(raw);
    };
}
