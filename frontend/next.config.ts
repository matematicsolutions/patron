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
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
