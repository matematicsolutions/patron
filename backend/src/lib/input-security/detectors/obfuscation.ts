// Detektor zaciemniania (obfuscation) - PL-aware.
//
// KLUCZOWA ROZNICA wzgledem wzorca z Atticusa (ADR-0019): tamtejszy
// `detectHomoglyphs` flaguje znaki cyrylicy, a `detectEmbeddingAnomalies` ma
// `[^\x00-\x7F]{3,}` - co na polskim tekscie z a/e/o/l/z/z/c/n/s dawaloby
// FALSE-POSITIVE na kazdym zdaniu. Tutaj homoglify wykrywamy przez MIESZANIE
// PISM w obrebie slowa (lacinka + cyrylica/greka), a NIE przez "znak nie-ASCII".
// Polskie diakrytyki sa pismem lacinskim - nie sa flagowane.

import type { Detector, SecurityFinding, SecurityScanInput } from "../types";

// Cyrylickie i greckie znaki wygladajace jak litery lacinskie (confusables).
// Obecnosc ktoregokolwiek W SLOWIE zawierajacym tez lacinke = podejrzenie.
const CONFUSABLE_CYRILLIC_GREEK = new Set(
    [
        // cyrylica wygladajaca jak lacinka
        "а", "е", "о", "р", "с", "у", "х", "і", "ј", "ѕ",
        "А", "В", "Е", "К", "М", "Н", "О", "Р", "С", "Т", "Х", "І", "Ј",
        // greka
        "ο", "α", "ν", "ρ", "ι", "κ", "Α", "Β", "Ε", "Ζ", "Η", "Ι", "Κ", "Μ", "Ν", "Ο", "Ρ", "Τ", "Χ",
    ].flatMap((c) => [c]),
);

const LATIN_LETTER = /[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]/u;

function detectHomoglyphs(text: string): SecurityFinding | null {
    let suspectWords = 0;
    let example = "";
    for (const word of text.split(/\s+/)) {
        if (word.length < 2) continue;
        let hasLatin = false;
        let hasConfusable = false;
        for (const ch of word) {
            if (LATIN_LETTER.test(ch)) hasLatin = true;
            else if (CONFUSABLE_CYRILLIC_GREEK.has(ch)) hasConfusable = true;
        }
        if (hasLatin && hasConfusable) {
            suspectWords++;
            if (!example) example = word;
        }
    }
    if (suspectWords === 0) return null;
    return {
        category: "obfuscation",
        technique: "homoglyph-mixed-script",
        severity: suspectWords > 3 ? "high" : "medium",
        confidence: Math.min(60 + suspectWords * 10, 95),
        evidence: `${suspectWords} slow z mieszanym pismem, np. "${example.slice(0, 30)}"`,
        impact: "Slowa lacza lacinke z cyrylica/greka - klasyczne omijanie filtrow slownikowych.",
    };
}

// Lancuchy enkodowania (base64/hex) z czytelnym dekodowaniem. Prog dlugosci
// wysoki, by nie lapac legalnych krotkich ciagow. Nie dekodujemy rekurencyjnie
// w skeletonie - jedno-poziomowo, oznaczamy do human_review.
function detectEncoding(text: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    const b64 = /\b([A-Za-z0-9+/]{60,}={0,2})\b/.exec(text);
    if (b64) {
        try {
            const decoded = Buffer.from(b64[1], "base64").toString("utf8");
            if (decoded.length > 10 && /[a-zA-Ząćęłńóśźż]{4,}/u.test(decoded)) {
                findings.push({
                    category: "obfuscation",
                    technique: "base64-readable",
                    severity: "medium",
                    confidence: 65,
                    evidence: `ciag base64 dlugosci ${b64[1].length}`,
                    impact: "Tresc zakodowana base64 dekoduje sie do czytelnego tekstu - mozliwe ukryte polecenie.",
                    decoded: decoded.slice(0, 100),
                });
            }
        } catch {
            // niepoprawny base64 - ignoruj
        }
    }

    // Znaki sterujace kierunkiem (bidi) i znaczniki tag - uzywane do ukrywania
    // tresci. Polski tekst ich nie uzywa, wiec sa czystym sygnalem.
    const bidi = (text.match(/[‪-‮⁦-⁩]/gu) || []).length;
    if (bidi > 0) {
        findings.push({
            category: "obfuscation",
            technique: "bidi-control-chars",
            severity: "high",
            confidence: 85,
            evidence: `${bidi} znakow sterujacych kierunkiem (bidi)`,
            impact: "Znaki bidi moga odwracac kolejnosc wyswietlania - tresc widziana przez czlowieka rozni sie od tej, ktora dostaje model.",
        });
    }

    return findings;
}

export const obfuscationDetector: Detector = {
    id: "obfuscation",
    category: "obfuscation",
    run(input: SecurityScanInput): SecurityFinding[] {
        const findings: SecurityFinding[] = [];
        const hg = detectHomoglyphs(input.text);
        if (hg) findings.push(hg);
        findings.push(...detectEncoding(input.text));
        return findings;
    },
};
