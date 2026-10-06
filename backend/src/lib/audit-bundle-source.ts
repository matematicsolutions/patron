// Zrodla danych dla audit bundle (ADR-0152, wpiecie rdzenia ADR-0066).
//
// Builder `audit-bundle.ts` jest czysty i przyjmuje gotowe dane. Ten modul
// odtwarza te dane z tego, co Patron NAPRAWDE persystuje, i tez jest czysty -
// route tylko czyta wiersze z bazy i podaje je tutaj.
//
// Granica, ktora trzeba znac: werdykt groundingu jest zapisywany w adnotacjach
// wiadomosci jako `grounding` (decyzja) + `grounding_status` (status). Pola
// `worstRatio` i `offset` z GroundingResult NIE sa persystowane (granica
// ADR-0120 - do audytu ida liczby, nie tresc zrodla). Odtwarzamy je wiec jako
// -1 i mowimy o tym w `note`, zamiast wstawiac 0: zero w `worstRatio` znaczy
// "dopasowanie idealne", czyli byloby to falszywe twierdzenie o jakosci cytatu.

import type { GroundingResult } from "./citation/grounding";
import type { AuditPackEvent } from "./audit-pack";

/** Wartosc oznaczajaca "nie persystowane", rozlaczna z kazdym realnym pomiarem. */
export const NIE_PERSYSTOWANE = -1;

const NOTE_MCP =
    "Cytat ze zrodla zewnetrznego (konektor MCP, ADR-0146). Werdykt karty zrodla " +
    "green/yellow/red odwzorowany na verified/unverified/blocked. ref ujemny, bo " +
    "cytaty MCP nie sa kotwiczone znacznikami [N] w prozie.";

const NOTE_ODTWORZONE =
    "Odtworzone z adnotacji wiadomosci. worstRatio/offset nie sa persystowane (ADR-0120), " +
    "wiec maja wartosc -1 - to brak pomiaru, nie pomiar rowny zeru.";

type Adnotacja = {
    type?: unknown;
    ref?: unknown;
    doc_id?: unknown;
    grounding?: unknown;
    grounding_status?: unknown;
};

const DECYZJE = new Set(["verified", "unverified", "blocked"]);

/**
 * Wyciaga werdykty cytatow z adnotacji wiadomosci (`citation_data`).
 *
 * Bierze WYLACZNIE adnotacje, ktore maja zapisany werdykt - cytat bez werdyktu
 * nie zostal zweryfikowany i nie wolno go liczyc jako zweryfikowanego ani jako
 * odrzuconego. Kolejnosc: rosnaco po `ref`, zeby bundle byl deterministyczny
 * niezaleznie od kolejnosci w bazie.
 */
export function citationsFromAnnotations(annotations: unknown): PozycjaCytatu[] {
    if (!Array.isArray(annotations)) return [];
    const out: PozycjaCytatu[] = [];
    for (const a of annotations as Adnotacja[]) {
        if (!a || a.type !== "citation_data") continue;
        const decision = typeof a.grounding === "string" ? a.grounding : null;
        if (!decision || !DECYZJE.has(decision)) continue;
        out.push({
            ref: typeof a.ref === "number" ? a.ref : NIE_PERSYSTOWANE,
            doc_id: typeof a.doc_id === "string" ? a.doc_id : "",
            status: (typeof a.grounding_status === "string"
                ? a.grounding_status
                : "unknown") as GroundingResult["status"],
            decision: decision as GroundingResult["decision"],
            worstRatio: NIE_PERSYSTOWANE,
            offset: NIE_PERSYSTOWANE,
            note: NOTE_ODTWORZONE,
        });
    }
    // ADR-0146: cytaty z konektorow MCP maja WLASNA adnotacje i wlasne slownictwo
    // werdyktu (green/yellow/red per karta zrodla). Pominiecie ich sprawiloby, ze
    // pismo oparte na orzecznictwie pokazuje w pakiecie dowodowym ZERO cytatow -
    // czyli dowod milczalby o tym, na czym naprawde stoi teza.
    //
    // `ref` jest UJEMNY celowo: cytaty MCP nie sa kotwiczone znacznikami [N] w prozie
    // (patrz PATRONMessage.mcpCitations), wiec dodatni numer sugerowalby przypis,
    // ktorego w tekscie nie ma. Ujemny numer jest rozlaczny z numeracja przypisow.
    let kolejny = -1;
    // D-08: cytaty z adnotacji `mcp_grounding` (null, gdy jej nie ma) - patrz nizej.
    const cytaty = cytatyMcp(annotations);
    for (const a of annotations as (Adnotacja & { server?: unknown; tool?: unknown; url?: unknown; title?: unknown })[]) {
        if (!a || a.type !== "mcp_citation") continue;
        const decision = decyzjaZWerdyktuMcp(a.grounding);
        if (!decision) continue;
        const powod =
            a.grounding && typeof a.grounding === "object" ? (a.grounding as { reason?: unknown }).reason : undefined;
        // Karta, ktorej werdykt wynika z cytatow, jest reprezentowana przez te cytaty.
        if (cytaty && typeof powod === "string" && POWODY_Z_CYTATOW.has(powod)) continue;
        out.push({
            ref: kolejny--,
            doc_id: zrodloMcp(a),
            status: statusZWerdyktuMcp(a.grounding),
            decision,
            worstRatio: NIE_PERSYSTOWANE,
            offset: NIE_PERSYSTOWANE,
            note: NOTE_MCP,
        });
    }

    // Audyt 2026-09, D-08: werdykty na poziomie CYTATU (adnotacja `mcp_grounding`,
    // quotes[]). Karta zrodla agreguje cytaty: karta z jednym cytatem green i
    // jednym red ma werdykt green, a konektor bez kart (structuredContent bez
    // citations) nie daje zadnej karty - w obu przypadkach sfabrykowany cytat
    // znikal z pakietu. Gdy adnotacja z cytatami istnieje, cytat jest jednostka
    // dowodu: karty, ktorych werdykt wynika z cytatow (quote_found /
    // quote_modified / quote_not_found), sa juz reprezentowane przez swoje
    // cytaty i wypadaja (bez podwojnego liczenia). Karty bez cytatu do
    // sprawdzenia (no_quote / no_source) zostaja jako osobne pozycje.
    if (cytaty) {
        for (const q of cytaty) {
            const decision = decyzjaZWerdyktuMcp(q.verdict);
            if (!decision) continue;
            const src = q.source && typeof q.source === "object" ? (q.source as { server?: unknown; tool?: unknown }) : null;
            const item: PozycjaCytatu = {
                ref: kolejny--,
                doc_id:
                    typeof q.citationKey === "string"
                        ? q.citationKey
                        : src
                          ? `${typeof src.server === "string" ? src.server : ""}|${typeof src.tool === "string" ? src.tool : ""}|`
                          : "",
                status: (typeof q.status === "string" ? q.status : statusZWerdyktuMcp(q.verdict)) as GroundingResult["status"],
                decision,
                worstRatio: typeof q.ratio === "number" && Number.isFinite(q.ratio) ? q.ratio : NIE_PERSYSTOWANE,
                offset: NIE_PERSYSTOWANE,
                note: NOTE_MCP_CYTAT,
            };
            if (typeof q.quote === "string") item.quote = q.quote;
            if (q.kind === "blockquote" || q.kind === "inline") item.kind = q.kind;
            out.push(item);
        }
    }

    out.sort((x, y) => x.ref - y.ref);
    return out;
}

/**
 * Pozycja werdyktu w pakiecie. Cytat MCP niesie dodatkowo swoj tekst i rodzaj:
 * pakiet i tak zawiera cala odpowiedz, wiec tekst cytatu nie wynosi niczego
 * nowego, a bez niego odbiorca nie wie, KTORE zdanie dostalo werdykt red.
 */
export type PozycjaCytatu = GroundingResult & {
    quote?: string;
    kind?: "blockquote" | "inline";
};

type CytatMcp = {
    quote?: unknown;
    kind?: unknown;
    verdict?: unknown;
    status?: unknown;
    ratio?: unknown;
    source?: unknown;
    citationKey?: unknown;
};

/** quotes[] z adnotacji `mcp_grounding` albo null, gdy adnotacji nie ma. */
function cytatyMcp(annotations: unknown[]): CytatMcp[] | null {
    for (const a of annotations as Array<{ type?: unknown; quotes?: unknown }>) {
        if (a && a.type === "mcp_grounding" && Array.isArray(a.quotes)) {
            return (a.quotes as unknown[]).filter((q): q is CytatMcp => !!q && typeof q === "object");
        }
    }
    return null;
}

const NOTE_MCP_CYTAT =
    "Cytat podany w odpowiedzi jako doslowny, sprawdzony wobec tekstu zwroconego przez " +
    "konektor MCP w tej turze (ADR-0146). Werdykt cytatu green/yellow/red odwzorowany na " +
    "verified/unverified/blocked. Dla red wskazane zrodlo jest NAJBLIZSZE, nie potwierdzajace. " +
    "worstRatio to zapisany stosunek edit-distance/dlugosc; offset nie jest persystowany (-1).";

const POWODY_Z_CYTATOW = new Set(["quote_found", "quote_modified", "quote_not_found"]);

/** Identyfikator zrodla MCP - lustro `mcpCitationKey` (ADR-0146). */
function zrodloMcp(a: { server?: unknown; tool?: unknown; url?: unknown; title?: unknown }): string {
    const s = typeof a.server === "string" ? a.server : "";
    const tl = typeof a.tool === "string" ? a.tool : "";
    const u = typeof a.url === "string" ? a.url : typeof a.title === "string" ? a.title : "";
    return `${s}|${tl}|${u}`;
}

/**
 * green/yellow/red (karta zrodla MCP) -> verified/unverified/blocked.
 *
 * Mapowanie jest jawne, bo laczy DWA rozne mechanizmy weryfikacji w jednym
 * podsumowaniu. `red` idzie na `blocked`, a nie na `unverified`: czerwony znaczy
 * "cytat podany jako doslowny NIE wystepuje w zrodle", czyli mocniejsze
 * twierdzenie niz "nie sprawdzono".
 */
function decyzjaZWerdyktuMcp(g: unknown): GroundingResult["decision"] | null {
    const v = werdyktMcp(g);
    if (v === "green") return "verified";
    if (v === "yellow") return "unverified";
    if (v === "red") return "blocked";
    return null;
}

function statusZWerdyktuMcp(g: unknown): GroundingResult["status"] {
    return (werdyktMcp(g) ?? "unknown") as GroundingResult["status"];
}

function werdyktMcp(g: unknown): string | null {
    if (typeof g === "string") return g;
    if (g && typeof g === "object") {
        const v = (g as { verdict?: unknown }).verdict;
        if (typeof v === "string") return v;
    }
    return null;
}

/**
 * Model, ktory napisal TE odpowiedz (audyt 2026-09, D-02).
 *
 * Zrodlo pierwsze: zdarzenie `chat.message.assistant` zapisane dla tej
 * wiadomosci - czat zapisuje je zaraz PO wstawieniu wiadomosci, wiec to
 * najwczesniejsze zdarzenie asystenta z `ts >= createdAt` (i przed nastepna
 * odpowiedzia asystenta w czacie, gdy jest). Wczesniej model czytany byl
 * WYLACZNIE z `llm_route`, ktore czat zapisuje bez chat_id - pole bylo zawsze
 * null. Zrodlo drugie (gdy pierwszego nie ma): `modelFromAuditRows`.
 */
export function modelForMessage(
    rows: ReadonlyArray<{ event_type: string; ts: string; payload?: unknown }>,
    message: { createdAt: string | null; nextAssistantCreatedAt?: string | null },
): { model: string | null; source: "chat.message.assistant" | "llm_route" | null } {
    const od = message.createdAt ? Date.parse(message.createdAt) : NaN;
    const doChwili = message.nextAssistantCreatedAt ? Date.parse(message.nextAssistantCreatedAt) : NaN;
    if (Number.isFinite(od)) {
        const kandydaci = rows
            .filter((r) => r.event_type === "chat.message.assistant")
            .map((r) => ({ r, t: Date.parse(r.ts) }))
            .filter(({ t }) => Number.isFinite(t) && t >= od && (!Number.isFinite(doChwili) || t < doChwili))
            .sort((a, b) => a.t - b.t);
        const pierwszy = kandydaci[0]?.r;
        const p = pierwszy?.payload;
        if (p && typeof p === "object" && typeof (p as { model?: unknown }).model === "string") {
            return { model: (p as { model: string }).model, source: "chat.message.assistant" };
        }
    }
    const zTrasy = modelFromAuditRows(rows);
    return zTrasy ? { model: zTrasy, source: "llm_route" } : { model: null, source: null };
}

/**
 * Model uzyty w tym czacie - z NAJNOWSZEGO zdarzenia `llm_route`.
 *
 * Czyta ladunek SUROWY (przed maskowaniem), bo maskowanie dziala na stringach
 * i moglo by dotknac identyfikatora modelu. Zwraca null, gdy w wyciagu nie ma
 * zdarzenia routingu - lepiej null niz zgadniety model w dowodzie.
 */
export function modelFromAuditRows(
    rows: ReadonlyArray<{ event_type: string; ts: string; payload?: unknown }>,
): string | null {
    const trasy = rows
        .filter((r) => r.event_type === "llm_route")
        .slice()
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    for (const r of trasy) {
        const p = r.payload;
        if (p && typeof p === "object" && typeof (p as { model?: unknown }).model === "string") {
            return (p as { model: string }).model;
        }
    }
    return null;
}

/** Nazwa pliku JSON bundla - lustro konwencji `buildAuditPackFilename`. */
export function buildAuditBundleFilename(messageId: string, exportedAt: string): string {
    const bezpieczny = messageId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "deliverable";
    const d = new Date(exportedAt);
    if (Number.isNaN(d.getTime())) return `audit-bundle-${bezpieczny}.json`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    return `audit-bundle-${bezpieczny}-${dateStr}.json`;
}

/** Wiersz audit_log -> AuditPackEvent (payload podaje CALLER, juz zamaskowany). */
export function toPackEvent(
    row: {
        id: number;
        event_type: string;
        ts: string;
        actor_user_id: string | null;
        chat_id: string | null;
        document_id: string | null;
        hash: string;
        prev_hash: string;
    },
    payloadMasked: unknown,
): AuditPackEvent {
    return {
        id: row.id,
        event_type: row.event_type,
        ts: row.ts,
        actor_user_id: row.actor_user_id,
        chat_id: row.chat_id,
        document_id: row.document_id,
        hash: row.hash,
        prev_hash: row.prev_hash,
        payload_masked: payloadMasked,
    };
}
