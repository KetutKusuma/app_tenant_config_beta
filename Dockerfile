# Stage 1: install dependency + build web & bff
FROM node:22-bookworm-slim AS build
RUN npm i -g pnpm@9
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/bff/package.json apps/bff/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter web build && pnpm --filter bff build

# Stage 2: runtime (hanya Node, tanpa pnpm)
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "apps/bff/dist/main.js"]
