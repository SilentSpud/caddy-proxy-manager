#!/bin/sh
# Compile Caddy with the requested plugins at the versions go.mod pins.
#
# Two inputs, deliberately separate:
#   * CADDY_MODULES — *which* plugins, a whitespace-separated list the app generates from the
#     operator's selection in Settings -> Caddy Build. Bare paths, or path@version for a custom
#     module the operator supplied a version for.
#   * go.mod        — *which version* of each known plugin, plus Caddy itself and the cel-go
#     compatibility replacement. Updated by Dependabot and update-compatibility-pins.sh.
#
# Resolving versions here rather than in CADDY_MODULES keeps the app's desired/applied diff
# comparing like with like: the agent records the requested list, and a pin moving is a reviewed
# code change rather than something that makes the UI claim a rebuild is pending.
set -eu

# The pinned version of a module, or empty when go.mod does not carry it — which is the normal case
# for a custom module the operator pasted in. `go list -m` reports a replacement's version when one
# is in effect, so the cel-go replace below reads back the version actually compiled.
module_version() {
    go list -m -f '{{if .Replace}}{{.Replace.Version}}{{else}}{{.Version}}{{end}}' "$1" 2>/dev/null || true
}

caddy_version="$(module_version github.com/caddyserver/caddy/v2)"
if [ -z "$caddy_version" ]; then
    echo "go.mod does not pin github.com/caddyserver/caddy/v2" >&2
    exit 1
fi

set -- "$caddy_version"
resolved=""
unpinned=""

for spec in ${CADDY_MODULES:-}; do
    case "$spec" in
        *@*)
            # The operator pinned it themselves; pass it through untouched.
            with="$spec"
            ;;
        *)
            version="$(module_version "$spec")"
            if [ -n "$version" ]; then
                with="$spec@$version"
            else
                # A custom module outside the catalog. Floats to latest, as it did before go.mod
                # existed — flagged in the build log so an unpinned build is not a silent one.
                with="$spec"
                unpinned="$unpinned $spec"
            fi
            ;;
    esac
    set -- "$@" --with "$with"
    resolved="$resolved $with"
done

# caddy-blocker-plugin tracks Caddy master and asks for a newer cel-go than the pinned stable Caddy
# release compiles against. update-compatibility-pins.sh derives the replacement from that release's
# own go.mod, so this stays a release tag instead of a floating master commit.
cel_go_version="$(module_version github.com/google/cel-go)"
if [ -n "$cel_go_version" ]; then
    set -- "$@" --replace "github.com/google/cel-go=github.com/google/cel-go@$cel_go_version"
fi

echo "Building Caddy $caddy_version with:${resolved:- no plugins}"
if [ -n "$unpinned" ]; then
    echo "WARNING: no pinned version in go.mod for:$unpinned"
fi

GOOS="$TARGETOS" GOARCH="$TARGETARCH" xcaddy build "$@" --output /usr/bin/caddy

# The exact versions that went into the binary, so an image can be audited on its own:
#   docker run --rm <image> cat /etc/caddy/caddy-modules.resolved.txt
printf '%s\n' "${resolved# }" > /caddy-modules.resolved.txt
