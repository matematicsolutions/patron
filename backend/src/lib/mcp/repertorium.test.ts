// ADR-0167: przelacznik "Repertorium w czacie" - pobranie klucza instalacji i zapis
// do nakladki Operatora. Zero sieci (fetch podstawiony), dane syntetyczne.
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { writeRepertoriumToOverlay } from "./operator-overlay";
import { pobierzKluczPatrona, przelaczRepertoriumWCzacie, REPERTORIUM_ADRES } from "./repertorium";

const KLUCZ = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const MCP = `${REPERTORIUM_ADRES}/mcp/${KLUCZ}`;

function nakladka(zawartosc?: unknown[]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repertorium-czat-"));
    const p = path.join(dir, "mcp-servers.operator.json");
    if (zawartosc) fs.writeFileSync(p, JSON.stringify(zawartosc));
    return p;
}
const czytaj = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>[];
const pl = () => "pl";

describe("przelaczRepertoriumWCzacie", () => {
    it("edycja inna niz PL: 404 i zero wywolan Repertorium", async () => {
        const pobierzKlucz = vi.fn();
        const w = await przelaczRepertoriumWCzacie(true, {
            pobierzKlucz, overlayPath: nakladka(), konfiguracje: () => [], locale: () => "en",
        });
        expect(w).toMatchObject({ ok: false, status: 404 });
        expect(pobierzKlucz).not.toHaveBeenCalled();
    });

    it("wlaczenie bez wpisu: jeden klucz, wpis z adresem i chatTools; odpowiedz bez klucza", async () => {
        const p = nakladka();
        const pobierzKlucz = vi.fn(async () => ({ ok: true as const, mcp: MCP }));
        const w = await przelaczRepertoriumWCzacie(true, {
            pobierzKlucz, overlayPath: p, konfiguracje: () => [], locale: pl,
        });
        expect(w).toEqual({ ok: true, enabled: true, kluczWydany: true });
        expect(JSON.stringify(w)).not.toContain(KLUCZ);
        expect(pobierzKlucz).toHaveBeenCalledTimes(1);
        expect(czytaj(p)).toEqual([
            { name: "repertorium", enabled: true, chatTools: true, transport: "http", url: MCP },
        ]);
    });

    it("wlaczenie przy istniejacym adresie: bez nowego klucza, zatwierdzenie bramy nietkniete", async () => {
        const zatw = { hash: "a".repeat(64), origin: "b".repeat(64), approvedAt: "2026-10-01", approvedBy: "op" };
        const p = nakladka([{ name: "repertorium", transport: "http", url: MCP, gatewayApproval: zatw }]);
        const pobierzKlucz = vi.fn();
        const w = await przelaczRepertoriumWCzacie(true, {
            pobierzKlucz, overlayPath: p, konfiguracje: () => [{ name: "repertorium", url: MCP }], locale: pl,
        });
        expect(w).toEqual({ ok: true, enabled: true, kluczWydany: false });
        expect(pobierzKlucz).not.toHaveBeenCalled();
        expect(czytaj(p)[0]).toMatchObject({ url: MCP, chatTools: true, enabled: true, gatewayApproval: zatw });
    });

    it("wylaczenie: chatTools false, konektor zostaje dla przycisku", async () => {
        const p = nakladka([{ name: "repertorium", transport: "http", url: MCP, chatTools: true }]);
        const w = await przelaczRepertoriumWCzacie(false, {
            overlayPath: p, konfiguracje: () => [{ name: "repertorium", url: MCP }], locale: pl,
        });
        expect(w).toEqual({ ok: true, enabled: false, kluczWydany: false });
        expect(czytaj(p)[0]).toMatchObject({ url: MCP, chatTools: false, enabled: true });
    });

    it("wylaczenie bez wpisu: nakladka nie powstaje", async () => {
        const p = nakladka();
        const w = await przelaczRepertoriumWCzacie(false, { overlayPath: p, konfiguracje: () => [], locale: pl });
        expect(w).toMatchObject({ ok: true, enabled: false });
        expect(fs.existsSync(p)).toBe(false);
    });

    it("odmowa Repertorium (limit wydan): 429 z przyczyna, nic nie zapisane", async () => {
        const p = nakladka();
        const w = await przelaczRepertoriumWCzacie(true, {
            pobierzKlucz: async () => ({ ok: false, status: 429, powod: "issuance_address_capped",
                szczegol: "Z tego adresu wydano juz 3 klucze.", retryAfterS: 3600 }),
            overlayPath: p, konfiguracje: () => [], locale: pl,
        });
        expect(w).toMatchObject({ ok: false, status: 429, powod: "issuance_address_capped", retryAfterS: 3600 });
        expect(fs.existsSync(p)).toBe(false);
    });
});

describe("pobierzKluczPatrona", () => {
    const odp = (status: number, cialo: unknown) =>
        (async () => new Response(JSON.stringify(cialo), { status })) as unknown as typeof fetch;

    it("sukces: adres MCP Repertorium", async () => {
        const fetchMock = vi.fn(odp(200, { token: KLUCZ, mcp: MCP }));
        const w = await pobierzKluczPatrona(fetchMock as unknown as typeof fetch);
        expect(w).toEqual({ ok: true, mcp: MCP });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${REPERTORIUM_ADRES}/wydaj-patron`);
        expect(init.method).toBe("POST");
        expect(init.body).toBe("{}");
    });

    it("adres konektora spoza Repertorium: odrzucony", async () => {
        const w = await pobierzKluczPatrona(odp(200, { mcp: `https://evil.example/mcp/${KLUCZ}` }));
        expect(w).toMatchObject({ ok: false, powod: "issuance_bad_response" });
    });

    it("odmowa HTTP: powod i retry_after_s z ciala Repertorium", async () => {
        const w = await pobierzKluczPatrona(odp(429, {
            error: "issuance_capped", detail: "Wyczerpany sufit.", retryable: false, retry_after_s: 120,
        }));
        expect(w).toEqual({ ok: false, status: 429, powod: "issuance_capped", szczegol: "Wyczerpany sufit.",
                            retryAfterS: 120 });
    });

    it("brak sieci: nazwany powod, bez wyjatku", async () => {
        const w = await pobierzKluczPatrona((async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
        expect(w).toMatchObject({ ok: false, status: 503, powod: "repertorium_unreachable" });
    });
});

describe("writeRepertoriumToOverlay - ksztalt adresu", () => {
    it("odrzuca http i adres bez /mcp/<klucz>", () => {
        const p = nakladka();
        expect(writeRepertoriumToOverlay(p, "repertorium",
            { url: `http://repertorium.matematicsolutions.com/mcp/${KLUCZ}`, enabled: true, chatTools: true }).ok).toBe(false);
        expect(writeRepertoriumToOverlay(p, "repertorium",
            { url: "https://repertorium.matematicsolutions.com/v1/search_law", enabled: true, chatTools: true }).ok).toBe(false);
        expect(fs.existsSync(p)).toBe(false);
    });
});
