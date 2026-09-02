# syntax=docker/dockerfile:1.6

# Bun is the only supported runtime (src/lib/runtime-guard.ts); the runtime stage needs no toolchain
# because what ships is one compiled binary. Pinned to $BUILDPLATFORM so `deps` and `builder` run
# natively: emulated, the Rolldown-backed `vinext build` deadlocks in its first transform pass and
# wedges the job until the runner's 6-hour cap. The runtime stage still builds per-target, and the
# only arch-specific artifact it gets is the binary, cross-compiled a few lines down.
FROM --platform=$BUILDPLATFORM oven/bun:1-slim AS base
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Every workspace manifest, not just the root one: `bun install` resolves the whole workspace graph
# up front and fails on a member it cannot read. bunfig.toml comes along because it pins the
# hoisted linker, without which transitive types stop resolving.
COPY package.json bun.lock bunfig.toml ./
COPY apps/controller/package.json ./apps/controller/
COPY apps/agent/package.json ./apps/agent/
COPY apps/site/package.json ./apps/site/
COPY packages/shared/package.json ./packages/shared/
# --ignore-scripts skips native addon build steps; nothing here needs one, since
# SQLite comes from bun's built-in bun:sqlite rather than a compiled addon.
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
ARG TARGETARCH
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/tmp/build.db
ENV DATABASE_URL=file:/tmp/build.db
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `build` emits dist/standalone; `build:binary` compiles scripts/standalone-entry.ts and the vinext
# production server into dist/standalone/cpm-server. This stage runs on the host arch, so the binary
# is cross-compiled for the target — Bun names targets by libc and arch, and the glibc variants
# match the debian:bookworm-slim runtime. BUN_COMPILE_TARGET feeds the package.json script.
RUN case "$TARGETARCH" in \
      amd64) export BUN_COMPILE_TARGET=bun-linux-x64 ;; \
      arm64) export BUN_COMPILE_TARGET=bun-linux-arm64 ;; \
      *) echo "docker/web/Dockerfile: unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac && \
    bun run build && bun run build:binary && rm -f /tmp/build.db

# ── Runtime ──────────────────────────────────────────────────────────────────
# Debian rather than oven/bun: the compiled binary carries its own Bun runtime, so a package manager
# and Bun CLI would be dead weight. Bookworm matches oven/bun:1-slim's base, so the glibc matches.
# The only runtime stage — the e2e suite runs this same image, seeding through the `db-seed`
# container rather than executing code here.
FROM debian:bookworm-slim AS runner
ARG PUID=10001
ARG PGID=10001

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# ca-certificates is not optional: ACME, OAuth/OIDC, ClickHouse and the Caddy
# admin API are all reached over TLS, and an image without a trust store fails
# every one of them at runtime rather than at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} cpm && \
    useradd -r -u ${PUID} -g cpm cpm

# The whole standalone directory, copied verbatim so the layout is preserved: the binary
# (cpm-server), the app bundle and client assets (dist/), the runtime deps the bundle still imports
# (node_modules/), and the package.json whose "type": "module" says how to load dist/*.js. The
# bundle stays on disk because vinext loads it with a runtime import() of a real path, which Bun's
# embedded-asset filesystem does not support.
COPY --from=builder --chown=cpm:cpm /app/apps/controller/dist/standalone ./

# Migrations are read at startup and live outside the bundle.
COPY --from=builder --chown=cpm:cpm /app/apps/controller/drizzle ./drizzle

RUN mkdir -p /app/data && chown -R cpm:cpm /app/data

# Shared volume for the custom ACME CA root PEM (issue #192). The web container writes it here;
# Caddy mounts the same volume read-only. Mode 0777 so it stays writable regardless of which
# container (with differing UIDs) initializes the named volume first — the file only ever holds a
# public CA certificate.
RUN mkdir -p /acme-ca && chmod 0777 /acme-ca

COPY --chown=cpm:cpm docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
USER cpm
ENTRYPOINT ["/entrypoint.sh"]
