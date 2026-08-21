// Gorny pas jest zarezerwowany na ZDARZENIE, nie na stan trwaly (ADR-0149,
// korekta WM 2026-08-21).
//
// Kluczowa rzecz, ktorej te testy pilnuja: zdjecie stalego ostrzezenia z gory
// NIE MOZE oznaczac, ze bramka, ktora cos zablokowala, przestaje krzyczec.
// Tryb bramki to konfiguracja (perymetr, zawsze widoczny), zablokowane
// narzedzie to wydarzenie (gora, glosno).

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpStatus } from "@/hooks/useMcpSecurityStatus";

const mcp = vi.hoisted(() => ({
    visible: true,
    status: null as McpStatus | null,
}));

vi.mock("@/hooks/useMcpSecurityStatus", () => ({
    useMcpSecurityStatus: () => ({
        visible: mcp.visible,
        status: mcp.status,
        error: null,
    }),
}));

import { McpSecurityBanner } from "./mcp-security-banner";

function status(
    mode: "disabled" | "audit" | "enforce",
    denied: number,
): McpStatus {
    return {
        gateway: {
            mode,
            active: mode === "enforce",
            last_startup_scan: null,
        } as McpStatus["gateway"],
        audit_summary_24h: {
            decisions_total: 12,
            by_action: { audit: 12 - denied, human_review: 0, denied },
        },
    };
}

describe("McpSecurityBanner - stan trwaly do perymetru, zdarzenie na gore", () => {
    beforeEach(() => {
        mcp.visible = true;
        mcp.status = null;
    });

    it("wylaczona bramka NIE zajmuje gory ekranu - to konfiguracja, nie zdarzenie", () => {
        mcp.status = status("disabled", 0);
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });

    it("bramka w trybie audit tez nie krzyczy z gory", () => {
        mcp.status = status("audit", 0);
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });

    it("bramka aktywna i czysta nie zajmuje gory", () => {
        mcp.status = status("enforce", 0);
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });

    it("FAKTYCZNA BLOKADA jest zdarzeniem - wraca na gore z liczba", () => {
        mcp.status = status("enforce", 3);
        render(<McpSecurityBanner />);
        const banner = screen.getByTestId("mcp-security-banner");
        expect(banner.textContent).toContain("3");
        expect(banner.getAttribute("href")).toBe("/admin/audit");
    });

    it("brak danych o bramce nie zmysla banera", () => {
        mcp.status = null;
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });
});
