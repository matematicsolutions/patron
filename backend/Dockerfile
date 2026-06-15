# Patron backend - Docker image
# Multi-stage build:
#   1) builder - instaluje WSZYSTKIE deps i kompiluje TS -> dist/
#   2) runtime - tylko production deps + dist + zbundlowane MCP servery
#
# UWAGA: przed `docker build` musisz uruchomic na hoscie:
#   node scripts/bundle-mcp.cjs
# To kopiuje mcp-saos/mcp-nsa/mcp-isap/mcp-eu-sparql do backend/mcp-bundled/.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# 1) Layer cache - kopiujemy tylko package*.json zeby ponowne buildy
# bez zmiany zaleznosci nie reinstalowaly wszystkiego.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2) Reszta kodu i kompilacja
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS runtime

# libreoffice-convert wymaga libreoffice na hoscie (uzywane przez konwersje
# docx -> pdf w convert.ts). Cienki obraz `libreoffice-core` wystarczy.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-core libreoffice-writer fonts-liberation \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Tylko production deps - znacznie mniejszy image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Skompilowany backend
COPY --from=builder /app/dist ./dist

# Zbundlowane serwery MCP + ich docker-ready manifest.
# WYMOG: skrypt scripts/bundle-mcp.cjs musial sie wykonac przed `docker build`.
COPY mcp-bundled ./mcp-bundled
COPY mcp-servers.docker.json ./mcp-servers.json

# Non-root user.
RUN groupadd --gid 1100 patron && useradd --uid 1100 --gid patron --shell /bin/bash --create-home patron \
    && chown -R patron:patron /app
USER patron

# Backend domyslnie nasluchuje na 3001 (patrz env: PORT).
ENV NODE_ENV=production \
    PORT=3001
EXPOSE 3001

# Healthcheck - prosty TCP na port aplikacji.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["node", "dist/index.js"]
