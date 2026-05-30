"use client";

import { useEffect, useState } from "react";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";
import { Loader2 } from "lucide-react";
import {
    getUsageSummary,
    getUsageByModel,
    getUsageByCase,
    getUsageTimeseries,
    type UsageSummary,
    type UsageGroup,
} from "@/app/lib/patronApi";
import { t, formatNumber, formatCurrency } from "@/i18n";

function usd(n: number): string {
    return formatCurrency(n, "USD");
}

function Card({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-medium text-gray-900 tabular-nums">
                {value}
            </div>
        </div>
    );
}

function GroupTable({
    title,
    keyHeader,
    rows,
}: {
    title: string;
    keyHeader: string;
    rows: UsageGroup[];
}) {
    return (
        <div>
            <h3 className="mb-2 text-sm font-medium text-gray-900">{title}</h3>
            <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                            <th className="px-3 py-2 font-medium">{keyHeader}</th>
                            <th className="px-3 py-2 text-right font-medium">
                                {t("usage.calls")}
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                                {t("usage.tokens")}
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                                {t("usage.cost")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr
                                key={r.key}
                                className="border-b border-gray-100 last:border-0"
                            >
                                <td className="px-3 py-2 text-gray-900">{r.key}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {formatNumber(r.calls)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {formatNumber(r.totalTokens)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {usd(r.costRealUsd + r.costEstimatedUsd)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function UsagePage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [byModel, setByModel] = useState<UsageGroup[]>([]);
    const [byCase, setByCase] = useState<UsageGroup[]>([]);
    const [series, setSeries] = useState<UsageGroup[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [s, m, c, ts] = await Promise.all([
                    getUsageSummary(),
                    getUsageByModel(),
                    getUsageByCase(),
                    getUsageTimeseries(),
                ]);
                if (cancelled) return;
                setSummary(s.data);
                setByModel(m.data);
                setByCase(c.data);
                setSeries(ts.data);
            } catch {
                if (!cancelled) setError(t("usage.loadError"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
        );
    }

    if (error) {
        return <div className="py-10 text-sm text-red-600">{error}</div>;
    }

    const empty = !summary || summary.calls === 0;
    const chartData = series.map((d) => ({
        date: d.key.slice(5), // MM-DD
        [t("usage.tokens")]: d.totalTokens,
    }));

    return (
        <div className="flex flex-col gap-8">
            <div>
                <h2 className="text-2xl font-medium text-gray-900">
                    {t("usage.title")}
                </h2>
                <p className="mt-1 text-sm text-gray-500">{t("usage.subtitle")}</p>
                <p className="mt-1 text-xs text-gray-400">{t("usage.windowNote")}</p>
            </div>

            {empty ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                    {t("usage.noData")}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <Card label={t("usage.calls")} value={formatNumber(summary!.calls)} />
                        <Card
                            label={t("usage.totalTokens")}
                            value={formatNumber(summary!.totalTokens)}
                        />
                        <Card
                            label={t("usage.unpricedCalls")}
                            value={formatNumber(summary!.unpricedCalls)}
                        />
                        <Card label={t("usage.promptTokens")} value={formatNumber(summary!.promptTokens)} />
                        <Card
                            label={t("usage.costReal")}
                            value={usd(summary!.costRealUsd)}
                        />
                        <Card
                            label={t("usage.costEstimated")}
                            value={usd(summary!.costEstimatedUsd)}
                        />
                    </div>

                    {chartData.length > 0 && (
                        <div>
                            <h3 className="mb-2 text-sm font-medium text-gray-900">
                                {t("usage.overTime")}
                            </h3>
                            <div className="h-64 w-full rounded-lg border border-gray-200 p-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                                        <YAxis tick={{ fontSize: 12 }} width={56} />
                                        <Tooltip />
                                        <Bar dataKey={t("usage.tokens")} fill="#2563eb" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <GroupTable
                            title={t("usage.byModel")}
                            keyHeader={t("usage.model")}
                            rows={byModel}
                        />
                        <GroupTable
                            title={t("usage.byCase")}
                            keyHeader={t("usage.case")}
                            rows={byCase}
                        />
                    </div>

                    <p className="text-xs text-gray-400">{t("usage.estimatedNote")}</p>
                </>
            )}
        </div>
    );
}
