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
//      Sygnatura wychodzi tylko z symbolem repertorium z BIALEJ LISTY sadow
//      (`repertoria.ts`, R-CC-01) i nie wychodzi sygnatura wlasnej sprawy z
//      naglowka pisma - reszta zostaje lokalnie jako `not_sent` z powodem.
//   3. checkDocumentCitations - partie po 25 (limit narzedzia), odpowiedz
//      laczona po `ref` z lokalnymi offsetami. Offset zna tylko PATRON.
//
// 🔴 To, co wychodzi do sieci, jest zwracane wolajacemu (`sent`) i pokazywane
// prawnikowi 1:1 - obietnica "pismo nie wychodzi" ma byc sprawdzalna na ekranie,
// nie deklaracja. Test `citation-check.test.ts` pilnuje jej na poziomie bajtow.

import { cytatyZPisma, MAKS_ZNAKOW_PISMA, type CytatZPisma } from "./cytaty_pl";
import { jestSygnaturaSadu, sygnaturyWlasnejSprawy } from "./repertoria";

/** Limit narzedzia `verify_citations` na jedno wywolanie (kontrakt Repertorium). */
export const VERIFY_BATCH = 25;
/** Ile wywolan na jedno pismo - kazde liczy sie do limitu wyszukiwan tokenu. */
export const MAX_CALLS = 4;
/** Zakladka miedzy oknami pisma dluzszego niz 64 000 znakow. */
const OVERLAP = 2000;

export type CitationKind = "signature" | "provision" | "unrecognized_act";

/**
 * Dlaczego pozycja NIE wychodzi do weryfikatora, choc ekstraktor ja znalazl
 * (R-CC-01): ciag "LITERY liczba/liczba" bez symbolu repertorium sadu z bialej
 * listy (adres, faktura, repertorium notarialne, sygnatura kancelarii) albo
 * sygnatura wlasnej sprawy z naglowka pisma.
 */
export type WithheldReason = "not_court_signature" | "own_case_signature";
/** Powod stanu `not_sent`: zatrzymane lokalnie albo ponad limit wywolan. */
export type NotSentReason = WithheldReason | "limit";

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
    /** Ustawione przy ekstrakcji: ta pozycja NIE wychodzi z komputera. */
    withheld?: WithheldReason;
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

/**
 * R-CC-05 (przeglad 2026-10-02, ADR-0157 pkt 3 "podswietlenie nie zgaduje"):
 * ekstraktor szuka sygnatur w `t.toUpperCase()`, a przepisow w `t.toLowerCase()`,
 * i uzywa offsetow z tych napisow jako offsetow w `t` ("wersaliki nie zmieniaja
 * dlugosci"). Ligatury z ekstrakcji PDF (U+FB01 "ﬁ" -> "FI", U+FB02 "ﬂ" -> "FL"),
 * "ß" -> "SS", "İ" -> "i̇" i podobne znaki lamia to zalozenie: kazdy offset za
 * nimi jest przesuniety, wiec podswietlenie i `excerpt` wskazuja inny fragment.
 *
 * `cytaty_pl.ts` jest kopia z przypietym sha (test dryfu) - nie zmieniamy go.
 * Zamiast tego ekstraktor dostaje tekst, w ktorym kazdy taki znak zastapiono
 * znakiem zastepczym o TEJ SAMEJ dlugosci UTF-16, dla ktorego zmiana wielkosci
 * liter dlugosci nie zmienia. Offsety sa wtedy wspolne dla obu napisow, a
 * excerpt i zakres podswietlenia bierzemy z ORYGINALU.
 *
 * Zastepnik zachowuje "literowosc" (pierwsza litera rozwiniecia: "ﬁ" -> "f",
 * "ß" -> "s"), zeby granice slow wokol niego byly takie jak w oryginale; gdy
 * taka litera tez nie spelnia warunku - U+FFFD.
 */
const ZASTEPNIK = "\uFFFD";
const zastepnikCache = new Map<string, string>();

function stalaDlugosc(ch: string): boolean {
    return ch.toUpperCase().length === ch.length && ch.toLowerCase().length === ch.length;
}

function zastepnikZnaku(ch: string): string {
    const cached = zastepnikCache.get(ch);
    if (cached !== undefined) return cached;
    let out: string;
    if (stalaDlugosc(ch)) out = ch;
    else if (ch.length === 1) {
        // "ﬁ" -> "FI" -> "f"; "ß" -> "SS" -> "s"; "İ" -> (dolna "i̇") -> "i".
        const gorna = ch.toUpperCase()[0]!;
        const kandydaci = [gorna.toLowerCase(), gorna, ch.toLowerCase()[0]!];
        out = kandydaci.find((k) => k.length === 1 && stalaDlugosc(k)) ?? ZASTEPNIK;
    } else out = ZASTEPNIK.repeat(ch.length); // para surogatow: 2 jednostki UTF-16
    zastepnikCache.set(ch, out);
    return out;
}

/**
 * Tekst dla ekstraktora: ta sama dlugosc UTF-16 co `text`, kazdy znak o stalej
 * dlugosci przy toUpperCase/toLowerCase. Znaki ASCII przechodza bez sprawdzania.
 */
export function tekstDlaEkstraktora(text: string): string {
    if (!/[^\x00-\x7f]/.test(text)) return text;
    let out = "";
    for (const ch of text) out += ch.charCodeAt(0) < 0x80 ? ch : zastepnikZnaku(ch);
    return out;
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
    // R-CC-05: ekstraktor czyta tekst o stalej dlugosci przy zmianie wielkosci
    // liter; offsety sa wspolne z `text`, z ktorego bierzemy excerpt.
    const scan = tekstDlaEkstraktora(text);
    const step = MAKS_ZNAKOW_PISMA - OVERLAP;
    const byKey = new Map<string, LocalCitation>();
    const order: LocalCitation[] = [];
    let withoutAct = 0;
    let windows = 0;
    for (let start = 0; start === 0 || start < text.length; start += step) {
        windows += 1;
        const part = scan.slice(start, start + MAKS_ZNAKOW_PISMA);
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
            // Zakres z ORYGINALU (R-CC-05): `c.tekst` pochodzi z tekstu dla
            // ekstraktora, ma te sama dlugosc, ale moze niesc znaki zastepcze.
            const oryginal = text.slice(offset, offset + c.tekst.length);
            const fragment = c.typ === "sygnatura" ? oryginal : zakresPodswietlenia(oryginal);
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
    // R-CC-01: sygnatura wychodzi tylko z repertorium sadu z bialej listy, a
    // sygnatura wlasnej sprawy (naglowek pisma) nie wychodzi wcale. Pozycja
    // zostaje na liscie - prawnik widzi, co zatrzymano i dlaczego.
    const wlasne = sygnaturyWlasnejSprawy(text);
    order.forEach((c, i) => {
        c.ref = `c${i + 1}`;
        if (c.kind !== "signature") return;
        const kontekst = text.slice(Math.max(0, c.offset - 100), c.offset + c.length + 40);
        if (!c.signature || !jestSygnaturaSadu(c.excerpt, kontekst))
            c.withheld = "not_court_signature";
        else if (wlasne.has(c.signature)) c.withheld = "own_case_signature";
    });
    return { citations: order, withoutAct, windows };
}

/**
 * Pozycje do wyslania - BIALA LISTA pol, budowana od zera (nie "obiekt minus
 * pola"), zeby nowe pole w LocalCitation nie moglo wyjsc po cichu.
 * `unrecognized_act` nie wychodzi: tryb listy go nie przyjmuje, a nazwa ustawy
 * spoza listy to tekst z pisma. Pozycja z `withheld` (R-CC-01) tez nie wychodzi -
 * dlatego wejsciem ma byc wynik `extractLocalCitations`, ktory to pole ustawia.
 */
export function buildVerifyItems(citations: readonly LocalCitation[]): VerifyItem[] {
    const out: VerifyItem[] = [];
    for (const c of citations) {
        if (c.withheld) continue;
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
    /**
     * B-08 (ADR-0158): konektor weryfikatora jest skonfigurowany, ale brama MCP
     * czeka na zatwierdzenie Operatora (`gatewayApproval`) - powolania wyciagniete
     * lokalnie, nic nie wyszlo do sieci.
     */
    | "gateway_pending"
    | "failed"
    | "no_citations";

export interface CheckedCitation extends LocalCitation {
    /** Status z Repertorium albo lokalny: not_checked / not_sent / rejected / act_not_recognized. */
    status: string;
    details: Record<string, unknown>;
    /** Powod odrzucenia pozycji przez serwer (`rejected[].reason`). */
    rejected_reason?: string;
    /** Przy stanie `not_sent`: zatrzymane lokalnie (R-CC-01) albo ponad limit. */
    not_sent_reason?: NotSentReason;
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
    /** Pozycje zatrzymane lokalnie (R-CC-01): nie sygnatura sadu albo wlasna sprawa. */
    withheld: number;
    asOf: string | null;
    checkedOn: string | null;
    snapshot: string | null;
    /** coverage_note kazdego wywolania - uczciwe granice od serwera. */
    serverNotes: string[];
    /** Ile wywolan sie nie udalo (blad, odmowa, brak `result`). */
    failedCalls: number;
}

/** Odpowiedz serwera po walidacji ksztaltu - tylko pola, ktorych uzywamy. */
interface Odpowiedz {
    /** `coverage_note`, gdy jest napisem (R-CC-04). */
    note: string | null;
    snapshot: string | null;
    /** null = koperta bez wyniku albo z wynikiem o zlym ksztalcie. */
    result: {
        asOf: string | null;
        checkedOn: string | null;
        citations: Array<Record<string, unknown>>;
        rejected: Array<Record<string, unknown>>;
    } | null;
}

function zwyklyObiekt(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function napis(v: unknown): string | null {
    return typeof v === "string" ? v : null;
}

/**
 * Serwer weryfikatora jest zdalny (Ring 2, niezaufany): jego odpowiedz to dane,
 * ktorych ksztalt sprawdzamy, zanim cokolwiek z niej przeczytamy (R-CC-03).
 * Zly ksztalt wyniku (`citations` nie-tablica albo z elementem nie-obiektem,
 * `rejected` nie-tablica albo z elementem nie-obiektem) = cale wywolanie
 * nieudane - nie przyjmujemy polowy odpowiedzi, ktorej reszta jest smieciem.
 */
function parseOdpowiedz(r: ToolCallResult): Odpowiedz | null {
    let koperta: unknown = zwyklyObiekt(r.structured) ? r.structured : null;
    if (!koperta) {
        try {
            koperta = JSON.parse(typeof r.text === "string" ? r.text : "");
        } catch {
            return null;
        }
    }
    if (!zwyklyObiekt(koperta)) return null;
    const out: Odpowiedz = {
        note: napis(koperta.coverage_note),
        snapshot: napis(koperta.snapshot),
        result: null,
    };
    const w = koperta.result;
    if (!zwyklyObiekt(w)) return out;
    const citations = w.citations;
    const rejected = w.rejected ?? [];
    if (!Array.isArray(citations) || !citations.every(zwyklyObiekt)) return out;
    if (!Array.isArray(rejected) || !rejected.every(zwyklyObiekt)) return out;
    out.result = {
        asOf: napis(w.as_of),
        checkedOn: napis(w.checked_on),
        citations,
        rejected,
    };
    return out;
}

/**
 * Sprawdza cytaty pisma. `callTool === null` znaczy: konektor weryfikacji nie
 * jest skonfigurowany albo czeka na zatwierdzenie Operatora (`pendingApproval`,
 * B-08) - zwracamy LOKALNA ekstrakcje ze stanem `not_checked`, zeby prawnik
 * zobaczyl, co pismo powoluje, i wiedzial, ze tego nie sprawdzono.
 */
export async function checkDocumentCitations(params: {
    text: string;
    callTool: VerifyToolCall | null;
    asOf?: string | null;
    /** Przy `callTool === null`: konektor czeka na zatwierdzenie Operatora (B-08). */
    pendingApproval?: boolean;
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
        if (c) {
            c.status = "not_sent";
            c.not_sent_reason = "limit";
        }
    }
    let withheld = 0;
    for (const c of checked) {
        if (!c.withheld) continue;
        c.status = "not_sent";
        c.not_sent_reason = c.withheld;
        withheld += 1;
    }

    const base = {
        withoutAct: local.withoutAct,
        windows: local.windows,
        notSent: items.length - sentCount,
        withheld,
        asOf,
        checkedOn: null as string | null,
        snapshot: null as string | null,
        serverNotes: [] as string[],
        failedCalls: 0,
    };

    if (!callTool)
        return {
            ...base,
            status: params.pendingApproval ? "gateway_pending" : "not_configured",
            citations: checked,
            sent: [],
        };
    if (items.length === 0)
        return { ...base, status: "no_citations", citations: checked, sent: [] };

    const sent: VerifyItem[][] = [];
    for (const batch of batches) {
        // Argumenty skladane TU, z pozycji z bialej listy - nic wiecej nie wychodzi.
        const args: Record<string, unknown> = { citations: batch };
        if (asOf) args.as_of = asOf;
        sent.push(batch);
        let odp: Odpowiedz | null = null;
        try {
            const r = await callTool(args);
            odp = r && !r.isError ? parseOdpowiedz(r) : null;
        } catch {
            odp = null;
        }
        if (odp?.note) base.serverNotes.push(odp.note);
        const wynik = odp?.result;
        if (!odp || !wynik) {
            base.failedCalls += 1;
            continue;
        }
        base.snapshot = odp.snapshot ?? base.snapshot;
        base.checkedOn = wynik.checkedOn ?? base.checkedOn;
        base.asOf = wynik.asOf ?? base.asOf;
        // R-CC-08: wynik przyjmujemy WYLACZNIE dla pozycji wyslanych w tej partii.
        // `ref` innego cytatu (niewyslanego, z innej partii, zgadniety) nie moze
        // nadac stanu powolaniu, ktorego ten serwer w tym wywolaniu nie dostal.
        const wPartii = new Set(batch.map((b) => b.ref));
        for (const w of wynik.citations) {
            const ref = typeof w.ref === "string" && wPartii.has(w.ref) ? w.ref : null;
            const c = ref ? byRef.get(ref) : undefined;
            // Wynik bez naszego `ref` (albo z cudzym) nie ma gdzie trafic w pismie -
            // nie zgadujemy po sygnaturze.
            if (!c) continue;
            c.status = typeof w.status === "string" && w.status ? w.status : "unknown";
            const details: Record<string, unknown> = {};
            for (const f of DETAIL_FIELDS) if (w[f] !== undefined) details[f] = w[f];
            c.details = details;
        }
        for (const rj of wynik.rejected) {
            const ref =
                typeof rj.ref === "string"
                    ? rj.ref
                    : typeof rj.index === "number" && Number.isInteger(rj.index)
                      ? batch[rj.index]?.ref
                      : undefined;
            const c = ref && wPartii.has(ref) ? byRef.get(ref) : undefined;
            if (!c) continue;
            c.status = "rejected";
            c.rejected_reason = typeof rj.reason === "string" ? rj.reason : undefined;
        }
    }

    // Niesprawdzone: brak wyniku, status nieustalony, odrzucone przez serwer
    // (R-CC-02) i nadwyzka ponad limit. Pozycje zatrzymane lokalnie (R-CC-01)
    // nie byly do sprawdzenia - maja wlasny wiersz z powodem i licznik `withheld`.
    const NIESPRAWDZONE = new Set(["not_checked", "unknown", "rejected"]);
    const anyMissing = checked.some(
        (c) =>
            NIESPRAWDZONE.has(c.status) ||
            (c.status === "not_sent" && c.not_sent_reason === "limit"),
    );
    const sentRefs = new Set(sent.flat().map((i) => i.ref));
    const anyChecked = checked.some(
        (c) => sentRefs.has(c.ref) && !NIESPRAWDZONE.has(c.status),
    );
    // Brak sprawdzenia nigdy nie jest "ok" (ADR-0146): zero sprawdzonych powolan
    // przy udanych wywolaniach (np. serwer odrzucil wszystko) to "failed".
    const status: CheckStatus =
        base.failedCalls === batches.length || !anyChecked
            ? "failed"
            : base.failedCalls > 0 || anyMissing
              ? "partial"
              : "ok";
    return { ...base, status, citations: checked, sent };
}
