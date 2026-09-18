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
# GA4 і Search Console: значення з deploy/.env (GA_ID, GOOGLE_SITE_VERIFICATION) через build-args
ARG VITE_GA_ID=""
ARG VITE_GOOGLE_SITE_VERIFICATION=""
ARG VITE_STICK_HOST=""
ENV VITE_GA_ID=$VITE_GA_ID VITE_GOOGLE_SITE_VERIFICATION=$VITE_GOOGLE_SITE_VERIFICATION VITE_STICK_HOST=$VITE_STICK_HOST
RUN pnpm --filter @deye/tv build && pnpm --filter @deye/web build

FROM alpine:3
COPY --from=build /repo/apps/tv/dist /out/tv
COPY --from=build /repo/apps/web/dist /out/web
# Оновлення без «дірки»: спершу копіюємо нову збірку поверх старої, і лише потім прибираємо файли, яких у ній уже немає.
# Раніше тут було rm -rf і потім cp: кілька секунд сайт лишався без sitemap.xml/index.html (а при двох деплоях одночасно — хвилини).
COPY deploy/static-sync.sh /static-sync.sh
CMD ["sh", "/static-sync.sh"]
