"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    AlertCircle,
    CheckCircle2,
    Loader2,
    ShieldAlert,
    Clock,
    FolderOpen,
    X,
} from "lucide-react";
import {
    ingestCaseFolder,
    type FolderIngestEntry,
    type FolderIngestResult,
} from "@/app/lib/patronApi";
import { t } from "@/i18n";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Opcjonalna sprawa (projekt), do ktorej trafiaja dokumenty. */
    projectId?: string | null;
}

/** Most preload.js (tylko w powloce Electron). W przegladarce/dev jest undefined. */
interface PatronBridge {
    selectFolder: () => Promise<string | null>;
    isDesktop?: boolean;
}
function patronBridge(): PatronBridge | undefined {
    if (typeof window === "undefined") return undefined;
    return (window as unknown as { patron?: PatronBridge }).patron;
}

type FileStatus = "imported" | "review" | "blocked" | "error";

function statusOf(httpStatus: number): FileStatus {
    if (httpStatus === 202) return "review";
    if (httpStatus < 300) return "imported";
    if (httpStatus === 422) return "blocked";
    return "error";
}

function StatusIcon({ status }: { status: FileStatus }) {
    if (status === "imported")
        return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />;
    if (status === "review")
        return <Clock className="h-4 w-4 shrink-0 text-amber-600" />;
    if (status === "blocked")
        return <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" />;
    return <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />;
}

function FileRow({ entry }: { entry: FolderIngestEntry }) {
    const s = statusOf(entry.httpStatus);
    return (
        <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <StatusIcon status={s} />
            <span className="min-w-0 flex-1 truncate text-gray-700" title={entry.file}>
                {entry.file}
            </span>
            <span
                className={`shrink-0 text-xs ${
                    s === "imported"
                        ? "text-green-600"
                        : s === "review"
                          ? "text-amber-600"
                          : "text-red-600"
                }`}
            >
                {t(`folderIngest.status.${s}` as const)}
            </span>
        </li>
    );
}

export function FolderIngestModal({ open, onClose, projectId }: Props) {
    const [path, setPath] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<FolderIngestResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setPath("");
            setResult(null);
            setError(null);
            setLoading(false);
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, loading, onClose]);

    if (!open) return null;

    const canImport = path.trim().length > 0 && !loading;

    const bridge = patronBridge();

    // Wspolna sciezka importu - parametr targetPath, by picker mogl zaimportowac
    // OD RAZU po wyborze (bez czekania na re-render stanu `path`).
    const runImport = async (targetPath: string) => {
        const p = targetPath.trim();
        if (!p || loading) return;
        setPath(p);
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await ingestCaseFolder(p, projectId);
            setResult(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("folderIngest.error"));
        } finally {
            setLoading(false);
        }
    };

    // Picker jak załącznik (parytet z Librą): wybierasz folder -> import startuje
    // od razu. Nietechniczny Operator nie wpisuje sciezki ani nie szuka "Importuj".
    const handleBrowse = async () => {
        const b = patronBridge();
        if (!b) return;
        try {
            const picked = await b.selectFolder();
            if (picked) await runImport(picked);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("folderIngest.error"));
        }
    };

    const handleImport = () => runImport(path);

    const summary = t("folderIngest.summary")
        .replace("{indexed}", String(result?.indexed ?? 0))
        .replace("{total}", String(result?.total ?? 0));

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs p-4">
            <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900">
                            {t("folderIngest.title")}
                        </h2>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {t("folderIngest.subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t("folderIngest.close")}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    <div>
                        {bridge?.selectFolder ? (
                            <>
                                {/* Desktop: picker = akcja glowna, jak zalacznik (parytet z Libra).
                                    Klik -> natywne okno -> wybor -> import startuje od razu. */}
                                <button
                                    type="button"
                                    onClick={handleBrowse}
                                    disabled={loading}
                                    className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-7 text-center hover:border-gray-400 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                                >
                                    {loading ? (
                                        <Loader2 className="h-7 w-7 animate-spin text-gray-500" />
                                    ) : (
                                        <FolderOpen className="h-7 w-7 text-gray-500" />
                                    )}
                                    <span className="text-sm font-semibold text-gray-800">
                                        {loading
                                            ? t("folderIngest.importing")
                                            : t("folderIngest.browseHero")}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {t("folderIngest.browseHeroHint")}
                                    </span>
                                </button>
                                <p className="mt-2 text-xs text-gray-400">
                                    {t("folderIngest.pathHint")}
                                </p>
                                {/* Fallback techniczny: sciezka reczna, zwiniety wizualnie. */}
                                <details className="mt-2">
                                    <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                                        {t("folderIngest.manualLabel")}
                                    </summary>
                                    <input
                                        type="text"
                                        value={path}
                                        onChange={(e) => setPath(e.target.value)}
                                        placeholder={t("folderIngest.pathPlaceholder")}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleImport();
                                        }}
                                        className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-800 outline-none focus:border-gray-400"
                                    />
                                </details>
                            </>
                        ) : (
                            <>
                                {/* Przegladarka/dev bez Electrona: pole tekstowe + Importuj. */}
                                <label className="mb-1 block text-xs font-medium text-gray-600">
                                    {t("folderIngest.pathLabel")}
                                </label>
                                <input
                                    type="text"
                                    value={path}
                                    onChange={(e) => setPath(e.target.value)}
                                    placeholder={t("folderIngest.pathPlaceholder")}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleImport();
                                    }}
                                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-800 outline-none focus:border-gray-400"
                                />
                                <p className="mt-1 text-xs text-gray-400">
                                    {t("folderIngest.pathHint")}
                                </p>
                            </>
                        )}
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-serif text-red-700">
                            {error}
                        </div>
                    )}

                    {result && (
                        <div>
                            <div className="mb-1 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-900">
                                    {t("folderIngest.resultTitle")}
                                </h3>
                                <span className="text-xs text-gray-500">
                                    {summary}
                                </span>
                            </div>
                            {result.results.length === 0 ? (
                                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                                    {t("folderIngest.noFiles")}
                                </p>
                            ) : (
                                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                                    {result.results.map((entry, i) => (
                                        <FileRow key={`${entry.file}-${i}`} entry={entry} />
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                    >
                        {t("folderIngest.close")}
                    </button>
                    <button
                        type="button"
                        onClick={handleImport}
                        disabled={!canImport}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {loading
                            ? t("folderIngest.importing")
                            : t("folderIngest.importBtn")}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
