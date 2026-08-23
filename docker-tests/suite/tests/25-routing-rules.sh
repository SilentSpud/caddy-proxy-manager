#!/usr/bin/env bash
# Per-host request shaping: location rules, redirects, prefix rewrite, path
# blocks and their allow-list escape hatch, path rewrites, and error pages.
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

banner "routing rules"

# ── Location rules ──────────────────────────────────────────────────────────
#
# A path pattern that overrides the host's default upstream. The catch-all must
# keep working for everything the pattern does not cover.

loc=$(domain_for "locations")
create_host_or_fail "a host with location rules can be created" "$(jq -nc --arg d "$loc" '{
  name: "docker-test locations",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  locationRules: [
    { path: "/api/*", upstreams: ["origin-b:8080"] },
    { path: "/exact", upstreams: ["origin-b:8080"] }
  ]
}')" && pass "a host with location rules can be created"

wait_for_https "$loc" 120

fetch "https://$loc/"
t_eq "the catch-all still reaches the default upstream" "origin-a" "$(fetch_json '.origin')"

fetch "https://$loc/api/things"
t_eq "a matching path is routed to the rule's upstream" "origin-b" "$(fetch_json '.origin')"
t_eq "the rule does not mangle the path" "/api/things" "$(fetch_json '.path')"

fetch "https://$loc/exact"
t_eq "an exact-path rule matches" "origin-b" "$(fetch_json '.origin')"

fetch "https://$loc/exactly-not"
t_eq "an exact-path rule does not match a longer path" "origin-a" "$(fetch_json '.origin')"

# ── Redirects ───────────────────────────────────────────────────────────────

red=$(domain_for "redirects")
create_host_or_fail "a host with redirects can be created" "$(jq -nc --arg d "$red" '{
  name: "docker-test redirects",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  redirects: [
    { from: "/.well-known/carddav", to: "/remote.php/dav/", status: 301 },
    { from: "/temporary", to: "https://elsewhere.cpm.test/there", status: 302 }
  ]
}')" && pass "a host with redirects can be created"

wait_for_https "$red" 120

fetch "https://$red/.well-known/carddav"
t_eq "a 301 redirect rule fires" "301" "$FETCH_CODE"
t_eq "the 301 sends the configured target" "/remote.php/dav/" "$(header_value location)"

fetch "https://$red/temporary"
t_eq "a 302 redirect rule fires" "302" "$FETCH_CODE"
t_eq "the 302 can point at an absolute URL" "https://elsewhere.cpm.test/there" "$(header_value location)"

fetch "https://$red/not-redirected"
t_eq "unmatched paths are proxied normally" "200" "$FETCH_CODE"

# ── Prefix rewrite ──────────────────────────────────────────────────────────
#
# The prefix is prepended to every request URI before it leaves for the
# upstream — the usual shape for an app mounted under a sub-path.

rw=$(domain_for "prefix-rewrite")
create_host_or_fail "a host with a prefix rewrite can be created" "$(jq -nc --arg d "$rw" '{
  name: "docker-test prefix rewrite",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  rewrite: { path_prefix: "/recipes" }
}')" && pass "a host with a prefix rewrite can be created"

wait_for_https "$rw" 120

fetch "https://$rw/list"
t_eq "the prefix is prepended before the upstream sees the request" "/recipes/list" "$(fetch_json '.path')"

fetch "https://$rw/list?page=2"
t_eq "the query string survives the rewrite" "page=2" "$(fetch_json '.query')"

# ── Path blocks, allows and rewrites ────────────────────────────────────────

paths=$(domain_for "path-rules")
create_host_or_fail "a host with path rules can be created" "$(jq -nc --arg d "$paths" '{
  name: "docker-test path rules",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  pathBlocks: [
    { path: "/admin/*", status: 403, body: "blocked by policy" },
    { path: "/teapot", status: 418 }
  ],
  pathAllows: [
    { path: "/admin/public/*" }
  ],
  pathRewrites: [
    { from: "/secretpath", to: "/hidden-target" }
  ]
}')" && pass "a host with path rules can be created"

wait_for_https "$paths" 120

fetch "https://$paths/admin/settings"
t_eq "a blocked path is refused" "403" "$FETCH_CODE"
t_eq "the block serves the configured body" "blocked by policy" "$FETCH_BODY"

fetch "https://$paths/teapot"
t_eq "a block can use any allowed status code" "418" "$FETCH_CODE"

fetch "https://$paths/admin/public/logo.png"
t_eq "an allow rule punches through the block" "200" "$FETCH_CODE"
t_eq "the allowed path still reaches the upstream" "/admin/public/logo.png" "$(fetch_json '.path')"

fetch "https://$paths/secretpath"
t_eq "a path rewrite is applied internally" "200" "$FETCH_CODE"
t_eq "the upstream sees the rewritten path" "/hidden-target" "$(fetch_json '.path')"

fetch "https://$paths/ordinary"
t_eq "unaffected paths are untouched" "/ordinary" "$(fetch_json '.path')"

# ── Error pages ─────────────────────────────────────────────────────────────
#
# These cover errors Caddy itself produces, so the host is pointed at a port
# nothing is listening on to force a gateway error.

err=$(domain_for "error-pages")
create_host_or_fail "a host with custom error pages can be created" "$(jq -nc --arg d "$err" '{
  name: "docker-test error pages",
  domains: [$d],
  upstreams: ["origin-a:9"],
  errorPages: [
    { statuses: [502, 503, 504], body: "<h1>the origin is having a moment</h1>",
      contentType: "text/html; charset=utf-8" }
  ]
}')" && pass "a host with custom error pages can be created"

wait_for_https "$err" 120

fetch "https://$err/"
t_matches "a dead upstream produces a gateway error" '^(502|503|504)$' "$FETCH_CODE"
t_contains "the custom error body is served" "the origin is having a moment" "$FETCH_BODY"
t_contains "the custom content type is honoured" "text/html" "$(header_value content-type)"

finish
