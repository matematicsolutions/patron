// A-23: requireAuth w trybie SQLite (desktop) wpuszcza KAZDE zadanie jako lokalnego
// uzytkownika-admina, niezaleznie od adresu zrodlowego - jedyna ochrona jest bind
// 127.0.0.1, ktory nadpisuje zmienna PATRON_HOST (punkt otwarty z audytu 2026-06-02).
// Oczekiwane zachowanie: bez tokenu bypass obowiazuje tylko dla polaczen z loopback;
// zadanie z adresu LAN dostaje 401/403 i nie przechodzi do handlera.
import { describe, expect, it, vi } from "vitest";

process.env.PATRON_DB_BACKEND = "sqlite";

import { requireAuth } from "../src/middleware/auth";

function fakeRes() {
    const res = {
        locals: {} as Record<string, unknown>,
        statusCode: 200,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json: vi.fn(),
    };
    return res;
}

describe("A-23 - auth bypass SQLite ograniczony do loopback", () => {
    it("zadanie z adresu LAN 192.168.1.50 bez tokenu nie przechodzi", async () => {
        const req = {
            headers: { host: "192.168.1.10:3001" },
            socket: { remoteAddress: "192.168.1.50" },
            ip: "192.168.1.50",
        };
        const res = fakeRes();
        const next = vi.fn();
        await requireAuth(
            req as unknown as Parameters<typeof requireAuth>[0],
            res as unknown as Parameters<typeof requireAuth>[1],
            next,
        );
        expect(next).not.toHaveBeenCalled();
        expect([401, 403]).toContain(res.statusCode);
    });
});
