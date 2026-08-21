// Powiadomienie o ZMIANIE postawy egress (Faza 2 audytu Fable5, korekta
// ADR-0149 z 2026-08-21).
//
// Do 2026-08-21 byl to staly pas na gorze ekranu, mowiacy dokladnie to samo, co
// pasek perymetru na dole - ta sama informacja dwa razy na jednym ekranie, przy
// czym gorna kopia zajmowala pozycje najwyzszej rangi w hierarchii (nad
// wszystkim, przez cala szerokosc). Ekran startowy oglaszal wiec, ze
// najwazniejsza jest konfiguracja, a nie sprawa mecenasa.
//
// Zasada po korekcie: STAN TRWALY nalezy do perymetru (tam zgode widac zawsze i
// mozna ja odwolac jednym klikiem), ZMIANA STANU do banera. Wlaczenie zgody
// Operatora jest zdarzeniem, ktore mecenas ma zauwazyc RAZ - trwanie zgody nie
// jest zdarzeniem.
//
// Zamkniecie zapisujemy per POSTAWA w sessionStorage: gdy postawa sie zmieni
// (np. dojda dostawcy z USA), baner wraca. Nie da sie wiec "zamknac na zawsze"
// czegos, co pozniej stanie sie inna decyzja. Pasywny - niczego nie loguje.

"use client";

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ChevronRight, Cloud, X } from "lucide-react";
import Link from "next/link";
import { useEgressConfig } from "@/hooks/useEgressConfig";
import { t } from "@/i18n";

const KLUCZ = "patron-egress-notice";

export function EgressConfigBanner(): ReactElement | null {
    const { config } = useEgressConfig();
    const [dismissed, setDismissed] = useState<string | null>(null);

    const privileged = config?.privileged_cloud.allowed ?? false;
    const us = config?.us_providers.allowed ?? false;
    // Tozsamosc postawy - zmiana tej wartosci przywraca baner.
    const postureKey = `${privileged ? "priv" : ""}${us ? "us" : ""}`;

    useEffect(() => {
        try {
            setDismissed(window.sessionStorage.getItem(KLUCZ));
        } catch {
            setDismissed(null);
        }
    }, []);

    if (!config) return null;
    if (!privileged && !us) return null;
    if (dismissed === postureKey) return null;

    const message = privileged
        ? t("egressConfig.privilegedCloudMessage")
        : t("egressConfig.usProvidersMessage");
    const ariaLabel = privileged
        ? t("egressConfig.privilegedCloudAriaLabel")
        : t("egressConfig.usProvidersAriaLabel");

    function zamknij() {
        try {
            window.sessionStorage.setItem(KLUCZ, postureKey);
        } catch {
            /* brak sessionStorage - baner po prostu zostanie do przeladowania */
        }
        setDismissed(postureKey);
    }

    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={ariaLabel}
            data-testid="egress-config-banner"
            className="flex items-center gap-2 border-b border-b-border/60 border-l-[3px] border-l-warn bg-transparent px-4 py-1.5 text-[12.5px] leading-tight text-warn"
        >
            <Cloud className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message}</span>
            <Link
                href="/account/models"
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:underline"
            >
                {t("egressConfig.actionHint")}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <button
                type="button"
                onClick={zamknij}
                data-testid="egress-config-dismiss"
                title={t("egressConfig.dismiss")}
                aria-label={t("egressConfig.dismiss")}
                className="shrink-0 rounded-sm p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}
