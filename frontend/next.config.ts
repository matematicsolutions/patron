import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Standalone output - minimalizuje rozmiar obrazu Dockera
    // (kopiowane sa tylko realnie uzywane node_modules + .next/static + server).
    output: "standalone",
    reactCompiler: true,
    async rewrites() {
        return [
            {
                source: "/sitemap.xml",
                destination: "/api/sitemap/sitemap.xml",
            },
            {
                source: "/sitemap_:slug.xml",
                destination: "/api/sitemap/sitemap_:slug.xml",
            },
        ];
    },
    // ADR-0069 (H8): naglowki bezpieczenstwa. Dokumenty klientow kancelarii nie
    // moga byc osadzane (clickjacking), a UUID sprawy nie moze wyciekac w Referer
    // do innego origin. CSP EGZEKWOWANA od 2026-10-06 (audyt A-21): druga warstwa
    // obrony przed eksfiltracja bez klikniecia (A-20) - img-src/connect-src bez
    // obcych hostow. Front i API zyja na roznych portach (3000 / 3001), czyli na
    // roznych originach: `connect-src 'self'` sam odcialby backend, wiec origin API
    // dochodzi jawnie. headers() liczy sie przy buildzie - NEXT_PUBLIC_API_BASE_URL
    // ustawia prepare-resources.cjs, a port backendu desktopu jest staly.
    // script-src z 'unsafe-inline'/'unsafe-eval' zostaje dlugiem (Next + docx-preview).
    async headers() {
        const apiOrigin = new URL(
            process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
        ).origin;
        const csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            `connect-src 'self' ${apiOrigin}`,
            "worker-src 'self' blob:",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join("; ");
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    {
                        key: "Referrer-Policy",
                        value: "strict-origin-when-cross-origin",
                    },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
                    },
                    { key: "Content-Security-Policy", value: csp },
                ],
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
