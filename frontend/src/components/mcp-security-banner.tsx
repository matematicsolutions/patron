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
    let message = "MCP Security: WYLACZONY. Zalecane wlaczenie w env MCP_SECURITY_GATEWAY_MODE.";
    let ariaLabel = "MCP Security Gateway wylaczony";

    if (mode === "enforce" && denied > 0) {
        bgClass = "bg-red-50 border-red-200 text-red-900";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = `MCP Security: ZABLOKOWANO ${denied} toolow w ostatnich 24h. Sprawdz audit_log.`;
        ariaLabel = `MCP Security Gateway zablokowal ${denied} narzedzi w 24h`;
    } else if (mode === "enforce") {
        bgClass = "bg-emerald-50 border-emerald-200 text-emerald-900";
        icon = <ShieldCheck className="h-5 w-5" aria-hidden="true" />;
        message = `MCP Security: aktywny (enforce). 24h: ${audit} audit, ${humanReview} human_review.`;
        ariaLabel = `MCP Security Gateway aktywny w trybie enforce, ${audit} audit ${humanReview} human review w 24h`;
    } else if (mode === "audit") {
        bgClass = "bg-amber-50 border-amber-200 text-amber-900";
        icon = <ShieldAlert className="h-5 w-5" aria-hidden="true" />;
        message = `MCP Security: audit-only. ${audit + humanReview + denied} zdarzen w 24h. Toole NIE sa blokowane.`;
        ariaLabel = "MCP Security Gateway w trybie audit-only, narzedzia nie sa blokowane";
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
