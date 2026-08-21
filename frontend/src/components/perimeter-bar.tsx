// Pasek perymetru - governance wyjety z ustawien na powierzchnie produktu.
//
// Po co to istnieje: laancuch skrotow, bramka egress i gateway MCP to jedyne
// rzeczy, ktorych nie ma zaden konkurent w kategorii (zmierzone 2026-08-21 na
// Harvey, Legora, Hebbia, Wexler, Libra, Omnilexia, Beck-Noxtua). Do tej pory
// siedzialy w /admin/audit i /account/connectors, czyli tam, gdzie prawnik
// zaglada raz w zyciu. Sprzedajemy governance i chowamy go jak ustawienia
// drukarki.
//
// Roznica wobec EgressConfigBanner: TAMTEN pokazuje sie tylko, gdy jest zle.
// Brak banera jest wtedy dwuznaczny - nie wiadomo, czy jest bezpiecznie, czy
// baner sie zepsul. Ten pasek jest ZAWSZE, wiec cisza przestaje byc informacja
// (por. "monitor wykrywa sukces, nie awarie"). Trojstan jak przy groundingu
// cytatu: brak odpowiedzi o konfiguracji to NIE jest stan zielony.
//
// Pasywny: czyta stan, niczego nie loguje i niczego nie zmienia.

"use client";

import type { ReactElement } from "react";
import { useEgressConfig } from "@/hooks/useEgressConfig";
import { useMcpSecurityStatus } from "@/hooks/useMcpSecurityStatus";
import { useSelectedModel } from "@/app/hooks/useSelectedModel";
import { t } from "@/i18n";

type Posture = "local" | "cloud" | "unknown";

export function PerimeterBar(): ReactElement {
    const { config } = useEgressConfig();
    const { status } = useMcpSecurityStatus();
    const [model] = useSelectedModel();

    // fail-closed: brak konfiguracji nie awansuje na zielony
    const posture: Posture =
        config === null
            ? "unknown"
            : config.privileged_cloud.allowed || config.us_providers.allowed
              ? "cloud"
              : "local";

    const tone =
        posture === "local"
            ? "text-grounded"
            : posture === "cloud"
              ? "text-unverified"
              : "text-unverified";

    const dot =
        posture === "local"
            ? "bg-grounded"
            : posture === "cloud"
              ? "bg-unverified"
              : "bg-unverified";

    const postureText =
        posture === "local"
            ? t("perimeter.local")
            : posture === "unknown"
              ? t("perimeter.unknown")
              : config?.privileged_cloud.allowed
                ? t("perimeter.cloudPrivileged")
                : t("perimeter.cloudUs");

    const blocked = status?.audit_summary_24h.by_action.denied ?? 0;

    return (
        <footer
            data-testid="perimeter-bar"
            data-posture={posture}
            aria-label={t("perimeter.label")}
            className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-sidebar px-4 py-1.5 text-[11px] leading-tight text-muted-foreground"
        >
            <span className={`inline-flex items-baseline gap-1.5 font-semibold ${tone}`}>
                <span
                    className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${dot}`}
                    aria-hidden="true"
                />
                {postureText}
            </span>

            <span className="inline-flex items-baseline gap-1">
                <span className="uppercase tracking-[0.08em]">{t("perimeter.model")}</span>
                <span className="font-mono text-foreground">{model}</span>
                {config?.local_model_configured ? (
                    <span className="text-grounded">({t("perimeter.localModel")})</span>
                ) : null}
            </span>

            {status ? (
                <span className="inline-flex items-baseline gap-1">
                    <span className="uppercase tracking-[0.08em]">{t("perimeter.gateway")}</span>
                    <span className={status.gateway.active ? "text-grounded" : "text-unverified"}>
                        {status.gateway.active
                            ? t("perimeter.gatewayActive")
                            : t("perimeter.gatewayInactive")}
                    </span>
                    <span className="font-mono text-foreground">
                        {status.audit_summary_24h.decisions_total}
                    </span>
                    <span>{t("perimeter.decisions24h")}</span>
                    {blocked > 0 ? (
                        <span className="font-semibold text-ungrounded">
                            {blocked} {t("perimeter.blocked")}
                        </span>
                    ) : null}
                </span>
            ) : null}
        </footer>
    );
}
