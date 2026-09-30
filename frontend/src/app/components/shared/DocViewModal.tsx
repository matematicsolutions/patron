"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ListChecks, Trash2, X } from "lucide-react";
import { DocView } from "./DocView";
import { CitationCheckView } from "./CitationCheckView";
import { t } from "@/i18n";
import { getDocumentUrl } from "@/app/lib/patronApi";
import type { PATRONDocument } from "./types";

interface Props {
    doc: PATRONDocument | null;
    /** Optional specific version to display. Only honoured for DOCX. */
    versionId?: string | null;
    /** Optional label suffix for the header (e.g. "V3"). */
    versionLabel?: string | null;
    onClose: () => void;
    onDelete?: (doc: PATRONDocument) => void;
}

export function DocViewModal({
    doc,
    versionId,
    versionLabel,
    onClose,
    onDelete,
}: Props) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    // ADR-0157: widok "Sprawdź powołania" zamiast podglądu pisma. Klucz pisma
    // zamiast flagi - inne pismo albo wersja w tym samym oknie wraca do podglądu.
    const docKey = `${doc?.id ?? ""}|${versionId ?? ""}`;
    const [checkingKey, setCheckingKey] = useState<string | null>(null);
    const checking = checkingKey === docKey;

    if (!doc || !mounted) return null;

    async function handleDownload() {
        if (!doc) return;
        const { url, filename } = await getDocumentUrl(doc.id, versionId ?? null);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }

    return createPortal(
        <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/40"
            onClick={onClose}
        >
            <div
                className="relative flex flex-col bg-white rounded-xl shadow-2xl w-[800px] max-w-[90vw] h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 shrink-0">
                    <span className="text-base font-medium font-serif text-gray-800 truncate pr-4">
                        {doc.filename}
                        {versionLabel && (
                            <span className="ml-2 text-xs font-normal text-gray-500">
                                {versionLabel}
                            </span>
                        )}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {/* Sprawdzenie czyta BIEŻĄCĄ wersję pisma - przy podglądzie
                            starszej wersji przycisk sprawdziłby inny tekst niż ten na ekranie. */}
                        {!versionId && !checking && (
                            <button
                                onClick={() => setCheckingKey(docKey)}
                                aria-label={t("citationCheck.buttonAria")}
                                className="flex items-center gap-1 rounded px-2 h-6 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                            >
                                <ListChecks className="h-4 w-4" />
                                {t("citationCheck.button")}
                            </button>
                        )}
                        <button
                            onClick={handleDownload}
                            className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            <Download className="h-4 w-4" />
                        </button>
                        {onDelete && (
                            <button
                                onClick={() => { onDelete(doc); onClose(); }}
                                className="flex items-center justify-center w-6 h-6 rounded hover:bg-bad-soft text-gray-400 hover:text-bad transition-colors"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* DocView serves PDF when available and falls back to
                    docx-preview internally if the active version has no
                    PDF rendition. Passing no versionId tells the backend
                    to resolve the latest tracked-changes version. */}
                {checking ? (
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden pb-3">
                        <CitationCheckView
                            documentId={doc.id}
                            onBack={() => setCheckingKey(null)}
                        />
                    </div>
                ) : (
                <div className="flex flex-col flex-1 overflow-hidden px-3 pb-3">
                    <DocView
                        key={versionId ?? "current"}
                        doc={{
                            document_id: doc.id,
                            version_id: versionId ?? null,
                        }}
                    />
                </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
