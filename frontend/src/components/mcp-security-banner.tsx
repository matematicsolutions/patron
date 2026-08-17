// Banner MCP Security Gateway dla operatora kancelarii (ADR-0042).
//
// Renderowany w panelu admin (frontend/src/app/(pages)/admin/layout.tsx).
// Widoczny TYLKO dla admin (whitelist email env per ADR-0034). Pasywny sygnal
// stanu kontroli - czyta state z useMcpSecurityStatus hook, nie loguje wejscia.
//
// Logowanie wejsc admin do audit_log = rezerwacja ADR-0043.

"use client";

import type { ReactElement } from "react";
import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
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
        bgClass = "bg-red-50 border-red-200 text-red-900";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.blockedMessage").replace("{denied}", String(denied));
        ariaLabel = t("mcpSecurity.blockedAriaLabel").replace("{denied}", String(denied));
    } else if (mode === "enforce") {
        bgClass = "bg-emerald-50 border-emerald-200 text-emerald-900";
        icon = <ShieldCheck className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.activeMessage")
            .replace("{audit}", String(audit))
            .replace("{humanReview}", String(humanReview));
        ariaLabel = t("mcpSecurity.activeAriaLabel")
            .replace("{audit}", String(audit))
            .replace("{humanReview}", String(humanReview));
    } else if (mode === "audit") {
        bgClass = "bg-amber-50 border-amber-200 text-amber-900";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = t("mcpSecurity.auditMessage").replace("{total}", String(audit + humanReview + denied));
        ariaLabel = t("mcpSecurity.auditAriaLabel");
    }

    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            className={`flex items-center gap-2 border-b px-4 py-2 text-sm ${bgClass}`}
        >
            {icon}
            <span>{message}</span>
        </div>
    );
}
