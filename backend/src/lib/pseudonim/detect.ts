// Detektor PII oparty o regex dla polskich identyfikatorow oraz
// stub-interfejs dla LLM-fallback.
//
// Zakres skeletonu: PESEL/NIP/REGON/KRS (z walidacja checksumy gdzie ma sens)
// + email + telefon. Imiona i nazwy firm zostawiamy na LLM-fallback w
// fazie tydzien 2 planu migracji (patrz ADR-0003).
//
// CHECKSUMY: zaimplementowane dla PESEL i NIP (wzorce GUS). REGON 9-cyfr
// i 14-cyfr ma checksumy zlozone (do dolozenia w iteracji). KRS to
// 10-cyfrowy ciag bez checksumy publicznej - akceptujemy goly format.

import type { DetectionRule, LlmDetector, PiiCategory } from "./types";

/**
 * Walidacja PESEL - checksuma wagowa (1,3,7,9,1,3,7,9,1,3) modulo 10.
 * Patrz Ustawa o ewidencji ludnosci, zalacznik nr 1.
 */
export function isValidPesel(pesel: string): boolean {
    if (!/^\d{11}$/.test(pesel)) return false;
    const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(pesel[i]!, 10) * weights[i]!;
    }
    const checksum = (10 - (sum % 10)) % 10;
    return checksum === parseInt(pesel[10]!, 10);
}

/**
 * Walidacja NIP - checksuma wagowa (6,5,7,2,3,4,5,6,7) modulo 11.
 * Ustawa o zasadach ewidencji i identyfikacji podatnikow.
 */
export function isValidNip(nip: string): boolean {
    const digits = nip.replace(/[\s-]/g, "");
    if (!/^\d{10}$/.test(digits)) return false;
    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(digits[i]!, 10) * weights[i]!;
    }
    const checksum = sum % 11;
    if (checksum === 10) return false;
    return checksum === parseInt(digits[9]!, 10);
}

/**
 * Zestaw reguł regex-based dla polskich identyfikatorow. Walidatory
 * uruchamiane PO dopasowaniu - zmniejszaja false-positive (np. 11
 * cyfr ktore nie sa PESEL-em).
 */
export const POLISH_PII_RULES: DetectionRule[] = [
    {
        id: "pesel-11-digits",
        category: "PESEL",
        // PESEL to 11 cyfr; uniknij dopasowania srodka dluzszego ciagu
        pattern: /\b\d{11}\b/g,
        validate: isValidPesel,
    },
    {
        id: "nip-10-digits",
        category: "NIP",
        // 10 cyfr, dopuszczamy ldash/spacje (123-456-78-90, 123 456 78 90)
        pattern: /\b\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
        validate: isValidNip,
    },
    {
        id: "regon-9-or-14-digits",
        category: "REGON",
        // 9-cyfrowy lub 14-cyfrowy ciag; checksuma do dolozenia w tygodniu 2
        pattern: /\b(\d{14}|\d{9})\b/g,
    },
    {
        id: "krs-10-digits",
        category: "KRS",
        // KRS to 10 cyfr (czesto z wiodacymi zerami). Brak publicznej
        // checksumy. False-positive ryzyko sredne - uzywamy razem z
        // kontekstem (slowo "KRS" w okolicy) w tygodniu 2.
        pattern: /\bKRS[:\s]*(\d{10})\b/gi,
    },
    {
        id: "email-rfc5322-loose",
        category: "EMAIL",
        // Pragmatyczny regex email; pelny RFC5322 jest bezwartosciowo zlozony
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
        id: "phone-pl-with-prefix",
        category: "PHONE",
        // Polski telefon z OBLIGATORYJNYM prefixem +48 - tylko tak unikamy
        // konfliktu z PESEL (11 cyfr), NIP (10) i REGON (9/14). Numery bez
        // prefixu zostawiamy LLM-fallback w fazie tydzien 2 planu migracji.
        pattern: /\+48[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    },
];

/**
 * Pojedyncze dopasowanie - tekst znaleziony + kategoria + zakres znakowy.
 */
export interface DetectionMatch {
    span: string;
    category: PiiCategory;
    start: number;
    end: number;
    ruleId: string;
}

/**
 * Detekcja regex-based - przebiega po wszystkich regulach, zwraca
 * znalezione spany posortowane wg pozycji w tekscie. Konflikty
 * (jeden span pokryty przez kilka regul) zostawiamy do rozwiazania
 * w `wrap.ts` - tutaj zwracamy wszystko.
 */
export function detectRegex(text: string, rules: DetectionRule[] = POLISH_PII_RULES): DetectionMatch[] {
    const matches: DetectionMatch[] = [];
    for (const rule of rules) {
        // Re-create regex per call (g flag stateful)
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const span = m[1] ?? m[0];
            if (!span) continue;
            const start = m.index + (m[0]!.indexOf(span));
            if (rule.validate && !rule.validate(span)) continue;
            matches.push({
                span,
                category: rule.category,
                start,
                end: start + span.length,
                ruleId: rule.id,
            });
        }
    }
    return matches.sort((a, b) => a.start - b.start);
}

/**
 * Stub LLM-detektora dla skeletonu. Docelowo Ollama qwen3.5:4b albo
 * mistral-pl z polskim promptem z `prompts.pl.ts` - patrz ADR-0003
 * tydzien 2 planu migracji.
 */
export const noopLlmDetector: LlmDetector = {
    async detect(_text: string) {
        return [];
    },
};
