#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"

# caddy-blocker-plugin may request a newer cel-go API than the reviewed stable
# Caddy release supports. Derive the compatibility replacement from the exact
# pinned Caddy module instead of hand-maintaining a second version number.
caddy_version="$(go list -m -f '{{.Version}}' github.com/caddyserver/caddy/v2)"
go mod download "github.com/caddyserver/caddy/v2@${caddy_version}"
caddy_mod_file="$(go env GOMODCACHE)/cache/download/github.com/caddyserver/caddy/v2/@v/${caddy_version}.mod"
# cel-go's import path became cel.dev/cel-go at v0.32.0 — the GitHub repo moved to
# cel-expr/cel-go, but the module renamed to the vanity domain rather than the new repo. Match
# either spelling on both sides so the pin survives Caddy and the plugins migrating separately.
cel_paths="github.com/google/cel-go cel.dev/cel-go"

caddy_cel_path=""
cel_go_version=""
for path in $cel_paths; do
  cel_go_version="$(awk -v p="$path" '$1 == p { print $2; exit }' "$caddy_mod_file")"
  if [ -n "$cel_go_version" ]; then
    caddy_cel_path="$path"
    break
  fi
done

if [ -z "$cel_go_version" ]; then
  echo "Unable to resolve Caddy's cel-go compatibility version" >&2
  exit 1
fi

# Replaced under whichever path our own graph requires, which is not necessarily Caddy's during a
# migration; a replace may cross paths, so pointing the old one at the new module is valid.
replaced=""
for path in $cel_paths; do
  if go list -m "$path" >/dev/null 2>&1; then
    go mod edit "-replace=${path}=${caddy_cel_path}@${cel_go_version}"
    replaced="${replaced} ${path}"
  fi
done

if [ -z "$replaced" ]; then
  echo "No cel-go in the module graph; nothing to pin." >&2
else
  echo "Pinned${replaced} to ${caddy_cel_path}@${cel_go_version}"
fi

go mod download all
