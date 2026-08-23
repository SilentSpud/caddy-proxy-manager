#!/usr/bin/env bash
# Master → slave replication between two complete CPM installations.
#
# Runs only when the `sync` compose profile is up (./run.sh --sync), because it
# needs a second web+Caddy pair. Everything else in the suite works without it.
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

banner "instance synchronisation"

if [ "${TEST_SYNC:-0}" != "1" ]; then
  skip "instance synchronisation" "not enabled — run ./run.sh --sync"
  finish
fi

SYNC_TOKEN="docker-test-sync-token-that-is-long-enough-0123456789"
SLAVE_JAR="$STATE_DIR/slave-cookies.txt"
SLAVE_TOKEN_FILE="$STATE_DIR/slave-api-token"

restore_master_mode() { api PUT /api/v1/settings/instance-mode '{"mode":"standalone"}' >/dev/null 2>&1; }
trap 'restore_master_mode; cleanup_tracked' EXIT

# Runs an API call against the slave rather than the master.
slave_api() {
  local API_BASE="$CPM_SLAVE_API" API_TOKEN
  API_TOKEN=$(cat "$SLAVE_TOKEN_FILE" 2>/dev/null)
  api "$@"
}

# ── Bring the slave up ──────────────────────────────────────────────────────

if ! wait_for "the slave API" 180 curl -sSf --max-time 5 -o /dev/null "$CPM_SLAVE_API/api/health"; then
  fail "the slave instance is reachable" "no health response from $CPM_SLAVE_API"
  finish
fi
pass "the slave instance is reachable"

rm -f "$SLAVE_JAR"
signin=$(cpm_sign_in "$CPM_SLAVE_API" "$SLAVE_JAR" "$CPM_ADMIN_USER" "$CPM_ADMIN_PASSWORD")
t_eq "the slave accepts the same admin credentials" "200" "$signin"

cpm_mint_token "$CPM_SLAVE_API" "$SLAVE_JAR" "docker-test-suite" >"$SLAVE_TOKEN_FILE"

if [ ! -s "$SLAVE_TOKEN_FILE" ]; then
  fail "an API token can be minted on the slave" "no raw_token returned"
  finish
fi
pass "an API token can be minted on the slave"

# ── Configure the pair ──────────────────────────────────────────────────────

slave_api PUT /api/v1/settings/instance-mode '{"mode":"slave"}'
t_eq "the slave can be put into slave mode" "200" "$API_STATUS"

slave_api PUT /api/v1/settings/sync-token "$(jq -nc --arg t "$SYNC_TOKEN" '{token:$t}')"
t_eq "the slave accepts a sync token" "200" "$API_STATUS"

slave_api GET /api/v1/settings/sync-token
t_eq "the slave reports that a token is set" "true" "$(jqr '.has_token')"

slave_api PUT /api/v1/settings/sync-token '{"token":"too-short"}'
t_eq "the slave rejects a weak sync token" "400" "$API_STATUS"
slave_api PUT /api/v1/settings/sync-token "$(jq -nc --arg t "$SYNC_TOKEN" '{token:$t}')"

api PUT /api/v1/settings/instance-mode '{"mode":"master"}'
t_eq "the master can be put into master mode" "200" "$API_STATUS"

if create_resource instances "$(jq -nc --arg u "$CPM_SLAVE_API" --arg t "$SYNC_TOKEN" \
    '{name:"docker-test slave", baseUrl:$u, apiToken:$t, enabled:true}')"; then
  pass "the slave can be registered on the master"
  instance_id="$NEW_ID"
else
  fail "the slave can be registered on the master" "HTTP $API_STATUS: $(printf '%.300s' "$API_BODY")"
  finish
fi

api GET /api/v1/instances
t_not_contains "the stored token is not returned in plaintext" "$SYNC_TOKEN" "$API_BODY"

# ── Replicate ───────────────────────────────────────────────────────────────

# Unique per run: the slave keeps whatever it was last sent, and once the
# master stops treating it as a target nothing removes the old copy. A fresh
# domain each run keeps the "not there yet" assertion meaningful in a rig that
# has been used before.
synced_domain=$(domain_for "synced-$$")

slave_api GET /api/v1/proxy-hosts
t_not_contains "the domain does not exist on the slave yet" "$synced_domain" "$API_BODY"

create_host_or_fail "a host can be created on the master" "$(jq -nc --arg d "$synced_domain" '{
  name: "docker-test synced host", domains: [$d], upstreams: ["origin-b:8080"], hstsEnabled: true
}')" && pass "a host can be created on the master"
synced_host_id="$NEW_ID"

# Replication is not a scheduled job the operator has to remember: applying the
# Caddy config pushes to every registered slave, so a create lands downstream
# without anything else happening.
if wait_for "the host to replicate on its own" 30 \
     bash -c "curl -sS --max-time 5 -H 'Authorization: Bearer $(cat "$SLAVE_TOKEN_FILE")' \
       '$CPM_SLAVE_API/api/v1/proxy-hosts' | grep -q '$synced_domain'"; then
  pass "creating a host replicates without an explicit sync"
else
  fail "creating a host replicates without an explicit sync" "$synced_domain never reached the slave"
fi

api POST /api/v1/instances/sync
t_eq "a sync can be triggered" "200" "$API_STATUS"
t_eq "the sync reports one target" "1" "$(jqr '.total')"
t_eq "the sync reports success" "1" "$(jqr '.success')"
t_eq "the sync skipped nothing for being plaintext" "0" "$(jqr '.skippedHttp')"

slave_api GET /api/v1/proxy-hosts
t_contains "the host arrived on the slave" "$synced_domain" "$API_BODY"
t_contains "the replicated host kept its name" "docker-test synced host" "$API_BODY"
t_contains "the replicated host kept its upstream" "origin-b:8080" "$API_BODY"

api GET /api/v1/instances
t_ne "the master recorded the sync result" "null" "$(jqr '.[0].lastSyncAt')"

# ── Updates replicate too ───────────────────────────────────────────────────

api PUT "/api/v1/proxy-hosts/$synced_host_id" "$(jq -nc --arg d "$synced_domain" '{
  name: "docker-test synced host (renamed)", domains: [$d], upstreams: ["origin-a:8080"]
}')" 2>/dev/null
api POST /api/v1/instances/sync

slave_api GET /api/v1/proxy-hosts
t_contains "an update replicates on the next sync" "docker-test synced host (renamed)" "$API_BODY"

# ── Authentication on the receiving end ─────────────────────────────────────

bad=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -H 'Authorization: Bearer wrong-sync-token' -H 'Content-Type: application/json' \
  --data-binary '{"generated_at":"2020-01-01T00:00:00.000Z","settings":{},"data":{}}' \
  "$CPM_SLAVE_API/api/instances/sync")
t_eq "the slave rejects a payload with the wrong token" "401" "$bad"

none=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  --data-binary '{"generated_at":"2020-01-01T00:00:00.000Z","settings":{},"data":{}}' \
  "$CPM_SLAVE_API/api/instances/sync")
t_eq "the slave rejects an unauthenticated payload" "401" "$none"

# ── Removing a target ───────────────────────────────────────────────────────
#
# The REST API exposes create, list and delete for instances; there is no
# update route, so removal is the way a target stops receiving pushes.

api DELETE "/api/v1/instances/$instance_id"
t_matches "a sync target can be removed" '^(200|204)$' "$API_STATUS"
# The teardown DELETE for this id is now a no-op 404, which is harmless — and
# leaving it registered is safer than clearing the whole stack, which still
# holds the proxy host created above.

api GET /api/v1/instances
t_not_contains "the removed target is gone from the listing" "docker-test slave" "$API_BODY"

api POST /api/v1/instances/sync
t_eq "a master with no targets syncs nothing" "0" "$(jqr '.total')"

restore_master_mode
api POST /api/v1/instances/sync
t_eq "a standalone instance syncs nothing" "0" "$(jqr '.total')"

finish
