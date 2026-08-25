# Always run the builder on the host arch (BUILDPLATFORM) and let xcaddy
# cross-compile Caddy for the target arch via GOOS/GOARCH. This avoids QEMU
# emulation when producing the linux/arm64 image on an x86 GitHub runner —
# native cross-compilation is several times faster.
FROM --platform=$BUILDPLATFORM golang:1.27 AS builder

ARG TARGETOS
ARG TARGETARCH

# Plugins compiled into the binary, whitespace-separated Go module paths with an
# optional @version. The default is the full set Caddy Proxy Manager supports,
# so a plain `docker compose build` produces the same image it always has.
#
# Settings → Caddy Build overrides this through a generated compose override
# (docker-compose.caddy-build.yml) when an operator turns modules off or adds
# their own. Keep this list in sync with CADDY_MODULES in src/lib/caddy-modules.ts —
# that registry is what tells the UI which settings a given module powers.
# tests/unit/caddy-modules.test.ts asserts the two match, so a module added to
# one and not the other fails the suite rather than shipping a dead toggle.
#
# Declared inside this stage, the only stage that consumes it. ARG scope is per
# stage, so the runtime stage below cannot see it — rather than duplicating the
# list there (two copies to drift) or leaning on global-ARG inheritance, the
# build writes the resolved list to a file that the runtime stage copies.
ARG CADDY_MODULES="\
github.com/caddy-dns/cloudflare \
github.com/caddy-dns/route53 \
github.com/caddy-dns/digitalocean \
github.com/caddy-dns/duckdns \
github.com/caddy-dns/hetzner \
github.com/caddy-dns/vultr \
github.com/caddy-dns/porkbun \
github.com/caddy-dns/godaddy \
github.com/caddy-dns/namecheap \
github.com/caddy-dns/ovh \
github.com/caddy-dns/ionos \
github.com/caddy-dns/linode \
github.com/caddy-dns/njalla \
github.com/caddy-dns/spaceship \
github.com/caddy-dns/desec \
github.com/caddy-dns/dynu \
github.com/caddy-dns/acmedns \
github.com/caddy-dns/infomaniak \
github.com/mholt/caddy-l4 \
github.com/fuomag9/caddy-blocker-plugin \
github.com/corazawaf/coraza-caddy/v2"

# Install xcaddy
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build Caddy with the selected plugins.
#
# The module list is expanded into `--with` flags here rather than being passed
# through pre-formatted, so the build arg stays a plain list that the app can
# generate, diff, and display without knowing xcaddy's flag syntax. Paths are
# validated against an allowlist before they reach this point
# (validateCustomModule in src/lib/caddy-modules.ts) — word splitting is what
# separates them, so a path containing shell metacharacters must never get here.
RUN set -eu; \
    args=""; \
    for module in ${CADDY_MODULES}; do \
        args="${args} --with ${module}"; \
    done; \
    echo "Building Caddy with:${args:- no plugins}"; \
    GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build master ${args} --output /usr/bin/caddy; \
    printf '%s\n' "${CADDY_MODULES}" > /caddy-modules.txt

FROM ubuntu:26.04

# Accept build args for user/group IDs to support rootless operation
# Using 10000 as default to avoid conflicts with system users
ARG PUID=10000
ARG PGID=10000

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create caddy user and directories with configurable IDs for rootless operation
# Remove any existing users/groups with the same UID/GID to avoid conflicts
RUN (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} caddy && \
    useradd -r -u ${PUID} -g caddy -m -d /home/caddy caddy && \
    mkdir -p /data /config /logs /acme-ca && \
    chown -R caddy:caddy /data /config /logs /home/caddy && \
    chmod 0777 /acme-ca

# Record what this image was built with. The app learns the module set from the
# record its sidecar writes after a successful rebuild (caddy-build.applied.json
# on the shared data volume); this file is the same answer carried by the image
# itself, so an image is inspectable on its own —
# `docker run --rm <image> cat /etc/caddy/caddy-modules.txt` says which plugins
# this binary actually has, with no volume and no running stack needed.
#
# Copied from the builder rather than re-read from a build arg: ARG is scoped per
# stage, so recording it here would need either a second copy of the default list
# (two lists to drift apart) or a reliance on global-ARG inheritance. This file is
# written from the very variable the build looped over, so it cannot disagree
# with the binary sitting next to it.
COPY --from=builder /caddy-modules.txt /etc/caddy/caddy-modules.txt

COPY --chown=caddy:caddy docker/caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 2019

# Set environment variables to use /data and /config like official Caddy image
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

# Run as non-root user (fully rootless)
USER caddy

CMD ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
