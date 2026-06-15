// Testy pure helpers admin RBAC (ADR-0034).
//
// requireAdmin middleware nie ma testu integracyjnego w tym pliku - wymaga
// supertest + mock Express (rezerwacja ADR-0042 framework testow integracyjnych).
// Tu sprawdzamy tylko `parseAdminEmails` i `isAdminEmail` jako pure functions.

import { describe, it, expect } from "vitest";
import { parseAdminEmails, isAdminEmail } from "./auth";

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
