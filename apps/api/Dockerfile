FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/register-maps/package.json packages/register-maps/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages ./packages
COPY apps/api ./apps/api
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/index.ts"]
