// Page viewer audytora (ADR-0046 - faza 2 z ADR-0040).
//
// Dostepne pod /admin/audit. Layout (pages)/layout.tsx daje requireAuth
// (redirect na /login dla niezalogowanych). Endpoint /api/audit/log
// (ADR-0040) dodatkowo wymaga requireAdmin (whitelist email env per
// ADR-0034) - non-admin dostanie 403, viewer pokaze komunikat.
//
// Logowanie wejscia: backend automatycznie loguje admin.access.audit_viewer
// do audit_log (ADR-0043, juz wpiete w GET /api/audit/log handler).

"use client";

import { useMemo, useState } from "react";
import { AuditFilterBar } from "@/components/audit-filter-bar";
import { AuditEventsList } from "@/components/audit-events-list";
import { AuditEventDetail } from "@/components/audit-event-detail";
import {
    useAuditLog,
    type AuditLogFilter,
    type AuditLogResponseEvent,
} from "@/hooks/useAuditLog";

function defaultFilter(): AuditLogFilter {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
        event_type: "all",
        actor_user_id: "",
        since: since.toISOString(),
        until: now.toISOString(),
        limit: 50,
        cursor: null,
    };
}

export default function AdminAuditPage() {
    const [filter, setFilter] = useState<AuditLogFilter>(() => defaultFilter());
    const [selectedEvent, setSelectedEvent] = useState<AuditLogResponseEvent | null>(
        null,
    );

    const { events, nextCursor, loading, error, refetch, loadMore } = useAuditLog(
        filter,
    );

    const eventCount = useMemo(() => events.length, [events]);

    return (
        <div className="flex h-full flex-col gap-4 overflow-auto p-6">
            <header className="flex items-baseline justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">
                        Audit log audytora
                    </h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Przeglad zdarzen audit_log z weryfikacja Merkle proof per event.
                        Payload zamaskowany server-side (tajemnica zawodowa, RODO).
                    </p>
                </div>
                <div className="text-sm text-gray-500">
                    {loading ? "Wczytuje..." : `Zaladowano ${eventCount} zdarzen`}
                </div>
            </header>

            <AuditFilterBar
                filter={filter}
                setFilter={setFilter}
                onApply={refetch}
                loading={loading}
            />

            <AuditEventsList
                events={events}
                nextCursor={nextCursor}
                loading={loading}
                error={error}
                onSelect={setSelectedEvent}
                onLoadMore={loadMore}
            />

            <AuditEventDetail
                event={selectedEvent}
                onClose={() => setSelectedEvent(null)}
            />
        </div>
    );
}
