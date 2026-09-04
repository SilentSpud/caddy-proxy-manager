# syntax=docker/dockerfile:1.6

# The agent compiles to a single Bun binary, but its runtime still needs the Docker CLI and the
# compose plugin: recreating the Caddy container is the whole job, and there is no Go client here
# that would let it talk to the daemon directly.
FROM --platform=$BUILDPLATFORM oven/bun:1-slim AS builder
WORKDIR /app

# Every workspace manifest, not just the agent's: `bun install` resolves the whole workspace graph
# up front and fails on a member it cannot read. bunfig.toml pins the isolated linker.
COPY package.json bun.lock bunfig.toml ./
COPY apps/controller/package.json ./apps/controller/
COPY apps/agent/package.json ./apps/agent/
COPY apps/site/package.json ./apps/site/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/agent ./apps/agent

# This stage runs on the host arch, so the binary is cross-compiled for the target. Bun names
# targets by libc and arch, and the glibc variants match the docker:cli runtime's musl — they do
# not, which is why the runtime stage below is Debian rather than Alpine.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) export BUN_COMPILE_TARGET=bun-linux-x64 ;; \
      arm64) export BUN_COMPILE_TARGET=bun-linux-arm64 ;; \
      *) echo "docker/agent/Dockerfile: unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac && \
    cd apps/agent && bun run build:binary

# ── Runtime ──────────────────────────────────────────────────────────────────
# Debian rather than docker:cli, whose Alpine base is musl: the compiled binary carries its own
# glibc-linked Bun runtime and will not start there.
FROM debian:bookworm-slim AS runner

# docker-ce-cli and the compose plugin from Docker's own repository. `docker compose` is invoked
# for every operation this container exists to perform, so its absence is a startup failure rather
# than something to discover on the first port change.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-compose-plugin \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/apps/agent/dist/cpm-agent /app/cpm-agent

# Runs as root deliberately: it talks to the Docker API and writes to the shared data volume, which
# the controller container owns under a different uid. Reach to the daemon is narrowed by the
# docker-socket-proxy service rather than by this container's user.

ENV DATA_DIR=/data
ENV COMPOSE_DIR=/compose
ENV AGENT_MODE=standalone

# Managed mode listens here. Standalone binds a socket on the data volume and publishes nothing.
EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD /app/cpm-agent --healthcheck

ENTRYPOINT ["/app/cpm-agent"]
