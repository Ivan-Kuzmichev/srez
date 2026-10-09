# syntax=docker/dockerfile:1

# Node stages run on the build machine's own platform (fast, no emulation): their output is the same
# for every target. better-sqlite3 ships prebuilt binaries for linux x64 and arm64 and picks one at
# runtime, so only the final stage is per platform.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM deps AS native
# pnpm links packages through symlinks; dereference so the runner gets real files.
RUN mkdir -p /out/better-sqlite3 \
  && cd node_modules/better-sqlite3 && cp -rL package.json lib prebuilds /out/better-sqlite3/

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/srez.db
WORKDIR /app
RUN groupadd --system --gid 1001 srez && useradd --system --uid 1001 --gid srez srez \
  && mkdir -p /data && chown srez:srez /data
COPY --from=build --chown=srez:srez /app/.next/standalone ./
# sharp is traced into standalone for the build platform only; images are unoptimized, so drop it.
RUN rm -rf node_modules/@img node_modules/sharp
COPY --from=build --chown=srez:srez /app/.next/static ./.next/static
COPY --from=build --chown=srez:srez /app/public ./public
COPY --from=build --chown=srez:srez /app/dist ./dist
COPY --from=build --chown=srez:srez /app/drizzle ./drizzle
# Native SQLite driver for the bundled worker, migrations and CLI.
COPY --from=native --chown=srez:srez /out/better-sqlite3 ./node_modules/better-sqlite3
# The Next.js server reaches the driver through .next/node_modules → node_modules/.pnpm/better-sqlite3@…,
# traced with the build platform's binary only: give it the full package with every prebuilt binary.
RUN for d in node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3; do \
      [ -d "$d" ] && rm -rf "$d" && cp -r node_modules/better-sqlite3 "$d" && chown -R srez:srez "$d"; \
    done; true
COPY --chown=srez:srez docker/entrypoint.sh ./entrypoint.sh
COPY --chown=srez:srez scripts/remote-address.mjs ./scripts/remote-address.mjs
# No USER: the entrypoint starts as root only to hand /data to uid 1001, then runs everything as it.
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["web"]
