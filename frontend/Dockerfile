# Patron frontend - Docker image (Next.js 16 standalone output).
# Multi-stage build:
#   1) deps     - instaluje wszystkie deps (npm ci)
#   2) builder  - kompiluje aplikacje Next ze standalone output
#   3) runtime  - minimalny obraz z .next/standalone + .next/static
#
# UWAGA: Next.js przy `output: "standalone"` w `next.config.ts` produkuje
# w .next/standalone/ samodzielna aplikacje z bundlowanymi node_modules.
# Public + .next/static kopiujemy obok bo standalone ich nie zawiera.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env - NEXT_PUBLIC_* trafiaja do bundla po stronie klienta.
# W docker-compose przekazujemy je przez ARG (lub trzymamy w .env.docker).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user.
RUN groupadd --gid 1100 patron && useradd --uid 1100 --gid patron --shell /bin/bash --create-home patron

# Standalone server + statyki + public folder.
COPY --from=builder --chown=patron:patron /app/.next/standalone ./
COPY --from=builder --chown=patron:patron /app/.next/static ./.next/static
COPY --from=builder --chown=patron:patron /app/public ./public

USER patron
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+process.env.PORT+'/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" || exit 1

CMD ["node", "server.js"]
