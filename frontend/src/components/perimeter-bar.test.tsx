// Testy paska perymetru - powierzchni, ktora odpowiada na pytanie zadawane przez
// kazdego partnera w kancelarii: "czy to wyszlo z mojego komputera?".
//
// Siatka pilnuje jednej rzeczy ponad wszystkie inne: BRAK ODPOWIEDZI O
// KONFIGURACJI NIE JEST STANEM ZIELONYM. To ta sama zasada, co przy groundingu
// cytatu (ADR-0146) i ten sam mechanizm, ktory w innych miejscach zawiodl -
// awaria konczaca sie sukcesem. Pasek, ktory przy padnietym endpoincie
// pokazywalby "dane nie opuszczaja urzadzenia", bylby gorszy niz jego brak,
// bo klamalby o zgodnosci.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import type { EgressConfig } from "@/hooks/useEgressConfig";
import type { McpStatus } from "@/hooks/useMcpSecurityStatus";

const egress = vi.hoisted(() => ({ config: null as EgressConfig | null }));
const mcp = vi.hoisted(() => ({ status: null as McpStatus | null }));

vi.mock("@/hooks/useEgressConfig", () => ({
    useEgressConfig: () => ({ config: egress.config }),
}));
vi.mock("@/hooks/useMcpSecurityStatus", () => ({
    useMcpSecurityStatus: () => ({ visible: true, status: mcp.status, error: null }),
}));
vi.mock("@/app/hooks/useSelectedModel", () => ({
    useSelectedModel: () => ["gemini-2.5-pro", vi.fn()],
}));

import { PerimeterBar } from "./perimeter-bar";

function config(over: Partial<EgressConfig> = {}): EgressConfig {
    return {
        us_providers: { allowed: false },
        privileged_cloud: { allowed: false },
        local_model_configured: false,
        ...over,
    };
}

function status(denied: number): McpStatus {
    return {
        gateway: { mode: "enforce", active: true, last_startup_scan: null } as McpStatus["gateway"],
        audit_summary_24h: {
            decisions_total: 12,
            by_action: { audit: 12 - denied, human_review: 0, denied },
        },
    };
}

function bar(): HTMLElement {
    return screen.getByTestId("perimeter-bar");
}

describe("PerimeterBar - postawa perymetru", () => {
    beforeEach(() => {
        egress.config = null;
        mcp.status = null;
    });

    it("brak konfiguracji NIE awansuje na zielony - stan 'nie potwierdzam'", () => {
        egress.config = null;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("unknown");
        expect(bar().getAttribute("data-posture")).not.toBe("local");
        expect(screen.getByText(t("perimeter.unknown"))).toBeTruthy();
    });

    it("tryb czysto lokalny raportuje, ze dane nie opuszczaja urzadzenia", () => {
        egress.config = config();
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("local");
        expect(screen.getByText(t("perimeter.local"))).toBeTruthy();
    });

    it("dopuszczony model chmurowy dla tajemnicy jest widoczny, nie schowany", () => {
        egress.config = config({ privileged_cloud: { allowed: true } });
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud");
        expect(screen.getByText(t("perimeter.cloudPrivileged"))).toBeTruthy();
    });

    it("sami dostawcy z USA tez daja stan 'cloud', nie 'local'", () => {
        egress.config = config({ us_providers: { allowed: true } });
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud");
        expect(screen.getByText(t("perimeter.cloudUs"))).toBeTruthy();
    });

    it("pasek renderuje sie ZAWSZE - cisza nie jest informacja", () => {
        egress.config = null;
        mcp.status = null;
        render(<PerimeterBar />);
        // W przeciwienstwie do EgressConfigBanner, ktory znika gdy jest dobrze
        // (i tak samo znika, gdy padnie), ten element istnieje w kazdym stanie.
        expect(bar()).toBeTruthy();
    });

    it("zablokowane decyzje bramki MCP sa wypisane liczba, nie ukryte", () => {
        egress.config = config();
        mcp.status = status(3);
        render(<PerimeterBar />);
        expect(bar().textContent).toContain("3");
        expect(bar().textContent).toContain(t("perimeter.blocked"));
    });

    it("brak zablokowanych nie dokleja pustego ostrzezenia", () => {
        egress.config = config();
        mcp.status = status(0);
        render(<PerimeterBar />);
        expect(bar().textContent).not.toContain(t("perimeter.blocked"));
    });
});

describe("PerimeterBar - osiagalnosc akt", () => {
    beforeEach(() => {
        egress.config = config();
        mcp.status = status(0);
    });

    // Do 2026-08-21 do /admin/audit NIE PROWADZIL zaden link w calym UI - lancuch
    // skrotow, pieczec Merkle i eksport teczki dowodowej (ADR-0142) dalo sie
    // otworzyc wylacznie wpisujac adres recznie. Funkcja, ktorej nie da sie
    // znalezc, nie istnieje dla uzytkownika.
    it("licznik decyzji prowadzi do akt i dowodow", () => {
        render(<PerimeterBar />);
        const link = screen.getByTestId("perimeter-audit-link");
        expect(link.getAttribute("href")).toBe("/admin/audit");
    });

    it("bez danych bramki MCP nie zmyslamy linku", () => {
        mcp.status = null;
        render(<PerimeterBar />);
        expect(screen.queryByTestId("perimeter-audit-link")).toBeNull();
    });
});
