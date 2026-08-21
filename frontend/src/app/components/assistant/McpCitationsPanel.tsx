// MCP Citations panel - powiazane zrodla z serwerow MCP (SAOS / eu-sparql / ...)
// + grounding cytatow MCP (ADR-0146): badge na karcie i baner nad panelem.
// Wydzielone z AssistantMessage.tsx (2026-08-18) - osobny modul jest testowalny
// bez ciagniecia katex/supabase/ReactMarkdown przez jsdom.
"use client";

import { t } from "@/i18n";
import type { PATRONMcpCitation, PATRONMcpGrounding } from "../shared/types";

// ---------------------------------------------------------------------------
// MCP Citations panel - powiazane zrodla z serwerow MCP (SAOS / eu-sparql / ...)
// ---------------------------------------------------------------------------

/**
 * Mapuje nazwe serwera MCP na czytelna etykiete sekcji.
 * Domyslnie zwraca surowa nazwe (kontrakt z back-endem - nowy serwer dodany do
 * mcp-servers.json od razu sie pokaze, byle tylko zwracal structuredContent).
 */
export function mcpServerLabel(server: string): string {
    switch (server) {
        case "saos":
            return t("citations.saos");
        case "nsa":
            return t("citations.nsa");
        case "isap":
            return t("citations.isap");
        case "eu-sparql":
        case "eurlex":
            return t("citations.euSparql");
        case "krs":
            return t("citations.krs");
        default:
            return `${t("citations.unknownServer")} (${server})`;
    }
}

interface McpCitationsPanelProps {
    citations: PATRONMcpCitation[];
}

/**
 * ADR-0146: badge werdyktu groundingu na karcie zrodla MCP. Trojstan
 * green/yellow/red; brak werdyktu (stara wiadomosc sprzed ADR-0146) = brak badge'a
 * (nie udajemy, ze sprawdzilismy).
 */
export function McpCardGroundingBadge({ grounding }: { grounding?: PATRONMcpCitation["grounding"] }) {
    if (!grounding) return null;
    // Aparat, nie pigulka: kropka + etykieta wersalikami. Werdykt ma sie czytac
    // jak adnotacja na marginesie pisma, nie jak tag w panelu SaaS.
    const tone =
        grounding.verdict === "green"
            ? "text-grounded"
            : grounding.verdict === "yellow"
              ? "text-unverified"
              : "text-ungrounded";
    const dot =
        grounding.verdict === "green"
            ? "bg-grounded"
            : grounding.verdict === "yellow"
              ? "bg-unverified"
              : "bg-ungrounded";
    const label =
        grounding.verdict === "green"
            ? t("citations.mcpCardGreen")
            : grounding.verdict === "red"
              ? t("citations.mcpCardRed")
              : grounding.reason === "quote_modified"
                ? t("citations.mcpCardYellowModified")
                : grounding.reason === "no_source"
                  ? t("citations.mcpCardYellowNoSource")
                  : t("citations.mcpCardYellowNoQuote");
    return (
        <span
            data-testid="mcp-card-grounding"
            data-verdict={grounding.verdict}
            className={`mt-1 inline-flex items-baseline gap-1.5 text-[10.5px] font-semibold uppercase leading-tight tracking-[0.08em] ${tone}`}
        >
            <span className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${dot}`} aria-hidden="true" />
            {label}
        </span>
    );
}

/**
 * ADR-0146: baner nad panelem zrodel MCP - jedno zdanie o stanie weryfikacji
 * doslownych cytatow ze zrodel zewnetrznych + lista cytatow czerwonych (fragment
 * odpowiedzi, ktorego nie ma w zadnym pobranym zrodle). Brak raportu przy
 * obecnych kartach = "nie zweryfikowano" (nigdy cicho).
 */
export function McpGroundingBanner({ report }: { report?: PATRONMcpGrounding }) {
    if (!report || report.error) {
        return (
            <div
                data-testid="mcp-grounding-banner"
                data-state="failed"
                className="mt-3 border-l-2 border-unverified bg-unverified-soft px-3 py-2 text-xs text-unverified"
            >
                {t("citations.mcpBannerFailed")}
            </div>
        );
    }
    const red = report.quotes.filter((q) => q.verdict === "red");
    if (red.length > 0) {
        return (
            <div
                data-testid="mcp-grounding-banner"
                data-state="red"
                className="mt-3 border-l-2 border-ungrounded bg-ungrounded-soft px-3 py-2 text-xs text-ungrounded"
            >
                <div className="font-semibold">{t("citations.mcpBannerTitle")}</div>
                <div className="mt-0.5">
                    {red.length === 1 ? t("citations.mcpBannerRed") : t("citations.mcpBannerRedMany")}
                </div>
                <ul className="mt-1.5 space-y-1">
                    {red.map((q, i) => (
                        <li key={i} className="border-l border-ungrounded/40 bg-card px-2 py-1 text-ungrounded">
                            <span className="italic">
                                {"\u201e"}
                                {q.quote.length > 220 ? `${q.quote.slice(0, 220)}\u2026` : q.quote}
                                {"\u201d"}
                            </span>
                            <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ungrounded">
                                {t("citations.mcpQuoteNotFound")}
                                {q.source ? ` \u00b7 ${t("citations.mcpClosestSource")}: ${q.source.server}` : ""}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
    if (report.summary.quotes === 0) {
        return (
            <div
                data-testid="mcp-grounding-banner"
                data-state="no-quotes"
                className="mt-3 border-l-2 border-unverified bg-unverified-soft px-3 py-2 text-xs text-unverified"
            >
                {t("citations.mcpBannerNoQuotes")}
            </div>
        );
    }
    const allGreen = report.summary.green === report.summary.quotes;
    return (
        <div
            data-testid="mcp-grounding-banner"
            data-state={allGreen ? "green" : "yellow"}
            className={
                allGreen
                    ? "mt-3 border-l-2 border-grounded bg-grounded-soft px-3 py-2 text-xs text-grounded"
                    : "mt-3 border-l-2 border-unverified bg-unverified-soft px-3 py-2 text-xs text-unverified"
            }
        >
            {allGreen
                ? t("citations.mcpBannerAllGreen")
                : `${t("citations.mcpBannerTitle")}: ${report.summary.green} ${t("citations.mcpQuoteFound")}, ${report.summary.yellow} ${t("citations.mcpQuoteModified")} / ${t("citations.mcpQuoteNoSource")}`}
        </div>
    );
}

export function McpCitationsPanel({ citations }: McpCitationsPanelProps) {
    // Grupuj po serwerze - sekcja per konektor.
    const groups = new Map<string, PATRONMcpCitation[]>();
    for (const c of citations) {
        const arr = groups.get(c.server) ?? [];
        arr.push(c);
        groups.set(c.server, arr);
    }

    return (
        <div className="mt-3 space-y-3">
            {Array.from(groups.entries()).map(([server, items]) => (
                <div
                    key={server}
                    className="rounded-lg border border-stone-200 bg-stone-50 p-3"
                >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {mcpServerLabel(server)} ({items.length})
                    </div>
                    <ul className="space-y-2">
                        {items.map((c, i) => (
                            <li key={`${c.server}-${c.tool}-${i}`}>
                                {c.url ? (
                                    <a
                                        href={c.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block rounded-md border border-stone-200 bg-white px-3 py-2 text-sm transition hover:border-stone-300 hover:bg-stone-50"
                                    >
                                        <div className="font-medium text-stone-800">
                                            {c.title ?? c.url}
                                        </div>
                                        <McpCardGroundingBadge grounding={c.grounding} />
                                        {c.snippet && (
                                            <div className="mt-1 text-xs text-stone-500 line-clamp-2">
                                                {c.snippet}
                                            </div>
                                        )}
                                        <div className="mt-1 text-[10px] text-stone-400 break-all">
                                            {c.url}
                                        </div>
                                    </a>
                                ) : (
                                    <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                                        <div className="font-medium text-stone-800">
                                            {c.title ?? "(brak tytułu)"}
                                        </div>
                                        <McpCardGroundingBadge grounding={c.grounding} />
                                        {c.snippet && (
                                            <div className="mt-1 text-xs text-stone-500 line-clamp-2">
                                                {c.snippet}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

