// Reguly regex-based ekstrakcji encji prawa polskiego.
//
// Skupiamy sie na piecu top kategoriach sygnatur orzeczen (SN, NSA, WSA,
// KIO, TK) - to ~90% cytowanych orzeczen w opiniach kancelaryjnych
// (do walidacji T2 benchmarkiem na pilotazowym korpusie).
//
// SAD: nazwy sadow przez gazetteer (sady-pl.json), NIE regex - lista
// zamknieta ~150 podmiotow.
//
// OSOBA / FIRMA: regex form prawnych (sp. z o.o., S.A., ...) wykrywa
// firmy z umiarkowana precyzja, niezaleznie od wielkosci liter w formie.
// Imiona osob - LLM-fallback (warstwa
// pseudonim ADR-0003 ma to juz wpiete, my reuse'ujemy wynik).

import {
    isValidPesel,
    isValidNip,
    isValidRegon,
    isValidKrsFormat,
} from "./checksums";
import type { ExtractionRule } from "./types";

/**
 * Sygnatury Sadu Najwyzszego.
 *
 * Format: `<izba_rzymska> <kod_dept> <numer>/<rok>`
 * gdzie kod_dept to np. CZP / PK / KK / DSP / III/SO / SNO / KSO...
 * Lista kodow nie jest zamknieta, akceptujemy 2-4 litery wielkie.
 *
 * Przyklady:
 *   "III CZP 11/13"     - cywilne, uchwała 7 sedziow
 *   "II PK 123/22"      - pracy i ubezpieczen
 *   "I KK 456/24"       - karna kasacja
 *   "I CSK 789/23"      - cywilna kasacja
 */
const SN_SIGNATURE_RE = /\b(?:I{1,3}|IV|V|VI|VII)\s+[A-Z]{2,4}\s+\d{1,5}\/\d{2,4}\b/g;

/**
 * Sygnatury Naczelnego Sadu Administracyjnego.
 *
 * Format: `<rzymska_izba> <FSK|OSK|OPS|GSK|FPS> <numer>/<rok>`
 *
 * Przyklady:
 *   "II FSK 1234/22"  - finansowa
 *   "I OSK 567/23"    - ogolnoadministracyjna
 *   "II OPS 7/20"     - postanowienie skladu 7 sedziow
 */
const NSA_SIGNATURE_RE = /\b(?:I|II|III)\s+(?:FSK|OSK|OPS|GSK|FPS|FSW|FZ)\s+\d{1,5}\/\d{2,4}\b/g;

/**
 * Sygnatury Wojewodzkich Sadow Administracyjnych.
 *
 * Format: `<rzymska_izba> <SA>/<miasto> <numer>/<rok>`
 * gdzie miasto to skrot 2-3 literowy (Wa = Warszawa, Kr = Krakow,
 * Po = Poznan, Gd = Gdansk, Wr = Wroclaw, Op = Opole, Bd = Bydgoszcz,
 * Bk = Bialystok, Gl = Gliwice, Ke = Kielce, Lu = Lublin, Lo = Lodz,
 * Ol = Olsztyn, Rz = Rzeszow, Sz = Szczecin).
 *
 * Przyklady:
 *   "II SA/Wa 1234/24"
 *   "III SA/Kr 567/23"
 */
const WSA_SIGNATURE_RE = /\b(?:I|II|III|IV)\s+SA\/[A-Z][a-z]{1,2}\s+\d{1,5}\/\d{2,4}\b/g;

/**
 * Sygnatury Krajowej Izby Odwolawczej (przy UZP, zamowienia publiczne).
 *
 * Format: `KIO <numer>/<rok>` lub `KIO/UZP <numer>/<rok>`
 *
 * Przyklady:
 *   "KIO 1234/24"
 *   "KIO 56/23"
 */
const KIO_SIGNATURE_RE = /\bKIO(?:\/UZP)?\s+\d{1,5}\/\d{2,4}\b/g;

/**
 * Sygnatury Trybunalu Konstytucyjnego.
 *
 * Format: `<typ_post> <numer>/<rok>`
 * gdzie typ to K (sprawa konstytucyjnosci ustawy), P (pytanie prawne),
 * U (kontrola rozporzadzen), SK (skarga konstytucyjna), Kp (przed-
 * publikacyjna), Kpt (kompetencyjny), Pp (zgodnosc partii politycznej).
 *
 * Wymagamy slowa-trigger "TK" lub kontekstu - ten regex jest bardzo
 * krotki i lapie false-positive z innych domen (np. "K 12/19" moze byc
 * fragmentem sygnatury innej). Walidacja kontekstowa w extractor
 * orchestratorze (planowany T2).
 *
 * Przyklady:
 *   "K 12/19"
 *   "SK 5/22"
 *   "P 7/20"
 */
const TK_SIGNATURE_RE = /\b(?:K|P|U|SK|Kp|Kpt|Pp)\s+\d{1,4}\/\d{2,4}\b/g;

/**
 * Liczba rzymska wydzialu/izby w zakresie I-XXXIX (1-39). Duze sady
 * (np. Warszawa) maja wydzialy o wysokich numerach (XXV, XXVII), wiec
 * nie wystarcza zakres 1-7 jak w SN. Fragment wspoldzielony - patrz tez
 * `parseSignaturePrefix` w gazetteers.ts (musi pozostac spojny).
 */
const ROMAN_1_39 = "(?:X{1,3}(?:IX|IV|VI{0,3}|I{1,3})?|IX|IV|VI{0,3}|I{1,3})";

/**
 * Sygnatury sadow powszechnych (rejonowe, okregowe) oraz apelacyjnych.
 *
 * Format: `<wydzial_rzymski> <kod_repertorium> <numer>/<rok>`
 * gdzie kod_repertorium to:
 *   - jednoliterowy kod sprawy: C (cywilny), K (karny), P (pracy),
 *     U (ubezpieczeniowy), W (wykroczeniowy)
 *   - kod mieszany (wielka litera + dalsze litery): Ns, Nc, Ca, Cz, Co,
 *     RC, GC, GNc, Ka, Kz, Pa, Ua oraz apelacyjne ACa, ACz, AKa, AKz,
 *     APa, AGa
 *
 * Negatywny lookahead `(?![A-Z]{2,4}\s)` wyklucza kody zlozone z 2-4
 * WIELKICH liter (CZP, CSK, FSK, OSK, KK, PK) - to teren SN/NSA, lapany
 * przez SN_SIGNATURE_RE / NSA_SIGNATURE_RE. Dzieki temu reguly sie nie
 * pokrywaja i nie generuja duplikatow encji na tym samym spanie.
 *
 * WSA ("II SA/Wa 100/26") nie jest lapany - po kodzie "SA" wystepuje
 * "/" zamiast spacji, wiec wzorzec `\s+\d` zawodzi (obsluga w WSA_RE).
 *
 * Przyklady:
 *   "I C 100/26"      - cywilny proces I instancji (najczestszy format)
 *   "I Ns 50/25"      - postepowanie nieprocesowe
 *   "II K 200/24"     - karny
 *   "XXV C 1500/23"   - cywilny, wysoki numer wydzialu (duzy sad)
 *   "I ACa 1234/23"   - apelacja cywilna (sad apelacyjny)
 *
 * Base confidence nizsze niz SN (kody krotsze = wieksze ryzyko
 * false-positive); extractor podnosi przy slowie-trigger ("sygn. akt")
 * oraz gdy prefix jest znany w gazetteerze.
 */
const SAD_POWSZECHNY_SIGNATURE_RE = new RegExp(
    `\\b${ROMAN_1_39}\\s+(?![A-Z]{2,4}\\s)[A-Z][A-Za-z]{0,3}\\s+\\d{1,5}\\/\\d{2,4}\\b`,
    "g",
);

/**
 * CELEX - identyfikator aktow prawa UE.
 *
 * Format: 10-cyfrowy kod, np. "32024R1689" (AI Act), "32016R0679" (RODO).
 *
 * Struktura: <typ_doc 1 cyfra><rok 4 cyfry><typ_aktu 1 litera><numer 4 cyfry>
 */
const CELEX_RE = /\b3\d{4}[RLDQ]\d{4}\b/g;

/**
 * ELI (European Legislation Identifier) dla aktow polskich z Dziennika
 * Ustaw lub Monitora Polskiego. Format url-like po `eli/`.
 *
 * Przyklady fragmentow url:
 *   "/eli/sejm/konst/1997/483/eng"
 *   "/eli/sejm/ustawy/1964/16/93"
 */
const ELI_FRAGMENT_RE = /eli\/(?:sejm|mp|powszechnie|akty-prawne)\/[a-z]+\/\d{4}\/\d+\/?\d*/gi;

/**
 * Telefon polski z prefixem +48 (deterministycznie - bez prefixu trudno
 * odroznic od PESEL / NIP / REGON, do LLM-fallback).
 */
const PHONE_PL_RE = /\+48[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g;

/**
 * Email - pragmatyczny regex (pelny RFC5322 jest bezwartosciowo zlozony).
 */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Formy prawne spolek - JEDNO zrodlo prawdy dla regexu FIRMA (ponizej) oraz
 * slownika bootstrapAnnotate (`LEGAL_FORMS` reeksportuje te liste). Rozjazd
 * dwoch recznie utrzymywanych list byl zrodlem luki opisanej nizej.
 *
 * Zapis kanoniczny MALA litera - tak wystepuje w KRS i w pismach procesowych
 * ("ABC sp. z o.o."), i to jest zapis dominujacy w polskiej praktyce. Wersja
 * z wielkiej ("Sp. z o.o.") jest lapana przez kompilacje case-insensitive,
 * patrz `legalFormPattern`.
 *
 * Warianty z polskimi znakami i bez (spolka / spółka) sa osobnymi wpisami -
 * pisma bywaja ASCII-folded (OCR, eksporty), a fold w regexie zwiekszalby
 * false-positive.
 */
export const LEGAL_FORM_LITERALS: readonly string[] = [
    "sp. z o.o.",
    "spółka z ograniczoną odpowiedzialnością",
    "spolka z ograniczona odpowiedzialnoscia",
    "s.a.",
    "sp. k.",
    "sp. j.",
    "sp. p.",
    "s.k.a.",
    "p.s.a.",
    "sp. komandytowa",
    "spółka komandytowa",
    "spolka komandytowa",
    "spółka cywilna",
    "spolka cywilna",
    "s.c.",
];

/**
 * Kompilacja literalu formy prawnej do fragmentu regexu ODPORNEGO NA WIELKOSC
 * LITER. Nie uzywamy flagi `i` na calym FIRMA_Z_FORMA_RE, bo kotwica nazwy
 * (`[A-ZŁŚŻŹĆŃÓĄĘ]` - nazwa firmy musi zaczynac sie z wielkiej) traci wtedy
 * cala precyzje. Flagi inline `(?i:...)` sa poza zasiegiem targetu Node 20.
 *
 * Reguly transformacji:
 *   - litera -> klasa `[xX]` (toUpperCase obsluguje tez ł/ó/ą/ś/ż/ź/ć/ń/ę),
 *   - kropka -> `\.`,
 *   - spacja PO kropce -> `\s*` (dopuszcza "sp.k." obok "sp. k."),
 *   - spacja po literze -> `\s+` (inaczej "spolkacywilna" byloby forma).
 */
function legalFormPattern(literal: string): string {
    let out = "";
    for (let i = 0; i < literal.length; i++) {
        const ch = literal[i]!;
        if (ch === ".") {
            out += "\\.";
        } else if (ch === " ") {
            out += literal[i - 1] === "." ? "\\s*" : "\\s+";
        } else {
            out += `[${ch}${ch.toUpperCase()}]`;
        }
    }
    return out;
}

// Sortowanie malejaco po dlugosci literalu - alternacja JS bierze PIERWSZY
// pasujacy wariant, wiec dluzsza forma musi byc probowana przed krotsza
// (inaczej "spolka komandytowa" zredukowaloby sie do przedrostka).
const LEGAL_FORM_ALT = [...LEGAL_FORM_LITERALS]
    .sort((a, b) => b.length - a.length)
    .map(legalFormPattern)
    .join("|");

/**
 * Forma prawna w nazwie firmy - heurystyka detekcji nazw spolek.
 * Wymaga w dopasowaniu obecnosci formy prawnej z `LEGAL_FORM_LITERALS` -
 * sama nazwa nie wystarczy.
 *
 * ADR-0110 (maskowanie podmiotow przed wyslaniem do LLM): wariant
 * case-sensitive NIE lapal zapisu mala litera ("ABC sp. z o.o."), czyli
 * zapisu DOMINUJACEGO w KRS i pismach procesowych - nazwa podmiotu klienta
 * mogla wyjsc do modelu chmurowego otwartym tekstem (tajemnica zawodowa).
 * Detekcja jest teraz odporna na wielkosc liter w samej formie prawnej;
 * nazwa nadal musi zaczynac sie z wielkiej litery.
 *
 * GRANICE: `(?<![\p{L}\p{N}_])` i `(?![\p{L}\p{N}])` zamiast `\b` - `\b`
 * jest ASCII, wiec gubi granice przy polskich literach ("Łódzkie Zaklady
 * sp. z o.o." na poczatku tekstu obcinalo pierwszy token nazwy). Granica
 * jest OBOWIAZKOWA: bez niej krotkie skroty (s.c., s.a.) generuja szum.
 *
 * PRECYZJA vs RECALL: formy slowne ("spolka cywilna") podnosza recall kosztem
 * precyzji - zdanie "Jest to spolka cywilna" tez sie zlapie. Swiadomy wybor:
 * nad-maskowanie jest odwracalne (unwrap w egress.ts), wyciek nazwy klienta
 * nie jest. Confidence 0.75 zostaje - warstwa wyzej moze filtrowac.
 *
 * Lapie tylko czesc nazw - "Acme sp. z o.o." OK, ale "Acme" bez
 * formy nie. W praktyce do uzupelnienia LLM-fallbackiem + lookup KRS.
 */
const FIRMA_Z_FORMA_RE = new RegExp(
    `(?<![\\p{L}\\p{N}_])[A-ZŁŚŻŹĆŃÓĄĘ][\\wŁŚŻŹĆŃÓĄĘłśżźćńóąę.,\\s&-]{0,80}?\\s+(?:${LEGAL_FORM_ALT})(?![\\p{L}\\p{N}])`,
    "gu",
);

/**
 * Osoba zakotwiczona na honoryfikatorze / tytule / roli procesowej (ADR-0127,
 * domkniecie wezlow PERSON grafu - audyt P2 #11). Grupa (1) = sama nazwa
 * (1-3 tokeny z wielkiej litery, z polskimi znakami i lacznikiem), marker NIE
 * wchodzi do dopasowania (detectAll bierze m[1]). Zakotwiczenie daje wysoka
 * precyzje: bez markera NIE lapiemy goych bigramow z wielkich liter (inaczej
 * "Sad Najwyzszy", nazwy ustaw -> falszywe osoby). Lookbehind Unicode (NIE \b),
 * bo marker moze zaczynac sie od polskiej litery ("świadek") - \b jest ASCII.
 * Lustro logiki egress lib/pseudonim/plDetector.ts (tam maskowanie, tu encje z
 * offsetami) - konwergencja do wspolnego zrodla = rezerwacja.
 */
const OSOBA_NAME = "[A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśźż]+(?:[-\\s][A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśźż]+){0,2}";
// Markery w formie kanonicznej (male litery tam gdzie role; Pan/Pani jak w tekscie).
const OSOBA_MARKERS_BASE = [
    "Pan", "Pani", "Pana", "Panu", "Panią", "Państwo", "Państwa",
    "adw\\.", "adwokat", "adwokata", "mec\\.", "mecenas", "mecenasa",
    "r\\.\\s?pr\\.", "radca prawny", "radcy prawnego",
    "sędzia", "sędziego", "prokurator", "prokuratora",
    "świadek", "świadka", "oskarżony", "oskarżonego", "oskarżonej", "oskarżona",
    "biegły", "biegłego", "biegła", "powód", "powoda", "pozwany", "pozwanego",
    "pokrzywdzony", "pokrzywdzonego", "obrońca", "obrońcy",
];
// Pierwsza litera markera case-insensitive ([xX]) - role bywaja na poczatku
// zdania z wielkiej ("Świadek X zeznal"); nazwa (grupa 1) wymagana z wielkiej.
const OSOBA_MARKERS = OSOBA_MARKERS_BASE.map((m) => {
    const c = m[0]!;
    return `[${c}${c.toUpperCase()}]${m.slice(1)}`;
}).join("|");
const OSOBA_Z_MARKEREM_RE = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${OSOBA_MARKERS})\\s+(${OSOBA_NAME})`,
    "gu",
);

/**
 * Komplet regul ekstrakcji. Wywolujacy moze rozszerzac/wylaczac
 * pojedyncze reguly per use case (graf cytowan moze potrzebowac wszystkie,
 * pseudonim PII tylko subset PESEL/NIP/REGON/KRS/EMAIL/PHONE/OSOBA/FIRMA).
 */
export const PL_EXTRACTION_RULES: ExtractionRule[] = [
    // === Identyfikatory PII (checksumy walidowane) ===
    {
        id: "pesel-11-digits-checksum",
        type: "PESEL",
        pattern: /\b\d{11}\b/g,
        validate: isValidPesel,
        baseConfidence: 1.0,
        normalize: (v) => v,
    },
    {
        id: "nip-10-digits-checksum",
        type: "NIP",
        pattern: /\b\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
        validate: isValidNip,
        baseConfidence: 1.0,
        normalize: (v) => v.replace(/[\s-]/g, ""),
    },
    {
        id: "regon-9-or-14-checksum",
        type: "REGON",
        pattern: /\b(\d{14}|\d{9})\b/g,
        validate: isValidRegon,
        baseConfidence: 1.0,
        normalize: (v) => v.replace(/[\s-]/g, ""),
    },
    {
        id: "krs-with-prefix",
        type: "KRS",
        // Wymagamy slowa "KRS" + opcjonalnego separatora przed cyframi -
        // bez tego false-positive eksploduje (zwykly 10-cyfrowy ciag).
        pattern: /\bKRS[:\s]*(\d{10})\b/gi,
        validate: isValidKrsFormat,
        baseConfidence: 0.95,
        normalize: (v) => v.replace(/[^\d]/g, "").padStart(10, "0"),
    },
    {
        id: "email-pragmatic",
        type: "EMAIL",
        pattern: EMAIL_RE,
        baseConfidence: 0.9,
        normalize: (v) => v.toLowerCase(),
    },
    {
        id: "phone-pl-with-prefix",
        type: "PHONE",
        pattern: PHONE_PL_RE,
        baseConfidence: 1.0,
        normalize: (v) => v.replace(/[\s-]/g, ""),
    },

    // === Sygnatury orzeczen polskich (5 top kategorii) ===
    {
        id: "signature-sn",
        type: "SYGNATURA_ORZECZENIA",
        pattern: SN_SIGNATURE_RE,
        baseConfidence: 0.85,
        normalize: (v) => v.replace(/\s+/g, " ").trim().toUpperCase(),
    },
    {
        id: "signature-nsa",
        type: "SYGNATURA_ORZECZENIA",
        pattern: NSA_SIGNATURE_RE,
        baseConfidence: 0.9,
        normalize: (v) => v.replace(/\s+/g, " ").trim().toUpperCase(),
    },
    {
        id: "signature-wsa",
        type: "SYGNATURA_ORZECZENIA",
        pattern: WSA_SIGNATURE_RE,
        baseConfidence: 0.9,
        normalize: (v) => v.replace(/\s+/g, " ").trim(),
    },
    {
        id: "signature-kio",
        type: "SYGNATURA_ORZECZENIA",
        pattern: KIO_SIGNATURE_RE,
        baseConfidence: 0.95,
        normalize: (v) => v.replace(/\s+/g, " ").trim().toUpperCase(),
    },
    {
        id: "signature-tk",
        type: "SYGNATURA_ORZECZENIA",
        // TK regex ma najwyzsze ryzyko false-positive (krotki format),
        // base confidence niski - extractor moze podniesc gdy sasiad slowa
        // "Trybunal" / "TK" w kontekscie (planowane T2)
        pattern: TK_SIGNATURE_RE,
        baseConfidence: 0.6,
        normalize: (v) => v.replace(/\s+/g, " ").trim().toUpperCase(),
    },
    {
        id: "signature-sad-powszechny",
        type: "SYGNATURA_ORZECZENIA",
        // Sady rejonowe / okregowe / apelacyjne - kody jednoliterowe
        // (I C 100/26) i mieszane (I Ns 50/25, I ACa 1234/23). Najczestszy
        // format spraw I instancji, dotychczas nie pokryty (SN_RE wymaga
        // kodu 2-4 wielkich liter). Normalize NIE wymusza UPPERCASE - kody
        // sadow powszechnych sa case-sensitive ("Ns" != "NS", "ACa" != "ACA").
        pattern: SAD_POWSZECHNY_SIGNATURE_RE,
        baseConfidence: 0.7,
        normalize: (v) => v.replace(/\s+/g, " ").trim(),
    },

    // === Sygnatury aktow prawa UE i PL ===
    {
        id: "celex-eu-act",
        type: "SYGNATURA_AKTU",
        pattern: CELEX_RE,
        baseConfidence: 1.0,
        normalize: (v) => v.toUpperCase(),
    },
    {
        id: "eli-pl-act",
        type: "SYGNATURA_AKTU",
        pattern: ELI_FRAGMENT_RE,
        baseConfidence: 0.95,
        normalize: (v) => v.toLowerCase(),
    },

    // === Firmy z forma prawna ===
    {
        id: "firma-z-forma-prawna",
        type: "FIRMA",
        pattern: FIRMA_Z_FORMA_RE,
        baseConfidence: 0.75,
        normalize: (v) => v.replace(/\s+/g, " ").trim(),
    },

    // === Osoby zakotwiczone na markerze (ADR-0127, wezly PERSON grafu) ===
    {
        id: "osoba-z-markerem",
        type: "OSOBA",
        pattern: OSOBA_Z_MARKEREM_RE,
        baseConfidence: 0.75,
        normalize: (v) => v.replace(/\s+/g, " ").trim(),
    },
];

/**
 * Pojedyncze dopasowanie regex bez transformacji - low-level interfejs.
 * Wyzsze warstwy (extractor orchestrator T2 ADR-0008) maja dostarczyc
 * `ExtractedEntity` po normalizacji + kontekstowej modyfikacji
 * confidence + dedup.
 */
export interface RegexMatch {
    /** Surowy tekst dopasowany (przed normalizacja). */
    raw: string;
    /** Wartosc znormalizowana wg `rule.normalize`. */
    normalized: string;
    /** Typ encji z reguly. */
    type: ExtractionRule["type"];
    /** Confidence bazowe z reguly. */
    confidence: number;
    /** Identyfikator reguly. */
    ruleId: string;
    /** Offset poczatkowy w tekscie zrodlowym. */
    start: number;
    /** Offset koncowy (exclusive). */
    end: number;
}

/**
 * Detekcja regex-based - przebiega po wszystkich regulach, walidator
 * filtruje false-positives, normalizator transformuje. Zwraca matches
 * posortowane wg pozycji w tekscie.
 *
 * Konflikty (dwa regexy lapia ten sam span) zostawiamy do rozwiazania
 * w extractor orchestratorze T2 - tutaj zwracamy wszystko.
 */
export function detectAll(
    text: string,
    rules: ExtractionRule[] = PL_EXTRACTION_RULES,
): RegexMatch[] {
    const matches: RegexMatch[] = [];
    for (const rule of rules) {
        // Re-create regex per call - flag `g` ma stan, recykling powodowal
        // by gubienie dopasowan przy kolejnych wywolaniach `detectAll`.
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const raw = m[1] ?? m[0];
            if (!raw) continue;
            const start = m.index + m[0]!.indexOf(raw);
            if (rule.validate && !rule.validate(raw)) continue;
            const normalized = rule.normalize ? rule.normalize(raw) : raw;
            matches.push({
                raw,
                normalized,
                type: rule.type,
                confidence: rule.baseConfidence,
                ruleId: rule.id,
                start,
                end: start + raw.length,
            });
        }
    }
    return matches.sort((a, b) => a.start - b.start);
}
