"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { t, type TranslationKey } from "@/i18n";
import {
    approveConnectorGateway,
    getConnectorGateway,
    getConnectors,
    setConnectorEnabled,
    type ConnectorGatewayDetails,
    type ConnectorInfo,
    type ConnectorJurisdiction,
} from "@/app/lib/patronApi";
import { RepertoriumCzat } from "./repertorium-czat";

/** apiRequest rzuca Error z surowym cialem odpowiedzi - wyciagamy `detail`. */
function szczegolBledu(err: unknown): string {
    const surowy = err instanceof Error ? err.message : String(err);
    try {
        const j = JSON.parse(surowy) as { detail?: unknown };
        if (typeof j.detail === "string") return j.detail;
    } catch {
        /* nie JSON */
    }
    return surowy;
}

type Przeglad = {
    name: string;
    details?: ConnectorGatewayDetails;
    error?: string;
    saving?: boolean;
};

const JURIS_ORDER: ConnectorJurisdiction[] = [
    "PL",
    "EU",
    "DE",
    "AT",
    "ES",
    "FI",
    "IE",
    "NL",
    "SE",
    "FR",
    "LU",
    "BR",
    "OTHER",
];

const JURIS_KEY: Record<ConnectorJurisdiction, TranslationKey> = {
    PL: "connectors.jurisdictionPL",
    EU: "connectors.jurisdictionEU",
    DE: "connectors.jurisdictionDE",
    AT: "connectors.jurisdictionAT",
    ES: "connectors.jurisdictionES",
    FI: "connectors.jurisdictionFI",
    IE: "connectors.jurisdictionIE",
    NL: "connectors.jurisdictionNL",
    SE: "connectors.jurisdictionSE",
    FR: "connectors.jurisdictionFR",
    LU: "connectors.jurisdictionLU",
    BR: "connectors.jurisdictionBR",
    OTHER: "connectors.jurisdictionOTHER",
};

// B-08 (ADR-0158): konektor spoza zaufanego zestawu czeka na zatwierdzenie
// Operatora albo zostal odrzucony przez bramke - picker mowi to wprost.
const GATEWAY_KEY: Record<
    NonNullable<ConnectorInfo["gateway"]>,
    { badge: TranslationKey; hint: TranslationKey }
> = {
    awaiting_operator_approval: {
        badge: "connectors.gatewayAwaiting",
        hint: "connectors.gatewayAwaitingHint",
    },
    blocked: {
        badge: "connectors.gatewayBlocked",
        hint: "connectors.gatewayBlockedHint",
    },
};

export default function ConnectorsPage() {
    const [connectors, setConnectors] = useState<ConnectorInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingName, setSavingName] = useState<string | null>(null);
    const [showRestart, setShowRestart] = useState(false);
    // B-08: przeglad i zatwierdzenie konektora czekajacego na Operatora.
    const [przeglad, setPrzeglad] = useState<Przeglad | null>(null);
    const [zatwierdzone, setZatwierdzone] = useState<Set<string>>(new Set());

    const otworzPrzeglad = useCallback(async (name: string) => {
        setPrzeglad({ name });
        try {
            const details = await getConnectorGateway(name);
            setPrzeglad({ name, details });
        } catch (err) {
            const d = szczegolBledu(err);
            setPrzeglad({
                name,
                error: /Admin role required/i.test(d)
                    ? t("connectors.approveForbidden")
                    : t("connectors.approveError").replace("{detail}", d),
            });
        }
    }, []);

    const zatwierdz = useCallback(async (p: Przeglad) => {
        if (!p.details) return;
        setPrzeglad({ ...p, saving: true, error: undefined });
        try {
            await approveConnectorGateway(p.name, {
                hash: p.details.hash,
                origin: p.details.origin,
            });
            setZatwierdzone((prev) => new Set(prev).add(p.name));
            setPrzeglad(null);
            setShowRestart(true);
        } catch (err) {
            const d = szczegolBledu(err);
            setPrzeglad({
                ...p,
                saving: false,
                error: /Admin role required/i.test(d)
                    ? t("connectors.approveForbidden")
                    : t("connectors.approveError").replace("{detail}", d),
            });
        }
    }, []);

    useEffect(() => {
        let active = true;
        getConnectors()
            .then((list) => {
                if (active) setConnectors(list);
            })
            .catch(() => {
                if (active) setError(t("connectors.loadError"));
            });
        return () => {
            active = false;
        };
    }, []);

    const onToggle = useCallback(async (c: ConnectorInfo) => {
        if (!c.toggleable) return;
        setSavingName(c.name);
        setError(null);
        try {
            const res = await setConnectorEnabled(c.name, !c.enabled);
            setConnectors((prev) =>
                prev
                    ? prev.map((x) => (x.name === c.name ? res.connector : x))
                    : prev,
            );
            if (res.restartRequired) setShowRestart(true);
        } catch {
            setError(t("connectors.toggleError"));
        } finally {
            setSavingName(null);
        }
    }, []);

    return (
        <section>
            <header className="mb-6">
                <h2 className="text-2xl font-medium text-gray-900">
                    {t("connectors.title")}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                    {t("connectors.subtitle")}
                </p>
            </header>

            {showRestart && (
                <div className="mb-4 rounded-lg border border-warn-soft bg-warn-soft px-4 py-3 text-sm text-warn">
                    {t("connectors.restartNote")}
                </div>
            )}

            {error && (
                <div className="mb-4 rounded-lg border border-bad-soft bg-bad-soft px-4 py-3 text-sm text-bad">
                    {error}
                </div>
            )}

            {connectors === null && !error && (
                <div className="flex items-center gap-2 py-8 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{t("common.loading")}</span>
                </div>
            )}

            {connectors !== null && connectors.length === 0 && (
                <p className="py-8 text-sm text-gray-500">
                    {t("connectors.empty")}
                </p>
            )}

            {connectors !== null && (
                <RepertoriumCzat
                    connectors={connectors}
                    onRestartRequired={() => setShowRestart(true)}
                />
            )}

            {connectors !== null && connectors.length > 0 && (
                <div className="flex flex-col gap-8">
                    {JURIS_ORDER.map((juris) => {
                        const group = connectors.filter(
                            (c) => c.jurisdiction === juris,
                        );
                        if (group.length === 0) return null;
                        return (
                            <div key={juris}>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {t(JURIS_KEY[juris])}
                                </h3>
                                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                                    {group.map((c) => (
                                        <li
                                            key={c.name}
                                            className="flex items-center justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-medium text-gray-900">
                                                        {c.name}
                                                    </span>
                                                    {c.toggleable ? (
                                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                                                            {t(
                                                                "connectors.trustedBadge",
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">
                                                            {t(
                                                                "connectors.operatorOnly",
                                                            )}
                                                        </span>
                                                    )}
                                                    {c.gateway && (
                                                        <span
                                                            data-testid={`connector-gateway-${c.name}`}
                                                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                                                                c.gateway === "blocked"
                                                                    ? "bg-bad-soft text-bad"
                                                                    : "bg-warn-soft text-warn"
                                                            }`}
                                                        >
                                                            {t(GATEWAY_KEY[c.gateway].badge)}
                                                        </span>
                                                    )}
                                                </div>
                                                {!c.toggleable && (
                                                    <p className="mt-0.5 text-xs text-gray-400">
                                                        {zatwierdzone.has(c.name)
                                                            ? t("connectors.approveDone")
                                                            : c.gateway
                                                              ? t(GATEWAY_KEY[c.gateway].hint)
                                                              : t(
                                                                    "connectors.operatorOnlyHint",
                                                                )}
                                                    </p>
                                                )}
                                                {c.gateway === "awaiting_operator_approval" &&
                                                    !zatwierdzone.has(c.name) &&
                                                    przeglad?.name !== c.name && (
                                                        <button
                                                            type="button"
                                                            data-testid={`connector-approve-${c.name}`}
                                                            onClick={() => otworzPrzeglad(c.name)}
                                                            className="mt-1 text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
                                                        >
                                                            {t("connectors.approveReview")}
                                                        </button>
                                                    )}
                                                {przeglad?.name === c.name && (
                                                    <div
                                                        data-testid={`connector-review-${c.name}`}
                                                        className="mt-2 max-w-xl rounded-lg border border-warn-soft bg-warn-soft/40 px-3 py-2 text-xs text-gray-700"
                                                    >
                                                        <p className="font-medium text-gray-900">
                                                            {t("connectors.approveTitle").replace("{name}", c.name)}
                                                        </p>
                                                        {!przeglad.details && !przeglad.error && (
                                                            <p className="mt-1 text-gray-500">
                                                                {t("connectors.approveLoading")}
                                                            </p>
                                                        )}
                                                        {przeglad.details && (
                                                            <>
                                                                <p className="mt-1">{t("connectors.approveIntro")}</p>
                                                                {przeglad.details.unknownThirdPartyOnly ? (
                                                                    <p className="mt-1">{t("connectors.approveUnknownOnly")}</p>
                                                                ) : (
                                                                    <>
                                                                        <p className="mt-1 font-medium">
                                                                            {t("connectors.approveFindings")}
                                                                        </p>
                                                                        <ul className="mt-0.5 list-disc pl-4">
                                                                            {przeglad.details.findings.map((f, i) => (
                                                                                <li key={i}>
                                                                                    {f.severity}: {f.message}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </>
                                                                )}
                                                                <p className="mt-1 font-mono text-[11px] text-gray-500">
                                                                    {t("connectors.approveFingerprint").replace(
                                                                        "{hash}",
                                                                        przeglad.details.hash.slice(0, 16),
                                                                    )}
                                                                </p>
                                                            </>
                                                        )}
                                                        {przeglad.error && (
                                                            <p className="mt-1 text-bad">{przeglad.error}</p>
                                                        )}
                                                        <div className="mt-2 flex gap-2">
                                                            {przeglad.details && (
                                                                <button
                                                                    type="button"
                                                                    data-testid={`connector-approve-confirm-${c.name}`}
                                                                    disabled={przeglad.saving}
                                                                    onClick={() => zatwierdz(przeglad)}
                                                                    className="rounded bg-gray-900 px-2.5 py-1 text-white disabled:opacity-50"
                                                                >
                                                                    {t("connectors.approveConfirm")}
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => setPrzeglad(null)}
                                                                className="rounded border border-gray-300 px-2.5 py-1"
                                                            >
                                                                {t("connectors.approveCancel")}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                disabled={
                                                    !c.toggleable ||
                                                    savingName === c.name
                                                }
                                                aria-pressed={c.enabled}
                                                onClick={() => onToggle(c)}
                                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                                                    c.enabled
                                                        // Stan, nie akcja: wlaczony konektor to
                                                        // skala semantyczna (ok), a nie akcent marki.
                                                        // Czerwonawy przelacznik w pozycji ON czyta
                                                        // sie jak alarm.
                                                        ? "bg-ok"
                                                        : "bg-gray-200"
                                                } ${
                                                    !c.toggleable
                                                        ? "cursor-not-allowed opacity-40"
                                                        : "cursor-pointer"
                                                }`}
                                            >
                                                <span className="sr-only">
                                                    {c.enabled
                                                        ? t(
                                                              "connectors.enabled",
                                                          )
                                                        : t(
                                                              "connectors.disabled",
                                                          )}
                                                </span>
                                                <span
                                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                                                        c.enabled
                                                            ? "translate-x-5"
                                                            : "translate-x-1"
                                                    }`}
                                                />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
