// Banner posture egress / data-residency (Faza 2 audytu Fable5).
//
// Renderowany w glownym layoucie aplikacji. Pokazuje sie TYLKO gdy dane spraw
// moga opuscic urzadzenie (model chmurowy dla tajemnicy albo dostawcy US
// dozwoleni) - czyni "swiadoma zgode Operatora" (ADR-0101) widoczna dla prawnika.
// W trybie czysto lokalnym (default, fail-closed) nie renderuje sie, by nie
// zasmiecac UI. Pasywny sygnal - czyta stan z useEgressConfig, nie loguje wejscia.

"use client";

import type { ReactElement } from "react";
import { Cloud } from "lucide-react";
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

    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            className="flex items-center gap-2 border-b border-warn-soft bg-warn-soft px-4 py-2 text-sm text-warn"
        >
            <Cloud className="h-5 w-5" aria-hidden="true" />
            <span>{message}</span>
        </div>
    );
}
