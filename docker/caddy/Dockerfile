# Always run the builder on the host arch (BUILDPLATFORM) and let xcaddy
# cross-compile Caddy for the target arch via GOOS/GOARCH. This avoids QEMU
# emulation when producing the linux/arm64 image on an x86 GitHub runner —
# native cross-compilation is several times faster.
#
# caddy:<version>-builder rather than golang:: it ships xcaddy already installed
# and a Go toolchain the Caddy maintainers built that release with. That buys two
# things over `golang: + go install xcaddy@latest`. The xcaddy compile step
# disappears from every cold build — including the ones operators trigger from
# Settings -> Caddy Build — and the version stops floating, so an upstream xcaddy
# release can no longer change this image with no commit here.
#
# Pinned to an exact tag for that second reason: the bare `builder` tag follows
# the newest Caddy release and would put the toolchain back on a moving target.
# The tag selects a Go and xcaddy version only — what actually gets compiled is
# CADDY_VERSION below, which need not be the same release.
FROM --platform=$BUILDPLATFORM caddy:2.11.4-builder AS builder

ARG TARGETOS
ARG TARGETARCH

# The Caddy source to compile, pinned so that an image rebuilt tomorrow contains
# what one rebuilt today does. With a moving source an upstream bug appears and
# disappears with no commit in this repo — which is exactly how the L4 TCP e2e
# failure behaved: it failed against a stale image and passed the moment the
# image was rebuilt, with nothing here having changed.
#
# This is a master commit rather than a release tag, and deliberately so. The
# plugin list below carries no versions, so Go resolves each to its latest,
# and those track Caddy's master. Building the v2.11.4 *release* against them
# fails to compile: the plugins pull a cel-go new enough to have renamed
# interpreter.Interpretable, which that release's own celmatcher.go predates.
# Master has absorbed that change; the last release has not.
#
# The consequence to know about: pinning Caddy while the plugins float means a
# future plugin release can break this build the same way. That surfaces as a
# compile error in the sidecar's build status, not as a silent behaviour change,
# and the fix is to move this pin forward. Pinning every plugin too would remove
# even that, at the cost of 21 more versions to maintain.
ARG CADDY_VERSION=d6637934e866

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

# Build Caddy with the selected plugins.
#
# The module list is expanded into `--with` flags here rather than being passed
# through pre-formatted, so the build arg stays a plain list that the app can
# generate, diff, and display without knowing xcaddy's flag syntax. Paths are
# validated against an allowlist before they reach this point
# (validateCustomModule in src/lib/caddy-modules.ts) — word splitting is what
# separates them, so a path containing shell metacharacters must never get here.
# The cache mounts matter most for the rebuild-from-the-UI flow: without them
# every module-list change re-downloads all of Caddy's and the plugins'
# dependencies and recompiles from scratch. BuildKit keeps these on the host
# daemon — the same daemon the sidecar's `docker compose build caddy` talks to —
# so repeat rebuilds reuse them.
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

# Alpine rather than ubuntu:, matching the builder's base. The binary xcaddy
# produces is statically linked, so it does not care which libc is here — but
# keeping both stages on the same distro means it never will, even if a plugin
# one day pulls in cgo. It also takes the image from ~262MB to well under half.
#
# Not caddy:<version> itself: this stage overwrites /usr/bin/caddy with our own
# build, so the official image's binary would sit in a lower layer as ~50MB of
# shadowed dead weight. What that image would otherwise give us — a Caddyfile
# and the XDG variables below — this file already sets for itself.
#
# wget is busybox's, and the compose healthcheck
# (wget --quiet --tries=1 -O /dev/null http://localhost:2019/config/) works with
# it unchanged, so nothing needs installing for that.
FROM alpine:3.23

# Accept build args for user/group IDs to support rootless operation
# Using 10000 as default to avoid conflicts with system users
ARG PUID=10000
ARG PGID=10000

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create caddy user and directories with configurable IDs for rootless operation
# Remove any existing users/groups with the same UID/GID to avoid conflicts
# `shadow` supplies useradd/groupadd/userdel/groupdel, which busybox does not:
# Alpine ships adduser/addgroup with different flags and different semantics.
# Installing it for this one layer and removing it again keeps the ID-remapping
# logic identical to what it has always been — this is what decides ownership of
# the /data, /config and /logs volumes, so it is the wrong place to be clever —
# without leaving user-management tooling in the shipped image.
RUN apk add --no-cache --virtual .user-setup shadow && \
    (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} caddy && \
    useradd -r -u ${PUID} -g caddy -m -d /home/caddy caddy && \
    mkdir -p /data /config /logs /acme-ca && \
    chown -R caddy:caddy /data /config /logs /home/caddy && \
    chmod 0777 /acme-ca && \
    apk del .user-setup

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
