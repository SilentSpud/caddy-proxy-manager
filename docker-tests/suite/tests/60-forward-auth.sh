#!/usr/bin/env bash
# CPM's built-in forward auth: an unauthenticated request is bounced to the
# portal, a full login round-trip issues a session cookie, identity headers are
# injected for the upstream, per-host access is enforced, and client-supplied
# identity headers are stripped.
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

banner "forward authentication"

JAR="$STATE_DIR/fa-cookies.txt"
rm -f "$JAR"

domain=$(domain_for "forward-auth")
create_host_or_fail "a forward-auth host can be created" "$(jq -nc --arg d "$domain" '{
  name: "docker-test forward auth",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  cpmForwardAuth: { enabled: true, excluded_paths: ["/open/*"] }
}')" || finish
pass "a forward-auth host can be created"
host_id="$NEW_ID"

wait_for_https "$domain" 120

# ── Unauthenticated access ──────────────────────────────────────────────────

fetch "https://$domain/private/page"
t_eq "an unauthenticated request is bounced" "302" "$FETCH_CODE"
portal_url=$(header_value location)
t_contains "the bounce points at the CPM portal" "$CPM_API/portal" "$portal_url"
t_contains "the bounce carries the original URL" "rd=https://$domain/private/page" "$portal_url"

t_eq "an excluded path is served without authentication" "200" "$(http_code "https://$domain/open/health")"

body=$(http_body "https://$domain/open/health")
t_contains "the excluded path reaches the upstream" "origin-a" "$body"

# Identity headers are injected by CPM alone. A client that supplies its own
# must not have them reach the upstream — on any route, authenticated or not.
spoof=$(http_body "https://$domain/open/spoof" \
  -H 'X-CPM-User: mallory' -H 'X-CPM-Email: mallory@evil.example' -H 'X-CPM-Groups: admins')
t_not_contains "a spoofed identity header is stripped (user)" "mallory" "$spoof"
t_not_contains "a spoofed identity header is stripped (groups)" "admins" "$spoof"

# ── Access control ──────────────────────────────────────────────────────────
#
# Forward auth denies by default: a user needs an explicit grant on the host.

api GET "/api/v1/proxy-hosts/$host_id/forward-auth-access"
t_eq "host access starts empty" "200" "$API_STATUS"

portal_login() {  # portal_login USERNAME PASSWORD -> prints the callback URL
  local user="$1" pass="$2"
  local portal rid_candidates rid response

  portal=$(curl -sS --max-time 15 "$CPM_API/portal?rd=$(printf '%s' "https://$domain/private/page" | jq -sRr @uri)" 2>/dev/null)
  # The portal mints a single-use redirect intent and hands the client only its
  # opaque id; it is rendered into the page, so pick it out of the markup.
  rid_candidates=$(printf '%s' "$portal" | grep -oE '[0-9a-f]{32}' | sort -u)
  for rid in $rid_candidates; do
    response=$(curl -sS --max-time 15 -H 'Content-Type: application/json' -H "Origin: $CPM_API" \
      --data-binary "$(jq -nc --arg u "$user" --arg p "$pass" --arg r "$rid" \
        '{username:$u, password:$p, rid:$r}')" \
      "$CPM_API/api/forward-auth/login" 2>/dev/null)
    LAST_LOGIN_RESPONSE="$response"
    local target; target=$(printf '%s' "$response" | jq -r '.redirectTo // empty' 2>/dev/null)
    if [ -n "$target" ]; then printf '%s' "$target"; return 0; fi
    # A 403 means the credentials were fine but the grant is missing — that is
    # a real answer, not a wrong rid, so stop trying other candidates.
    case "$response" in *"do not have access"*) return 1 ;; esac
  done
  return 1
}

LAST_LOGIN_RESPONSE=
if portal_login "$CPM_ADMIN_USER" "$CPM_ADMIN_PASSWORD" >/dev/null; then
  fail "login is refused without a host grant" "the login succeeded before access was granted"
else
  t_contains "login is refused without a host grant" "do not have access" "$LAST_LOGIN_RESPONSE"
fi

api PUT "/api/v1/proxy-hosts/$host_id/forward-auth-access" '{"userIds":[1],"groupIds":[]}'
t_eq "a user can be granted access to the host" "200" "$API_STATUS"

# ── Full login round-trip ───────────────────────────────────────────────────

api GET /api/v1/forward-auth-sessions
sessions_before="$API_BODY"

callback=$(portal_login "$CPM_ADMIN_USER" "$CPM_ADMIN_PASSWORD")
if [ -z "$callback" ]; then
  fail "the portal issues an exchange code" "$(printf '%.300s' "$LAST_LOGIN_RESPONSE")"
  finish
fi
pass "the portal issues an exchange code"
t_contains "the exchange code is redeemed on the protected domain" "https://$domain/.cpm-auth/callback" "$callback"

# Caddy routes /.cpm-auth/callback back to CPM; redeeming sets the session
# cookie on the protected domain and bounces to the originally requested URL.
fetch "$callback" -c "$JAR"
t_eq "redeeming the code redirects back to the original URL" "302" "$FETCH_CODE"
t_eq "the redirect returns to where the client started" "https://$domain/private/page" "$(header_value location)"
t_contains "a forward-auth session cookie is issued" "_cpm_fa" "$(cat "$JAR" 2>/dev/null)"

fetch "https://$domain/private/page" -b "$JAR"
t_eq "the authenticated request is served" "200" "$FETCH_CODE"
t_eq "it reaches the upstream" "origin-a" "$(fetch_json '.origin')"

# Regression: these four were red when the rig was first run, against a real
# defect. The generated handle_response block read each value back through
# `{http.reverse_proxy.header.X-CPM-User}`, and that placeholder does not
# resolve — Go canonicalises the stored header key to `X-Cpm-User` and Caddy
# indexes the map with the literal name from the placeholder. The empty-value
# guard (`not vars ... ""`) then matched, the copy route was skipped, and every
# upstream behind CPM forward auth received an anonymous request.
#
# Fixed by canonicalising the placeholder in caddy.ts; pinned at the unit level
# too, in tests/unit/caddy-forward-auth-copy-headers.test.ts.
t_eq "the upstream is told who the user is" "$CPM_ADMIN_USER" "$(fetch_json '.headers["x-cpm-user"]')"
t_eq "the upstream is told the user's email" "$CPM_ADMIN_USER@localhost" "$(fetch_json '.headers["x-cpm-email"]')"
t_eq "the upstream is told the user's id" "1" "$(fetch_json '.headers["x-cpm-user-id"]')"

# Even with a valid session, a forged header must be replaced rather than
# passed through alongside the real one.
fetch "https://$domain/private/page" -b "$JAR" -H 'X-CPM-User: mallory'
t_eq "a forged identity header is overwritten for an authenticated user" \
  "$CPM_ADMIN_USER" "$(fetch_json '.headers["x-cpm-user"]')"

# ── Session revocation ──────────────────────────────────────────────────────

api GET /api/v1/forward-auth-sessions
t_eq "forward-auth sessions can be listed" "200" "$API_STATUS"

# Pick the session this run created rather than trusting the listing order:
# sessions from an earlier run in the same container are still in the table,
# and revoking one of those would prove nothing about the cookie in hand.
session_id=$(jqr '[.[]? | select(.id as $i | ($known | index($i)) | not) | .id] | .[0]' \
  --argjson known "$(printf '%s' "$sessions_before" | jq -c '[.[]?.id]')")

if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
  api DELETE "/api/v1/forward-auth-sessions/$session_id"
  t_matches "a forward-auth session can be revoked" '^(200|204)$' "$API_STATUS"

  if wait_for "the revoked session to stop working" 30 \
       bash -c "[ \"\$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' --cacert '$CA_BUNDLE' -b '$JAR' 'https://$domain/private/page' 2>/dev/null)\" = '302' ]"; then
    pass "a revoked session is bounced back to the portal"
  else
    fail "a revoked session is bounced back to the portal" \
      "still returns $(http_code "https://$domain/private/page" -b "$JAR")"
  fi
else
  fail "forward-auth sessions can be listed" "the listing was empty after a successful login"
fi

# ── Revoking the grant ──────────────────────────────────────────────────────

api PUT "/api/v1/proxy-hosts/$host_id/forward-auth-access" '{"userIds":[],"groupIds":[]}'
t_eq "a host grant can be withdrawn" "200" "$API_STATUS"

LAST_LOGIN_RESPONSE=
portal_login "$CPM_ADMIN_USER" "$CPM_ADMIN_PASSWORD" >/dev/null
t_contains "login is refused again once the grant is withdrawn" "do not have access" "$LAST_LOGIN_RESPONSE"

finish
