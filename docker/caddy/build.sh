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
# for a custom module the operator pasted in.
#
# Deliberately the version the module is *required* at, not the one it resolves to: a replaced
# module resolves to its replacement's version, which is not a version the original path has, so
# feeding that back as `--with path@version` asks for something that does not exist. The
# replacements travel separately, below.
module_version() {
    go list -m -f '{{.Version}}' "$1" 2>/dev/null || true
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

# Every replacement go.mod declares, passed through as-is.
#
# Read from go.mod rather than listed here, because there are two unrelated reasons for one and
# both have to reach the build: a compatibility pin (cel-go, which caddy-blocker-plugin wants newer
# than the pinned Caddy release compiles against), and a plugin temporarily pointed at a fork
# carrying a fix that upstream has not merged. Each says why it exists in go.mod, next to itself.
#
# Not a `while read` loop: that runs in a subshell, and the positional arguments it appended would
# be discarded with it. Replacements to a local directory are skipped — they have no version, and
# nothing in a reproducible image build should depend on a path outside it.
replacements="$(go list -m -f '{{if and .Replace .Replace.Version}}{{.Path}}={{.Replace.Path}}@{{.Replace.Version}}{{end}}' all 2>/dev/null | grep . || true)"
for replacement in $replacements; do
    set -- "$@" --replace "$replacement"
done

echo "Building Caddy $caddy_version with:${resolved:- no plugins}"
if [ -n "$replacements" ]; then
    echo "Replacements:"
    for replacement in $replacements; do
        echo "  $replacement"
    done
fi
if [ -n "$unpinned" ]; then
    echo "WARNING: no pinned version in go.mod for:$unpinned"
fi

GOOS="$TARGETOS" GOARCH="$TARGETARCH" xcaddy build "$@" --output /usr/bin/caddy

# The exact versions that went into the binary, so an image can be audited on its own:
#   docker run --rm <image> cat /etc/caddy/caddy-modules.resolved.txt
#
# Replacements are recorded beside them, because "which caddy-tailscale is actually in here" is
# exactly the question this file exists to answer, and the module list alone would say the wrong one.
{
    printf '%s\n' "${resolved# }"
    for replacement in $replacements; do
        printf 'replace %s\n' "$replacement"
    done
} > /caddy-modules.resolved.txt
