# syntax=docker/dockerfile:1.6@sha256:ac85f380a63b13dfcefa89046420e1781752bab202122f8f50032edf31be0021

# Builder on the host arch (BUILDPLATFORM) with xcaddy cross-compiling via GOOS/GOARCH — avoids QEMU
# when building linux/arm64 on an x86 runner. caddy:<version>-builder rather than golang:: it ships
# xcaddy and the Go toolchain that release was built with, so cold builds skip the xcaddy compile
# and the version stops floating. Pinned to an exact tag for that second reason; it selects the Go
# toolchain and xcaddy only — what gets compiled is pinned in docker/caddy/go.mod. The two are
# allowed to drift: this tag is the xcaddy pin, go.mod is the Caddy and plugin pin.
FROM --platform=$BUILDPLATFORM caddy:2.11.4-builder AS builder

ARG TARGETOS
ARG TARGETARCH

# What gets compiled — Caddy's own version and every plugin's — is pinned in docker/caddy/go.mod,
# which build.sh reads. Dependabot updates it weekly, and update-compatibility-pins.sh keeps the
# cel-go replacement consistent with the pinned Caddy release — which is what lets that be a release
# tag rather than the master commit this used to track.
WORKDIR /build
COPY docker/caddy/go.mod docker/caddy/go.sum docker/caddy/build.sh ./

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

# build.sh expands the list into `--with path@version` flags, resolving each version from go.mod, so
# the build arg stays a plain list the app can generate and diff without knowing xcaddy's syntax or
# carrying versions; word splitting separates the entries, and paths are allowlisted upstream
# (validateCustomModule). The cache mounts matter for the rebuild-from-the-UI flow — without them
# every module change recompiles from scratch. BuildKit keeps them on the same daemon the sidecar
# talks to.
#
# What lands in /caddy-modules.txt is the requested list, not build.sh's resolved one: the sidecar
# records that same unresolved list as "applied", and the two must match or the UI reports a rebuild
# that already happened. The exact versions go to /caddy-modules.resolved.txt instead.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    set -eu; \
    CADDY_MODULES="${CADDY_MODULES}" TARGETOS="$TARGETOS" TARGETARCH="$TARGETARCH" sh ./build.sh; \
    printf '%s\n' "${CADDY_MODULES}" > /caddy-modules.txt

# Alpine, matching the builder's base: the xcaddy binary is statically linked, and keeping both
# stages on one distro means it stays that way even if a plugin pulls in cgo. Not caddy:<version>
# itself — this stage overwrites /usr/bin/caddy, so the official binary would sit in a lower layer
# as ~50MB of dead weight. wget is busybox's, which the compose healthcheck uses unchanged.
FROM alpine:3.24

# Accept build args for user/group IDs to support rootless operation
# Using 10000 as default to avoid conflicts with system users
ARG PUID=10000
ARG PGID=10000

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create the caddy user and directories with configurable IDs for rootless operation, removing any
# existing user/group with the same UID/GID. `shadow` supplies useradd/userdel, which busybox does
# not; installing it for one layer and removing it keeps the ID-remapping logic — which decides
# ownership of /data, /config and /logs — unchanged, without shipping the tooling.
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
COPY --from=builder /caddy-modules.resolved.txt /etc/caddy/caddy-modules.resolved.txt

COPY --chown=caddy:caddy docker/caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 2019

# Set environment variables to use /data and /config like official Caddy image
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

# Run as non-root user (fully rootless)
USER caddy

CMD ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
