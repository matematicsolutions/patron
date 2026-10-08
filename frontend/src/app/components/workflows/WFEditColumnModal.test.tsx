// Ikona formatu kolumny w WFEditColumnModal (przeglad 2026-10-08): po zmianie na
// createElement (react-hooks/static-components) przycisk formatu nadal pokazuje ikone
// wlasciwa dla formatu kolumny - takze po zmianie kolumny. patronApi zamockowane.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnConfig } from "../shared/types";
import { FORMAT_OPTIONS } from "../tabular/columnFormat";

vi.mock("@/app/lib/patronApi", () => ({ generateTabularColumnPrompt: vi.fn() }));

import { WFEditColumnModal } from "./WFEditColumnModal";

const kolumna = (format: ColumnConfig["format"]): ColumnConfig =>
    ({ index: 0, name: "Kara umowna", prompt: "Jaka jest kara umowna?", format, tags: [] }) as ColumnConfig;

/** Klasa ikony lucide w przycisku formatu (np. "lucide-calendar"). */
function ikonaFormatu(): string | null {
    const etykiety = FORMAT_OPTIONS.map((o) => o.label);
    const span = [...document.querySelectorAll("button span")].find((s) =>
        etykiety.some((e) => s.textContent?.trim() === e));
    const svg = span?.querySelector("svg");
    return svg ? [...svg.classList].find((c) => c.startsWith("lucide-") && c !== "lucide-icon") ?? "" : null;
}

describe("WFEditColumnModal - ikona formatu", () => {
    it.each(FORMAT_OPTIONS.map((o) => o.value))("format %s ma ikone w przycisku formatu", (format) => {
        const { unmount } = render(
            <WFEditColumnModal column={kolumna(format)} onClose={() => {}} onSave={() => {}} onDelete={() => {}} />,
        );
        expect(ikonaFormatu()).toBeTruthy();
        unmount();
    });

    it("zmiana kolumny zmienia ikone (rozne formaty -> rozne ikony)", () => {
        const props = { onClose: () => {}, onSave: () => {}, onDelete: () => {} };
        const { rerender, unmount } = render(<WFEditColumnModal column={kolumna("date")} {...props} />);
        const przed = ikonaFormatu();
        rerender(<WFEditColumnModal column={kolumna("number")} {...props} />);
        const po = ikonaFormatu();
        expect(przed).toBeTruthy();
        expect(po).toBeTruthy();
        expect(po).not.toBe(przed);
        unmount();
    });
});
