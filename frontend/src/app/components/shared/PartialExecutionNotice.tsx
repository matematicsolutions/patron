// Jawne ostrzezenie o wykonaniu CZESCIOWYM edycji / komentarzy DOCX
// (audyt C-08 / D-10): "Zastosowano N z M. Nie zastosowano: ...".
// Wspolne dla inboxu kart zatwierdzen i panelu edycji w czacie - mecenas ma
// zobaczyc, ktore zmiany NIE weszly, zamiast domniemywac pelny sukces.

import { t } from "@/i18n";

export interface PartialFailure {
    index: number;
    reason: string;
}

export interface PartialExecutionInfo {
    applied: number;
    total: number;
    failures: PartialFailure[];
}

/** Bezpieczny odczyt listy bledow z niezaufanego JSON-a (SSE / odpowiedz API). */
export function readFailures(raw: unknown): PartialFailure[] {
    if (!Array.isArray(raw)) return [];
    const out: PartialFailure[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.reason !== "string") continue;
        out.push({
            index: typeof rec.index === "number" ? rec.index : -1,
            reason: rec.reason,
        });
    }
    return out;
}

/**
 * Wynik zatwierdzenia karty -> informacja o wykonaniu czesciowym albo null
 * (pelny sukces / brak wykonania). Backend oddaje result.applied /
 * result.requested / result.failed / result.errors (C-08).
 */
export function partialFromApprovalResult(
    executed: boolean,
    result: unknown,
): PartialExecutionInfo | null {
    if (!executed || !result || typeof result !== "object") return null;
    const r = result as Record<string, unknown>;
    const failures = readFailures(r.errors);
    const failedCount =
        typeof r.failed === "number" ? r.failed : failures.length;
    if (failures.length === 0 && failedCount <= 0) return null;
    const applied = typeof r.applied === "number" ? r.applied : 0;
    const total =
        typeof r.requested === "number"
            ? r.requested
            : applied + Math.max(failedCount, failures.length);
    return { applied, total, failures };
}

export function PartialExecutionNotice({
    info,
    note,
    filename,
}: {
    info: PartialExecutionInfo;
    /** Zdanie kontekstu (inbox kart vs czat). */
    note?: string;
    filename?: string;
}) {
    const summary = t("partialExecution.summary")
        .replace("{applied}", String(info.applied))
        .replace("{total}", String(info.total));
    return (
        <div
            role="alert"
            className="rounded-lg border border-warn-soft bg-warn-soft px-4 py-3 text-sm text-warn"
        >
            <p className="font-medium">
                {t("partialExecution.title")}
                {filename ? ` - ${filename}` : ""}
            </p>
            {note && <p className="mt-1">{note}</p>}
            <p className="mt-1">{summary}</p>
            {info.failures.length > 0 && (
                <>
                    <p className="mt-1">{t("partialExecution.notAppliedLabel")}</p>
                    <ul className="mt-1 list-disc pl-5">
                        {info.failures.map((f, i) => (
                            <li key={`${f.index}-${i}`}>
                                {f.index >= 0
                                    ? t("partialExecution.item")
                                          .replace("{n}", String(f.index + 1))
                                          // replacer-funkcja: "$&" / "$1" w powodzie
                                          // (cytat z dokumentu) zostaje doslownie
                                          .replace("{reason}", () => f.reason)
                                    : f.reason}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
