// Panel spojnosci lancucha audytu na ekranie audytu (ADR-0165, rdzen ADR-0161).
//
// Pokazuje trojstan OK / UWAGI / BLOKADA z GET /api/audit/chain i - gdy sa
// rozwidlenia sprzed straznika - pozwala Operatorowi je potwierdzic. Potwierdzenie
// to akt czlowieka w dwoch krokach (przycisk -> pytanie -> "Tak, zapisz"), a backend
// przyjmuje je tylko z `digest` z podgladu: jesli stan zmienil sie w miedzyczasie,
// zapisu nie ma (409 stale).
//
// Brak odpowiedzi to komunikat o bledzie, nigdy pusty panel - cisza wygladalaby jak
// "wszystko w porzadku" (lekcja z apiBase.ts). Raport niesie same numery wpisow.
// Wlasny fetch zamiast patronApi.ts: plik jest w toku scalania linii (ADR-0163).

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime, t, type TranslationKey } from "@/i18n";
import { apiUrl } from "@/lib/apiBase";

export type ChainVerdict = "ok" | "uwagi" | "blokada";

export interface ChainFinding {
    kind: string;
    severity: "info" | "uwagi" | "blokada";
    ids: number[];
    detail: string;
}

export interface ChainStatus {
    report: {
        verdict: ChainVerdict;
        rows: number;
        mainChain: number;
        sideRows: number;
        forkPoints: number;
        guardAfterId: number | null;
        findings: ChainFinding[];
    };
    guardKnown: boolean;
    pending: { digest: string; forks: Array<{ parentId: number; siblingIds: number[] }> } | null;
    checkedAt: string;
}

const VERDICT_KEY: Record<ChainVerdict, TranslationKey> = {
    ok: "audit.chain.verdictOk",
    uwagi: "audit.chain.verdictUwagi",
    blokada: "audit.chain.verdictBlokada",
};

const VERDICT_STYLE: Record<ChainVerdict, string> = {
    ok: "border-green-300 bg-green-50 text-green-900",
    uwagi: "border-amber-300 bg-amber-50 text-amber-900",
    blokada: "border-red-300 bg-red-50 text-red-900",
};

const REFUSAL_KEY: Record<string, TranslationKey> = {
    stale: "audit.chain.errorStale",
    blocked: "audit.chain.errorBlocked",
    no_guard: "audit.chain.errorNoGuard",
    nothing_to_acknowledge: "audit.chain.errorNothing",
};

function fill(text: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), text);
}

function kindLabel(kind: string): string {
    const key = `audit.chain.kind.${kind}` as TranslationKey;
    const label = t(key);
    return label === key ? kind : label;
}

export function AuditChainPanel() {
    const [status, setStatus] = useState<ChainStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(apiUrl("/api/audit/chain"), { credentials: "include" });
            if (res.status === 403) {
                setStatus(null);
                setError(t("audit.chain.errorForbidden"));
                return;
            }
            if (!res.ok) {
                setStatus(null);
                setError(fill(t("audit.chain.errorGeneric"), { detail: `HTTP ${res.status}` }));
                return;
            }
            setStatus((await res.json()) as ChainStatus);
        } catch (e) {
            setStatus(null);
            setError(fill(t("audit.chain.errorGeneric"), { detail: e instanceof Error ? e.message : "?" }));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const acknowledge = useCallback(async () => {
        if (!status?.pending) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(apiUrl("/api/audit/chain/acknowledge"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ digest: status.pending.digest }),
            });
            const body = (await res.json().catch(() => null)) as
                | (ChainStatus & { error?: string; status?: ChainStatus; detail?: string })
                | null;
            if (res.ok && body) {
                setStatus(body);
                setSaved(true);
            } else {
                const reason = body?.error ?? "";
                setError(
                    REFUSAL_KEY[reason]
                        ? t(REFUSAL_KEY[reason])
                        : fill(t("audit.chain.errorGeneric"), { detail: body?.detail ?? `HTTP ${res.status}` }),
                );
                if (body?.status) setStatus(body.status);
            }
        } catch (e) {
            setError(fill(t("audit.chain.errorGeneric"), { detail: e instanceof Error ? e.message : "?" }));
        } finally {
            setSaving(false);
            setConfirming(false);
        }
    }, [status]);

    const report = status?.report;

    return (
        <section
            aria-labelledby="audit-chain-title"
            className="rounded-md border border-gray-200 bg-white p-4"
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 id="audit-chain-title" className="text-base font-semibold text-gray-900">
                        {t("audit.chain.title")}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">{t("audit.chain.intro")}</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setSaved(false);
                        void load();
                    }}
                    disabled={loading || saving}
                    className="shrink-0 rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                    {loading ? t("audit.chain.checking") : t("audit.chain.check")}
                </button>
            </div>

            {error && (
                <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">
                    {error}
                </p>
            )}

            {report && (
                <div className="mt-3 space-y-3">
                    <p
                        data-testid="chain-verdict"
                        className={`rounded border p-2 text-sm font-medium ${VERDICT_STYLE[report.verdict]}`}
                    >
                        {t(VERDICT_KEY[report.verdict])}
                    </p>
                    <p className="text-sm text-gray-700">
                        {fill(t("audit.chain.counts"), {
                            rows: report.rows,
                            main: report.mainChain,
                            side: report.sideRows,
                        })}
                        {" · "}
                        {status.guardKnown && report.guardAfterId !== null
                            ? fill(t("audit.chain.guardOn"), { id: report.guardAfterId })
                            : t("audit.chain.guardUnknown")}
                        {" · "}
                        {fill(t("audit.chain.checkedAt"), { time: formatDateTime(status.checkedAt) })}
                    </p>

                    {report.findings.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">{t("audit.chain.findings")}</h3>
                            <ul className="mt-1 space-y-1 text-sm">
                                {report.findings.map((f, i) => (
                                    <li key={`${f.kind}-${i}`} className="text-gray-700">
                                        <span className={f.severity === "blokada" ? "font-semibold text-red-800" : ""}>
                                            {kindLabel(f.kind)}
                                        </span>
                                        {f.ids.length > 0 && (
                                            <span className="text-gray-500">
                                                {" - "}
                                                {fill(t("audit.chain.entries"), { ids: f.ids.join(", ") })}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {status.pending && (
                        <div className="rounded border border-amber-300 bg-amber-50 p-3">
                            <h3 className="text-sm font-semibold text-amber-900">{t("audit.chain.pendingTitle")}</h3>
                            <p className="mt-1 text-sm text-amber-900">{t("audit.chain.pendingIntro")}</p>
                            <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                                {status.pending.forks.map((f) => (
                                    <li key={f.parentId}>
                                        {fill(t("audit.chain.pendingFork"), {
                                            parent: f.parentId,
                                            ids: f.siblingIds.join(", "),
                                        })}
                                    </li>
                                ))}
                            </ul>
                            {!confirming ? (
                                <button
                                    type="button"
                                    onClick={() => setConfirming(true)}
                                    disabled={saving || loading}
                                    className="mt-3 rounded bg-amber-700 px-3 py-1 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
                                >
                                    {t("audit.chain.acknowledge")}
                                </button>
                            ) : (
                                <div role="group" aria-label={t("audit.chain.confirmTitle")} className="mt-3 rounded border border-amber-400 bg-white p-3">
                                    <p className="text-sm font-semibold text-gray-900">{t("audit.chain.confirmTitle")}</p>
                                    <p className="mt-1 text-sm text-gray-700">{t("audit.chain.confirmBody")}</p>
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void acknowledge()}
                                            disabled={saving}
                                            className="rounded bg-amber-700 px-3 py-1 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
                                        >
                                            {saving ? t("audit.chain.saving") : t("audit.chain.confirmYes")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirming(false)}
                                            disabled={saving}
                                            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            {t("audit.chain.cancel")}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {saved && <p role="status" className="text-sm text-green-800">{t("audit.chain.saved")}</p>}
                </div>
            )}
        </section>
    );
}
