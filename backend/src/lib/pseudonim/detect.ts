// Detektor PII oparty o regex dla polskich identyfikatorow oraz
// stub-interfejs dla LLM-fallback.
//
// Zakres skeletonu: PESEL/NIP/REGON/KRS (z walidacja checksumy gdzie ma sens)
// + email + telefon. Imiona i nazwy firm zostawiamy na LLM-fallback w
// fazie tydzien 2 planu migracji (patrz ADR-0003).
//
// REFACTOR T1 ADR-0008 (2026-05-21, commit a5f03c2 + nastepny): walidatory
// checksum oraz format checks importujemy z kanonicznej biblioteki
// `lib/pl-entities/checksums.ts`. Single source of truth - taki sam
// algorytm uzywany przez graf cytowan (ADR-0008) i pseudonim (ADR-0003).
//
// W tym module zostaja: regexy specyficzne dla detekcji PII (mozliwe
// ze sa szersze niz w pl-entities z uwagi na inne false-positive profile),
// re-exporty walidatorow (backward compat z istniejacymi testami),
// orkiestracja `detectRegex` + stub LlmDetector.

import {
    isValidPesel,
    isValidNip,
    isValidRegon,
    isValidKrsFormat,
} from "../pl-entities/checksums";
import type { DetectionRule, LlmDetector, PiiCategory } from "./types";

// Re-eksport walidatorow dla backward compat - poprzednia wersja modulu
// eksportowala je lokalnie, istniejace testy `pseudonim.test.ts` i przyszle
// integracje importuja przez `./index` -> `./detect`.
export { isValidPesel, isValidNip, isValidRegon, isValidKrsFormat };

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
        // 9-cyfrowy lub 14-cyfrowy ciag z checksuma. Walidator z
        // pl-entities/checksums.ts redukuje false-positive (zwykly ciag
        // 9/14 cyfr ktory nie jest REGON-em odpada).
        pattern: /\b(\d{14}|\d{9})\b/g,
        validate: isValidRegon,
    },
    {
        id: "krs-10-digits",
        category: "KRS",
        // KRS to 10 cyfr (czesto z wiodacymi zerami). Brak publicznej
        // checksumy - walidujemy wylacznie format (10 cyfr) przez
        // isValidKrsFormat. Wymagamy slowa "KRS" + opcjonalnego
        // separatora przed cyframi - bez tego false-positive eksploduje.
        // Walidacja istnienia podmiotu w rejestrze odbywa sie przez
        // mcp-krs lookup (flag `.env KRS_LOOKUP_ENABLED`, patrz ADR-0008).
        pattern: /\bKRS[:\s]*(\d{10})\b/gi,
        validate: isValidKrsFormat,
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
