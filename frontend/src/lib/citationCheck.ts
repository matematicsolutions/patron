// "Sprawdź powołania" (ADR-0157) - czyste funkcje widoku: typy odpowiedzi
// backendu, waga statusu, segmenty podświetlenia po offsetach i raport HTML.
// Raport powstaje w przeglądarce i zapisuje się lokalnie - bez serwera.

import { getLocale, t, type TranslationKey } from "@/i18n";

export type CitationKind = "signature" | "provision" | "unrecognized_act";

/** Dlaczego pozycja nie wyszła: limit wywołań albo zatrzymana lokalnie (R-CC-01). */
export type NotSentReason = "limit" | "not_court_signature" | "own_case_signature";

export interface CheckedCitation {
    ref: string;
    kind: CitationKind;
    offset: number;
    length: number;
    excerpt: string;
    occurrences: number;
    signature?: string;
    date_in_text?: string | null;
    act_id?: string;
    act_name?: string;
    article?: string | null;
    status: string;
    details: Record<string, unknown>;
    rejected_reason?: string;
    not_sent_reason?: NotSentReason;
}

export type SentItem =
    | { type: "signature"; signature: string; date_in_text?: string; ref: string }
    | { type: "provision"; act_id: string; article: string; ref: string };

export type CitationCheckResponse =
    | { status: "no_text"; filename: string }
    | {
          status: "ok" | "partial" | "not_configured" | "gateway_pending" | "failed" | "no_citations";
          filename: string;
          verifier: string;
          text: string;
          citations: CheckedCitation[];
          withoutAct: number;
          windows: number;
          sent: SentItem[][];
          notSent: number;
          /** Pozycje zatrzymane lokalnie (R-CC-01); brak pola = starszy backend. */
          withheld?: number;
          asOf: string | null;
          checkedOn: string | null;
          snapshot: string | null;
          serverNotes: string[];
          failedCalls: number;
          /**
           * B-08 (ADR-0158): przy `gateway_pending` - wartosci, ktore Operator
           * wpisuje w `gatewayApproval` (skroty SHA-256, bez adresu i klucza).
           */
          gatewayApproval?: GatewayApprovalHint;
      };

export interface GatewayApprovalHint {
    server: string;
    hash: string;
    origin: string;
    reason: "missing" | "hash_mismatch";
}

/** Fragment do wklejenia we wpis konektora w nakladce Operatora (ADR-0158). */
export function gatewayApprovalSnippet(g: GatewayApprovalHint): string {
    return JSON.stringify(
        { gatewayApproval: { hash: g.hash, origin: g.origin, approvedAt: "RRRR-MM-DD", approvedBy: "..." } },
        null,
        2,
    );
}

export type CheckedResponse = Exclude<CitationCheckResponse, { status: "no_text" }>;

/** Podstawia `{klucz}` w tekście słownika (t() nie ma interpolacji). */
export function fill(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (m, k: string) =>
        k in vars ? String(vars[k]) : m,
    );
}

export type Severity = "ok" | "warn" | "attention" | "none";

const OK = new Set(["found", "no_known_changes_after_date"]);
const ATTENTION = new Set([
    "not_in_corpus",
    "act_not_in_corpus",
    "provision_not_found",
    "act_repealed",
]);
const WARN = new Set([
    "ambiguous",
    "amended_after_date",
    "amendment_pending",
    "changes_unknown",
    "unknown",
]);

/**
 * Waga statusu dla koloru. "attention" to NIE "błąd": brak w korpusie wymaga
 * sprawdzenia, a nie dowodzi, że powołanie jest fałszywe. Zgodna sygnatura z
 * niezgodną datą schodzi z "ok" - to klasyczny ślad sklejonego cytatu.
 */
export function severityOf(c: Pick<CheckedCitation, "status" | "details">): Severity {
    if (c.details?.date_mismatch === true) return "attention";
    if (OK.has(c.status)) return "ok";
    if (ATTENTION.has(c.status)) return "attention";
    if (WARN.has(c.status)) return "warn";
    return "none";
}

const NOT_SENT_REASONS: readonly string[] = ["limit", "not_court_signature", "own_case_signature"];

const KNOWN_STATUSES = [
    "found", "ambiguous", "not_in_corpus", "unknown", "act_not_in_corpus",
    "act_repealed", "provision_not_found", "amendment_pending", "amended_after_date",
    "no_known_changes_after_date", "changes_unknown", "act_not_recognized",
    "not_checked", "not_sent", "rejected",
] as const;

export function statusLabel(status: string): string {
    if ((KNOWN_STATUSES as readonly string[]).includes(status))
        return t(`citationCheck.status.${status}` as TranslationKey);
    // Nowy status serwera nie może zniknąć ani udawać znanego - pokazujemy go wprost.
    return fill(t("citationCheck.status.other"), { s: status });
}

export function kindLabel(kind: CitationKind): string {
    return kind === "signature"
        ? t("citationCheck.kindSignature")
        : kind === "provision"
          ? t("citationCheck.kindProvision")
          : t("citationCheck.kindUnrecognized");
}

/** Czytelny identyfikator powołania: sygnatura albo "art. N <akt>". */
export function identifierOf(c: CheckedCitation): string {
    if (c.kind === "signature") return c.signature ?? c.excerpt;
    const art = c.article ? `art. ${c.article}` : "";
    const akt = c.act_name || c.act_id || "";
    return [art, akt].filter(Boolean).join(" ");
}

/** Linie szczegółów pod powołaniem (wspólne dla widoku i raportu). */
export function detailLines(c: CheckedCitation): string[] {
    const out: string[] = [];
    const d = c.details ?? {};
    if (c.occurrences > 1) out.push(fill(t("citationCheck.occurrences"), { n: c.occurrences }));
    if (c.date_in_text) out.push(fill(t("citationCheck.dateInText"), { d: c.date_in_text }));
    if (d.date_mismatch === true) {
        const daty = Array.isArray(d.corpus_dates) ? d.corpus_dates.filter(Boolean).join(", ") : "";
        out.push(fill(t("citationCheck.dateMismatch"), { d: daty || "?" }));
    }
    const typo = d.possible_typo_of as { signature?: unknown } | undefined;
    if (typo && typeof typo.signature === "string")
        out.push(fill(t("citationCheck.possibleTypo"), { s: typo.signature }));
    if (typeof d.act_title === "string") out.push(fill(t("citationCheck.actTitle"), { t: d.act_title }));
    if (Array.isArray(d.changes_after_as_of) && d.changes_after_as_of.length)
        out.push(fill(t("citationCheck.changesAfter"), { n: d.changes_after_as_of.length }));
    if (typeof d.note === "string") out.push(d.note);
    if (typeof c.rejected_reason === "string") out.push(c.rejected_reason);
    if (c.status === "not_sent" && c.not_sent_reason && NOT_SENT_REASONS.includes(c.not_sent_reason))
        out.push(t(`citationCheck.notSentReason.${c.not_sent_reason}` as TranslationKey));
    return out;
}

export interface Segment {
    text: string;
    ref: string | null;
}

/**
 * Tekst pisma pocięty na kawałki zwykłe i podświetlone. Offsety pochodzą z
 * lokalnej ekstrakcji (ten sam tekst), więc nic nie jest wyszukiwane ponownie.
 * Nakładające się zakresy: wygrywa wcześniejszy, późniejszy jest pomijany
 * (zostaje na liście powołań) - lepiej nie podświetlić niż podświetlić krzywo.
 */
export function highlightSegments(
    text: string,
    citations: ReadonlyArray<Pick<CheckedCitation, "ref" | "offset" | "length">>,
): Segment[] {
    const sorted = [...citations]
        .filter((c) => c.length > 0 && c.offset >= 0 && c.offset < text.length)
        .sort((a, b) => a.offset - b.offset);
    const out: Segment[] = [];
    let pos = 0;
    for (const c of sorted) {
        if (c.offset < pos) continue;
        const end = Math.min(text.length, c.offset + c.length);
        if (c.offset > pos) out.push({ text: text.slice(pos, c.offset), ref: null });
        out.push({ text: text.slice(c.offset, end), ref: c.ref });
        pos = end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), ref: null });
    return out;
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const SEVERITY_COLOR: Record<Severity, string> = {
    ok: "#1f7a3d",
    warn: "#8a5a00",
    attention: "#a3261b",
    none: "#555",
};

/**
 * Raport HTML: samodzielny plik (zero skryptów, zero zasobów zewnętrznych),
 * każdy napis z pisma i z serwera escapowany. Zawiera fragmenty pisma przy
 * powołaniach - zostaje na komputerze kancelarii jak samo pismo.
 */
export function buildReportHtml(r: CheckedResponse, generatedAt: Date): string {
    const wiersze = r.citations
        .map((c, i) => {
            const sev = severityOf(c);
            return `<tr><td>${i + 1}</td><td>${esc(kindLabel(c.kind))}</td><td>${esc(identifierOf(c))}</td>`
                + `<td class="frag">${esc(c.excerpt)}</td>`
                + `<td style="color:${SEVERITY_COLOR[sev]};font-weight:600">${esc(statusLabel(c.status))}</td>`
                + `<td>${detailLines(c).map(esc).join("<br>")}</td></tr>`;
        })
        .join("\n");
    const meta = [
        r.checkedOn ? fill(t("citationCheck.checkedOn"), { d: r.checkedOn }) : null,
        r.asOf ? fill(t("citationCheck.asOf"), { d: r.asOf }) : null,
        r.snapshot ? fill(t("citationCheck.snapshot"), { s: r.snapshot }) : null,
    ].filter((x): x is string => !!x);
    const wyslane = r.sent.flat().length;
    const uwagi = [
        statusNote(r),
        r.withoutAct ? fill(t("citationCheck.withoutAct"), { n: r.withoutAct }) : null,
        r.notSent ? fill(t("citationCheck.notSentCount"), { n: r.notSent }) : null,
        r.withheld ? fill(t("citationCheck.withheldCount"), { n: r.withheld }) : null,
    ].filter((x): x is string => !!x);
    return `<!doctype html>
<html lang="${getLocale() === "pl" ? "pl" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("citationCheck.reportTitle"))} - ${esc(r.filename)}</title>
<style>
body{font-family:Georgia,serif;margin:24px;color:#1a1a1a;background:#fff}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#555;font-size:13px;margin-bottom:12px}
.note{border-left:3px solid #999;padding:6px 10px;margin:8px 0;font-size:13px;background:#f6f6f6}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}
th{background:#f0f0f0}
.frag{font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap}
pre{font-size:12px;background:#f6f6f6;padding:8px;white-space:pre-wrap;word-break:break-all}
</style></head><body>
<h1>${esc(t("citationCheck.reportTitle"))}</h1>
<div class="meta">${esc(r.filename)} · ${esc(generatedAt.toISOString().slice(0, 10))}${meta.length ? " · " + meta.map(esc).join(" · ") : ""}</div>
<div class="note">${esc(fill(t("citationCheck.privacyNote"), { server: r.verifier, n: wyslane }))}</div>
<div class="note">${esc(t("citationCheck.notInCorpusNote"))}</div>
${uwagi.map((u) => `<div class="note">${esc(u)}</div>`).join("\n")}
<table><thead><tr><th>#</th><th></th><th>${esc(t("citationCheck.reportIdentifier"))}</th><th>${esc(t("citationCheck.reportFragment"))}</th><th>${esc(t("citationCheck.reportStatus"))}</th><th>${esc(t("citationCheck.reportDetails"))}</th></tr></thead>
<tbody>
${wiersze}
</tbody></table>
${r.serverNotes.length ? `<h2 style="font-size:15px">${esc(t("citationCheck.serverNotes"))}</h2>${r.serverNotes.map((n) => `<div class="note">${esc(String(n))}</div>`).join("\n")}` : ""}
<h2 style="font-size:15px">${esc(t("citationCheck.reportSent"))}</h2>
<pre>${esc(JSON.stringify(r.sent, null, 2))}</pre>
</body></html>
`;
}

/** Nota o stanie całego sprawdzenia (null, gdy wszystko sprawdzone). */
export function statusNote(
    r: Pick<CheckedResponse, "status"> & Partial<Pick<CheckedResponse, "verifier" | "gatewayApproval">>,
): string | null {
    switch (r.status) {
        case "not_configured":
            return t("citationCheck.statusNotConfigured");
        case "gateway_pending":
            return fill(t("citationCheck.statusGatewayPending"), {
                server: r.gatewayApproval?.server ?? r.verifier ?? "",
            });
        case "failed":
            return t("citationCheck.statusFailed");
        case "partial":
            return t("citationCheck.statusPartial");
        case "no_citations":
            return t("citationCheck.statusNoCitations");
        default:
            return null;
    }
}

export function reportFilename(filename: string, date: Date): string {
    const baza = filename.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60);
    return `sprawdzenie-powolan-${baza || "pismo"}-${date.toISOString().slice(0, 10)}.html`;
}
