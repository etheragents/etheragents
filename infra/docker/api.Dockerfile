# Etheragents API (Node 22 runs the TypeScript sources directly — no build step)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY contracts/package.json contracts/
RUN npm ci -w @etheragents/api --omit=dev --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "apps/api/src/main.ts"]
