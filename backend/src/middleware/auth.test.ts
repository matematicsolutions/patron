// Testy pure helpers admin RBAC (ADR-0034).
//
// requireAdmin middleware nie ma testu integracyjnego w tym pliku - wymaga
// supertest + mock Express (rezerwacja ADR-0042 framework testow integracyjnych).
// Tu sprawdzamy tylko `parseAdminEmails` i `isAdminEmail` jako pure functions.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
    isAdminEmail,
    isLoopbackAddress,
    parseAdminEmails,
    requireAdmin,
    requireAuth,
} from "./auth";

describe("parseAdminEmails", () => {
    it("zwraca pusty Set dla undefined / pustego stringa", () => {
        expect(parseAdminEmails(undefined).size).toBe(0);
        expect(parseAdminEmails("").size).toBe(0);
    });

    it("parsuje pojedynczy email", () => {
        const admins = parseAdminEmails("admin@kancelaria.pl");
        expect(admins.has("admin@kancelaria.pl")).toBe(true);
        expect(admins.size).toBe(1);
    });

    it("parsuje CSV - 3 emaile", () => {
        const admins = parseAdminEmails(
            "admin@k.pl,wspolnik@k.pl,it@k.pl",
        );
        expect(admins.size).toBe(3);
        expect(admins.has("wspolnik@k.pl")).toBe(true);
    });

    it("trimuje spacje wokol kazdego wpisu", () => {
        const admins = parseAdminEmails(
            "  admin@k.pl , wspolnik@k.pl ,  it@k.pl  ",
        );
        expect(admins.has("admin@k.pl")).toBe(true);
        expect(admins.has("wspolnik@k.pl")).toBe(true);
        expect(admins.has("it@k.pl")).toBe(true);
    });

    it("lowercase wszystkich emaili (case-insensitive match)", () => {
        const admins = parseAdminEmails("Admin@Kancelaria.PL,IT@K.pl");
        expect(admins.has("admin@kancelaria.pl")).toBe(true);
        expect(admins.has("it@k.pl")).toBe(true);
        expect(admins.has("Admin@Kancelaria.PL")).toBe(false);
    });

    it("odrzuca puste wpisy z CSV (',,admin@k.pl,,')", () => {
        const admins = parseAdminEmails(",,admin@k.pl,,");
        expect(admins.size).toBe(1);
        expect(admins.has("admin@k.pl")).toBe(true);
    });

    it("duplikaty traktowane jako jeden wpis (Set semantyka)", () => {
        const admins = parseAdminEmails("admin@k.pl,admin@k.pl,Admin@K.PL");
        expect(admins.size).toBe(1);
    });
});

describe("isAdminEmail", () => {
    const fixtureAdmins = new Set([
        "admin@kancelaria.pl",
        "wspolnik@kancelaria.pl",
    ]);

    it("zwraca true dla emaila z whitelist", () => {
        expect(isAdminEmail("admin@kancelaria.pl", fixtureAdmins)).toBe(true);
    });

    it("zwraca true dla emaila z whitelist case-insensitive", () => {
        expect(isAdminEmail("Admin@Kancelaria.PL", fixtureAdmins)).toBe(true);
        expect(isAdminEmail("WSPOLNIK@KANCELARIA.PL", fixtureAdmins)).toBe(true);
    });

    it("trimuje spacje przed match", () => {
        expect(isAdminEmail("  admin@kancelaria.pl  ", fixtureAdmins)).toBe(true);
    });

    it("zwraca false dla emaila spoza whitelist", () => {
        expect(isAdminEmail("intern@kancelaria.pl", fixtureAdmins)).toBe(false);
    });

    it("zwraca false dla pustego stringa", () => {
        expect(isAdminEmail("", fixtureAdmins)).toBe(false);
    });

    it("zwraca false gdy whitelist pusta (Set())", () => {
        expect(isAdminEmail("admin@kancelaria.pl", new Set())).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Audyt 2026-09, A-23: bypass SQLite tylko dla loopback.
// ---------------------------------------------------------------------------

describe("isLoopbackAddress", () => {
    it("127.0.0.0/8, ::1, IPv4-mapped", () => {
        for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"]) {
            expect(isLoopbackAddress(a)).toBe(true);
        }
    });

    it("LAN, publiczne, puste i podrobki: false", () => {
        for (const a of [
            undefined,
            null,
            "",
            "192.168.1.50",
            "10.0.0.1",
            "172.17.0.1",
            "::ffff:192.168.1.50",
            "0.0.0.0",
            "128.0.0.1",
            "127.0.0.1.atakujacy.example",
            "127.0.0.999",
            "localhost",
        ]) {
            expect(isLoopbackAddress(a)).toBe(false);
        }
    });
});

describe("requireAuth / requireAdmin w trybie SQLite (A-23)", () => {
    function fakeRes() {
        return {
            locals: {} as Record<string, unknown>,
            statusCode: 200,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json: vi.fn(),
        };
    }

    function call(
        mw: typeof requireAuth | typeof requireAdmin,
        remoteAddress: string | undefined,
        extra: Record<string, unknown> = {},
    ) {
        const req = {
            method: "GET",
            path: "/projects",
            headers: {},
            socket: { remoteAddress },
            ...extra,
        };
        const res = fakeRes();
        const next = vi.fn();
        return Promise.resolve(
            mw(req as never, res as never, next),
        ).then(() => ({ res, next }));
    }

    const saved = {
        db: process.env.PATRON_DB_BACKEND,
        trust: process.env.PATRON_SQLITE_TRUST_NETWORK,
    };
    beforeEach(() => {
        process.env.PATRON_DB_BACKEND = "sqlite";
        delete process.env.PATRON_SQLITE_TRUST_NETWORK;
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        if (saved.db === undefined) delete process.env.PATRON_DB_BACKEND;
        else process.env.PATRON_DB_BACKEND = saved.db;
        if (saved.trust === undefined) delete process.env.PATRON_SQLITE_TRUST_NETWORK;
        else process.env.PATRON_SQLITE_TRUST_NETWORK = saved.trust;
        vi.restoreAllMocks();
    });

    it("loopback: lokalny uzytkownik, next()", async () => {
        const { res, next } = await call(requireAuth, "127.0.0.1");
        expect(next).toHaveBeenCalledOnce();
        expect(res.locals.userId).toBeTruthy();
    });

    it("IPv6 loopback i IPv4-mapped: next()", async () => {
        expect((await call(requireAuth, "::1")).next).toHaveBeenCalledOnce();
        expect((await call(requireAuth, "::ffff:127.0.0.1")).next).toHaveBeenCalledOnce();
    });

    it("adres LAN: 401, handler nie rusza", async () => {
        const { res, next } = await call(requireAuth, "192.168.1.50");
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.locals.userId).toBeUndefined();
    });

    it("brak adresu gniazda: 401 (fail-closed)", async () => {
        const { res, next } = await call(requireAuth, undefined);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it("X-Forwarded-For / req.ip = 127.0.0.1 nie podrabia loopback", async () => {
        const { res, next } = await call(requireAuth, "192.168.1.50", {
            ip: "127.0.0.1",
            headers: { "x-forwarded-for": "127.0.0.1" },
        });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it("PATRON_SQLITE_TRUST_NETWORK=true: jawna furtka operatora wpuszcza LAN", async () => {
        process.env.PATRON_SQLITE_TRUST_NETWORK = "true";
        expect((await call(requireAuth, "192.168.1.50")).next).toHaveBeenCalledOnce();
    });

    it("furtka tylko dla dokladnie 'true'", async () => {
        process.env.PATRON_SQLITE_TRUST_NETWORK = "1";
        expect((await call(requireAuth, "192.168.1.50")).next).not.toHaveBeenCalled();
    });

    it("requireAdmin trzyma te sama granice", async () => {
        expect((await call(requireAdmin, "192.168.1.50")).next).not.toHaveBeenCalled();
        expect((await call(requireAdmin, "127.0.0.1")).next).toHaveBeenCalledOnce();
    });
});
