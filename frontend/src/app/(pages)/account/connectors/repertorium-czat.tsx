"use client";

// ADR-0167: karta "Repertorium w czacie" - tylko edycja PL, tylko Operator.
// Wlaczenie pobiera klucz instalacji po stronie backendu (odpowiedz go nie niesie)
// i wpuszcza do czatu narzedzia ODCZYTU Repertorium. Karta mowi wprost, co
// wychodzi z komputera i jakie sa limity - zanim Operator kliknie.

import { useCallback, useState } from "react";
import { getLocale, t } from "@/i18n";
import { setRepertoriumChat, type ConnectorInfo } from "@/app/lib/patronApi";

/** apiRequest rzuca Error z surowym cialem odpowiedzi - wyciagamy `detail`. */
function szczegol(err: unknown): string {
    const surowy = err instanceof Error ? err.message : String(err);
    try {
        const j = JSON.parse(surowy) as { detail?: unknown };
        if (typeof j.detail === "string") return j.detail;
    } catch {
        /* nie JSON */
    }
    return surowy;
}

export function RepertoriumCzat({
    connectors,
    onRestartRequired,
}: {
    connectors: ConnectorInfo[];
    onRestartRequired: () => void;
}) {
    const zListy = connectors.find((c) => c.name === "repertorium")?.chatTools === true;
    const [wlaczone, setWlaczone] = useState<boolean>(zListy);
    const [komunikat, setKomunikat] = useState<string | null>(null);
    const [blad, setBlad] = useState<string | null>(null);
    const [zapis, setZapis] = useState(false);

    const przelacz = useCallback(async () => {
        setZapis(true);
        setBlad(null);
        try {
            const r = await setRepertoriumChat(!wlaczone);
            setWlaczone(r.enabled);
            setKomunikat(t(r.enabled ? "connectors.repertoriumOn" : "connectors.repertoriumOff"));
            if (r.restartRequired) onRestartRequired();
        } catch (err) {
            const d = szczegol(err);
            setBlad(
                /Admin role required/i.test(d)
                    ? t("connectors.approveForbidden")
                    : t("connectors.repertoriumError").replace("{detail}", d),
            );
        } finally {
            setZapis(false);
        }
    }, [wlaczone, onRestartRequired]);

    if (getLocale() !== "pl") return null;

    return (
        <div className="mb-6 rounded-xl border border-gray-100 px-4 py-3">
            <h3 className="text-sm font-medium text-gray-900">{t("connectors.repertoriumTitle")}</h3>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">{t("connectors.repertoriumBody")}</p>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">{t("connectors.repertoriumLimits")}</p>
            <button
                type="button"
                onClick={przelacz}
                disabled={zapis}
                className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
                {t(wlaczone ? "connectors.repertoriumDisable" : "connectors.repertoriumEnable")}
            </button>
            {komunikat && <p className="mt-2 text-xs text-gray-700">{komunikat}</p>}
            {blad && <p className="mt-2 text-xs text-bad">{blad}</p>}
        </div>
    );
}
