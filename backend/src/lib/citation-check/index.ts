// "Sprawdz powolania" (ADR-0157): weryfikacja sygnatur i przepisow z pisma
// kancelarii w zewnetrznym korpusie (Repertorium, narzedzie MCP
// `verify_citations`) BEZ wysylania tresci pisma.
//
// Podzial pracy:
//   1. extractLocalCitations - LOKALNIE, kopia ekstraktora Repertorium
//      (`cytaty_pl.ts`, test dryfu sha256 obok). Wynik trzyma offsety w pismie.
//   2. buildVerifyItems - z kazdego cytatu buduje pozycje z BIALEJ LISTY pol:
//      sygnatura / data przy sygnaturze albo akt + artykul, plus nieprzezroczysty
//      `ref` ("c1", "c2"...). Zadnego wycinka pisma, zadnego offsetu, nazwy pliku.
//   3. checkDocumentCitations - partie po 25 (limit narzedzia), odpowiedz
//      laczona po `ref` z lokalnymi offsetami. Offset zna tylko PATRON.
//
// 🔴 To, co wychodzi do sieci, jest zwracane wolajacemu (`sent`) i pokazywane
// prawnikowi 1:1 - obietnica "pismo nie wychodzi" ma byc sprawdzalna na ekranie,
// nie deklaracja. Test `citation-check.test.ts` pilnuje jej na poziomie bajtow.

import { cytatyZPisma, MAKS_ZNAKOW_PISMA, type CytatZPisma } from "./cytaty_pl";

/** Limit narzedzia `verify_citations` na jedno wywolanie (kontrakt Repertorium). */
export const VERIFY_BATCH = 25;
/** Ile wywolan na jedno pismo - kazde liczy sie do limitu wyszukiwan tokenu. */
export const MAX_CALLS = 4;
/** Zakladka miedzy oknami pisma dluzszego niz 64 000 znakow. */
const OVERLAP = 2000;

export type CitationKind = "signature" | "provision" | "unrecognized_act";

export interface LocalCitation {
    /** Nieprzezroczysty identyfikator - jedyne, co laczy wynik z pismem. */
    ref: string;
    kind: CitationKind;
    /** Offset pierwszego wystapienia w tekscie pisma (UTF-16, jak String.slice). */
    offset: number;
    length: number;
    /** Fragment pisma - ZOSTAJE lokalnie (podswietlenie, raport). */
    excerpt: string;
    occurrences: number;
    signature?: string;
    date_in_text?: string | null;
    act_id?: string;
    act_name?: string;
    article?: string | null;
}

export interface LocalExtraction {
    citations: LocalCitation[];
    /** "art. 5 tej ustawy" - bez aktu, nie do sprawdzenia. */
    withoutAct: number;
    /** Pismo przeszlo przez wiecej niz jedno okno (liczba `withoutAct` przyblizona). */
    windows: number;
}

export type VerifyItem =
    | { type: "signature"; signature: string; date_in_text?: string; ref: string }
    | { type: "provision"; act_id: string; article: string; ref: string };

/**
 * Zakres PODSWIETLENIA przepisu. Ekstraktor bierze okno do 160 znakow i celowo
 * nie tnie na koncu wiersza (PDF lamie "Prawa\n\nbankowego"), wiec "art. 481 § 1
 * k.c.\nSad Najwyzszy..." podswietlalby dwa kolejne zdania. Tniemy tylko na
 * nowym wierszu, po ktorym stoi WIELKA litera - poczatek nastepnego zdania albo
 * akapitu, a potem na skrocie kodeksu. Identyfikator (akt, artykul) pochodzi z
 * ekstraktora i sie nie zmienia - to tylko zakres zaznaczenia w pismie.
 */
function zakresPodswietlenia(fragment: string): string {
    const m = /\n\s*[A-ZĄĆĘŁŃÓŚŹŻ]/.exec(fragment);
    const zdanie = (m ? fragment.slice(0, m.index) : fragment).trimEnd();
    // Skrot kodeksu zamyka powolanie: "art. 471 k.c., klauzula z" -> "art. 471 k.c."
    // (zmierzone 2026-10-01 na zywym przebiegu - okno konczy sie dopiero na
    // nastepnym "art."). Adresy Dz.U. i nazwy ustaw zostaja w calym oknie zdania.
    const skrot =
        /\bk\.(?:\s?[a-ząćęłńóśźż]{1,2}\.){1,3}|\bk(?:pc|pk|pa|sh|ro|kw|ks|c|k|p)\b/.exec(zdanie);
    return skrot ? zdanie.slice(0, skrot.index + skrot[0].length) : zdanie;
}

/** Klucz deduplikacji - ten sam co w ekstraktorze (typ + identyfikator). */
function keyOf(c: CytatZPisma): string {
    if (c.typ === "sygnatura") return `S|${c.sygnatura}`;
    if (c.typ === "przepis") return `P|${c.akt}|${c.artykul ?? ""}`;
    return `N|${c.fraza}|${c.artykul ?? ""}`;
}

/**
 * Wszystkie cytaty z pisma, z offsetami w CALYM tekscie. Ekstraktor czyta
 * najwyzej 64 000 znakow, wiec dluzsze pismo idzie oknami z zakladka; kazde
 * okno "posiada" swoj przedzial offsetow, zeby cytat z zakladki nie byl liczony
 * dwa razy.
 */
export function extractLocalCitations(text: string): LocalExtraction {
    const step = MAKS_ZNAKOW_PISMA - OVERLAP;
    const byKey = new Map<string, LocalCitation>();
    const order: LocalCitation[] = [];
    let withoutAct = 0;
    let windows = 0;
    for (let start = 0; start === 0 || start < text.length; start += step) {
        windows += 1;
        const part = text.slice(start, start + MAKS_ZNAKOW_PISMA);
        const last = start + MAKS_ZNAKOW_PISMA >= text.length;
        const ownFrom = start === 0 ? 0 : OVERLAP / 2;
        const ownTo = last ? Infinity : step + OVERLAP / 2;
        // `maks` wysoko: limit 25 dotyczy WYWOLANIA, nie pisma - partie robimy nizej.
        const r = cytatyZPisma(part, 100_000);
        withoutAct += r.bez_aktu;
        for (const c of r.cytaty) {
            if (c.offset < ownFrom || c.offset >= ownTo) continue;
            const key = keyOf(c);
            const prev = byKey.get(key);
            if (prev) {
                prev.occurrences += c.wystapien;
                if (c.typ === "sygnatura" && !prev.date_in_text)
                    prev.date_in_text = c.data_w_pismie;
                continue;
            }
            const offset = start + c.offset;
            const fragment = c.typ === "sygnatura" ? c.tekst : zakresPodswietlenia(c.tekst);
            const length = Math.max(0, Math.min(fragment.length, text.length - offset));
            const base = {
                ref: "",
                offset,
                length,
                excerpt: text.slice(offset, offset + length),
                occurrences: c.wystapien,
            };
            const lc: LocalCitation =
                c.typ === "sygnatura"
                    ? { ...base, kind: "signature", signature: c.sygnatura, date_in_text: c.data_w_pismie }
                    : c.typ === "przepis"
                      ? { ...base, kind: "provision", act_id: c.akt, act_name: c.nazwa, article: c.artykul }
                      : { ...base, kind: "unrecognized_act", act_name: c.fraza, article: c.artykul };
            byKey.set(key, lc);
            order.push(lc);
        }
        if (last) break;
    }
    order.sort((a, b) => a.offset - b.offset);
    order.forEach((c, i) => {
        c.ref = `c${i + 1}`;
    });
    return { citations: order, withoutAct, windows };
}

/**
 * Pozycje do wyslania - BIALA LISTA pol, budowana od zera (nie "obiekt minus
 * pola"), zeby nowe pole w LocalCitation nie moglo wyjsc po cichu.
 * `unrecognized_act` nie wychodzi: tryb listy go nie przyjmuje, a nazwa ustawy
 * spoza listy to tekst z pisma.
 */
export function buildVerifyItems(citations: readonly LocalCitation[]): VerifyItem[] {
    const out: VerifyItem[] = [];
    for (const c of citations) {
        if (c.kind === "signature" && c.signature) {
            out.push({
                type: "signature",
                signature: c.signature,
                ...(c.date_in_text ? { date_in_text: c.date_in_text } : {}),
                ref: c.ref,
            });
        } else if (c.kind === "provision" && c.act_id && c.article) {
            out.push({ type: "provision", act_id: c.act_id, article: c.article, ref: c.ref });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Wywolanie i scalenie
// ---------------------------------------------------------------------------

export interface ToolCallResult {
    text: string;
    structured?: unknown;
    isError?: boolean;
}
export type VerifyToolCall = (args: Record<string, unknown>) => Promise<ToolCallResult>;

/** Pola odpowiedzi serwera, ktore przenosimy do UI. Reszta jest pomijana. */
const DETAIL_FIELDS = [
    "document_id",
    "document_ids",
    "resolved_by_date",
    "same_signature_other",
    "corpus_dates",
    "court",
    "date_mismatch",
    "possible_typo_of",
    "act_title",
    "base_act_id",
    "provision",
    "changes_after_as_of",
    "last_change_before_as_of",
    "provision_checked",
    "checked_text",
    "note",
] as const;

export type CheckStatus =
    | "ok"
    | "partial"
    | "not_configured"
    | "failed"
    | "no_citations";

export interface CheckedCitation extends LocalCitation {
    /** Status z Repertorium albo lokalny: not_checked / not_sent / rejected / act_not_recognized. */
    status: string;
    details: Record<string, unknown>;
    /** Powod odrzucenia pozycji przez serwer (`rejected[].reason`). */
    rejected_reason?: string;
}

export interface CheckResult {
    status: CheckStatus;
    citations: CheckedCitation[];
    withoutAct: number;
    windows: number;
    /** Dokladnie to, co wyszlo do sieci - po jednej tablicy na wywolanie. */
    sent: VerifyItem[][];
    /** Pozycje nie wyslane, bo przekroczylyby MAX_CALLS. */
    notSent: number;
    asOf: string | null;
    checkedOn: string | null;
    snapshot: string | null;
    /** coverage_note kazdego wywolania - uczciwe granice od serwera. */
    serverNotes: string[];
    /** Ile wywolan sie nie udalo (blad, odmowa, brak `result`). */
    failedCalls: number;
}

interface Koperta {
    result?: {
        as_of?: string;
        checked_on?: string;
        citations?: Array<Record<string, unknown>>;
        rejected?: Array<{ index?: number; ref?: string | null; reason?: string }>;
    } | null;
    snapshot?: string;
    coverage_status?: string;
    coverage_note?: string;
}

function parseKoperta(r: ToolCallResult): Koperta | null {
    const candidate =
        r.structured && typeof r.structured === "object" ? r.structured : null;
    if (candidate) return candidate as Koperta;
    try {
        const parsed: unknown = JSON.parse(r.text);
        return parsed && typeof parsed === "object" ? (parsed as Koperta) : null;
    } catch {
        return null;
    }
}

/**
 * Sprawdza cytaty pisma. `callTool === null` znaczy: konektor weryfikacji nie
 * jest skonfigurowany - zwracamy LOKALNA ekstrakcje ze stanem `not_checked`,
 * zeby prawnik zobaczyl, co pismo powoluje, i wiedzial, ze tego nie sprawdzono.
 */
export async function checkDocumentCitations(params: {
    text: string;
    callTool: VerifyToolCall | null;
    asOf?: string | null;
}): Promise<CheckResult> {
    const { text, callTool } = params;
    const asOf = params.asOf ?? null;
    const local = extractLocalCitations(text);
    const checked: CheckedCitation[] = local.citations.map((c) => ({
        ...c,
        status: c.kind === "unrecognized_act" ? "act_not_recognized" : "not_checked",
        details: {},
    }));
    const byRef = new Map(checked.map((c) => [c.ref, c]));
    const items = buildVerifyItems(local.citations);
    const batches: VerifyItem[][] = [];
    for (let i = 0; i < items.length && batches.length < MAX_CALLS; i += VERIFY_BATCH)
        batches.push(items.slice(i, i + VERIFY_BATCH));
    const sentCount = batches.reduce((n, b) => n + b.length, 0);
    for (const it of items.slice(sentCount)) {
        const c = byRef.get(it.ref);
        if (c) c.status = "not_sent";
    }

    const base = {
        withoutAct: local.withoutAct,
        windows: local.windows,
        notSent: items.length - sentCount,
        asOf,
        checkedOn: null as string | null,
        snapshot: null as string | null,
        serverNotes: [] as string[],
        failedCalls: 0,
    };

    if (!callTool)
        return { ...base, status: "not_configured", citations: checked, sent: [] };
    if (items.length === 0)
        return { ...base, status: "no_citations", citations: checked, sent: [] };

    const sent: VerifyItem[][] = [];
    for (const batch of batches) {
        // Argumenty skladane TU, z pozycji z bialej listy - nic wiecej nie wychodzi.
        const args: Record<string, unknown> = { citations: batch };
        if (asOf) args.as_of = asOf;
        sent.push(batch);
        let koperta: Koperta | null = null;
        try {
            const r = await callTool(args);
            koperta = r.isError ? null : parseKoperta(r);
        } catch {
            koperta = null;
        }
        const wyniki = koperta?.result?.citations;
        if (!koperta || !Array.isArray(wyniki)) {
            base.failedCalls += 1;
            if (koperta?.coverage_note) base.serverNotes.push(koperta.coverage_note);
            continue;
        }
        if (koperta.coverage_note) base.serverNotes.push(koperta.coverage_note);
        base.snapshot = koperta.snapshot ?? base.snapshot;
        base.checkedOn = koperta.result?.checked_on ?? base.checkedOn;
        base.asOf = koperta.result?.as_of ?? base.asOf;
        for (const w of wyniki) {
            const ref = typeof w.ref === "string" ? w.ref : null;
            const c = ref ? byRef.get(ref) : undefined;
            // Wynik bez naszego `ref` (albo z cudzym) nie ma gdzie trafic w pismie -
            // nie zgadujemy po sygnaturze.
            if (!c) continue;
            c.status = typeof w.status === "string" ? w.status : "unknown";
            const details: Record<string, unknown> = {};
            for (const f of DETAIL_FIELDS) if (w[f] !== undefined) details[f] = w[f];
            c.details = details;
        }
        for (const rj of koperta.result?.rejected ?? []) {
            const ref =
                typeof rj.ref === "string"
                    ? rj.ref
                    : typeof rj.index === "number"
                      ? batch[rj.index]?.ref
                      : undefined;
            const c = ref ? byRef.get(ref) : undefined;
            if (!c) continue;
            c.status = "rejected";
            c.rejected_reason = typeof rj.reason === "string" ? rj.reason : undefined;
        }
    }

    const anyMissing = checked.some(
        (c) => c.status === "not_checked" || c.status === "unknown" || c.status === "not_sent",
    );
    const status: CheckStatus =
        base.failedCalls === batches.length
            ? "failed"
            : base.failedCalls > 0 || anyMissing
              ? "partial"
              : "ok";
    return { ...base, status, citations: checked, sent };
}
