// Banner posture egress / data-residency (Faza 2 audytu Fable5).
//
// Renderowany w glownym layoucie aplikacji. Pokazuje sie TYLKO gdy dane spraw
// moga opuscic urzadzenie (model chmurowy dla tajemnicy albo dostawcy US
// dozwoleni) - czyni "swiadoma zgode Operatora" (ADR-0101) widoczna dla prawnika.
// W trybie czysto lokalnym (default, fail-closed) nie renderuje sie, by nie
// zasmiecac UI. Pasywny sygnal - czyta stan z useEgressConfig, nie loguje wejscia.

"use client";

import type { ReactElement } from "react";
import { ChevronRight, Cloud } from "lucide-react";
import Link from "next/link";
import { useEgressConfig } from "@/hooks/useEgressConfig";
import { t } from "@/i18n";

export function EgressConfigBanner(): ReactElement | null {
    const { config } = useEgressConfig();
    if (!config) return null;

    const privileged = config.privileged_cloud.allowed;
    const us = config.us_providers.allowed;
    if (!privileged && !us) return null;

    const message = privileged
        ? t("egressConfig.privilegedCloudMessage")
        : t("egressConfig.usProvidersMessage");
    const ariaLabel = privileged
        ? t("egressConfig.privilegedCloudAriaLabel")
        : t("egressConfig.usProvidersAriaLabel");

    // Baner jest AKTYWNY (WM 2026-08-21): zgoda Operatora ma byc nie tylko
    // widoczna, ale odwolywalna jednym ruchem - klik prowadzi tam, gdzie
    // zmienia sie polityke modelu.
    return (
        <Link
            href="/account/models"
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            data-testid="egress-config-banner"
            className="group flex items-center gap-2 border-b border-warn-soft bg-warn-soft px-4 py-2 text-sm text-warn transition-colors hover:brightness-95"
        >
            <Cloud className="h-5 w-5" aria-hidden="true" />
            <span>{message}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold underline-offset-2 group-hover:underline">
                {t("egressConfig.actionHint")}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
        </Link>
    );
}
