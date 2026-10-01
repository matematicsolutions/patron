"use client";

// "Sprawdź powołania" (ADR-0157): tekst pisma z podświetlonymi powołaniami i
// lista stanów z korpusu Repertorium. Offsety pochodzą z lokalnej ekstrakcji
// tego samego tekstu - podświetlenie nie wyszukuje niczego ponownie.

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { t } from "@/i18n";
import { checkDocumentCitations } from "@/app/lib/patronApi";
import {
    buildReportHtml,
    detailLines,
    fill,
    highlightSegments,
    identifierOf,
    kindLabel,
    reportFilename,
    severityOf,
    statusLabel,
    statusNote,
    type CheckedResponse,
    type CitationCheckResponse,
    type Severity,
} from "@/lib/citationCheck";

interface Props {
    documentId: string;
    onBack: () => void;
}

const MARK: Record<Severity, string> = {
    ok: "bg-ok-soft",
    warn: "bg-warn-soft",
    attention: "bg-bad-soft",
    none: "bg-gray-100",
};
const BADGE: Record<Severity, string> = {
    ok: "text-ok border-ok-soft",
    warn: "text-warn border-warn-soft",
    attention: "text-bad border-bad-soft",
    none: "text-gray-500 border-gray-200",
};

export function CitationCheckView({ documentId, onBack }: Props) {
    const [asOf, setAsOf] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CitationCheckResponse | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [showSent, setShowSent] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const run = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSelected(null);
        try {
            setResult(await checkDocumentCitations(documentId, asOf || null));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [documentId, asOf]);

    const checked: CheckedResponse | null =
        result && result.status !== "no_text" ? result : null;
    const byRef = useMemo(
        () => new Map((checked?.citations ?? []).map((c) => [c.ref, c])),
        [checked],
    );
    const segments = useMemo(
        () => (checked ? highlightSegments(checked.text, checked.citations) : []),
        [checked],
    );
    const sentCount = checked ? checked.sent.reduce((n, b) => n + b.length, 0) : 0;

    function select(ref: string, from: "text" | "list") {
        setSelected(ref);
        const root = from === "list" ? textRef.current : listRef.current;
        root?.querySelector(`[data-ref="${ref}"]`)?.scrollIntoView({
            block: "center",
            behavior: "smooth",
        });
    }

    function downloadReport() {
        if (!checked) return;
        const now = new Date();
        const blob = new Blob([buildReportHtml(checked, now)], {
            type: "text/html;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = reportFilename(checked.filename, now);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const note = checked ? statusNote(checked) : null;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Pasek sterowania */}
            <div className="flex flex-wrap items-end gap-3 px-5 pb-3 shrink-0">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t("citationCheck.backToDocument")}
                </button>
                <label className="flex flex-col text-xs text-gray-600">
                    {t("citationCheck.asOfLabel")}
                    <input
                        type="date"
                        value={asOf}
                        onChange={(e) => setAsOf(e.target.value)}
                        className="mt-1 rounded border border-gray-200 px-2 py-1 text-sm text-gray-800"
                    />
                </label>
                <button
                    onClick={() => void run()}
                    disabled={loading}
                    className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
                >
                    {result ? t("citationCheck.rerun") : t("citationCheck.run")}
                </button>
                {checked && checked.citations.length > 0 && (
                    <button
                        onClick={downloadReport}
                        title={t("citationCheck.downloadReportHint")}
                        className="ml-auto flex items-center gap-1 rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        <Download className="h-4 w-4" />
                        {t("citationCheck.downloadReport")}
                    </button>
                )}
            </div>
            <p className="px-5 pb-2 text-xs text-gray-500 shrink-0">
                {t("citationCheck.asOfHint")}
            </p>

            {loading && (
                <div className="flex items-center gap-2 px-5 py-4 text-sm text-gray-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("citationCheck.running")}
                </div>
            )}
            {error && (
                <div className="mx-5 my-2 rounded border border-bad-soft bg-bad-soft px-3 py-2 text-sm text-bad">
                    {error}
                </div>
            )}
            {result?.status === "no_text" && (
                <div className="mx-5 my-2 rounded border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    {t("citationCheck.statusNoText")}
                </div>
            )}

            {checked && !loading && (
                <>
                    <div className="space-y-2 px-5 pb-3 shrink-0 text-xs">
                        {sentCount > 0 && (
                            <div className="rounded border border-ok-soft bg-ok-soft px-3 py-2 text-gray-800">
                                {fill(t("citationCheck.privacyNote"), {
                                    server: checked.verifier,
                                    n: sentCount,
                                })}{" "}
                                <button
                                    onClick={() => setShowSent((v) => !v)}
                                    className="underline"
                                >
                                    {showSent
                                        ? t("citationCheck.privacyHideSent")
                                        : t("citationCheck.privacyShowSent")}
                                </button>
                                {showSent && (
                                    <pre
                                        data-testid="citation-check-sent"
                                        className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[11px]"
                                    >
                                        {JSON.stringify(checked.sent, null, 2)}
                                    </pre>
                                )}
                            </div>
                        )}
                        {note && (
                            <div className="rounded border border-warn-soft bg-warn-soft px-3 py-2 text-gray-800">
                                {note}
                            </div>
                        )}
                        <div className="rounded border border-gray-200 px-3 py-2 text-gray-700">
                            {t("citationCheck.notInCorpusNote")}
                        </div>
                        {checked.withoutAct > 0 && (
                            <div className="text-gray-500">
                                {fill(t("citationCheck.withoutAct"), { n: checked.withoutAct })}
                            </div>
                        )}
                        {checked.notSent > 0 && (
                            <div className="text-gray-500">
                                {fill(t("citationCheck.notSentCount"), { n: checked.notSent })}
                            </div>
                        )}
                        {checked.serverNotes.length > 0 && (
                            <details className="text-gray-500">
                                <summary>{t("citationCheck.serverNotes")}</summary>
                                {checked.serverNotes.map((n, i) => (
                                    <p key={i} className="mt-1">{n}</p>
                                ))}
                            </details>
                        )}
                    </div>

                    <div className="flex flex-1 min-h-0 border-t border-gray-100">
                        <div
                            ref={textRef}
                            className="flex-1 overflow-auto px-5 py-3 font-serif text-sm leading-relaxed whitespace-pre-wrap text-gray-800"
                        >
                            {segments.map((s, i) => {
                                if (!s.ref) return <span key={i}>{s.text}</span>;
                                const c = byRef.get(s.ref);
                                const sev = c ? severityOf(c) : "none";
                                return (
                                    <mark
                                        key={i}
                                        data-ref={s.ref}
                                        onClick={() => select(s.ref!, "text")}
                                        title={c ? statusLabel(c.status) : undefined}
                                        className={`cursor-pointer rounded-sm px-0.5 text-inherit ${MARK[sev]} ${selected === s.ref ? "ring-2 ring-gray-500" : ""}`}
                                    >
                                        {s.text}
                                    </mark>
                                );
                            })}
                        </div>
                        <div
                            ref={listRef}
                            className="w-72 shrink-0 overflow-auto border-l border-gray-100 px-3 py-3 space-y-2"
                        >
                            {checked.citations.map((c) => {
                                const sev = severityOf(c);
                                return (
                                    <button
                                        key={c.ref}
                                        data-ref={c.ref}
                                        onClick={() => select(c.ref, "list")}
                                        className={`w-full rounded border px-2 py-1.5 text-left text-xs ${selected === c.ref ? "border-gray-500" : "border-gray-200"} hover:bg-gray-50`}
                                    >
                                        <div className="text-[10px] uppercase tracking-wide text-gray-400">
                                            {kindLabel(c.kind)}
                                        </div>
                                        <div className="font-medium text-gray-800">
                                            {identifierOf(c)}
                                        </div>
                                        <span
                                            className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[11px] ${BADGE[sev]}`}
                                        >
                                            {statusLabel(c.status)}
                                        </span>
                                        {detailLines(c).map((l, i) => (
                                            <div key={i} className="mt-0.5 text-gray-500">
                                                {l}
                                            </div>
                                        ))}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
