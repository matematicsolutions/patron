// Drawer/side panel ze szczegolami eventu audit_log (ADR-0046).
//
// Conditional render bez biblioteki Dialog (zero new deps). Pokazuje payload
// (juz zamaskowany server-side per ADR-0040 faza 1), hash chain, Merkle
// proof button. Klik click-to-copy dla hash.

"use client";

import { X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MerkleVerifyButton } from "@/components/merkle-verify-button";
import type { AuditLogResponseEvent } from "@/hooks/useAuditLog";

export interface AuditEventDetailProps {
    event: AuditLogResponseEvent | null;
    onClose: () => void;
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        /* graceful - przegladarka bez clipboard API */
    }
}

export function AuditEventDetail({ event, onClose }: AuditEventDetailProps) {
    if (!event) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 sm:items-center sm:justify-center"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-detail-title"
        >
            <div
                className="flex h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-auto rounded-t-lg bg-white p-6 shadow-xl sm:rounded-lg"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-4 border-b pb-3">
                    <div>
                        <h2 id="audit-detail-title" className="text-lg font-semibold">
                            Zdarzenie #{event.id}
                        </h2>
                        <p className="text-sm text-gray-600">{formatDateTime(event.ts)}</p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Zamknij"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </header>

                <section className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">{event.event_type}</Badge>
                    {event.actor_user_id && (
                        <Badge variant="outline">
                            actor: {event.actor_user_id.slice(0, 8)}...
                        </Badge>
                    )}
                    {event.chat_id && (
                        <Badge variant="outline">
                            chat: {event.chat_id.slice(0, 8)}...
                        </Badge>
                    )}
                    {event.document_id && (
                        <Badge variant="outline">
                            doc: {event.document_id.slice(0, 8)}...
                        </Badge>
                    )}
                </section>

                <section>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">
                        Payload (zamaskowany)
                    </h3>
                    <pre className="max-h-80 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
                        {JSON.stringify(event.payload_masked, null, 2)}
                    </pre>
                </section>

                <section>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">
                        Hash chain (ADR-0001)
                    </h3>
                    <dl className="grid grid-cols-[120px_1fr] gap-2 text-xs">
                        <dt className="text-gray-600">hash</dt>
                        <dd className="flex items-center gap-2">
                            <code className="break-all">{event.hash}</code>
                            <button
                                type="button"
                                onClick={() => void copyToClipboard(event.hash)}
                                className="text-gray-500 hover:text-gray-800"
                                aria-label="Kopiuj hash"
                            >
                                <Copy className="h-3 w-3" />
                            </button>
                        </dd>
                        <dt className="text-gray-600">prev_hash</dt>
                        <dd className="flex items-center gap-2">
                            <code className="break-all">{event.prev_hash}</code>
                            <button
                                type="button"
                                onClick={() => void copyToClipboard(event.prev_hash)}
                                className="text-gray-500 hover:text-gray-800"
                                aria-label="Kopiuj prev_hash"
                            >
                                <Copy className="h-3 w-3" />
                            </button>
                        </dd>
                    </dl>
                </section>

                <section>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">
                        Weryfikacja Merkle proof (ADR-0026, ADR-0036)
                    </h3>
                    <MerkleVerifyButton eventId={event.id} />
                </section>
            </div>
        </div>
    );
}
