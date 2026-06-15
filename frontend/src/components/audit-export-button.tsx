// Button eksportu audit pack JSON dla audytora (ADR-0047) z fallback
// "Wymus compute root" gdy brak pokrywajacego Merkle root (ADR-0048).
//
// Wywoluje GET /api/audit/export/:eventId, pobiera Blob i wymusza download
// przez native <a download>. Gdy backend zwroci 404 z detail zawierajacym
// "brak Merkle root pokrywajacego event" - pokazuje drugi button "Wymus
// compute root i ponow eksport" wywolujacy POST /api/audit/merkle/compute-now
// (ADR-0048), nastepnie auto-retry GET /api/audit/export.
//
// Zero nowych deps (Konstytucja Art. 4): shadcn Button + lucide
// Download/Loader2/AlertCircle/ShieldCheck istniejace, native fetch + Blob
// + URL.createObjectURL.

"use client";

import { useState } from "react";
import { Download, Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type State =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "needs-compute"; detail: string }
    | { kind: "computing" }
    | { kind: "failed"; error: string };

interface ComputeNowResponse {
    computed: boolean;
    reason: string;
    root?: { id: number; event_count: number; merkle_root: string };
    error?: string;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
    if (!header) return null;
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

/**
 * Heurystyka rozroznienia 404: "brak Merkle root" (mozliwy retry przez
 * compute-now) vs "event nie istnieje" (terminalny). Backend zwraca
 * polski detail z `fetchProofForEvent`.
 *
 * Anti-pattern brittle string match przyznane - docelowo backend powinien
 * zwracac machine-readable `error: "merkle_root_missing"`. Dlug na ADR-0050.
 */
function isMissingMerkleRoot(detail: string): boolean {
    return detail.includes("brak Merkle root");
}

export interface AuditExportButtonProps {
    eventId: number;
}

export function AuditExportButton({ eventId }: AuditExportButtonProps) {
    const [state, setState] = useState<State>({ kind: "idle" });

    async function fetchExport(): Promise<
        { kind: "ok"; blob: Blob; filename: string }
        | { kind: "needs-compute"; detail: string }
        | { kind: "error"; detail: string }
    > {
        const res = await fetch(`/api/audit/export/${eventId}`, {
            credentials: "include",
        });
        if (res.ok) {
            const filename =
                parseFilenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
                fallbackFilename(eventId);
            const blob = await res.blob();
            return { kind: "ok", blob, filename };
        }
        let detail = `HTTP ${res.status}`;
        try {
            const body = (await res.json()) as { detail?: string };
            if (body.detail) detail = body.detail;
        } catch {
            /* response nie jest JSON-em */
        }
        if (res.status === 404 && isMissingMerkleRoot(detail)) {
            return { kind: "needs-compute", detail };
        }
        return { kind: "error", detail };
    }

    async function handleExport(): Promise<void> {
        setState({ kind: "loading" });
        try {
            const result = await fetchExport();
            if (result.kind === "ok") {
                downloadBlob(result.blob, result.filename);
                setState({ kind: "idle" });
                return;
            }
            if (result.kind === "needs-compute") {
                setState({ kind: "needs-compute", detail: result.detail });
                return;
            }
            setState({ kind: "failed", error: result.detail });
        } catch (err) {
            setState({
                kind: "failed",
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    }

    async function handleForceCompute(): Promise<void> {
        setState({ kind: "computing" });
        try {
            const res = await fetch(`/api/audit/merkle/compute-now`, {
                method: "POST",
                credentials: "include",
            });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try {
                    const body = (await res.json()) as { detail?: string };
                    if (body.detail) detail = body.detail;
                } catch {
                    /* graceful */
                }
                setState({ kind: "failed", error: `Compute root: ${detail}` });
                return;
            }
            const body = (await res.json()) as ComputeNowResponse;
            if (!body.computed) {
                const why =
                    body.reason === "no_new_events"
                        ? "Brak nowych eventow do compute - audit_log pusty od ostatniego roota."
                        : body.error ?? `compute pominiety (reason: ${body.reason})`;
                setState({ kind: "failed", error: why });
                return;
            }
            // Compute udany - auto-retry eksportu
            const retry = await fetchExport();
            if (retry.kind === "ok") {
                downloadBlob(retry.blob, retry.filename);
                setState({ kind: "idle" });
                return;
            }
            if (retry.kind === "needs-compute") {
                // Compute udany ale event nadal nie pokryty? Edge case - bledny zakres.
                setState({
                    kind: "failed",
                    error: `Compute root udany (#${body.root?.id}) ale event ${eventId} nadal poza zakresem: ${retry.detail}`,
                });
                return;
            }
            setState({ kind: "failed", error: retry.detail });
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
                disabled={state.kind === "loading" || state.kind === "computing"}
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

            {state.kind === "needs-compute" && (
                <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="flex items-start gap-1 text-sm text-amber-900">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                            Event nie jest jeszcze pokryty przez Merkle root.
                            Wymus compute (auto-trigger uruchamia sie raz na 24h
                            lub po 1000 nowych eventow per ADR-0036).
                        </span>
                    </p>
                    <Button
                        type="button"
                        onClick={handleForceCompute}
                        variant="outline"
                        className="self-start"
                    >
                        <ShieldCheck className="h-4 w-4" />
                        <span>Wymus compute root i ponow eksport</span>
                    </Button>
                </div>
            )}

            {state.kind === "computing" && (
                <p className="flex items-center gap-1 text-sm text-gray-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Liczenie Merkle root i ponawianie eksportu...
                </p>
            )}

            {state.kind === "failed" && (
                <p className="flex items-start gap-1 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{state.error}</span>
                </p>
            )}
        </div>
    );
}
