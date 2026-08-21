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
import Link from "next/link";
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
            ? "text-rev-ok"
            : posture === "cloud"
              ? "text-rev-warn"
              : "text-rev-warn";

    const dot =
        posture === "local"
            ? "bg-rev-ok"
            : posture === "cloud"
              ? "bg-rev-warn"
              : "bg-rev-warn";

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
            // Perymetr jest ZAWSZE rewersem biezacego motywu (ciemny pas na
            // jasnym ekranie i odwrotnie): governance to "druga strona kartki",
            // widoczna obwodowo i nigdy nie zlewajaca sie z trescia. Segmenty
            // rozdziela wloskowata kreska - pas ma czytac sie jako JEDEN
            // instrument pomiarowy, nie luzny zbior napisow.
            className="flex shrink-0 flex-wrap items-stretch gap-y-1 border-t border-rev-border bg-rev-background px-4 py-2 text-[11px] leading-tight text-rev-muted-foreground"
        >
            <span
                className={`inline-flex items-baseline gap-1.5 self-center font-semibold ${tone}`}
            >
                <span
                    className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${dot}`}
                    aria-hidden="true"
                />
                {postureText}
            </span>

            <span className="mx-4 w-px self-stretch bg-rev-border" aria-hidden="true" />

            <span className="inline-flex items-baseline gap-1.5 self-center">
                <span className="uppercase tracking-[0.08em]">{t("perimeter.model")}</span>
                <span className="font-mono text-rev-foreground">{model}</span>
                {config?.local_model_configured ? (
                    <span className="text-rev-ok">({t("perimeter.localModel")})</span>
                ) : null}
            </span>

            {/* Lancuch skrotow, Merkle i eksport teczki dowodowej zyja pod
                /admin/audit, do ktorego do 2026-08-21 NIE PROWADZIL ZADEN LINK -
                dalo sie tam wejsc tylko wpisujac adres. Jedyne funkcje, ktorych
                nie ma konkurencja, byly nieosiagalne. Licznik decyzji jest teraz
                wejsciem do akt. */}
            {status ? (
                <>
                    <span
                        className="mx-4 w-px self-stretch bg-rev-border"
                        aria-hidden="true"
                    />
                    <span className="inline-flex items-baseline gap-1.5 self-center">
                        <span className="uppercase tracking-[0.08em]">
                            {t("perimeter.gateway")}
                        </span>
                        <span
                            className={
                                status.gateway.active ? "text-rev-ok" : "text-rev-warn"
                            }
                        >
                            {status.gateway.active
                                ? t("perimeter.gatewayActive")
                                : t("perimeter.gatewayInactive")}
                        </span>
                        <span className="font-mono text-rev-foreground">
                            {status.audit_summary_24h.decisions_total}
                        </span>
                        <span>{t("perimeter.decisions24h")}</span>
                        {blocked > 0 ? (
                            <span className="font-semibold text-rev-bad">
                                {blocked} {t("perimeter.blocked")}
                            </span>
                        ) : null}
                    </span>
                    <Link
                        href="/admin/audit"
                        data-testid="perimeter-audit-link"
                        title={t("perimeter.auditLink")}
                        // Odsylacz do akt to znak autorytetu - jedyne zloto na
                        // pasku, dobite do prawej krawedzi jak pieczec na dole
                        // dokumentu.
                        className="ml-auto inline-flex items-baseline gap-1 self-center rounded-sm pl-4 font-semibold uppercase tracking-[0.08em] text-rev-gold underline-offset-2 hover:underline focus-visible:underline"
                    >
                        <span aria-hidden="true">⏣</span>
                        {t("perimeter.auditLink")}
                    </Link>
                </>
            ) : null}
        </footer>
    );
}
