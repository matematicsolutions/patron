// Banner MCP Security Gateway dla operatora kancelarii (ADR-0042).
//
// Renderowany w panelu admin (frontend/src/app/(pages)/admin/layout.tsx).
// Widoczny TYLKO dla admin (whitelist email env per ADR-0034). Pasywny sygnal
// stanu kontroli - czyta state z useMcpSecurityStatus hook, nie loguje wejscia.
//
// Logowanie wejsc admin do audit_log = rezerwacja ADR-0043.

"use client";

import type { ReactElement } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { blockedGatewayDecisions, useMcpSecurityStatus } from "@/hooks/useMcpSecurityStatus";
import { t } from "@/i18n";

export function McpSecurityBanner(): ReactElement | null {
    const { visible, status } = useMcpSecurityStatus();

    if (!visible || !status) return null;

    const blocked = blockedGatewayDecisions(status);

    // ADR-0149 (korekta WM 2026-08-21): STAN TRWALY nalezy do perymetru, gora
    // jest zarezerwowana na ZDARZENIE. Gora zapala sie wylacznie wtedy, gdy
    // bramka FAKTYCZNIE cos zablokowala - `denied` albo `human_review` bez
    // zatwierdzenia Operatora (dryf, podmiana plikow konektora). Tryb bramy jest
    // zawsze "enforce" (ADR-0160), wiec innych stanow baner nie rozroznia.
    if (blocked === 0) return null;

    // Adnotacja, nie alarm: kolor niesie WYLACZNIE kreska po lewej i ton
    // tekstu; tlo zostaje papierem.
    const message = t("mcpSecurity.blockedMessage").replace("{blocked}", String(blocked));
    const ariaLabel = t("mcpSecurity.blockedAriaLabel").replace("{blocked}", String(blocked));

    // Baner jest AKTYWNY (WM 2026-08-21): klik prowadzi do akt audytu, gdzie
    // widac decyzje bramki i sciezke zatwierdzenia (ADR-0158). Informacja bez wyjscia
    // do akcji zamienia governance w tapete.
    return (
        <Link
            href="/admin/audit"
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            data-testid="mcp-security-banner"
            className="group flex items-center gap-2 border-b border-b-border/60 border-l-[3px] border-l-bad bg-transparent px-4 py-1.5 text-[12.5px] leading-tight text-bad transition-colors hover:bg-gray-50"
        >
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold underline-offset-2 group-hover:underline">
                {t("mcpSecurity.actionHint")}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
        </Link>
    );
}
