# Збирає статику apps/tv і apps/web; контейнер копіює dist у volumes Caddy і завершується.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/tv/package.json apps/tv/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/register-maps/package.json packages/register-maps/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages ./packages
COPY apps/tv ./apps/tv
COPY apps/web ./apps/web
RUN pnpm --filter @deye/tv build && pnpm --filter @deye/web build

FROM alpine:3
COPY --from=build /repo/apps/tv/dist /out/tv
COPY --from=build /repo/apps/web/dist /out/web
CMD sh -c "rm -rf /srv/tv/* /srv/web/* && cp -r /out/tv/. /srv/tv/ && cp -r /out/web/. /srv/web/ && echo static deployed && ls /srv/tv /srv/web"
