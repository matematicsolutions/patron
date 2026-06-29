"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/i18n";
import {
    listApprovalCards,
    approveCard,
    rejectCard,
    type ApprovalCard,
} from "@/app/lib/patronApi";

function toolLabel(name: string): string {
    if (name === "edit_document") return t("approvals.toolEditDocument");
    if (name === "generate_docx") return t("approvals.toolGenerateDocx");
    return name;
}

function formatStagedAt(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export default function ApprovalCardsPage() {
    const [cards, setCards] = useState<ApprovalCard[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [execError, setExecError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        listApprovalCards()
            .then((list) => {
                if (active) setCards(list);
            })
            .catch(() => {
                if (active) setError(t("approvals.loadError"));
            });
        return () => {
            active = false;
        };
    }, []);

    const removeCard = useCallback((id: string) => {
        setCards((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
    }, []);

    const onApprove = useCallback(
        async (card: ApprovalCard) => {
            setBusyId(card.id);
            setError(null);
            setExecError(null);
            try {
                const res = await approveCard(card.id);
                // Karta nie jest juz pending - znika z inboxa. Gdy wykonanie
                // padlo po zatwierdzeniu, pokazujemy komunikat (decyzja zaszla).
                if (!res.executed && res.execution_error) {
                    setExecError(res.execution_error);
                }
                removeCard(card.id);
            } catch {
                setError(t("approvals.actionError"));
            } finally {
                setBusyId(null);
            }
        },
        [removeCard],
    );

    const onReject = useCallback(
        async (card: ApprovalCard) => {
            setBusyId(card.id);
            setError(null);
            try {
                await rejectCard(card.id, reasons[card.id]?.trim() || undefined);
                removeCard(card.id);
            } catch {
                setError(t("approvals.actionError"));
            } finally {
                setBusyId(null);
            }
        },
        [reasons, removeCard],
    );

    return (
        <section>
            <header className="mb-6">
                <h2 className="text-2xl font-medium text-gray-900">
                    {t("approvals.title")}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                    {t("approvals.subtitle")}
                </p>
            </header>

            {execError && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {t("approvals.executionErrorNote")} {execError}
                </div>
            )}

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {cards === null && !error && (
                <div className="flex items-center gap-2 py-8 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{t("common.loading")}</span>
                </div>
            )}

            {cards !== null && cards.length === 0 && (
                <p className="py-8 text-sm text-gray-500">
                    {t("approvals.empty")}
                </p>
            )}

            {cards !== null && cards.length > 0 && (
                <ul className="flex flex-col gap-4">
                    {cards.map((card) => {
                        const filename = card.tool_payload.filename as
                            | string
                            | undefined;
                        const busy = busyId === card.id;
                        return (
                            <li
                                key={card.id}
                                className="rounded-xl border border-gray-100 p-4"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="text-sm font-medium text-gray-900">
                                        {toolLabel(card.tool_name)}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {t("approvals.stagedAt")}:{" "}
                                        {formatStagedAt(card.staged_at)}
                                    </span>
                                </div>

                                {filename && (
                                    <p className="mt-1 text-sm text-gray-600">
                                        {t("approvals.documentLabel")}:{" "}
                                        <span className="font-medium">
                                            {filename}
                                        </span>
                                    </p>
                                )}

                                <details className="mt-2">
                                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                                        {t("approvals.detailsLabel")}
                                    </summary>
                                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                                        {JSON.stringify(
                                            card.tool_payload,
                                            null,
                                            2,
                                        )}
                                    </pre>
                                </details>

                                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <input
                                        type="text"
                                        value={reasons[card.id] ?? ""}
                                        onChange={(e) =>
                                            setReasons((prev) => ({
                                                ...prev,
                                                [card.id]: e.target.value,
                                            }))
                                        }
                                        placeholder={t(
                                            "approvals.rejectReasonPlaceholder",
                                        )}
                                        disabled={busy}
                                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                                    />
                                    <div className="flex shrink-0 gap-2">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onReject(card)}
                                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {busy
                                                ? t("approvals.rejecting")
                                                : t("approvals.reject")}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onApprove(card)}
                                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {busy
                                                ? t("approvals.approving")
                                                : t("approvals.approve")}
                                        </button>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
