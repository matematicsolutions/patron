"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, Copy, Loader2, X } from "lucide-react";
import {
    refineDraft,
    type AdwokatMode,
    type DraftRefineResult,
    type DraftStageResult,
} from "@/app/lib/patronApi";
import { t } from "@/i18n";

const ADWOKAT_MODES: AdwokatMode[] = [
    "strona-przeciwna",
    "sad",
    "prokurator",
];

function stageLabel(s: DraftStageResult): string {
    const base = t(`draft.stage.${s.stage}` as const);
    if (s.stage === "adwokat" && s.mode) {
        return `${base} — ${t(`draft.mode.${s.mode}` as const)}`;
    }
    return base;
}

const mdComponents = {
    p: ({ children }: { children?: React.ReactNode }) => (
        <p className="mb-3 leading-7 last:mb-0">{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc pl-6 mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal pl-6 mb-3 space-y-1">{children}</ol>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-semibold">{children}</strong>
    ),
};

function StageBlock({ stage }: { stage: DraftStageResult }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-md border border-gray-200 bg-gray-50">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                />
                <span className="flex-1 truncate">{stageLabel(stage)}</span>
            </button>
            {open && (
                <div className="border-t border-gray-200 px-4 py-3 text-sm font-serif text-gray-700 prose prose-sm max-w-none">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={mdComponents}
                    >
                        {stage.output || "—"}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    );
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** Tekst wstepny - np. proza wygenerowanej odpowiedzi asystenta. */
    initialText: string;
}

export function DraftRefinePanel({ open, onClose, initialText }: Props) {
    const [text, setText] = useState(initialText);
    const [mode, setMode] = useState<AdwokatMode>("strona-przeciwna");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<DraftRefineResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Reset stanu przy kazdym otwarciu (nowy tekst zrodlowy).
    useEffect(() => {
        if (open) {
            setText(initialText);
            setResult(null);
            setError(null);
            setCopied(false);
            setLoading(false);
        }
    }, [open, initialText]);

    // Esc zamyka (gdy nie trwa doskonalenie).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, loading, onClose]);

    if (!open) return null;

    const canRefine = text.trim().length > 0 && !loading;

    const handleRefine = async () => {
        if (!canRefine) return;
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await refineDraft({
                text: text.trim(),
                adwokat_mode: mode,
            });
            setResult(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("draft.error"));
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.final);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs p-4">
            <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900">
                            {t("draft.title")}
                        </h2>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {t("draft.subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t("draft.close")}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Tekst zrodlowy */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                            {t("draft.textLabel")}
                        </label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={t("draft.textPlaceholder")}
                            rows={6}
                            className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-serif text-gray-800 outline-none focus:border-gray-400"
                        />
                    </div>

                    {/* Tryb adwokata */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                            {t("draft.modeLabel")}
                        </label>
                        <select
                            value={mode}
                            onChange={(e) =>
                                setMode(e.target.value as AdwokatMode)
                            }
                            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-gray-400"
                        >
                            {ADWOKAT_MODES.map((m) => (
                                <option key={m} value={m}>
                                    {t(`draft.mode.${m}` as const)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-serif text-red-700">
                            {error}
                        </div>
                    )}

                    {result && (
                        <div className="space-y-4">
                            {/* Gotowy draft */}
                            <div>
                                <div className="mb-1 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-900">
                                        {t("draft.resultTitle")}
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                    >
                                        {copied ? (
                                            <Check className="h-3.5 w-3.5 text-green-600" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                        {copied
                                            ? t("draft.copied")
                                            : t("draft.copy")}
                                    </button>
                                </div>
                                <div className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-serif text-gray-800 prose prose-sm max-w-none">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={mdComponents}
                                    >
                                        {result.final || "—"}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Transparencja etapow */}
                            {result.stages.length > 0 && (
                                <div>
                                    <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                                        {t("draft.stagesTitle")}
                                    </h3>
                                    <div className="space-y-2">
                                        {result.stages.map((s, i) => (
                                            <StageBlock
                                                key={`${s.stage}-${i}`}
                                                stage={s}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 shrink-0">
                    <p className="text-[11px] leading-snug text-gray-400 max-w-md">
                        {t("draft.disclaimer")}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                        >
                            {t("draft.close")}
                        </button>
                        <button
                            type="button"
                            onClick={handleRefine}
                            disabled={!canRefine}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                        >
                            {loading && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            {loading
                                ? t("draft.refining")
                                : t("draft.refine")}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
