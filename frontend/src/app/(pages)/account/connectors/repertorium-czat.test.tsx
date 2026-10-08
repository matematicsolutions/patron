// ADR-0167: karta "Repertorium w czacie". Pilnujemy: (1) przed kliknieciem karta mowi,
// co wychodzi i jakie sa limity; (2) przelaczenie idzie do API z odwrocona wartoscia
// i pokazuje note o restarcie; (3) odmowa dla nie-Operatora jest nazwana;
// (4) poza edycja PL karty nie ma. patronApi zamockowane - zero sieci.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/i18n";
import type { ConnectorInfo } from "@/app/lib/patronApi";

const setRepertoriumChat = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    setRepertoriumChat: (...a: unknown[]) => setRepertoriumChat(...a),
}));

import { RepertoriumCzat } from "./repertorium-czat";

const repertorium = (chatTools?: boolean): ConnectorInfo => ({
    name: "repertorium",
    enabled: true,
    ring: 2,
    toggleable: false,
    jurisdiction: "OTHER" as ConnectorInfo["jurisdiction"],
    ...(chatTools !== undefined && { chatTools }),
});

beforeEach(() => {
    setRepertoriumChat.mockReset();
    setLocale("pl");
});
afterEach(() => setLocale("pl"));

describe("RepertoriumCzat (ADR-0167)", () => {
    it("przed kliknieciem: co wychodzi i limity; wlaczenie wola API z true i zglasza restart", async () => {
        const onRestart = vi.fn();
        setRepertoriumChat.mockResolvedValue({ enabled: true, keyIssued: true, restartRequired: true });
        render(<RepertoriumCzat connectors={[]} onRestartRequired={onRestart} />);
        expect(screen.getByText(t("connectors.repertoriumBody"))).toBeTruthy();
        expect(screen.getByText(t("connectors.repertoriumLimits"))).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: t("connectors.repertoriumEnable") }));
        await screen.findByText(t("connectors.repertoriumOn"));
        expect(setRepertoriumChat).toHaveBeenCalledWith(true);
        expect(onRestart).toHaveBeenCalled();
        expect(screen.getByRole("button", { name: t("connectors.repertoriumDisable") })).toBeTruthy();
    });

    it("stan z listy: wlaczone -> przycisk wylacza (API z false)", async () => {
        setRepertoriumChat.mockResolvedValue({ enabled: false, keyIssued: false, restartRequired: true });
        render(<RepertoriumCzat connectors={[repertorium(true)]} onRestartRequired={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: t("connectors.repertoriumDisable") }));
        await screen.findByText(t("connectors.repertoriumOff"));
        expect(setRepertoriumChat).toHaveBeenCalledWith(false);
    });

    it("nie-Operator: nazwana odmowa, stan bez zmian", async () => {
        setRepertoriumChat.mockRejectedValue(new Error(JSON.stringify({ detail: "Admin role required" })));
        render(<RepertoriumCzat connectors={[]} onRestartRequired={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: t("connectors.repertoriumEnable") }));
        await screen.findByText(t("connectors.approveForbidden"));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: t("connectors.repertoriumEnable") })).toBeTruthy());
    });

    it("edycja inna niz PL: karty nie ma", () => {
        setLocale("en");
        const { container } = render(<RepertoriumCzat connectors={[]} onRestartRequired={() => {}} />);
        expect(container.innerHTML).toBe("");
    });
});
