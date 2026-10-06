// Walidacja naglowka Host (i Origin dla zadan zmieniajacych stan) - audyt
// 2026-09, A-22: DNS rebinding.
//
// Backend desktop slucha na 127.0.0.1, a w trybie SQLite auth jest pominiety
// (jeden lokalny uzytkownik). Loopback NIE chroni przed DNS rebinding: strona
// atakujacy.example otwarta w zwyklej przegladarce przepina swoja nazwe na
// 127.0.0.1 i jej skrypt wysyla zadania "same-origin" na lokalny port - CORS
// nic nie daje, a backend bez tej bramki czytal i zapisywal akta spraw.
// Jedyne, czego rebinding nie podrobi, to naglowek Host: przegladarka wysyla w
// nim nazwe atakujacego. Dlatego przed jakimkolwiek routerem sprawdzamy Host
// wobec allowlisty.
//
// Druga polowa (CSRF): zwykly formularz z obcej strony moze wyslac POST
// multipart na http://localhost:3001 - Host jest wtedy prawdziwy. Dla metod
// zmieniajacych stan sprawdzamy wiec Origin, jesli przegladarka go podala.
// Brak Origin = klient spoza przegladarki (powloka Electron, skrypty) - wpuszczamy.
//
// Kiedy wlaczone: tryb SQLite (desktop, auth bypass) zawsze; tryb serwerowy
// tylko gdy operator ustawi PATRON_ALLOWED_HOSTS - tam auth JWT, a za reverse
// proxy Host niesie domene kancelarii, ktorej nie znamy z gory.
//
// Uwaga: NIE uzywamy req.hostname - przy `trust proxy` Express bierze go z
// X-Forwarded-Host, ktory ustawia klient.
import type { NextFunction, Request, RequestHandler, Response } from "express";

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ParsedHost {
    /** lowercase; IPv6 w nawiasach, np. "[::1]" */
    hostname: string;
    /** port jako tekst; pusty = domyslny dla schematu */
    port: string;
}

/** Parsuje wartosc naglowka Host ("name", "name:port", "[v6]:port"). */
export function parseHostHeader(value: string | undefined): ParsedHost | null {
    if (value === undefined) return null;
    const v = value.trim().toLowerCase();
    if (!v) return null;
    let hostname: string;
    let port = "";
    if (v.startsWith("[")) {
        const end = v.indexOf("]");
        if (end < 0) return null;
        hostname = v.slice(0, end + 1);
        const rest = v.slice(end + 1);
        if (rest) {
            if (!rest.startsWith(":")) return null;
            port = rest.slice(1);
        }
    } else {
        const first = v.indexOf(":");
        const last = v.lastIndexOf(":");
        if (first !== last) return null; // goly IPv6 bez nawiasow - niepoprawny Host
        if (last >= 0) {
            hostname = v.slice(0, last);
            port = v.slice(last + 1);
        } else {
            hostname = v;
        }
    }
    if (port && !/^\d{1,5}$/.test(port)) return null;
    if (!hostname || /[\s/\\@?#,]/.test(hostname)) return null;
    return { hostname, port };
}

/**
 * Allowlista hostow: "name:port" (dokladnie) albo "name:*" (dowolny port).
 * Domyslnie loopback z portem backendu; PATRON_ALLOWED_HOSTS (CSV) dodaje
 * wpisy - "name" bez portu oznacza dowolny port.
 */
export function buildAllowedHosts(
    port: string | number,
    extraCsv?: string,
): Set<string> {
    const out = new Set<string>();
    for (const h of LOOPBACK_HOSTNAMES) out.add(`${h}:${String(port)}`);
    for (const raw of (extraCsv ?? "").split(",")) {
        const parsed = parseHostHeader(raw);
        if (!parsed) continue;
        out.add(`${parsed.hostname}:${parsed.port || "*"}`);
    }
    return out;
}

export function isHostAllowed(
    hostHeader: string | undefined,
    allowed: ReadonlySet<string>,
    defaultPort = "80",
): boolean {
    const parsed = parseHostHeader(hostHeader);
    if (!parsed) return false;
    const port = parsed.port || defaultPort;
    return (
        allowed.has(`${parsed.hostname}:${port}`) ||
        allowed.has(`${parsed.hostname}:*`)
    );
}

function originOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
    } catch {
        return null;
    }
}

/**
 * Originy frontendu: FRONTEND_URL (domyslnie http://localhost:3000), a gdy to
 * loopback - takze jego aliasy (127.0.0.1 / localhost / [::1]) na tym samym porcie.
 */
export function buildFrontendOrigins(frontendUrl: string | undefined): Set<string> {
    const out = new Set<string>();
    const origin = originOf(frontendUrl ?? "http://localhost:3000");
    if (!origin) return out;
    out.add(origin);
    const u = new URL(origin);
    if ((LOOPBACK_HOSTNAMES as readonly string[]).includes(u.hostname)) {
        for (const h of LOOPBACK_HOSTNAMES) {
            out.add(`${u.protocol}//${h}${u.port ? `:${u.port}` : ""}`);
        }
    }
    return out;
}

/** Origin zadania zmieniajacego stan: frontend albo sam backend (allowlista Host). */
export function isOriginAllowed(
    origin: string,
    frontendOrigins: ReadonlySet<string>,
    allowedHosts: ReadonlySet<string>,
): boolean {
    const normalized = originOf(origin);
    if (!normalized) return false; // "null", file:, app:, smieci
    if (frontendOrigins.has(normalized)) return true;
    const u = new URL(normalized);
    const defaultPort = u.protocol === "https:" ? "443" : "80";
    return isHostAllowed(u.host, allowedHosts, defaultPort);
}

export interface HostGuardOptions {
    enabled: boolean;
    port: string | number;
    allowedHostsCsv?: string;
    frontendUrl?: string;
    log?: (msg: string) => void;
}

export function hostGuardEnabled(opts: {
    sqlite: boolean;
    allowedHostsCsv?: string;
}): boolean {
    return opts.sqlite || Boolean(opts.allowedHostsCsv?.trim());
}

function shortForLog(v: string | undefined): string {
    return JSON.stringify((v ?? "(brak)").slice(0, 120));
}

export function createHostGuard(opts: HostGuardOptions): RequestHandler {
    if (!opts.enabled) {
        return (_req: Request, _res: Response, next: NextFunction) => next();
    }
    const allowedHosts = buildAllowedHosts(opts.port, opts.allowedHostsCsv);
    const frontendOrigins = buildFrontendOrigins(opts.frontendUrl);
    const log = opts.log ?? ((m: string) => console.warn(m));

    return (req: Request, res: Response, next: NextFunction) => {
        const host = req.headers.host;
        if (!isHostAllowed(host, allowedHosts)) {
            log(`[host-guard] odrzucono Host=${shortForLog(host)} ${req.method} (A-22)`);
            // 421 Misdirected Request, bez tresci - nic o aplikacji nie wycieka.
            res.status(421).end();
            return;
        }
        const origin = req.headers.origin;
        if (
            origin !== undefined &&
            !SAFE_METHODS.has(req.method) &&
            !isOriginAllowed(origin, frontendOrigins, allowedHosts)
        ) {
            log(`[host-guard] odrzucono Origin=${shortForLog(origin)} ${req.method} (A-22)`);
            res.status(403).end();
            return;
        }
        next();
    };
}
