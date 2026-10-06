// Testy pickera konektorow MCP (ADR-0133) - powierzchnia demo "wybor jurysdykcji".
// Siatka na regresje governance, ktorych kompilator nie pilnuje: konektor
// nie-toggleable (Ring 2 / operator-only) NIE moze byc przelaczony z UI, przelaczenie
// idzie do API z odwrocona wartoscia, a `restartRequired` z API pokazuje note.
// patronApi zamockowane - zero sieci.
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { t } from "@/i18n";
import type { ConnectorInfo } from "@/app/lib/patronApi";

const getConnectors = vi.fn();
const setConnectorEnabled = vi.fn();
const getConnectorGateway = vi.fn();
const approveConnectorGateway = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    getConnectors: (...a: unknown[]) => getConnectors(...a),
    setConnectorEnabled: (...a: unknown[]) => setConnectorEnabled(...a),
    getConnectorGateway: (...a: unknown[]) => getConnectorGateway(...a),
    approveConnectorGateway: (...a: unknown[]) => approveConnectorGateway(...a),
}));

import ConnectorsPage from "./page";

function conn(over: Partial<ConnectorInfo>): ConnectorInfo {
    return {
        name: "saos",
        enabled: true,
        ring: 1,
        toggleable: true,
        jurisdiction: "PL",
        ...over,
    };
}

beforeEach(() => {
    getConnectors.mockReset();
    setConnectorEnabled.mockReset();
    getConnectorGateway.mockReset();
    approveConnectorGateway.mockReset();
});

describe("ConnectorsPage - picker konektorow (ADR-0133)", () => {
    it("grupuje po jurysdykcji i pokazuje stan aria-pressed", async () => {
        getConnectors.mockResolvedValue([
            conn({ name: "saos", jurisdiction: "PL", enabled: true }),
            conn({ name: "eureka", jurisdiction: "PL", enabled: false }),
            conn({ name: "eu-sparql", jurisdiction: "EU", enabled: true }),
        ]);
        render(<ConnectorsPage />);
        await screen.findByText("saos");
        expect(screen.getByText(t("connectors.jurisdictionPL"))).toBeTruthy();
        expect(screen.getByText(t("connectors.jurisdictionEU"))).toBeTruthy();
        const buttons = screen.getAllByRole("button");
        expect(buttons).toHaveLength(3);
        const byName = (n: string) =>
            screen.getByText(n).closest("li")!.querySelector("button")!;
        expect(byName("saos").getAttribute("aria-pressed")).toBe("true");
        expect(byName("eureka").getAttribute("aria-pressed")).toBe("false");
    });

    it("konektor nie-toggleable (operator-only) ma disabled i NIE wola API po kliku", async () => {
        getConnectors.mockResolvedValue([
            conn({ name: "krs", toggleable: false, ring: 2, enabled: false }),
        ]);
        render(<ConnectorsPage />);
        await screen.findByText("krs");
        expect(screen.getByText(t("connectors.operatorOnly"))).toBeTruthy();
        const btn = screen.getByRole("button");
        expect((btn as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(btn);
        expect(setConnectorEnabled).not.toHaveBeenCalled();
    });

    it("klik na toggleable wysyla ODWROCONA wartosc, aktualizuje stan i pokazuje note o restarcie", async () => {
        getConnectors.mockResolvedValue([conn({ name: "saos", enabled: true })]);
        setConnectorEnabled.mockResolvedValue({
            connector: conn({ name: "saos", enabled: false }),
            restartRequired: true,
        });
        render(<ConnectorsPage />);
        await screen.findByText("saos");
        expect(screen.queryByText(t("connectors.restartNote"))).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole("button"));
        });
        expect(setConnectorEnabled).toHaveBeenCalledWith("saos", false);
        await waitFor(() =>
            expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false"),
        );
        expect(screen.getByText(t("connectors.restartNote"))).toBeTruthy();
    });

    it("blad API przy przelaczeniu -> komunikat, stan NIE zmieniony", async () => {
        getConnectors.mockResolvedValue([conn({ name: "saos", enabled: true })]);
        setConnectorEnabled.mockRejectedValue(new Error("500"));
        render(<ConnectorsPage />);
        await screen.findByText("saos");
        await act(async () => {
            fireEvent.click(screen.getByRole("button"));
        });
        await screen.findByText(t("connectors.toggleError"));
        expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    });

    it("blad ladowania listy -> komunikat, pusta lista -> empty state", async () => {
        getConnectors.mockRejectedValueOnce(new Error("down"));
        const { unmount } = render(<ConnectorsPage />);
        await screen.findByText(t("connectors.loadError"));
        unmount();
        getConnectors.mockResolvedValueOnce([]);
        render(<ConnectorsPage />);
        await screen.findByText(t("connectors.empty"));
    });

    it("B-08: konektor czekajacy na zatwierdzenie Operatora ma plakietke i wskazowke (nie 'atak')", async () => {
        getConnectors.mockResolvedValue([
            conn({ name: "repertorium", toggleable: false, ring: 2, jurisdiction: "OTHER", gateway: "awaiting_operator_approval" }),
            conn({ name: "saoss", toggleable: false, ring: 2, jurisdiction: "OTHER", gateway: "blocked" }),
            conn({ name: "vendor-x", toggleable: false, ring: 2, jurisdiction: "OTHER" }),
        ]);
        render(<ConnectorsPage />);
        await screen.findByText("repertorium");
        expect(screen.getByTestId("connector-gateway-repertorium").textContent).toBe(t("connectors.gatewayAwaiting"));
        expect(screen.getByText(t("connectors.gatewayAwaitingHint"))).toBeTruthy();
        expect(screen.getByTestId("connector-gateway-saoss").textContent).toBe(t("connectors.gatewayBlocked"));
        expect(screen.getByText(t("connectors.gatewayBlockedHint"))).toBeTruthy();
        // Bez stanu bramy - dotychczasowa wskazowka.
        expect(screen.queryByTestId("connector-gateway-vendor-x")).toBeNull();
        expect(screen.getByText(t("connectors.operatorOnlyHint"))).toBeTruthy();
    });

    const H = "a".repeat(64);
    const O = "b".repeat(64);
    const czekajacy = () =>
        conn({ name: "repertorium", toggleable: false, ring: 2, jurisdiction: "OTHER", gateway: "awaiting_operator_approval" });

    it("B-08: przycisk tylko przy konektorze czekajacym; zatwierdzenie odsyla hash i origin z przegladu", async () => {
        getConnectors.mockResolvedValue([
            czekajacy(),
            conn({ name: "saoss", toggleable: false, ring: 2, jurisdiction: "OTHER", gateway: "blocked" }),
        ]);
        getConnectorGateway.mockResolvedValue({
            gatewayAction: "human_review", approval: "missing", unknownThirdPartyOnly: true,
            hash: H, origin: O, findings: [],
        });
        approveConnectorGateway.mockResolvedValue({ ok: true, restartRequired: true, approvedAt: "x" });
        render(<ConnectorsPage />);
        await screen.findByText("repertorium");
        expect(screen.queryByTestId("connector-approve-saoss")).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByTestId("connector-approve-repertorium"));
        });
        expect(getConnectorGateway).toHaveBeenCalledWith("repertorium");
        await screen.findByText(t("connectors.approveUnknownOnly"));
        expect(screen.getByText(t("connectors.approveFingerprint").replace("{hash}", H.slice(0, 16)))).toBeTruthy();
        expect(approveConnectorGateway).not.toHaveBeenCalled(); // nic bez klikniecia "Zatwierdzam"
        await act(async () => {
            fireEvent.click(screen.getByTestId("connector-approve-confirm-repertorium"));
        });
        expect(approveConnectorGateway).toHaveBeenCalledWith("repertorium", { hash: H, origin: O });
        await screen.findByText(t("connectors.approveDone"));
        expect(screen.getByText(t("connectors.restartNote"))).toBeTruthy();
        expect(screen.queryByTestId("connector-approve-repertorium")).toBeNull();
    });

    it("B-08: zastrzezenia bramy sa pokazane; odmowa serwera (nieaktualna definicja) nie udaje sukcesu", async () => {
        getConnectors.mockResolvedValue([czekajacy()]);
        getConnectorGateway.mockResolvedValue({
            gatewayAction: "human_review", approval: "hash_mismatch", unknownThirdPartyOnly: false,
            hash: H, origin: O,
            findings: [{ detector: "drift", severity: "high", message: "zmienil sie opis narzedzia" }],
        });
        approveConnectorGateway.mockRejectedValue(
            new Error(JSON.stringify({ code: "stale_definition", detail: "Definicja zmienila sie" })),
        );
        render(<ConnectorsPage />);
        await screen.findByText("repertorium");
        await act(async () => {
            fireEvent.click(screen.getByTestId("connector-approve-repertorium"));
        });
        await screen.findByText("high: zmienil sie opis narzedzia");
        await act(async () => {
            fireEvent.click(screen.getByTestId("connector-approve-confirm-repertorium"));
        });
        await screen.findByText(t("connectors.approveError").replace("{detail}", "Definicja zmienila sie"));
        expect(screen.queryByText(t("connectors.approveDone"))).toBeNull();
        expect(screen.queryByText(t("connectors.restartNote"))).toBeNull();
    });

    it("B-08: brak roli Operatora -> czytelna odmowa", async () => {
        getConnectors.mockResolvedValue([czekajacy()]);
        getConnectorGateway.mockRejectedValue(new Error(JSON.stringify({ detail: "Admin role required" })));
        render(<ConnectorsPage />);
        await screen.findByText("repertorium");
        await act(async () => {
            fireEvent.click(screen.getByTestId("connector-approve-repertorium"));
        });
        await screen.findByText(t("connectors.approveForbidden"));
        expect(screen.queryByTestId("connector-approve-confirm-repertorium")).toBeNull();
    });
});
