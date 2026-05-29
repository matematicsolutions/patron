// Post-processing OCR pod polskie dokumenty prawne (ADR-0075, "wlasny OCR" poziom 1).
//
// Wartosc dodana NAD surowym OCR (GLM-OCR/Chandra): nie poprawiamy tekstu po cichu
// (to byłaby halucynacja), tylko FLAGUJEMY prawnikowi miejsca do weryfikacji -
// dokladnie to, czego Libra/chmura nie daje. Czyste funkcje, testowalne bez OCR.
//
// Dwie klasy flag istotne dla skanow sadowych:
//   1. Podejrzane daty - OCR myli cyfry (znany problem "rok 3013"). Flagujemy rok
//      poza wiarygodnym zakresem zamiast zgadywac poprawke.
//   2. Niska jakosc OCR - duzo "smieciowych" znakow / malo liter = skan slaby,
//      mecenas powinien rzucic okiem na oryginal.

export type OcrFlagKind = "suspect-date" | "low-quality";

export interface OcrFlag {
    kind: OcrFlagKind;
    /** Czytelny komunikat PL dla mecenasa. */
    message: string;
    /** Kontekst (dopasowany fragment / metryka). */
    detail?: string;
}

export interface PostProcessResult {
    /** Tekst/Markdown (niezmieniony - NIE poprawiamy tresci, tylko flagujemy). */
    markdown: string;
    flags: OcrFlag[];
}

/** Dolny i gorny wiarygodny rok dla polskiego dokumentu prawnego. */
export const MIN_PLAUSIBLE_YEAR = 1900;

/**
 * Flaguje daty z rokiem poza wiarygodnym zakresem (OCR zniekształcil cyfre).
 * Obsluguje formaty numeryczne: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD.
 * NIE poprawia - tylko zglasza do weryfikacji. `currentYear` parametrem dla
 * determinizmu testow (default biezacy rok).
 */
export function flagSuspectDates(
    text: string,
    currentYear: number = new Date().getFullYear(),
): OcrFlag[] {
    const maxYear = currentYear + 1; // pisma moga nosic date przyszla (terminy)
    const flags: OcrFlag[] = [];
    const seen = new Set<string>();
    const push = (year: number, match: string) => {
        if (year >= MIN_PLAUSIBLE_YEAR && year <= maxYear) return;
        if (seen.has(match)) return;
        seen.add(match);
        flags.push({
            kind: "suspect-date",
            message: `Podejrzana data (rok ${year} poza zakresem ${MIN_PLAUSIBLE_YEAR}-${maxYear}) - mozliwy blad OCR, sprawdz oryginal.`,
            detail: match,
        });
    };

    // DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
    const dmy = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;
    let m: RegExpExecArray | null;
    while ((m = dmy.exec(text)) !== null) push(Number(m[3]), m[0]);

    // YYYY-MM-DD (ISO)
    const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = iso.exec(text)) !== null) push(Number(m[1]), m[0]);

    return flags;
}

/**
 * Heurystyczna ocena jakosci OCR. Liczy udzial znakow "literowych" (\p{L},
 * obejmuje polskie diakrytyki) w tresci niebędacej bialym znakiem. Niski udzial
 * = duzo smieci/krzakow = slaby skan. Zwraca score 0..1 i flage niskiej jakosci.
 */
export function assessOcrQuality(
    text: string,
    threshold = 0.55,
): { score: number; lowQuality: boolean } {
    const nonSpace = text.replace(/\s+/g, "");
    if (nonSpace.length < 20) {
        // Za malo tekstu, by ocenic - traktujemy jako niskiej jakosci (skan pusty/krzaki).
        return { score: 0, lowQuality: true };
    }
    const letters = (nonSpace.match(/\p{L}/gu) ?? []).length;
    const digits = (nonSpace.match(/\p{Nd}/gu) ?? []).length;
    // Litery + cyfry to "uzyteczna" tresc; reszta (interpunkcja w nadmiarze,
    // krzaki) obniza score.
    const score = (letters + digits) / nonSpace.length;
    return { score, lowQuality: score < threshold };
}

/**
 * Pelny post-processing wyniku OCR: flagi (daty + jakosc), tekst niezmieniony.
 * To "nasz" krok w pipeline OCR - wartosc dodana pod polskie pisma prawne.
 */
export function postProcessOcr(
    markdown: string,
    currentYear?: number,
): PostProcessResult {
    const flags: OcrFlag[] = [...flagSuspectDates(markdown, currentYear)];
    const q = assessOcrQuality(markdown);
    if (q.lowQuality) {
        flags.push({
            kind: "low-quality",
            message:
                "Niska jakosc rozpoznania (slaby skan?) - zalecana weryfikacja z oryginalem.",
            detail: `score=${q.score.toFixed(2)}`,
        });
    }
    return { markdown, flags };
}
