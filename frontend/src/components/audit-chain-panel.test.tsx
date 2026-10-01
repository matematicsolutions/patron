// Panel spojnosci lancucha (ADR-0165) na atrapie backendu. Sprawdzamy: trojstan
// trafia na ekran, potwierdzenie wymaga DWOCH klikniec i wysyla digest z podgladu,
// odmowa "stale" ma swoj komunikat, a blad sieci jest widoczny - nie pusty panel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { AuditChainPanel, type ChainStatus } from "./audit-chain-panel";

const DIGEST = "a".repeat(64);

function status(over: Partial<ChainStatus["report"]> = {}, pending = true): ChainStatus {
    return {
        report: {
            verdict: "uwagi",
            rows: 6,
            mainChain: 5,
            sideRows: 1,
            forkPoints: 1,
            guardAfterId: 6,
            findings: [{ kind: "fork_concurrent", severity: "uwagi", ids: [4, 5], detail: "x" }],
            ...over,
        },
        guardKnown: true,
        pending: pending ? { digest: DIGEST, forks: [{ parentId: 3, siblingIds: [4, 5] }] } : null,
        checkedAt: "2026-01-15T10:00:00.000Z",
    };
}

function json(body: unknown, statusCode = 200): Response {
    return new Response(JSON.stringify(body), {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
    });
}

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("AuditChainPanel", () => {
    it("pokazuje werdykt, znaleziska z numerami wpisow i liste do potwierdzenia", async () => {
        fetchMock.mockResolvedValueOnce(json(status()));
        render(<AuditChainPanel />);
        expect(await screen.findByText(t("audit.chain.verdictUwagi"))).toBeTruthy();
        expect(screen.getByText(t("audit.chain.kind.fork_concurrent"))).toBeTruthy();
        expect(screen.getByText(/4, 5/, { selector: "li" })).toBeTruthy();
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/audit\/chain$/);
    });

    it("potwierdzenie: pierwszy klik tylko pyta, drugi wysyla digest z podgladu", async () => {
        fetchMock
            .mockResolvedValueOnce(json(status()))
            .mockResolvedValueOnce(json(status({ verdict: "ok", findings: [] }, false)));
        render(<AuditChainPanel />);
        fireEvent.click(await screen.findByText(t("audit.chain.acknowledge")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText(t("audit.chain.confirmBody"))).toBeTruthy();

        fireEvent.click(screen.getByText(t("audit.chain.confirmYes")));
        await waitFor(() => expect(screen.getByText(t("audit.chain.verdictOk"))).toBeTruthy());
        const [url, init] = fetchMock.mock.calls[1];
        expect(String(url)).toMatch(/\/api\/audit\/chain\/acknowledge$/);
        expect((init as RequestInit).method).toBe("POST");
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ digest: DIGEST });
        expect(screen.getByText(t("audit.chain.saved"))).toBeTruthy();
    });

    it("anuluj nie wysyla niczego", async () => {
        fetchMock.mockResolvedValueOnce(json(status()));
        render(<AuditChainPanel />);
        fireEvent.click(await screen.findByText(t("audit.chain.acknowledge")));
        fireEvent.click(screen.getByText(t("audit.chain.cancel")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText(t("audit.chain.acknowledge"))).toBeTruthy();
    });

    it("odmowa stale (409): komunikat i stan z odpowiedzi", async () => {
        fetchMock
            .mockResolvedValueOnce(json(status()))
            .mockResolvedValueOnce(json({ error: "stale", status: status() }, 409));
        render(<AuditChainPanel />);
        fireEvent.click(await screen.findByText(t("audit.chain.acknowledge")));
        fireEvent.click(screen.getByText(t("audit.chain.confirmYes")));
        expect(await screen.findByText(t("audit.chain.errorStale"))).toBeTruthy();
        expect(screen.queryByText(t("audit.chain.saved"))).toBeNull();
    });

    it("BLOKADA: wyrazny werdykt i brak przycisku potwierdzenia", async () => {
        fetchMock.mockResolvedValueOnce(
            json(
                status(
                    {
                        verdict: "blokada",
                        findings: [{ kind: "ack_missing", severity: "blokada", ids: [7, 4], detail: "x" }],
                    },
                    false,
                ),
            ),
        );
        render(<AuditChainPanel />);
        expect(await screen.findByText(t("audit.chain.verdictBlokada"))).toBeTruthy();
        expect(screen.getByText(t("audit.chain.kind.ack_missing"))).toBeTruthy();
        expect(screen.queryByText(t("audit.chain.acknowledge"))).toBeNull();
    });

    it("blad sieci to widoczny komunikat, nie pusty panel", async () => {
        fetchMock.mockRejectedValueOnce(new Error("offline"));
        render(<AuditChainPanel />);
        expect((await screen.findByRole("alert")).textContent).toContain("offline");
        expect(screen.queryByTestId("chain-verdict")).toBeNull();
    });

    it("403: komunikat o roli administratora", async () => {
        fetchMock.mockResolvedValueOnce(json({ detail: "Admin role required" }, 403));
        render(<AuditChainPanel />);
        expect(await screen.findByText(t("audit.chain.errorForbidden"))).toBeTruthy();
    });
});

describe("etykiety rodzajow znalezisk", () => {
    // Bramka miedzy pakietami: kazdy rodzaj z unii ChainFindingKind w backendzie ma
    // etykiete w slowniku. Bez niej panel pokazalby mecenasowi surowy klucz. Unia
    // rosnie przy scalaniu linii (ADR-0164: zerwania z mocy prawa) - test to wymusi.
    const zrodlo = readFileSync(
        join(__dirname, "..", "..", "..", "backend", "src", "lib", "audit-chain-verify.ts"),
        "utf8",
    );
    const unia = /export type ChainFindingKind =([\s\S]*?);/.exec(zrodlo)?.[1] ?? "";
    const rodzaje = [...unia.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    it("unia jest czytelna (kontrola pozytywna - pusta lista nie jest sukcesem)", () => {
        expect(rodzaje.length).toBeGreaterThanOrEqual(12);
        expect(rodzaje).toContain("fork_acknowledged");
    });

    it.each(rodzaje)("%s ma etykiete PL", (rodzaj) => {
        const klucz = `audit.chain.kind.${rodzaj}`;
        expect(t(klucz as Parameters<typeof t>[0])).not.toBe(klucz);
    });
});
