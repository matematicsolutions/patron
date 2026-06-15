// Middleware IP whitelist dla endpointu /metrics (ADR-0037).
//
// Prometheus scraping standardowo nie obsluguje JWT - autoryzacja przez IP.
// Whitelist env `METRICS_ALLOWED_IPS` (CSV, np. "10.0.0.5,192.168.1.100").
// Brak env = endpoint disabled (404 zamiast 401/403, ukrywa endpoint
// przed publicznym discoverem).
//
// Endpoint /metrics nie zawiera PII ani contentu eventow - tylko counters
// i gauges. IP whitelist jest standardem branzowym dla scraping endpoints
// (Konstytucja Art. 4 neutralnosc, kompatybilnosc z typowym deployment
// monitoring stack).

import type { Request, Response, NextFunction } from "express";

/**
 * Pure function - sprawdza czy IP requestu jest na liscie z env.
 * Brak env / brak IP w whitelist -> false.
 */
export function isMetricsAllowed(
    remoteIp: string | undefined,
    envAllowedIps: string | undefined,
): boolean {
    if (!remoteIp) return false;
    const raw = (envAllowedIps ?? "").trim();
    if (!raw) return false;
    const allowed = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return allowed.includes(remoteIp);
}

/**
 * Middleware Express. Brak whitelist match = 404 (nie 401/403 - ukrywa
 * endpoint przed nieautoryzowanym).
 */
export function requireMetricsAllowed(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const remoteIp = req.ip ?? req.socket?.remoteAddress ?? undefined;
    if (!isMetricsAllowed(remoteIp, process.env.METRICS_ALLOWED_IPS)) {
        res.status(404).json({ error: "not_found" });
        return;
    }
    next();
}
