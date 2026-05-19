FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY turbo.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @secretnotebook/api... build

FROM node:20-alpine AS runtime
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY --from=build /repo /repo
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@secretnotebook/api", "start"]
