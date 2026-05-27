// Button eksportu audit pack JSON dla audytora (ADR-0047).
//
// Wywoluje GET /api/audit/export/:eventId, pobiera Blob i wymusza download
// przez native <a download>. Zero nowych deps (Konstytucja Art. 4):
// shadcn Button + lucide Download/Loader2/AlertCircle istniejace, native
// fetch + Blob + URL.createObjectURL.
//
// Filename pobierany z Content-Disposition header (zwracany przez backend
// jako "audit-pack-event-{id}-{YYYYMMDD}.json"); fallback gdy header brak.

"use client";

import { useState } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type State =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "failed"; error: string };

function parseFilenameFromContentDisposition(header: string | null): string | null {
    if (!header) return null;
    // Format: `attachment; filename="audit-pack-event-123-20260527.json"`
    const match = header.match(/filename="([^"]+)"/);
    return match ? match[1] : null;
}

function fallbackFilename(eventId: number): string {
    return `audit-pack-event-${eventId}.json`;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export interface AuditExportButtonProps {
    eventId: number;
}

export function AuditExportButton({ eventId }: AuditExportButtonProps) {
    const [state, setState] = useState<State>({ kind: "idle" });

    async function handleExport(): Promise<void> {
        setState({ kind: "loading" });
        try {
            const res = await fetch(`/api/audit/export/${eventId}`, {
                credentials: "include",
            });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const body = (await res.json()) as { detail?: string };
                    if (body.detail) detail = body.detail;
                } catch {
                    /* response nie jest JSON-em (Content-Disposition setowany dopiero przy 200) */
                }
                setState({ kind: "failed", error: detail });
                return;
            }
            const filename =
                parseFilenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
                fallbackFilename(eventId);
            const blob = await res.blob();
            downloadBlob(blob, filename);
            setState({ kind: "idle" });
        } catch (err) {
            setState({
                kind: "failed",
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Button
                type="button"
                onClick={handleExport}
                disabled={state.kind === "loading"}
                variant="outline"
            >
                {state.kind === "loading" ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Przygotowuje pack...</span>
                    </>
                ) : (
                    <>
                        <Download className="h-4 w-4" />
                        <span>Pobierz audit pack (JSON)</span>
                    </>
                )}
            </Button>

            {state.kind === "failed" && (
                <p className="flex items-center gap-1 text-sm text-red-700">
                    <AlertCircle className="h-3 w-3" />
                    {state.error}
                </p>
            )}
        </div>
    );
}
