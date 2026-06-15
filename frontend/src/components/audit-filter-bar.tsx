// Filter bar dla viewera audytora (ADR-0046).
//
// Native HTML5 form + shadcn input/button. Zero nowych deps.

"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuditEventType, AuditLogFilter } from "@/hooks/useAuditLog";

const EVENT_TYPE_OPTIONS: Array<{ value: AuditEventType; label: string }> = [
    { value: "all", label: "Wszystkie" },
    { value: "chat.message.user", label: "Wiadomosc uzytkownika" },
    { value: "chat.message.assistant", label: "Odpowiedz asystenta" },
    { value: "input_security_scan", label: "Skan bezpieczenstwa wejscia" },
    { value: "mcp_security.gateway", label: "MCP Security Gateway" },
    { value: "ring_policy.decision", label: "Decyzja ring policy" },
    { value: "rodo.delete", label: "RODO usuniecie" },
    { value: "rodo.export", label: "RODO eksport" },
    { value: "admin.access.audit_viewer", label: "Admin: viewer" },
    { value: "admin.access.security_banner", label: "Admin: banner" },
    { value: "admin.access.metrics", label: "Admin: metrics" },
    { value: "migrate.rollback", label: "Migracja: rollback" },
];

export interface AuditFilterBarProps {
    filter: AuditLogFilter;
    setFilter: Dispatch<SetStateAction<AuditLogFilter>>;
    onApply: () => void;
    loading: boolean;
}

export function AuditFilterBar({
    filter,
    setFilter,
    onApply,
    loading,
}: AuditFilterBarProps) {
    return (
        <form
            className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm"
            onSubmit={(e) => {
                e.preventDefault();
                onApply();
            }}
        >
            <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700">Typ zdarzenia</span>
                <select
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={filter.event_type}
                    onChange={(e) =>
                        setFilter((f) => ({
                            ...f,
                            event_type: e.target.value as AuditEventType,
                        }))
                    }
                >
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700">UUID aktora</span>
                <Input
                    type="text"
                    placeholder="np. 12345678-1234-..."
                    value={filter.actor_user_id}
                    onChange={(e) =>
                        setFilter((f) => ({ ...f, actor_user_id: e.target.value }))
                    }
                    className="w-72"
                />
            </label>

            <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700">Od</span>
                <Input
                    type="datetime-local"
                    value={filter.since.slice(0, 16)}
                    onChange={(e) =>
                        setFilter((f) => ({
                            ...f,
                            since: new Date(e.target.value).toISOString(),
                        }))
                    }
                />
            </label>

            <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700">Do</span>
                <Input
                    type="datetime-local"
                    value={filter.until.slice(0, 16)}
                    onChange={(e) =>
                        setFilter((f) => ({
                            ...f,
                            until: new Date(e.target.value).toISOString(),
                        }))
                    }
                />
            </label>

            <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700">Limit</span>
                <select
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
                    value={filter.limit}
                    onChange={(e) =>
                        setFilter((f) => ({ ...f, limit: Number(e.target.value) }))
                    }
                >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                </select>
            </label>

            <Button type="submit" disabled={loading}>
                {loading ? "Wczytuje..." : "Zastosuj"}
            </Button>
        </form>
    );
}
