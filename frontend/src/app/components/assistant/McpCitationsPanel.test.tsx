// Testy powierzchni czatu "research + zrodla MCP" (ADR-0146): baner weryfikacji
// cytatow ze zrodel zewnetrznych i badge werdyktu na karcie zrodla. To jest ekran
// "AI, ktora wie, czego nie wie" - siatka pilnuje, ze:
//   - cytat red (podany jako doslowny, nieobecny w zrodlach) jest WIDOCZNY na
//     poziomie odpowiedzi z trescia cytatu, nigdy cicho,
//   - brak raportu / awaria groundingu = "nie zweryfikowano", nigdy zielono,
//   - karta bez werdyktu (stara wiadomosc) NIE dostaje badge'a (nie udajemy).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import type {
    PATRONMcpCitation,
    PATRONMcpGrounding,
    PATRONMcpQuoteResult,
} from "../shared/types";
import {
    McpCardGroundingBadge,
    McpCitationsPanel,
    McpGroundingBanner,
} from "./McpCitationsPanel";

function quote(over: Partial<PATRONMcpQuoteResult>): PATRONMcpQuoteResult {
    return {
        quote: "Sprzedaż nieruchomości nabytej w spadku po upływie trzech lat nie podlega opodatkowaniu",
        kind: "blockquote",
        verdict: "red",
        status: "NIEZWERYFIKOWANY",
        ratio: 1,
        ...over,
    };
}

function report(quotes: PATRONMcpQuoteResult[], over: Partial<PATRONMcpGrounding> = {}): PATRONMcpGrounding {
    return {
        quotes,
        summary: {
            quotes: quotes.length,
            green: quotes.filter((q) => q.verdict === "green").length,
            yellow: quotes.filter((q) => q.verdict === "yellow").length,
            red: quotes.filter((q) => q.verdict === "red").length,
            sources: 1,
            cards: 1,
        },
        ...over,
    };
}

function banner() {
    return screen.getByTestId("mcp-grounding-banner");
}

describe("McpGroundingBanner (ADR-0146)", () => {
    it("brak raportu przy obecnych kartach = 'nie zweryfikowano' (stan failed), nigdy cicho", () => {
        render(<McpGroundingBanner report={undefined} />);
        expect(banner().getAttribute("data-state")).toBe("failed");
        expect(screen.getByText(t("citations.mcpBannerFailed"))).toBeTruthy();
    });

    it("awaria groundingu (error) = ten sam jawny sygnal", () => {
        render(<McpGroundingBanner report={report([], { error: "grounding_failed" })} />);
        expect(banner().getAttribute("data-state")).toBe("failed");
    });

    it("cytat red: baner czerwony z TRESCIA cytatu i etykieta 'brak w zrodlach' + najblizsze zrodlo", () => {
        render(
            <McpGroundingBanner
                report={report([quote({ source: { server: "eureka", tool: "get_interpretation" } })])}
            />,
        );
        expect(banner().getAttribute("data-state")).toBe("red");
        expect(screen.getByText(t("citations.mcpBannerRed"))).toBeTruthy();
        expect(screen.getByText(/Sprzedaż nieruchomości nabytej w spadku/)).toBeTruthy();
        expect(screen.getByText(new RegExp(t("citations.mcpQuoteNotFound")))).toBeTruthy();
        expect(screen.getByText(new RegExp(`${t("citations.mcpClosestSource")}: eureka`))).toBeTruthy();
    });

    it("wiele cytatow red: liczba mnoga i lista wszystkich; dlugi cytat przyciety do 220 znakow", () => {
        const long = "x".repeat(300);
        render(
            <McpGroundingBanner
                report={report([quote({ quote: "pierwszy zmyślony cytat" }), quote({ quote: long })])}
            />,
        );
        expect(screen.getByText(t("citations.mcpBannerRedMany"))).toBeTruthy();
        expect(screen.getByText(/pierwszy zmyślony cytat/)).toBeTruthy();
        const items = banner().querySelectorAll("li");
        expect(items).toHaveLength(2);
        expect(items[1].textContent).toContain("x".repeat(220));
        expect(items[1].textContent).not.toContain("x".repeat(221));
    });

    it("zero cytatow do sprawdzenia = zolty 'nie porownano tresci' (nie zielony)", () => {
        render(<McpGroundingBanner report={report([])} />);
        expect(banner().getAttribute("data-state")).toBe("no-quotes");
        expect(screen.getByText(t("citations.mcpBannerNoQuotes"))).toBeTruthy();
    });

    it("wszystkie cytaty green = zielony baner", () => {
        render(
            <McpGroundingBanner
                report={report([quote({ verdict: "green", status: "ZWERYFIKOWANY", ratio: 0 })])}
            />,
        );
        expect(banner().getAttribute("data-state")).toBe("green");
        expect(screen.getByText(t("citations.mcpBannerAllGreen"))).toBeTruthy();
    });

    it("mieszanka green + yellow (bez red) = zolty baner z licznikami", () => {
        render(
            <McpGroundingBanner
                report={report([
                    quote({ verdict: "green", status: "ZWERYFIKOWANY", ratio: 0 }),
                    quote({ verdict: "yellow", status: "ZMODYFIKOWANY", ratio: 0.1 }),
                ])}
            />,
        );
        expect(banner().getAttribute("data-state")).toBe("yellow");
        expect(banner().textContent).toContain(`1 ${t("citations.mcpQuoteFound")}`);
        expect(banner().textContent).toContain(`1 ${t("citations.mcpQuoteModified")}`);
    });
});

describe("McpCardGroundingBadge (ADR-0146)", () => {
    it("brak werdyktu (stara wiadomosc) = brak badge'a", () => {
        render(<McpCardGroundingBadge grounding={undefined} />);
        expect(screen.queryByTestId("mcp-card-grounding")).toBeNull();
    });

    it.each([
        ["green", "quote_found", "citations.mcpCardGreen"],
        ["red", "quote_not_found", "citations.mcpCardRed"],
        ["yellow", "quote_modified", "citations.mcpCardYellowModified"],
        ["yellow", "no_source", "citations.mcpCardYellowNoSource"],
        ["yellow", "no_quote", "citations.mcpCardYellowNoQuote"],
    ] as const)("%s / %s -> etykieta %s", (verdict, reason, key) => {
        render(<McpCardGroundingBadge grounding={{ verdict, reason, matched: verdict === "green" ? 1 : 0 }} />);
        const el = screen.getByTestId("mcp-card-grounding");
        expect(el.getAttribute("data-verdict")).toBe(verdict);
        expect(el.textContent).toBe(t(key));
    });
});

describe("McpCitationsPanel - karty zrodel", () => {
    const cits: PATRONMcpCitation[] = [
        {
            source: "mcp",
            server: "eureka",
            tool: "get_interpretation",
            title: "0114-KDIP3-1.4011.844.2024.2.MS2",
            url: "https://eureka.mf.gov.pl/informacje/podglad/123",
            grounding: { verdict: "red", reason: "quote_not_found", matched: 0 },
        },
        {
            source: "mcp",
            server: "saos",
            tool: "search",
            title: "I CSK 1049/14",
            url: "https://www.saos.org.pl/judgments/1",
            grounding: { verdict: "yellow", reason: "no_quote", matched: 0 },
        },
        { source: "mcp", server: "saos", tool: "search", title: "III CZP 25/22 (bez werdyktu)" },
    ];

    it("grupuje po serwerze, kazda karta z linkiem do zrodla i badge'em wg werdyktu; karta bez werdyktu bez badge'a", () => {
        render(<McpCitationsPanel citations={cits} />);
        expect(screen.getByText(`${t("citations.saos")} (2)`)).toBeTruthy();
        const links = screen.getAllByRole("link");
        expect(links.map((l) => l.getAttribute("href"))).toEqual([
            "https://eureka.mf.gov.pl/informacje/podglad/123",
            "https://www.saos.org.pl/judgments/1",
        ]);
        expect(links.every((l) => l.getAttribute("rel")?.includes("noopener"))).toBe(true);
        const badges = screen.getAllByTestId("mcp-card-grounding");
        expect(badges.map((b) => b.getAttribute("data-verdict"))).toEqual(["red", "yellow"]);
        expect(screen.getByText("III CZP 25/22 (bez werdyktu)")).toBeTruthy();
    });
});
