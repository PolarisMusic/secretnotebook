FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY turbo.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @secretnotebook/api... build

FROM node:22-alpine AS runtime
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN apk add --no-cache wget
COPY --from=build /repo /repo
# Bundle the migration SQL files into the runtime image so the
# migrate step can locate them without a bind mount.
COPY infra/db/migrations /repo/infra/db/migrations
ENV NODE_ENV=production
EXPOSE 3000

# Container-internal liveness check. The /v1/health endpoint returns
# `{ ok: true, ... }` once Fastify is listening; PaaS deploy targets
# (Fly, Railway, etc.) hook into this to decide when to route
# traffic to a new revision.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://localhost:3000/v1/health || exit 1

# Apply pending SQL migrations before handing control to the server.
# The runner tracks applied files in `schema_migrations` so re-runs
# (every container restart / new revision) are idempotent. On a
# migration failure the script exits non-zero and the container
# won't start — surfaces fast in fly/railway/etc.
CMD ["sh", "-c", "pnpm --filter @secretnotebook/api migrate && pnpm --filter @secretnotebook/api start"]
