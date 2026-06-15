// Detektor technik omijania detekcji (AI evasion) - PL-aware.
//
// Wzorzec z Atticusa porownywal NFC vs NFD, co na polskich diakrytykach ZAWSZE
// rozni sie (a -> a + ogonek) i dawalo false-positive. Tutaj NIE robimy tego.
// Zamiast tego wykrywamy: (1) sztuczne dzielenie tokenow spacjami,
// (2) nadmiarowe znaki laczace (combining marks) - "zalgo" - ktore polszczyzna
// uzywa pojedynczo, nie w stosach. Patrz ADR-0019.

import type { Detector, SecurityFinding, SecurityScanInput } from "../types";

// "z i g n o r u j" zamiast "zignoruj" - pojedyncze litery rozdzielone spacjami.
function detectTokenSplitting(text: string): SecurityFinding | null {
    const matches = text.match(/(?:\b[\p{L}]\s+){4,}[\p{L}]\b/gu);
    if (!matches || matches.length === 0) return null;
    return {
        category: "evasion",
        technique: "token-boundary-splitting",
        severity: "medium",
        confidence: 70,
        evidence: matches[0].slice(0, 60),
        impact: "Tekst rozbity na pojedyncze litery, by ominac dopasowanie slownikowe i detekcje.",
    };
}

// Stosy znakow laczacych (U+0300-036F itd.). Polski uzywa diakrytykow jako
// znakow precomponowanych (a, e) lub pojedynczego znaku laczacego - nigdy
// stosow 3+. Stos = "zalgo"/proba zaciemnienia.
function detectCombiningStacks(text: string): SecurityFinding | null {
    const stacks = text.match(/[̀-ͯ҃-҉᪰-᫿⃐-⃿]{3,}/gu);
    if (!stacks || stacks.length === 0) return null;
    return {
        category: "evasion",
        technique: "combining-mark-stacking",
        severity: "medium",
        confidence: 75,
        evidence: `${stacks.length} stosow znakow laczacych (3+)`,
        impact: "Nadmiarowe znaki laczace (zalgo) - moga zaburzac tokenizacje i ukrywac tresc.",
    };
}

// Znaczniki tag (U+E0000-E007F) - niewidoczne, uzywane do ukrytych instrukcji.
function detectTagChars(text: string): SecurityFinding | null {
    const tags = text.match(/[\u{E0000}-\u{E007F}]/gu);
    if (!tags || tags.length === 0) return null;
    return {
        category: "evasion",
        technique: "unicode-tag-chars",
        severity: "high",
        confidence: 90,
        evidence: `${tags.length} znakow tag (U+E00xx)`,
        impact: "Niewidoczne znaczniki tag moga przenosic ukryta instrukcje dla modelu.",
    };
}

export const evasionDetector: Detector = {
    id: "evasion",
    category: "evasion",
    run(input: SecurityScanInput): SecurityFinding[] {
        const findings: SecurityFinding[] = [];
        const split = detectTokenSplitting(input.text);
        if (split) findings.push(split);
        const stacks = detectCombiningStacks(input.text);
        if (stacks) findings.push(stacks);
        const tags = detectTagChars(input.text);
        if (tags) findings.push(tags);
        return findings;
    },
};
