// Eval paraphrase-judge (ADR-0097, cascade.ts etap 3) na korpusie PL.
//
// MAKSYMALNA WIERNOSC: uzywa REALNEGO makeJudge (judge.ts) -> realny completeText
// (llm/index.ts) -> realny OllamaProvider. Sedzia jest LOKALNY-ONLY; dla modelu
// "ollama/..." + projectId=null guardEgress przepuszcza bez dotykania DB
// (resolveClassification(null)="internal", egress=no-egress, decideRoute=allow),
// wiec atrapa db jest bezpieczna (nigdy nie wywolana).
//
// Mierzy na 3 kategoriach: TRUE / PARAPHRASE / FALSE_UNDER_TRUE (Stanford/Magesh).
// Kazdy przypadek N prob (LLM niedeterministyczny) -> werdykt wiekszosciowy + slad.
//
// Uruchom:  npx tsx scripts/eval-judge-pl.ts [sciezka-korpusu] [trials]
//   default korpus: C:/Users/Wieslaw/Projects/legal-eval-harness/judge-pl/corpus-pl.json
//   default model:  env PATRON_LOCAL_MODEL || "ollama/llama3.2:3b"

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { groundCascade, type CascadeVerdict } from "../src/lib/citation/cascade";
import { makeJudge } from "../src/lib/citation/judge";
import type { ParsedCitation } from "../src/lib/chat/types";

interface Case {
    id: string;
    category: "TRUE" | "PARAPHRASE" | "FALSE_UNDER_TRUE";
    doc_id: string;
    source: string;
    quote: string;
    claim: string;
}

const corpusPath =
    process.argv[2] ??
    "C:/Users/Wieslaw/Projects/legal-eval-harness/judge-pl/corpus-pl.json";
const TRIALS = Number(process.argv[3] ?? 3);
const MODEL = process.env.PATRON_LOCAL_MODEL?.trim() || "ollama/llama3.2:3b";

function majority(vs: CascadeVerdict[]): CascadeVerdict {
    const c: Record<string, number> = {};
    for (const v of vs) c[v] = (c[v] ?? 0) + 1;
    return (Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        "red") as CascadeVerdict;
}

async function main() {
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
        cases: Case[];
    };
    console.log(`Korpus: ${corpusPath}`);
    console.log(`Model sedziego: ${MODEL}  |  proby/przypadek: ${TRIALS}`);

    // Realny sedzia. db nieuzywany dla local+null-project (patrz naglowek).
    const judge = await makeJudge({
        db: {} as never,
        model: MODEL,
        projectId: null,
    });
    if (!judge) {
        console.error(
            `BLAD: makeJudge zwrocil null dla modelu ${MODEL}. ` +
                `Sedzia jest LOCAL-ONLY - podaj model "ollama/...".`,
        );
        process.exit(1);
    }

    const rows: Array<{
        id: string;
        category: Case["category"];
        textStage: number;
        textStatus: string;
        trials: { verdict: CascadeVerdict; stage: number; reason?: string }[];
        majority: CascadeVerdict;
    }> = [];

    for (const c of corpus.cases) {
        const citation: ParsedCitation = {
            ref: 1,
            doc_id: c.doc_id,
            page: 1,
            quote: c.quote,
        };
        // Etap 1/2 bez sedziego - referencja deterministyczna (text-only).
        const textOnly = await groundCascade(citation, c.source, {});
        const trials: {
            verdict: CascadeVerdict;
            stage: number;
            reason?: string;
        }[] = [];
        for (let t = 0; t < TRIALS; t++) {
            const r = await groundCascade(citation, c.source, {
                judge,
                claim: c.claim,
            });
            trials.push({
                verdict: r.verdict,
                stage: r.stage,
                reason: r.judgeReason,
            });
        }
        const maj = majority(trials.map((t) => t.verdict));
        rows.push({
            id: c.id,
            category: c.category,
            textStage: textOnly.stage,
            textStatus: textOnly.status,
            trials,
            majority: maj,
        });
        console.log(
            `${c.id} [${c.category}] text=${textOnly.verdict}(${textOnly.status}) ` +
                `-> judge=${trials.map((t) => t.verdict).join(",")} maj=${maj}`,
        );
    }

    // ---- Metryki ----
    const fut = rows.filter((r) => r.category === "FALSE_UNDER_TRUE");
    const par = rows.filter((r) => r.category === "PARAPHRASE");
    const tru = rows.filter((r) => r.category === "TRUE");

    const futCaught = fut.filter((r) => r.majority !== "green").length; // maj
    const futCatchRate = futCaught / fut.length;
    // Per-proba leak: ile (przypadek,proba) FUT zostalo green (najgorszy przypadek).
    const futTrials = fut.flatMap((r) => r.trials);
    const futGreenTrials = futTrials.filter((t) => t.verdict === "green").length;

    const parRescued = par.filter((r) => r.majority !== "red").length;
    const parRecall = parRescued / par.length;

    const truGreen = tru.filter((r) => r.majority === "green").length;
    const truRed = tru.filter((r) => r.majority === "red").length; // regresja
    const truGreenRate = truGreen / tru.length;

    // Precyzja etykiety GREEN (per-proba): wsrod wszystkich green ile to TRUE.
    const allTrials = rows.flatMap((r) =>
        r.trials.map((t) => ({ cat: r.category, v: t.verdict })),
    );
    const greenTrials = allTrials.filter((x) => x.v === "green");
    const greenTrue = greenTrials.filter((x) => x.cat === "TRUE").length;
    const greenPrecision =
        greenTrials.length > 0 ? greenTrue / greenTrials.length : 1;

    const summary = {
        model: MODEL,
        trials_per_case: TRIALS,
        counts: { TRUE: tru.length, PARAPHRASE: par.length, FALSE_UNDER_TRUE: fut.length },
        metrics: {
            fut_catch_rate_majority: round(futCatchRate),
            fut_caught: futCaught,
            fut_total: fut.length,
            fut_green_leak_trials: futGreenTrials,
            fut_total_trials: futTrials.length,
            paraphrase_recall_majority: round(parRecall),
            paraphrase_rescued: parRescued,
            paraphrase_total: par.length,
            true_green_rate_majority: round(truGreenRate),
            true_regression_red: truRed,
            green_label_precision_pertrial: round(greenPrecision),
        },
        targets: {
            fut_catch_rate: 0.9,
            paraphrase_recall: 0.7,
        },
        pass: {
            fut_catch_rate: futCatchRate >= 0.9,
            paraphrase_recall: parRecall >= 0.7,
            true_no_regression: truRed === 0,
        },
    };

    console.log("\n===== METRYKI =====");
    console.log(JSON.stringify(summary.metrics, null, 2));
    console.log("PASS:", JSON.stringify(summary.pass, null, 2));

    const outDir = dirname(corpusPath);
    writeFileSync(
        join(outDir, "results-pl.json"),
        JSON.stringify({ summary, rows }, null, 2),
        "utf8",
    );
    console.log(`\nWyniki zapisane: ${join(outDir, "results-pl.json")}`);
}

function round(n: number): number {
    return Math.round(n * 1000) / 1000;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
