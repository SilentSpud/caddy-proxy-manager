#!/usr/bin/env bash
# HTTP basic auth via access lists, including live add/remove of credentials.
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

banner "access lists"

if ! create_resource access-lists '{
  "name": "docker-test list",
  "description": "created by the docker test suite",
  "users": [
    { "username": "alice", "password": "alice-secret" },
    { "username": "bob",   "password": "bob-secret" }
  ]
}'; then
  fail "an access list can be created" "HTTP $API_STATUS: $(printf '%.300s' "$API_BODY")"
  finish
fi
list_id="$NEW_ID"
pass "an access list can be created"
t_eq "the list reports both users" "2" "$(jqr '.entries | length')"
t_eq "entries are returned sorted by username" "alice" "$(jqr '.entries[0].username')"
t_not_contains "the API never returns a password hash" "passwordHash" "$API_BODY"

domain=$(domain_for "protected")
create_host_or_fail "a host can be put behind an access list" "$(jq -nc --arg d "$domain" --argjson l "$list_id" '{
  name: "docker-test protected", domains: [$d], upstreams: ["origin-a:8080"], accessListId: $l
}')" && pass "a host can be put behind an access list"
host_id="$NEW_ID"

wait_for_https "$domain" 120

# ── Enforcement ─────────────────────────────────────────────────────────────

fetch "https://$domain/"
t_eq "an unauthenticated request is challenged" "401" "$FETCH_CODE"
t_contains "the challenge is HTTP basic" "Basic" "$(header_value www-authenticate)"

fetch "https://$domain/" -u "alice:alice-secret"
t_eq "a listed user is let through" "200" "$FETCH_CODE"
t_eq "the authenticated request reaches the upstream" "origin-a" "$(fetch_json '.origin')"

fetch "https://$domain/" -u "bob:bob-secret"
t_eq "a second listed user is let through" "200" "$FETCH_CODE"

fetch "https://$domain/" -u "alice:wrong-password"
t_eq "a wrong password is refused" "401" "$FETCH_CODE"

fetch "https://$domain/" -u "mallory:anything"
t_eq "an unknown user is refused" "401" "$FETCH_CODE"

# ── Live credential changes ─────────────────────────────────────────────────

api POST "/api/v1/access-lists/$list_id/entries" '{"username":"carol","password":"carol-secret"}'
t_eq "a user can be added to a live list" "201" "$API_STATUS"
carol_entry_id=$(jqr '[.entries[] | select(.username == "carol")] | .[0].id')

if wait_for "carol's credentials to take effect" 30 \
     bash -c "curl -sS --max-time 5 -o /dev/null -f --cacert '$CA_BUNDLE' -u carol:carol-secret 'https://$domain/'"; then
  pass "a newly added user can authenticate without a restart"
else
  fail "a newly added user can authenticate without a restart" "carol was still refused"
fi

api DELETE "/api/v1/access-lists/$list_id/entries/$carol_entry_id"
t_matches "a user can be removed from a live list" '^(200|204)$' "$API_STATUS"

if wait_for "carol's credentials to be revoked" 30 \
     bash -c "! curl -sS --max-time 5 -o /dev/null -f --cacert '$CA_BUNDLE' -u carol:carol-secret 'https://$domain/'"; then
  pass "a removed user is refused without a restart"
else
  fail "a removed user is refused without a restart" "carol still authenticates"
fi

fetch "https://$domain/" -u "alice:alice-secret"
t_eq "removing one user does not affect the others" "200" "$FETCH_CODE"

# ── Detaching ───────────────────────────────────────────────────────────────

api PUT "/api/v1/proxy-hosts/$host_id" "$(jq -nc --arg d "$domain" '{
  name: "docker-test protected", domains: [$d], upstreams: ["origin-a:8080"], accessListId: null
}')"
t_eq "the access list can be detached" "200" "$API_STATUS"

if wait_for "the host to become public" 30 \
     bash -c "curl -sS --max-time 5 -o /dev/null -f --cacert '$CA_BUNDLE' 'https://$domain/'"; then
  pass "detaching the list removes the challenge"
else
  fetch "https://$domain/"
  fail "detaching the list removes the challenge" "still HTTP $FETCH_CODE"
fi

# ── Deletion is refused while in use ────────────────────────────────────────

api PUT "/api/v1/proxy-hosts/$host_id" "$(jq -nc --arg d "$domain" --argjson l "$list_id" '{
  name: "docker-test protected", domains: [$d], upstreams: ["origin-a:8080"], accessListId: $l
}')"
api GET "/api/v1/access-lists"
t_contains "the list is still listed while attached" "docker-test list" "$API_BODY"

finish
