// Deterministyczny detektor encji osobowych dla EGRESS do chmury (audyt P1 #4,
// domkniecie ADR-0067 - "maskujemy tylko identyfikatory regexowe").
//
// Dotad llmDetector w wrapConversation byl no-op (detect.ts noopLlmDetector),
// wiec PESEL/NIP/REGON/KRS/email/telefon byly maskowane, ale IMIONA, NAZWISKA,
// NAZWY PODMIOTOW i ADRESY wychodzily do modelu chmurowego OTWARTYM TEKSTEM.
// Ten modul dostarcza realny detektor PERSON/ORG/ADDRESS implementujacy
// interfejs `LlmDetector`.
//
// ZERO-CLOUD i DETERMINIZM (Konstytucja Art. 2 + Art. 3): detekcja jest czysto
// regulowa/regexowa, dziala w procesie, bez zadnego wywolania modelu - inaczej
// niz sugeruje nazwa interfejsu (LlmDetector to tylko kontrakt `detect()`).
//
// PRECYZJA vs RECALL: maskowanie jest ODWRACANE przez unwrap na strumieniu
// odpowiedzi (egress.ts), wiec nad-maskowanie NIE psuje finalnego outputu (token
// wraca do oryginalu) - kosztuje tylko nieco zrozumienia po stronie modelu.
// Wyciek (false negative) jest grozny. Dlatego:
//   - ORG: reuzywamy utrzymywany regex form prawnych z pl-entities (FIRMA) -
//     wymaga formy prawnej (Sp. z o.o. / S.A. / ...), wysoka precyzja. NIE
//     forkujemy pl-entities (reguly org sa shared library, ADR-0008).
//   - PERSON: zakotwiczone na honoryfikatorze/roli (Pan/Pani/adw./mec./swiadek/
//     oskarzony/...) + nastepujace tokeny z wielkiej litery. Bez kotwicy NIE
//     maskujemy goych bigramow z wielkich liter - inaczej "Sad Najwyzszy",
//     "Kodeks Karny" itp. byly maskowane masowo, psujac kontekst prawny.
//   - ADDRESS: kod pocztowy (NN-NNN) + ulica/aleja/plac z numerem.
//
// OGRANICZENIE v1: nazwisko bez kotwicy (np. samo "Jan Kowalski" w srodku zdania
// bez "Pan"/roli) nie jest lapane. Twarde identyfikatory (PESEL itd.) lapie
// warstwa regex. Rozszerzenie (gazetteer imion / lokalny model NER) - rezerwacja.

import type { LlmDetector, PiiCategory } from "./types";
import { detectAll } from "../pl-entities";

// Token nazwy: pierwsza litera wielka (z polskimi), reszta male/lacznik.
const NAME_TOKEN = "[A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśźż]+";
// 1-3 tokeny nazwy (Jan, Jan Kowalski, Anna Nowak-Kowalska).
const NAME_SEQ = `${NAME_TOKEN}(?:[-\\s]${NAME_TOKEN}){0,2}`;

// Kotwice osobowe: honoryfikatory, tytuly zawodowe, role procesowe. Marker NIE
// jest maskowany (to rola, nie PII) - maskujemy wylacznie grupe (1) z nazwa.
const PERSON_MARKERS = [
    "Pan",
    "Pani",
    "Pana",
    "Panu",
    "Panią",
    "Państwo",
    "Państwa",
    "adw\\.",
    "adwokat",
    "adwokata",
    "mec\\.",
    "mecenas",
    "mecenasa",
    "r\\.\\s?pr\\.",
    "radca prawny",
    "radcy prawnego",
    "sędzia",
    "sędziego",
    "prokurator",
    "prokuratora",
    "świadek",
    "świadka",
    "oskarżony",
    "oskarżonego",
    "oskarżonej",
    "oskarżona",
    "biegły",
    "biegłego",
    "biegła",
    "powód",
    "powoda",
    "pozwany",
    "pozwanego",
    "pokrzywdzony",
    "pokrzywdzonego",
    "obrońca",
    "obrońcy",
];

// Granica przed markerem: lookbehind Unicode (NIE `\b`, ktore jest ASCII -
// przed markerem zaczynajacym sie od polskiej litery, np. "świadek", ASCII
// word-boundary NIE zachodzi i marker nie bylby lapany).
const PERSON_RE = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${PERSON_MARKERS.join("|")})\\s+(${NAME_SEQ})`,
    "gu",
);

// Kod pocztowy PL: NN-NNN.
const POSTAL_RE = /\b\d{2}-\d{3}\b/gu;

// Ulica/aleja/plac/osiedle + nazwa + numer (opcjonalnie /mieszkanie).
const STREET_RE =
    /\b(?:ul\.|ulica|al\.|aleja|alei|pl\.|plac|os\.|osiedle)\s+[A-ZŁŚŻŹĆŃÓĄĘ0-9][\wśżźćńółęąŁŚŻŹĆŃÓĄĘ.\- ]{1,50}?\s+\d+[A-Za-z]?(?:\s*\/\s*\d+[A-Za-z]?)?\b/giu;

interface Hit {
    span: string;
    category: PiiCategory;
}

function collect(re: RegExp, text: string, category: PiiCategory, group = 0): Hit[] {
    const out: Hit[] = [];
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
        const span = (group === 0 ? m[0] : m[group])?.trim();
        if (span) out.push({ span, category });
        // Zabezpieczenie przed nieskonczona petla dla zerowej dlugosci.
        if (m.index === r.lastIndex) r.lastIndex++;
    }
    return out;
}

/**
 * Deterministyczny detektor PERSON/ORG/ADDRESS. Zwraca unikalne spany (bez
 * offsetow) - wrap.ts znajduje wszystkie ich wystapienia i maskuje wspolna mapa.
 */
export const plEntityDetector: LlmDetector = {
    async detect(text: string): Promise<Array<{ span: string; category: PiiCategory }>> {
        if (!text) return [];
        const hits: Hit[] = [];

        // PERSON - grupa (1) (sama nazwa, bez markera).
        hits.push(...collect(PERSON_RE, text, "PERSON", 1));

        // ORG - reuzycie utrzymywanego regexu form prawnych z pl-entities.
        for (const m of detectAll(text)) {
            if (m.type === "FIRMA" && m.raw.trim()) {
                hits.push({ span: m.raw.trim(), category: "ORG" });
            }
        }

        // ADDRESS - ulica z numerem + kod pocztowy.
        hits.push(...collect(STREET_RE, text, "ADDRESS"));
        hits.push(...collect(POSTAL_RE, text, "ADDRESS"));

        // Deduplikacja po (kategoria, span) - wrap.ts i tak maskuje wszystkie
        // wystapienia, wiec wystarczy unikat.
        const seen = new Set<string>();
        const unique: Hit[] = [];
        for (const h of hits) {
            const key = `${h.category}:${h.span}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(h);
        }
        return unique;
    },
};
