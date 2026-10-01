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

// Podmieniamy TYLKO hook; blockedGatewayDecisions zostaje prawdziwe - test ma
// mierzyc te sama regule liczenia blokad co produkcja.
vi.mock("@/hooks/useMcpSecurityStatus", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/hooks/useMcpSecurityStatus")>()),
    useMcpSecurityStatus: () => ({
        visible: mcp.visible,
        status: mcp.status,
        error: null,
    }),
}));

import { McpSecurityBanner } from "./mcp-security-banner";

function status(denied: number, humanReview = 0): McpStatus {
    return {
        gateway: {
            mode: "enforce",
            active: true,
            last_startup_scan: null,
        } as McpStatus["gateway"],
        audit_summary_24h: {
            decisions_total: 12,
            by_action: { audit: 12 - denied - humanReview, human_review: humanReview, denied },
        },
    };
}

describe("McpSecurityBanner - stan trwaly do perymetru, zdarzenie na gore", () => {
    beforeEach(() => {
        mcp.visible = true;
        mcp.status = null;
    });

    it("bramka bez blokad nie zajmuje gory ekranu - to stan, nie zdarzenie", () => {
        mcp.status = status(0);
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });

    it("FAKTYCZNA BLOKADA (denied) jest zdarzeniem - wraca na gore z liczba", () => {
        mcp.status = status(3);
        render(<McpSecurityBanner />);
        const banner = screen.getByTestId("mcp-security-banner");
        expect(banner.textContent).toContain("3");
        expect(banner.getAttribute("href")).toBe("/admin/audit");
    });

    it("human_review bez zatwierdzenia to tez blokada - dryf i podmiana plikow konektora (ADR-0159/0162)", () => {
        mcp.status = status(0, 2);
        render(<McpSecurityBanner />);
        expect(screen.getByTestId("mcp-security-banner").textContent).toContain("2");
    });

    it("liczba to suma denied i human_review", () => {
        mcp.status = status(1, 2);
        render(<McpSecurityBanner />);
        expect(screen.getByTestId("mcp-security-banner").textContent).toContain("3");
    });

    it("komunikat nie zostawia surowego placeholdera", () => {
        mcp.status = status(1);
        render(<McpSecurityBanner />);
        expect(screen.getByTestId("mcp-security-banner").textContent).not.toContain("{");
    });

    it("brak danych o bramce nie zmysla banera", () => {
        mcp.status = null;
        render(<McpSecurityBanner />);
        expect(screen.queryByTestId("mcp-security-banner")).toBeNull();
    });
});
