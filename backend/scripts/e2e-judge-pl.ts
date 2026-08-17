// E2E (poziom wiringu czatu) paraphrase-judge ADR-0097 - realna sciezka SSE
// bez transportu HTTP/frontu. Sklada dokladnie to, co robi stream.ts:
//   1. extractClaim(answerText, ref)  - REALNA ekstrakcja tezy wokol [ref]
//   2. makeJudge(...)                 - REALNE bramkowanie (LOCAL-ONLY, fail-closed)
//   3. groundCascade(citation, src, {judge, claim}) - REALNY werdykt 3-kolor
//   4. whitelist {decision, verdict}  - dokladnie jak groundingForClient (PII out)
//
// Scenariusz GLOWNY: cytat doslowny (verifyOne->ZWERYFIKOWANY) pod FALSZYWA teza.
// Oczekiwanie: judge degraduje verdict do "red" -> front pokaze czerwony badge
// "uwaga: zrodlo NIE potwierdza tezy" (i18n verdictRed). judgeReason NIE w SSE.
//
// Scenariusz FAIL-CLOSED: makeJudge dla modelu CHMUROWEGO zwraca null (przed DB),
// kaskada zostaje deterministyczna (verdict z decision). Tresc nie egressuje.
//
// Uruchom: npx tsx scripts/e2e-judge-pl.ts

import { groundCascade } from "../src/lib/citation/cascade";
import { makeJudge } from "../src/lib/citation/judge";
import { extractClaim } from "../src/lib/chat/ground-citations";
import type { ParsedCitation } from "../src/lib/chat/types";

const LOCAL_MODEL = process.env.PATRON_LOCAL_MODEL?.trim() || "ollama/llama3.2:3b";
const CLOUD_MODEL = "gemini-2.0-flash";

// Zrodlo (dokument klienta) - cytat istnieje doslownie.
const SOURCE =
    "Kto z winy swojej wyrzadzil drugiemu szkode, obowiazany jest do jej " +
    "naprawienia. Odpowiedzialnosc ta opiera sie na zasadzie winy sprawcy.";

// Odpowiedz asystenta: cytat [1] podstawiony pod FALSZYWA teze (odpowiedzialnosc
// na zasadzie ryzyka, niezaleznie od winy) - klasyczny Stanford/Magesh FUT.
const ANSWER_FUT =
    "W ocenie odpowiedzialnosci nalezy przyjac, ze sprawca odpowiada za szkode " +
    "niezaleznie od winy, na zasadzie ryzyka [1].\n\n" +
    '<CITATIONS>[{"ref":1,"doc_id":"kc-415","quote":"Kto z winy swojej wyrzadzil drugiemu szkode, obowiazany jest do jej naprawienia"}]</CITATIONS>';

function sseWhitelist(r: {
    decision: string;
    verdict?: "green" | "yellow" | "red";
    judgeReason?: string;
}): { decision: string; verdict?: string } {
    // DOKLADNIE jak stream.ts groundingForClient: tylko decision (+verdict gdy jest).
    return r.verdict ? { decision: r.decision, verdict: r.verdict } : { decision: r.decision };
}

async function main() {
    console.log(`Model lokalny (sedzia): ${LOCAL_MODEL}\n`);

    // ---- SCENARIUSZ 1: FALSE-UNDER-TRUE, model lokalny, flaga ON ----
    const judge = await makeJudge({ db: {} as never, model: LOCAL_MODEL, projectId: null });
    if (!judge) {
        console.error(`BLAD: makeJudge(null) dla ${LOCAL_MODEL} - oczekiwano sedziego.`);
        process.exit(1);
    }
    const ref = 1;
    const claim = extractClaim(ANSWER_FUT, ref); // REALNA ekstrakcja tezy
    const citation: ParsedCitation = {
        ref,
        doc_id: "kc-415",
        page: 1,
        quote: "Kto z winy swojej wyrzadzil drugiemu szkode, obowiazany jest do jej naprawienia",
    };

    console.log("SCENARIUSZ 1 - FALSE-UNDER-TRUE (cytat doslowny pod falszywa teza)");
    console.log(`  teza (extractClaim): "${claim}"`);

    const textOnly = await groundCascade(citation, SOURCE, {});
    console.log(
        `  bez sedziego: decision=${textOnly.decision} verdict=${textOnly.verdict} status=${textOnly.status}`,
    );

    // 3 proby (LLM niedeterministyczny)
    const verdicts: string[] = [];
    let lastWithJudge: Awaited<ReturnType<typeof groundCascade>> | null = null;
    for (let i = 0; i < 3; i++) {
        const r = await groundCascade(citation, SOURCE, { judge, claim });
        verdicts.push(r.verdict);
        lastWithJudge = r;
    }
    console.log(`  z sedzia (3x): ${verdicts.join(", ")}`);
    const redCount = verdicts.filter((v) => v === "red").length;
    console.log(
        `  -> czerwony w ${redCount}/3 probach; SSE: ${JSON.stringify(sseWhitelist(lastWithJudge!))}`,
    );
    const piiLeak = JSON.stringify(sseWhitelist(lastWithJudge!)).includes("judgeReason");
    console.log(
        `  PII judgeReason w SSE: ${piiLeak ? "TAK (BLAD!)" : "NIE (ok - whitelist)"}`,
    );
    const s1pass = redCount >= 2 && !piiLeak; // wiekszosc czerwona + brak PII
    console.log(`  WYNIK S1: ${s1pass ? "PASS" : "UWAGA"} (oczekiwano degradacji do red)\n`);

    // ---- SCENARIUSZ 2: FAIL-CLOSED, model chmurowy ----
    console.log("SCENARIUSZ 2 - FAIL-CLOSED (model chmurowy -> sedzia null)");
    const judgeCloud = await makeJudge({
        db: {} as never,
        model: CLOUD_MODEL,
        projectId: "fake-tajemnica",
    });
    const s2pass = judgeCloud === null;
    console.log(`  makeJudge("${CLOUD_MODEL}") = ${judgeCloud === null ? "null" : "FUNKCJA"}`);
    console.log(
        `  WYNIK S2: ${s2pass ? "PASS" : "BLAD"} (sedzia LOCAL-ONLY - tresc nie egressuje)`,
    );
    // Kaskada bez sedziego = deterministyczna (verdict z decision).
    const det = await groundCascade(citation, SOURCE, {});
    console.log(
        `  kaskada bez sedziego: verdict=${det.verdict} (deterministyczny, stage ${det.stage})\n`,
    );

    console.log("===== PODSUMOWANIE E2E =====");
    console.log(`S1 (FUT degradacja do red, model lokalny): ${s1pass ? "PASS" : "UWAGA"}`);
    console.log(`S2 (fail-closed model chmurowy):            ${s2pass ? "PASS" : "BLAD"}`);
    if (!s2pass) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
