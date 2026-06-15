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
    // do innego origin. CSP w trybie REPORT-ONLY na start - dynamiczny podglad
    // docx/pdf.js i Next moga generowac inline; report-only zbiera naruszenia bez
    // psucia UI, twardy enforce po obserwacji raportow (rezerwacja).
    async headers() {
        const csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
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
                    { key: "Content-Security-Policy-Report-Only", value: csp },
                ],
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
