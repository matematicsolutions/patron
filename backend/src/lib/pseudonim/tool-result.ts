// Maskowanie WYNIKOW NARZEDZI przed oddaniem ich modelowi chmurowemu (audyt
// 2026-09, A-01 / P0).
//
// wrapConversation (egress.ts) maskuje system prompt i wiadomosci na starcie
// tury. Tresc akt trafia jednak do modelu niemal wylacznie przez narzedzia
// (read_document, fetch_documents, get_document_text, find_in_document,
// search_corpus, recall, read_table_cells, wyniki konektorow MCP) - i te wyniki
// szly do kolejnego wywolania providera surowe. Ten modul domyka luke: kazdy
// tool_result przechodzi przez TA SAMA mape pseudonimow co konwersacja, wiec:
//   - ten sam identyfikator dostaje ten sam token w wiadomosciach i w aktach,
//   - PseudonimStreamUnwrapper (trzyma referencje do tej samej, rozszerzanej
//     mapy) odwraca w odpowiedzi takze tokeny wprowadzone przez narzedzia,
//   - odtworzTokeny w stream.ts odwraca je w argumentach kolejnych wywolan.
//
// Dwa dodatki wzgledem samego wrapInto:
//   1. ZNANE ORYGINALY. Nazwisko rozpoznane raz po kotwicy ("Pan Jan Testowy")
//      jest maskowane takze tam, gdzie w kolejnym wyniku narzedzia stoi bez
//      kotwicy (fragment RAG, snippet find_in_document). Bez tego ta sama osoba
//      wychodzila jawnie w drugim wyniku narzedzia (klasa A-03).
//   2. JSON. Wiele narzedzi zwraca JSON.stringify(...). Maskowanie surowego
//      tekstu JSON moglo przeciac sekwencje ucieczki (span konczacy sie na `\`
//      przed `"`) i zepsuc dokument. Gdy wynik jest poprawnym JSON-em
//      (obiekt/tablica), maskujemy kazdy literal napisowy osobno (po
//      zdekodowaniu) i wstawiamy go z powrotem przez JSON.stringify - reszta
//      bajtow (liczby, biale znaki) zostaje nietknieta.

import { wrapInto, type WrapOptions } from "./wrap";
import { plEntityDetector } from "./plDetector";
import { noopLlmDetector } from "./detect";
import type { LlmDetector, PiiCategory, PseudonimMap } from "./types";

const LETTER_OR_DIGIT = /[\p{L}\p{N}_]/u;

/** Czy `text` zawiera `span` jako samodzielne slowo (granice Unicode). */
function containsAsWord(text: string, span: string): boolean {
    let idx = text.indexOf(span);
    while (idx !== -1) {
        const before = idx > 0 ? text[idx - 1]! : "";
        const after = text[idx + span.length] ?? "";
        if (
            (!before || !LETTER_OR_DIGIT.test(before)) &&
            (!after || !LETTER_OR_DIGIT.test(after))
        ) {
            return true;
        }
        idx = text.indexOf(span, idx + 1);
    }
    return false;
}

/**
 * Detektor laczacy bazowy detektor encji z "pamiecia" mapy: kazdy oryginal juz
 * obecny w mapie, ktory wystepuje w tekscie jako samodzielne slowo, jest
 * zglaszany ze swoja kategoria (addPseudonim zwroci istniejacy token).
 */
export function knownOriginalsDetector(
    map: PseudonimMap,
    base: LlmDetector = plEntityDetector,
): LlmDetector {
    return {
        async detect(text: string) {
            const hits: Array<{ span: string; category: PiiCategory }> = [
                ...(await base.detect(text)),
            ];
            if (!text) return hits;
            for (const t of map.tokens) {
                if (t.original && containsAsWord(text, t.original)) {
                    hits.push({ span: t.original, category: t.category });
                }
            }
            return hits;
        },
    };
}

/**
 * Maskuje w `text` WYLACZNIE oryginaly juz obecne w mapie (bez detekcji
 * regex/encji - te zrobil pierwszy przebieg). Mechanizm ten sam co dla wynikow
 * narzedzi (knownOriginalsDetector), wiec obie sciezki maja jedna definicje
 * "znanego oryginalu". Nie dodaje nowych wpisow do mapy (addPseudonim zwraca
 * istniejacy token), wiec jeden przebieg jest punktem stalym.
 * Uzywane w wrapConversation (audyt 2026-09, A-03).
 */
export async function maskKnownOriginalsInto(
    map: PseudonimMap,
    text: string,
): Promise<string> {
    if (!text || map.tokens.length === 0) return text;
    return wrapInto(map, text, {
        rules: [],
        llmDetector: knownOriginalsDetector(map, noopLlmDetector),
    });
}

function isJsonContainer(content: string): boolean {
    const head = content.trimStart()[0];
    if (head !== "{" && head !== "[") return false;
    try {
        const parsed: unknown = JSON.parse(content);
        return parsed !== null && typeof parsed === "object";
    } catch {
        return false;
    }
}

// Literal napisowy JSON. Na poprawnym dokumencie JSON skan od lewej trafia
// wylacznie w literaly (poza nimi nie ma cudzyslowow).
const JSON_STRING_LITERAL = /"(?:[^"\\]|\\.)*"/gs;

async function maskJsonStringLiterals(
    map: PseudonimMap,
    content: string,
    opts: WrapOptions,
): Promise<string> {
    let out = "";
    let last = 0;
    const re = new RegExp(JSON_STRING_LITERAL.source, JSON_STRING_LITERAL.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        const literal = m[0];
        const decoded = JSON.parse(literal) as string;
        const masked = await wrapInto(map, decoded, opts);
        out += content.slice(last, m.index);
        out += masked === decoded ? literal : JSON.stringify(masked);
        last = m.index + literal.length;
    }
    out += content.slice(last);
    return out;
}

/**
 * Maskuje tresc jednego tool_result do wspolnej mapy konwersacji. Mapa jest
 * MUTOWANA (nowe tokeny), co jest celowe - unwrapper strumienia i odtworzTokeny
 * czytaja te sama instancje.
 *
 * Domyslny detektor encji: plEntityDetector (jak wrapConversation w stream.ts),
 * uzupelniony o znane oryginaly z mapy.
 */
export async function wrapToolResultInto(
    map: PseudonimMap,
    content: string,
    opts: WrapOptions = {},
): Promise<string> {
    if (!content) return content;
    const wrapOpts: WrapOptions = {
        ...opts,
        llmDetector: knownOriginalsDetector(
            map,
            opts.llmDetector ?? plEntityDetector,
        ),
    };
    if (isJsonContainer(content)) {
        return maskJsonStringLiterals(map, content, wrapOpts);
    }
    return wrapInto(map, content, wrapOpts);
}
