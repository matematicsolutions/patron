"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/**
 * Klikalny naglowek kolumny z sortowaniem A-Z / Z-A (uwaga Piotrka 2026-06-03).
 * Wspoldzielony przez listy: WorkflowList, tabular-reviews, ProjectsOverview.
 * Klik w kolumne aktywna przelacza kierunek; klik w inna ustawia ja rosnaco.
 */
export function SortHeader({
    label,
    columnKey,
    activeKey,
    dir,
    onSort,
    className,
}: {
    label: string;
    columnKey: string;
    activeKey: string | null;
    dir: SortDir;
    onSort: (key: string) => void;
    className?: string;
}) {
    const active = activeKey === columnKey;
    return (
        <button
            type="button"
            onClick={() => onSort(columnKey)}
            aria-sort={
                active
                    ? dir === "asc"
                        ? "ascending"
                        : "descending"
                    : "none"
            }
            className={`group/sh inline-flex items-center gap-1 cursor-pointer select-none transition-colors hover:text-gray-700 ${
                active ? "text-gray-700" : "text-inherit"
            } ${className ?? ""}`}
        >
            <span className="truncate">{label}</span>
            {active ? (
                dir === "asc" ? (
                    <ChevronUp className="h-3 w-3 shrink-0" />
                ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                )
            ) : (
                <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/sh:opacity-40" />
            )}
        </button>
    );
}

/** Wartosc komorki do porownania - string sortowany lokalnie (numeric), liczba numerycznie. */
export type SortValue = string | number | null | undefined;

/**
 * Stabilne sortowanie kopii tablicy wg gettera. Puste/null ZAWSZE na koncu
 * (niezaleznie od kierunku). Brak activeKey = brak zmiany (kolejnosc wejsciowa).
 * Sort stosuj PO filtrach, na widocznej puli - zaznaczenia licz na tej samej puli.
 */
export function applySort<T>(
    rows: T[],
    activeKey: string | null,
    dir: SortDir,
    getValue: (row: T) => SortValue,
): T[] {
    if (!activeKey) return rows;
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const va = getValue(a);
        const vb = getValue(b);
        const aEmpty = va === null || va === undefined || va === "";
        const bEmpty = vb === null || vb === undefined || vb === "";
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        let c: number;
        if (typeof va === "number" && typeof vb === "number") {
            c = va - vb;
        } else {
            c = String(va).localeCompare(String(vb), undefined, {
                numeric: true,
                sensitivity: "base",
            });
        }
        return c * factor;
    });
}
