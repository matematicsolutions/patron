// Banner MCP Security Gateway dla operatora kancelarii (ADR-0042).
//
// Renderowany w panelu admin (frontend/src/app/(pages)/admin/layout.tsx).
// Widoczny TYLKO dla admin (whitelist email env per ADR-0034). Pasywny sygnal
// stanu kontroli - czyta state z useMcpSecurityStatus hook, nie loguje wejscia.
//
// Logowanie wejsc admin do audit_log = rezerwacja ADR-0043.

"use client";

import type { ReactElement } from "react";
import { ChevronRight, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useMcpSecurityStatus } from "@/hooks/useMcpSecurityStatus";
import { t } from "@/i18n";

export function McpSecurityBanner(): ReactElement | null {
    const { visible, status } = useMcpSecurityStatus();

    if (!visible || !status) return null;

    const { mode } = status.gateway;
    const { by_action } = status.audit_summary_24h;
    const denied = by_action.denied;
    const audit = by_action.audit;
    const humanReview = by_action.human_review;

    let bgClass = "bg-gray-50 border-gray-200 text-gray-900";
    let icon = <ShieldOff className="h-5 w-5" aria-hidden="true" />;
    let message = t("mcpSecurity.disabledMessage");
    let ariaLabel = t("mcpSecurity.disabledAriaLabel");

    if (mode === "enforce" && denied > 0) {
        bgClass = "bg-bad-soft border-bad-soft text-bad";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.blockedMessage").replace("{denied}", String(denied));
        ariaLabel = t("mcpSecurity.blockedAriaLabel").replace("{denied}", String(denied));
    } else if (mode === "enforce") {
        bgClass = "bg-ok-soft border-ok-soft text-ok";
        icon = <ShieldCheck className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.activeMessage")
            .replace("{audit}", String(audit))
            .replace("{humanReview}", String(humanReview));
        ariaLabel = t("mcpSecurity.activeAriaLabel")
            .replace("{audit}", String(audit))
            .replace("{humanReview}", String(humanReview));
    } else if (mode === "audit") {
        bgClass = "bg-warn-soft border-warn-soft text-warn";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.auditMessage").replace("{total}", String(audit + humanReview + denied));
        ariaLabel = t("mcpSecurity.auditAriaLabel");
    }

    // Baner jest AKTYWNY (WM 2026-08-21): klik prowadzi do akt audytu, gdzie
    // widac decyzje bramki i instrukcje wlaczenia. Informacja bez wyjscia
    // do akcji zamienia governance w tapete.
    return (
        <Link
            href="/admin/audit"
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            data-testid="mcp-security-banner"
            className={`group flex items-center gap-2 border-b px-4 py-2 text-sm transition-colors hover:brightness-95 ${bgClass}`}
        >
            {icon}
            <span>{message}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold underline-offset-2 group-hover:underline">
                {t("mcpSecurity.actionHint")}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
        </Link>
    );
}
