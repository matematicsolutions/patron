// Tabela eventow audit_log z paginacja cursor (ADR-0046).
//
// Native <table> + tailwind, zero nowych deps. Klik wiersza otwiera detail
// drawer w parent przez setSelectedEvent.

"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AuditLogResponseEvent } from "@/hooks/useAuditLog";

export interface AuditEventsListProps {
    events: AuditLogResponseEvent[];
    nextCursor: number | null;
    loading: boolean;
    error: string | null;
    onSelect: (event: AuditLogResponseEvent) => void;
    onLoadMore: (cursor: number) => void;
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eventTypeBadgeVariant(
    eventType: string,
): "default" | "secondary" | "destructive" | "outline" {
    if (eventType.startsWith("rodo.")) return "destructive";
    if (eventType.startsWith("mcp_security.")) return "destructive";
    if (eventType.startsWith("admin.access.")) return "outline";
    if (eventType.startsWith("migrate.")) return "outline";
    return "secondary";
}

export function AuditEventsList({
    events,
    nextCursor,
    loading,
    error,
    onSelect,
    onLoadMore,
}: AuditEventsListProps) {
    if (error) {
        return (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error}
            </div>
        );
    }

    if (events.length === 0 && !loading) {
        return (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
                <p className="font-medium">Brak zdarzen w wybranym zakresie</p>
                <p className="mt-1 text-gray-500">
                    Spr&oacute;buj rozszerzyc okres czasu lub wybrac inny typ zdarzenia.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                        <th className="px-3 py-2 font-medium">Czas</th>
                        <th className="px-3 py-2 font-medium">Typ zdarzenia</th>
                        <th className="px-3 py-2 font-medium">Aktor</th>
                        <th className="px-3 py-2 font-medium">Hash</th>
                        <th className="px-3 py-2 font-medium text-right">Akcja</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {events.map((event) => (
                        <tr
                            key={event.id}
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() => onSelect(event)}
                        >
                            <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                                {formatDateTime(event.ts)}
                            </td>
                            <td className="px-3 py-2">
                                <Badge variant={eventTypeBadgeVariant(event.event_type)}>
                                    {event.event_type}
                                </Badge>
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                                {event.actor_user_id
                                    ? `${event.actor_user_id.slice(0, 8)}...`
                                    : "system"}
                            </td>
                            <td className="px-3 py-2">
                                <code className="text-xs text-gray-500">
                                    {event.hash.slice(0, 8)}...
                                </code>
                            </td>
                            <td className="px-3 py-2 text-right">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelect(event);
                                    }}
                                >
                                    Szczeg&oacute;ly
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {nextCursor !== null && (
                <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-center">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onLoadMore(nextCursor)}
                        disabled={loading}
                    >
                        {loading ? "Wczytuje..." : "Wczytaj wiecej"}
                    </Button>
                </div>
            )}
        </div>
    );
}
