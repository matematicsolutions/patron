// Banner aktualizacji paczek wiedzy (kanal dystrybucji chunkowej, ADR-0140).
//
// Renderowany w glownym layoucie obok bannerow MCP Security i egress. Pokazuje
// sie TYLKO, gdy kanal ma nowsza wersje ktorejs z lokalnych paczek - komunikat
// "dostepna aktualizacja X -> Y, do pobrania N MB z M MB" (rozmiar delty
// policzony z manifestu i lokalnego seeda, nie zgadywany). Model abonamentu
// bez DRM: paczka dziala wiecznie, banner to jedyny nacisk. Pasywny sygnal -
// sama aktualizacja to akt Operatora (POST /api/packs/update z panelu).

"use client";

import type { ReactElement } from "react";
import { PackageOpen } from "lucide-react";
import { usePackUpdates } from "@/hooks/usePackUpdates";
import { t } from "@/i18n";

function fill(template: string, u: {
    packName: string | null;
    file: string;
    have: string | null;
    available: string;
    downloadMb: number;
    packMb: number;
}): string {
    return template
        .replace("{name}", u.packName ?? u.file)
        .replace("{have}", u.have ?? "?")
        .replace("{available}", u.available)
        .replace("{download}", String(u.downloadMb))
        .replace("{total}", String(u.packMb));
}

export function PackUpdateBanner(): ReactElement | null {
    const { updates } = usePackUpdates();
    if (updates.length === 0) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900"
        >
            {updates.map((u) => (
                <div
                    key={u.file}
                    className="flex items-center gap-2"
                    aria-label={fill(t("packUpdates.availableAriaLabel"), u)}
                >
                    <PackageOpen className="h-5 w-5" aria-hidden="true" />
                    <span>{fill(t("packUpdates.availableMessage"), u)}</span>
                </div>
            ))}
        </div>
    );
}
