# One Dockerfile for both services. Railway picks it up automatically.
# Set the service variable SERVICE=api on the API service and SERVICE=web on the website service.
ARG SERVICE=api

# ───────────── API: Node 22 runs the TypeScript sources directly ─────────────
FROM node:22-slim AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY contracts/package.json contracts/
RUN npm ci -w @etheragents/api --omit=dev --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "apps/api/src/main.ts"]

# ───────────── Website: Next.js standalone build ─────────────
FROM node:22-slim AS web-build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_WC_PROJECT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY contracts/package.json contracts/
RUN npm ci -w @etheragents/web --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @etheragents/web

FROM node:22-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ───────────── the image Railway runs ─────────────
FROM ${SERVICE}
