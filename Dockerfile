# Multi-stage Dockerfile for Next.js app deployment on OpenShift

# Build stage — install ALL deps (including devDeps) so native binaries like
# lightningcss get compiled for linux-arm64-musl inside the Alpine container.
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY exploration_ui/report-explorer/package*.json ./

# Full install — devDeps are required at build time (tailwindcss, lightningcss, typescript)
RUN npm ci

# Copy source code
COPY exploration_ui/report-explorer/ ./

# Produce a standalone Next.js build (bundles only the required node_modules)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production stage — copy only the standalone server bundle, no node_modules
FROM node:20-alpine AS runner

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid  1001 nextjs

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone output: .next/standalone contains the minimal server + bundled deps
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets still need to be served from the public folder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Static Next.js assets (.next/static) must sit inside .next/static
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Standalone entry point is server.js, not npm start
CMD ["node", "server.js"]