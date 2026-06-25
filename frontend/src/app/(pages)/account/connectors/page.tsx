"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { t, type TranslationKey } from "@/i18n";
import {
    getConnectors,
    setConnectorEnabled,
    type ConnectorInfo,
    type ConnectorJurisdiction,
} from "@/app/lib/patronApi";

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
    OTHER: "connectors.jurisdictionOTHER",
};

export default function ConnectorsPage() {
    const [connectors, setConnectors] = useState<ConnectorInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingName, setSavingName] = useState<string | null>(null);
    const [showRestart, setShowRestart] = useState(false);

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
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {t("connectors.restartNote")}
                </div>
            )}

            {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">
                                                            {t(
                                                                "connectors.operatorOnly",
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                                {!c.toggleable && (
                                                    <p className="mt-0.5 text-xs text-gray-400">
                                                        {t(
                                                            "connectors.operatorOnlyHint",
                                                        )}
                                                    </p>
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
                                                        ? "bg-blue-600"
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
