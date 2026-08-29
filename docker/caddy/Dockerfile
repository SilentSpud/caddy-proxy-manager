# Builder on the host arch (BUILDPLATFORM) with xcaddy cross-compiling via GOOS/GOARCH — avoids QEMU
# when building linux/arm64 on an x86 runner. caddy:<version>-builder rather than golang:: it ships
# xcaddy and the Go toolchain that release was built with, so cold builds skip the xcaddy compile
# and the version stops floating. Pinned to an exact tag for that second reason; it selects Go and
# xcaddy only — what gets compiled is CADDY_VERSION below.
FROM --platform=$BUILDPLATFORM caddy:2.11.4-builder AS builder

ARG TARGETOS
ARG TARGETARCH

# The Caddy source to compile, pinned so an image rebuilt tomorrow matches one rebuilt today. A
# master commit rather than a release tag, deliberately: the plugin list below carries no versions,
# so Go resolves each to its latest and those track master — building the v2.11.4 release against
# them fails to compile (cel-go renamed interpreter.Interpretable). The trade-off: a future plugin
# release can break this build the same way, surfacing as a compile error in the sidecar's build
# status; the fix is to move this pin forward.
ARG CADDY_VERSION=d6637934e866

# Plugins compiled into the binary: whitespace-separated Go module paths with an optional @version.
# Settings → Caddy Build overrides this through a generated compose override. Keep in sync with
# CADDY_MODULES in src/lib/caddy-modules.ts — tests/unit/caddy-modules.test.ts asserts the two
# match. Declared in this stage only; the runtime stage reads the resolved list from a file the
# build writes, since ARG scope is per stage.
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

# Build Caddy with the selected plugins. The module list is expanded into `--with` flags here, so
# the build arg stays a plain list the app can generate and diff without knowing xcaddy's syntax;
# word splitting separates them, and paths are allowlisted upstream (validateCustomModule). The
# cache mounts matter for the rebuild-from-the-UI flow — without them every module change recompiles
# from scratch. BuildKit keeps them on the same daemon the sidecar talks to.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    set -eu; \
    args=""; \
    for module in ${CADDY_MODULES}; do \
        args="${args} --with ${module}"; \
    done; \
    echo "Building Caddy with:${args:- no plugins}"; \
    GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build ${CADDY_VERSION} ${args} --output /usr/bin/caddy; \
    printf '%s\n' "${CADDY_MODULES}" > /caddy-modules.txt

# Alpine, matching the builder's base: the xcaddy binary is statically linked, and keeping both
# stages on one distro means it stays that way even if a plugin pulls in cgo. Not caddy:<version>
# itself — this stage overwrites /usr/bin/caddy, so the official binary would sit in a lower layer
# as ~50MB of dead weight. wget is busybox's, which the compose healthcheck uses unchanged.
FROM alpine:3.23

# Accept build args for user/group IDs to support rootless operation
# Using 10000 as default to avoid conflicts with system users
ARG PUID=10000
ARG PGID=10000

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create the caddy user and directories with configurable IDs for rootless operation, removing any
# existing user/group with the same UID/GID to avoid conflicts.
#
# `shadow` supplies useradd/groupadd/userdel/groupdel, which busybox does not — Alpine's
# adduser/addgroup have different flags and semantics. Installing it for this one layer and
# removing it again keeps the ID-remapping logic identical to what it has always been (it decides
# ownership of the /data, /config and /logs volumes) without leaving the tooling in the image.
RUN apk add --no-cache --virtual .user-setup shadow && \
    (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} caddy && \
    useradd -r -u ${PUID} -g caddy -m -d /home/caddy caddy && \
    mkdir -p /data /config /logs /acme-ca && \
    chown -R caddy:caddy /data /config /logs /home/caddy && \
    chmod 0777 /acme-ca && \
    apk del .user-setup

# Record what this image was built with, so an image is inspectable on its own:
# `docker run --rm <image> cat /etc/caddy/caddy-modules.txt`. Copied from the builder rather than
# re-read from a build arg — ARG is per stage, and this is written from the very variable the build
# looped over, so it cannot disagree with the binary beside it.
COPY --from=builder /caddy-modules.txt /etc/caddy/caddy-modules.txt

COPY --chown=caddy:caddy docker/caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 2019

# Set environment variables to use /data and /config like official Caddy image
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

# Run as non-root user (fully rootless)
USER caddy

CMD ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
