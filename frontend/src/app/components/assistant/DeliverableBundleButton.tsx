// Przycisk eksportu pakietu dowodowego dla JEDNEJ odpowiedzi (ADR-0152).
//
// Rozni sie od AuditExportButton (ADR-0047) przedmiotem: tamten wynosi
// pojedyncze zdarzenie z dziennika dla audytora, ten wynosi CALY dokument
// koncowy razem z dowodem, jak powstal - tresc, werdykt kazdego cytatu,
// fragment lancucha audytowego, wersje modelu. Odbiorca to klient albo
// regulator pytajacy "jak powstala ta analiza".
//
// Zero nowych zaleznosci (Konstytucja Art. 4): istniejacy Button + ikony
// lucide + natywny fetch/Blob, tak samo jak w AuditExportButton.

"use client";

import { useState } from "react";
import { FileArchive, Loader2, AlertCircle } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";
import { t } from "@/i18n";

type Stan =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "failed"; error: string };

function nazwaZNaglowka(header: string | null): string | null {
    if (!header) return null;
    const m = header.match(/filename="([^"]+)"/);
    return m ? m[1] : null;
}

function pobierz(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export interface DeliverableBundleButtonProps {
    /** id wiadomosci asystenta, ktora jest dokumentem koncowym */
    messageId: string;
}

export function DeliverableBundleButton({ messageId }: DeliverableBundleButtonProps) {
    const [stan, setStan] = useState<Stan>({ kind: "idle" });

    async function eksportuj(): Promise<void> {
        setStan({ kind: "loading" });
        try {
            const res = await fetch(apiUrl(`/api/audit/bundle/${messageId}`), {
                credentials: "include",
            });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const body = (await res.json()) as { detail?: string; error?: string };
                    detail = body.detail ?? body.error ?? detail;
                } catch {
                    /* odpowiedz nie jest JSON-em */
                }
                setStan({ kind: "failed", error: detail });
                return;
            }
            const filename =
                nazwaZNaglowka(res.headers.get("Content-Disposition")) ??
                `audit-bundle-${messageId}.zip`;
            pobierz(await res.blob(), filename);
            setStan({ kind: "idle" });
        } catch (e) {
            setStan({
                kind: "failed",
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    if (stan.kind === "failed") {
        return (
            <button
                type="button"
                onClick={() => void eksportuj()}
                data-testid="deliverable-bundle-button"
                className="flex items-center gap-1 text-left text-[11px] leading-tight text-red-700 underline-offset-2 hover:underline"
                title={stan.error}
            >
                <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("citations.bundleFailed")}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={() => void eksportuj()}
            disabled={stan.kind === "loading"}
            data-testid="deliverable-bundle-button"
            aria-label={t("citations.bundleAria")}
            title={t("citations.bundleHint")}
            className="flex items-center gap-1 text-left text-[11px] leading-tight text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-60"
        >
            {stan.kind === "loading" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
                <FileArchive className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            {t("citations.bundleExport")}
        </button>
    );
}
