// Detektor manipulacji modelem (adversarial) - PL-aware.
//
// KLUCZOWA ROZNICA wzgledem wzorca z Atticusa (ADR-0019): listy sygnalow w
// Atticusie sa WYLACZNIE angielskie. Polskie "zignoruj poprzednie instrukcje",
// "dzialaj jako", "tryb dewelopera" przechodzilyby bez wykrycia. Tutaj korpus
// jest polski w pierwszej kolejnosci, angielski dodatkowo (dokumenty bywaja
// dwujezyczne). Lekcja z [[feedback_polskie_pii_nie_jest_en_pii]].

import type { Detector, SecurityFinding, SecurityScanInput } from "../types";

interface SignalRule {
    technique: string;
    pattern: RegExp;
    severity: SecurityFinding["severity"];
    impact: string;
}

// Polskie sygnaly prompt-injection. Diakrytyki opcjonalne w klasach znakow,
// bo dokument moze byc po polsku z pelnymi znakami - regex dziala na tresci
// klienta (z diakrytykami), nie na komentarzach kodu.
const PROMPT_INJECTION_PL: SignalRule[] = [
    // UWAGA granice slow: JS `\b` jest ASCII-only - polskie s/n/c (z diakrytykiem)
    // to dla `\b` znaki NIE-slowne, wiec `jeste[sś]\b` zachowuje sie odwrotnie do
    // intencji (matchuje "jestesmy", nie matchuje "jestes " przed spacja). Dlatego
    // uzywamy unicode-aware lookaheadow `(?<!\p{L})` / `(?!\p{L})`. To dokladnie ta
    // klasa bledu, ktora odrzucamy u Atticusa (patrz ADR-0019).
    {
        technique: "prompt-injection-pl",
        pattern:
            /(?<!\p{L})(?:zignoruj|pomi[nń]|zapomnij|odrzu[cć])\s+(?:wszystkie\s+)?(?:poprzednie|powy[zż]sze|wcze[sś]niejsze|dotychczasowe)\s+(?:instrukcje|polecenia|wytyczne|ustalenia|zasady)/giu,
        severity: "high",
        impact: "Proba nadpisania instrukcji systemowych - model moze ujawnic kontekst innej sprawy lub zlamac zasady.",
    },
    {
        // Tylko silne, imperatywne przejecie roli. Bare "od teraz jestes" / "jestes
        // teraz" CELOWO usuniete - to naturalne zwroty w pismach ("od teraz jestes
        // zobowiazany"), dawaly false-positive. Atak typu role-override i tak lapie
        // sie na "udawaj ze jestes" / "dzialaj jako".
        technique: "prompt-injection-pl-newrole",
        pattern:
            /(?<!\p{L})(?:dzia[lł]aj\s+(?:jako|jak)|udawaj,?\s+[zż]e\s+jeste[sś]|wciel\s+si[eę]\s+w)(?!\p{L})/giu,
        severity: "high",
        impact: "Proba przejecia roli (role override) - wymuszenie nowej persony modelu.",
    },
    {
        technique: "prompt-injection-pl-reveal",
        pattern:
            /(?<!\p{L})(?:ujawnij|poka[zż]|wypisz|wyswietl|zdrad[zź])\s+(?:sw[oó]j\s+)?(?:prompt\s+systemowy|instrukcje\s+systemowe|polecenie\s+systemowe|konfiguracj[eę]|ustawienia\s+systemowe)/giu,
        severity: "high",
        impact: "Proba ekstrakcji promptu systemowego.",
    },
    {
        technique: "jailbreak-pl-mode",
        pattern:
            /(?<!\p{L})(?:tryb\s+(?:dewelopera|deweloperski|bez\s+ogranicze[nń]|nieocenzurowany|swobodny)|bez\s+(?:filtr[oó]w|cenzury|ogranicze[nń])|pomi[nń]\s+(?:zabezpieczenia|filtry|zasady\s+bezpiecze[nń]stwa))(?!\p{L})/giu,
        severity: "high",
        impact: "Polski wariant proby jailbreak - wylaczenie mechanizmow bezpieczenstwa.",
    },
];

// Angielskie sygnaly - dodatkowa warstwa (dokumenty dwujezyczne, wklejki).
const PROMPT_INJECTION_EN: SignalRule[] = [
    {
        technique: "prompt-injection-en",
        pattern:
            /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior|earlier)\s+(?:instructions|prompts|commands|rules)/gi,
        severity: "high",
        impact: "Override instrukcji systemowych (wariant angielski).",
    },
    {
        technique: "prompt-injection-en-marker",
        pattern: /\[(?:SYSTEM|ADMIN|INST|\/INST)\]|<\|(?:system|im_start|im_end)\|>|###\s*system/gi,
        severity: "medium",
        impact: "Wstrzykniety marker roli/sekcji - proba sfalszowania struktury rozmowy.",
    },
    {
        technique: "jailbreak-en-known",
        pattern: /\b(?:DAN|STAN|DUDE|AIM)\b|do\s+anything\s+now|developer\s+mode|jailbreak/gi,
        severity: "high",
        impact: "Znana technika jailbreak (wariant angielski).",
    },
];

const ALL_SIGNALS = [...PROMPT_INJECTION_PL, ...PROMPT_INJECTION_EN];

/**
 * Context-stuffing: bardzo wiele zdan z wysoka powtarzalnoscia - proba
 * zalania okna kontekstu i obnizenia uwagi modelu na tresc krytyczna.
 * Jezyk-niezalezne (liczy struktura, nie slowa).
 */
function detectContextStuffing(text: string): SecurityFinding | null {
    const sentences = text
        .split(/[.!?\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);
    if (sentences.length < 100) return null;

    const unique = new Set(sentences.map((s) => s.toLowerCase()));
    const repetition = 1 - unique.size / sentences.length;
    if (repetition <= 0.3) return null;

    return {
        category: "adversarial",
        technique: "context-stuffing",
        severity: "medium",
        confidence: 75,
        evidence: `${sentences.length} zdan, ${(repetition * 100).toFixed(0)}% powtorzen`,
        impact: "Proba przepelnienia okna kontekstu modelu i ukrycia tresci krytycznej.",
    };
}

function clip(s: string, n = 120): string {
    return s.length > n ? `${s.slice(0, n)}...` : s;
}

export const adversarialDetector: Detector = {
    id: "adversarial-pl",
    category: "adversarial",
    run(input: SecurityScanInput): SecurityFinding[] {
        const { text } = input;
        const findings: SecurityFinding[] = [];

        for (const rule of ALL_SIGNALS) {
            rule.pattern.lastIndex = 0;
            const match = rule.pattern.exec(text);
            if (match) {
                const count = (text.match(rule.pattern) || []).length;
                findings.push({
                    category: "adversarial",
                    technique: rule.technique,
                    severity: rule.severity,
                    confidence: Math.min(80 + count * 5, 98),
                    evidence: clip(match[0]),
                    impact: rule.impact,
                });
            }
        }

        const stuffing = detectContextStuffing(text);
        if (stuffing) findings.push(stuffing);

        return findings;
    },
};
