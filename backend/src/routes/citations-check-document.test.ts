// POST /api/citations/check-document (ADR-0157), R-CC-03: blad w async handlerze
// Express 4 nie moze konczyc procesu ani wisiec - odpowiedz to jawne "failed".
// Zaleznosci (baza, dostep, odczyt pisma, konektor) zamockowane; zero sieci.

import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { odczyt, weryfikator, stanWeryfikatora } = vi.hoisted(() => ({
    odczyt: vi.fn(),
    weryfikator: vi.fn(),
    stanWeryfikatora: {
        podlaczony: true,
        oczekuje: null as null | { server: string; hash: string; origin: string; reason: string },
    },
}));

vi.mock("../middleware/auth", () => ({
    requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
        res.locals.userId = "u1";
        next();
    },
}));
vi.mock("../lib/supabase", () => ({
    createServerSupabase: () => ({
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: { id: "d1", filename: "pismo.docx", file_type: "docx", user_id: "u1", project_id: null },
                    }),
                }),
            }),
        }),
    }),
}));
vi.mock("../lib/access", () => ({
    checkProjectAccess: async () => ({ ok: true }),
    ensureDocAccess: async () => ({ ok: true }),
}));
vi.mock("../lib/documentVersions", () => ({
    attachActiveVersionPaths: async (_db: unknown, rows: Array<{ storage_path?: string }>) => {
        rows[0].storage_path = "u1/d1/pismo.docx";
    },
}));
vi.mock("../lib/chat/tool-dispatch", () => ({
    getDocumentTextForGrounding: (...a: unknown[]) => odczyt(...a),
}));
vi.mock("../lib/citation-check/connector", () => ({
    resolveVerifyToolCall: async () => (stanWeryfikatora.podlaczony ? weryfikator : null),
    verifierPendingApproval: () => stanWeryfikatora.oczekuje,
    verifierServerName: () => "repertorium",
}));

let server: http.Server;
let base = "";

beforeAll(async () => {
    const express = (await import("express")).default;
    const { citationsRouter } = await import("./citations");
    const app = express();
    app.use(express.json());
    app.use("/api/citations", citationsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
    server?.close();
});

beforeEach(() => {
    odczyt.mockReset();
    weryfikator.mockReset();
    stanWeryfikatora.podlaczony = true;
    stanWeryfikatora.oczekuje = null;
});

const sprawdz = () =>
    fetch(`${base}/api/citations/check-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: "d1" }),
    });

describe("POST /check-document - bledy nie konca procesu", () => {
    it("znieksztalcona odpowiedz weryfikatora = 200 z status failed", async () => {
        odczyt.mockResolvedValue("Podstawa: art. 471 k.c.");
        weryfikator.mockResolvedValue({ text: JSON.stringify({ result: { citations: [null], rejected: 5 } }) });
        const res = await sprawdz();
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; failedCalls: number };
        expect(body.status).toBe("failed");
        expect(body.failedCalls).toBe(1);
    });

    it("wyjatek w trasie = 500 z status failed, bez tresci bledu; serwer zyje dalej", async () => {
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        odczyt.mockRejectedValue(new Error("ENOENT /dane/u1/d1/Pozew Jan Testowy.docx"));
        const res = await sprawdz();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ status: "failed", detail: "Citation check failed" });
        const log = JSON.stringify(errSpy.mock.calls);
        errSpy.mockRestore();
        expect(log).not.toContain("Jan Testowy");

        odczyt.mockResolvedValue("Podstawa: art. 471 k.c.");
        weryfikator.mockResolvedValue({ text: JSON.stringify({ result: { citations: [] } }) });
        expect((await sprawdz()).status).toBe(200);
    });
});

describe("POST /check-document - weryfikator czeka na zatwierdzenie Operatora (B-08)", () => {
    it("gateway_pending z wartosciami do wpisania; nic nie wyszlo do sieci", async () => {
        odczyt.mockResolvedValue("Podstawa: art. 471 k.c. oraz wyrok SN z dnia 12 marca 2024 r., II CSKP 1/24.");
        stanWeryfikatora.podlaczony = false;
        stanWeryfikatora.oczekuje = {
            server: "repertorium",
            hash: "a".repeat(64),
            origin: "b".repeat(64),
            reason: "missing",
        };
        const res = await sprawdz();
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            status: string;
            sent: unknown[];
            citations: unknown[];
            gatewayApproval?: { server: string; hash: string; origin: string; reason: string };
        };
        expect(body.status).toBe("gateway_pending");
        expect(body.sent).toEqual([]);
        expect(body.citations.length).toBeGreaterThan(0);
        expect(body.gatewayApproval).toEqual({
            server: "repertorium",
            hash: "a".repeat(64),
            origin: "b".repeat(64),
            reason: "missing",
        });
        expect(weryfikator).not.toHaveBeenCalled();
    });

    it("brak konektora (nie czeka na zatwierdzenie) = not_configured, bez pola gatewayApproval", async () => {
        odczyt.mockResolvedValue("Podstawa: art. 471 k.c.");
        stanWeryfikatora.podlaczony = false;
        const body = (await (await sprawdz()).json()) as { status: string; gatewayApproval?: unknown };
        expect(body.status).toBe("not_configured");
        expect(body.gatewayApproval).toBeUndefined();
    });
});
