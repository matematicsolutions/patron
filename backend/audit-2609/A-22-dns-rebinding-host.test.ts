// A-22: backend desktop (SQLite, auth bypass, bind 127.0.0.1) przyjmuje zadania z
// DOWOLNYM naglowkiem Host - strona WWW otwarta w zwyklej przegladarce na tej samej
// maszynie moze przez DNS rebinding (atakujacy.example -> 127.0.0.1) czytac i zapisywac
// akta spraw bez zadnego tokenu (loopback nie chroni przed rebindingiem).
// Oczekiwane zachowanie: zadanie z Host spoza {localhost,127.0.0.1}[:port] jest
// odrzucane (np. 403/421) i nie zwraca danych spraw.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let proc: ChildProcess | undefined;
let port = 0;
let tmp = "";

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => {
            const p = (s.address() as net.AddressInfo).port;
            s.close(() => resolve(p));
        });
        s.on("error", reject);
    });
}

function req(
    method: string,
    p: string,
    host: string,
    body?: string,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const r = http.request(
            {
                host: "127.0.0.1",
                port,
                path: p,
                method,
                headers: {
                    Host: host,
                    ...(body
                        ? {
                              "Content-Type": "application/json",
                              "Content-Length": Buffer.byteLength(body),
                          }
                        : {}),
                },
            },
            (res) => {
                let b = "";
                res.on("data", (c) => (b += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
            },
        );
        r.on("error", reject);
        if (body) r.write(body);
        r.end();
    });
}

async function waitHealth(timeoutMs: number): Promise<void> {
    const start = Date.now();
    for (;;) {
        try {
            const r = await req("GET", "/health", `127.0.0.1:${port}`);
            if (r.status === 200) return;
        } catch {
            /* jeszcze nie wstal */
        }
        if (Date.now() - start > timeoutMs) throw new Error("backend nie wstal");
        await new Promise((r) => setTimeout(r, 300));
    }
}

beforeAll(async () => {
    port = await freePort();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a22-"));
    const backendDir = path.resolve(__dirname, "..");
    proc = spawn(
        process.execPath,
        [path.join(backendDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
        {
            cwd: backendDir,
            env: {
                ...process.env,
                // Konfiguracja jak w desktop/main.js backendLocalEnv()
                PATRON_DB_BACKEND: "sqlite",
                PATRON_STORAGE: "fs",
                PATRON_DB_PATH: path.join(tmp, "patron.db"),
                PATRON_STORAGE_DIR: path.join(tmp, "sprawy"),
                PATRON_BRAIN_DIR: path.join(tmp, "brain"),
                PATRON_HOST: "127.0.0.1",
                PORT: String(port),
                NODE_ENV: "production",
                DOWNLOAD_SIGNING_SECRET: "a".repeat(64),
                USER_API_KEYS_ENCRYPTION_SECRET: "b".repeat(64),
            },
            stdio: "ignore",
        },
    );
    await waitHealth(45_000);
    // Syntetyczna sprawa klienta (zalozona legalnie, z Host loopback).
    await req(
        "POST",
        "/projects",
        `localhost:${port}`,
        JSON.stringify({ name: "Sprawa Jan Testowy przeciwko Testowa sp. z o.o." }),
    );
}, 60_000);

afterAll(() => {
    proc?.kill("SIGTERM");
    try {
        fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
        /* sprzatanie best-effort */
    }
});

describe("A-22 - backend desktop odrzuca obcy naglowek Host (DNS rebinding)", () => {
    it("GET /projects z Host: rebind.atakujacy.example nie zwraca listy spraw", async () => {
        const r = await req("GET", "/projects", `rebind.atakujacy.example:${port}`);
        expect(r.body).not.toContain("Jan Testowy");
        expect([403, 421]).toContain(r.status);
    });

    it("POST /projects z Host: rebind.atakujacy.example nie zaklada sprawy", async () => {
        const r = await req(
            "POST",
            "/projects",
            `rebind.atakujacy.example:${port}`,
            JSON.stringify({ name: "Sprawa podrzucona" }),
        );
        expect([403, 421]).toContain(r.status);
    });
});
