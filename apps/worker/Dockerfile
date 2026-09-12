FROM node:24-alpine
RUN apk add --no-cache ffmpeg && corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/register-maps/package.json packages/register-maps/
COPY apps/api/package.json apps/api/
COPY apps/tv/package.json apps/tv/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @deye/worker
COPY apps/worker ./apps/worker
WORKDIR /repo/apps/worker
CMD ["node", "--experimental-strip-types", "src/worker.ts"]
