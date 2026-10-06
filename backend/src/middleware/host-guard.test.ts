// Audyt 2026-09, A-22: walidacja Host/Origin przeciw DNS rebinding.
// Czerwony test audytu (audit-2609/A-22-dns-rebinding-host.test.ts) stawia caly
// backend; tu pilnujemy logiki bramki, prawdziwych sciezek wywolan (frontend,
// powloka Electron) i tego, ze index.ts wpina bramke PRZED routerami.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    buildAllowedHosts,
    buildFrontendOrigins,
    createHostGuard,
    hostGuardEnabled,
    isHostAllowed,
    isOriginAllowed,
    parseHostHeader,
} from "./host-guard";

describe("parseHostHeader", () => {
    it("nazwa, nazwa:port, [IPv6]:port", () => {
        expect(parseHostHeader("LocalHost:3001")).toEqual({ hostname: "localhost", port: "3001" });
        expect(parseHostHeader("127.0.0.1")).toEqual({ hostname: "127.0.0.1", port: "" });
        expect(parseHostHeader("[::1]:3001")).toEqual({ hostname: "[::1]", port: "3001" });
    });

    it("smieci i proby obejscia: null", () => {
        for (const bad of [
            undefined,
            "",
            "::1:3001",
            "[::1",
            "[::1]x",
            "localhost:abc",
            "localhost:3001@atakujacy.example",
            "atakujacy.example/localhost:3001",
            "localhost, atakujacy.example",
        ]) {
            expect(parseHostHeader(bad)).toBeNull();
        }
    });
});

describe("allowlista Host", () => {
    const allowed = buildAllowedHosts(3001);

    it("loopback z portem backendu przechodzi", () => {
        for (const h of ["127.0.0.1:3001", "localhost:3001", "LOCALHOST:3001", "[::1]:3001"]) {
            expect(isHostAllowed(h, allowed)).toBe(true);
        }
    });

    it("obca nazwa (rebinding), inny port, brak portu: odmowa", () => {
        for (const h of [
            "rebind.atakujacy.example:3001",
            "localhost.atakujacy.example:3001",
            "127.0.0.1.nip.io:3001",
            "localhost:3000",
            "localhost",
            "0.0.0.0:3001",
            undefined,
        ]) {
            expect(isHostAllowed(h, allowed)).toBe(false);
        }
    });

    it("PATRON_ALLOWED_HOSTS: wpis bez portu = dowolny port, z portem = dokladnie", () => {
        const extra = buildAllowedHosts(3001, " patron.kancelaria.local , serwer:8443,,bledny:x ");
        expect(isHostAllowed("patron.kancelaria.local", extra)).toBe(true);
        expect(isHostAllowed("patron.kancelaria.local:9999", extra)).toBe(true);
        expect(isHostAllowed("serwer:8443", extra)).toBe(true);
        expect(isHostAllowed("serwer:8444", extra)).toBe(false);
        expect(isHostAllowed("bledny:3001", extra)).toBe(false);
        expect(isHostAllowed("localhost:3001", extra)).toBe(true);
    });

    it("hostGuardEnabled: SQLite zawsze, serwer tylko z PATRON_ALLOWED_HOSTS", () => {
        expect(hostGuardEnabled({ sqlite: true })).toBe(true);
        expect(hostGuardEnabled({ sqlite: false })).toBe(false);
        expect(hostGuardEnabled({ sqlite: false, allowedHostsCsv: "  " })).toBe(false);
        expect(hostGuardEnabled({ sqlite: false, allowedHostsCsv: "patron.local" })).toBe(true);
    });
});

describe("allowlista Origin (zadania zmieniajace stan)", () => {
    const hosts = buildAllowedHosts(3001);
    const front = buildFrontendOrigins(undefined);

    it("frontend desktop (http://localhost:3000) i jego aliasy loopback", () => {
        expect(isOriginAllowed("http://localhost:3000", front, hosts)).toBe(true);
        expect(isOriginAllowed("http://127.0.0.1:3000", front, hosts)).toBe(true);
        expect(isOriginAllowed("http://[::1]:3000", front, hosts)).toBe(true);
    });

    it("sam backend (strona weryfikatora itp.) przechodzi", () => {
        expect(isOriginAllowed("http://localhost:3001", front, hosts)).toBe(true);
    });

    it("obce originy, null, file: - odmowa", () => {
        for (const o of [
            "https://atakujacy.example",
            "http://localhost:3002",
            "http://localhost:3000.atakujacy.example",
            "null",
            "file://",
            "smieci",
        ]) {
            expect(isOriginAllowed(o, front, hosts)).toBe(false);
        }
    });

    it("FRONTEND_URL serwera: tylko ten origin (bez aliasow loopback)", () => {
        const srv = buildFrontendOrigins("https://patron.kancelaria.pl/app");
        expect([...srv]).toEqual(["https://patron.kancelaria.pl"]);
    });
});

// ---------------------------------------------------------------------------
// Bramka na prawdziwym serwerze HTTP (Host ustawiany recznie, jak w rebindingu)
// ---------------------------------------------------------------------------

let server: http.Server;
let port = 0;
const logs: string[] = [];

function req(
    method: string,
    p: string,
    headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
        });
        r.on("error", reject);
        r.end();
    });
}

beforeAll(async () => {
    const app = express();
    app.use(
        createHostGuard({
            enabled: true,
            port: 3001,
            log: (m) => logs.push(m),
        }),
    );
    app.get("/projects", (_req, res) => res.json([{ name: "Sprawa Jan Testowy" }]));
    app.post("/projects", (_req, res) => res.status(201).json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    port = (server.address() as AddressInfo).port;
});

afterAll(() => {
    server?.close();
});

describe("createHostGuard - zachowanie na zywym serwerze", () => {
    it("frontend desktop: GET z Host localhost:3001 i Origin localhost:3000", async () => {
        const r = await req("GET", "/projects", {
            Host: "localhost:3001",
            Origin: "http://localhost:3000",
        });
        expect(r.status).toBe(200);
    });

    it("frontend desktop: POST z Origin localhost:3000", async () => {
        const r = await req("POST", "/projects", {
            Host: "localhost:3001",
            Origin: "http://localhost:3000",
        });
        expect(r.status).toBe(201);
    });

    it("powloka Electron (/health przez http.get, bez Origin) i 127.0.0.1", async () => {
        expect((await req("GET", "/projects", { Host: "localhost:3001" })).status).toBe(200);
        expect((await req("POST", "/projects", { Host: "127.0.0.1:3001" })).status).toBe(201);
    });

    it("rebinding: obcy Host -> 421 bez tresci, takze dla OPTIONS", async () => {
        for (const method of ["GET", "POST", "OPTIONS"]) {
            const r = await req(method, "/projects", { Host: "rebind.atakujacy.example:3001" });
            expect(r.status).toBe(421);
            expect(r.body).toBe("");
        }
        expect(logs.some((l) => l.includes("rebind.atakujacy.example"))).toBe(true);
    });

    it("CSRF: POST z obcym Origin i prawdziwym Host -> 403 bez tresci", async () => {
        const r = await req("POST", "/projects", {
            Host: "localhost:3001",
            Origin: "https://atakujacy.example",
        });
        expect(r.status).toBe(403);
        expect(r.body).toBe("");
    });

    it("GET z obcym Origin przechodzi (odczyt i tak blokuje CORS)", async () => {
        const r = await req("GET", "/projects", {
            Host: "localhost:3001",
            Origin: "https://atakujacy.example",
        });
        expect(r.status).toBe(200);
    });

    it("X-Forwarded-Host nie obchodzi bramki", async () => {
        const r = await req("GET", "/projects", {
            Host: "rebind.atakujacy.example:3001",
            "X-Forwarded-Host": "localhost:3001",
        });
        expect(r.status).toBe(421);
    });
});

describe("createHostGuard wylaczony (tryb serwerowy bez PATRON_ALLOWED_HOSTS)", () => {
    it("przepuszcza bez sprawdzania", () => {
        const mw = createHostGuard({ enabled: false, port: 3001 });
        let called = false;
        mw(
            { headers: { host: "cokolwiek" }, method: "POST" } as never,
            {} as never,
            () => {
                called = true;
            },
        );
        expect(called).toBe(true);
    });
});

describe("index.ts wpina bramke przed CORS i routerami", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");

    it("createHostGuard jest pierwszym app.use", () => {
        const guard = src.indexOf("createHostGuard(");
        const firstUse = src.indexOf("app.use(");
        expect(guard).toBeGreaterThan(-1);
        // pierwszy app.use( to wywolanie z bramka
        expect(src.slice(firstUse, guard)).toMatch(/^app\.use\(\s*$/);
        expect(guard).toBeLessThan(src.indexOf("cors("));
        expect(guard).toBeLessThan(src.indexOf('app.use("/'));
        expect(guard).toBeLessThan(src.indexOf('app.get("/health"'));
    });
});
