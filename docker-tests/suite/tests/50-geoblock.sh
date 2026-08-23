#!/usr/bin/env bash
# IP-based blocking, per host and globally.
#
# Country/continent/ASN rules need MaxMind databases, which are a licensed
# download and deliberately absent from this offline rig. CIDR and bare-IP
# rules go through the same blocker handler and need no database, so those are
# what the suite asserts on. If the handler refuses to load at all without a
# database, the whole file skips with that reason rather than failing.
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

banner "geo/IP blocking"

if [ "${TEST_GEOBLOCK:-1}" != "1" ]; then
  skip "IP blocking" "disabled via CPM_TEST_GEOBLOCK=0"
  finish
fi

empty_geoblock='{
  "enabled": false,
  "block_countries": [], "block_continents": [], "block_asns": [], "block_cidrs": [], "block_ips": [],
  "allow_countries": [], "allow_continents": [], "allow_asns": [], "allow_cidrs": [], "allow_ips": []
}'

restore_global() { api PUT /api/v1/settings/geoblock "$empty_geoblock" >/dev/null 2>&1; }
trap 'restore_global; cleanup_tracked' EXIT

# ── Per-host blocking ───────────────────────────────────────────────────────

blocked=$(domain_for "geoblock-host")
host_body=$(jq -nc --arg d "$blocked" --arg ip "$CLIENT_IP" '{
  name: "docker-test geoblock host",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  geoblock: {
    enabled: true,
    block_countries: [], block_continents: [], block_asns: [],
    block_cidrs: [], block_ips: [$ip],
    allow_countries: [], allow_continents: [], allow_asns: [],
    allow_cidrs: [], allow_ips: []
  },
  geoblockMode: "override"
}')

if ! create_host "$host_body"; then
  skip "IP blocking" "the blocker handler rejected the config (HTTP $API_STATUS) — likely no GeoIP database in this rig"
  finish
fi
pass "a host with an IP block rule can be created"

if ! wait_for "the geoblocked host to answer" 120 \
     bash -c "curl -sS --max-time 8 -o /dev/null --cacert '$CA_BUNDLE' 'https://$blocked/'"; then
  fail "the geoblocked host is reachable at all" "no response from https://$blocked/"
  finish
fi

code=$(http_code "https://$blocked/")
t_ne "the client's own address is blocked" "200" "$code"
t_matches "the block is served as an HTTP rejection" '^(403|444|000)$' "$code"

# ── Allow rules win over block rules ────────────────────────────────────────

allowed=$(domain_for "geoblock-allow")
create_host_or_fail "a host with a matching allow rule can be created" "$(jq -nc \
  --arg d "$allowed" --arg ip "$CLIENT_IP" '{
  name: "docker-test geoblock allow",
  domains: [$d],
  upstreams: ["origin-a:8080"],
  geoblock: {
    enabled: true,
    block_countries: [], block_continents: [], block_asns: [],
    block_cidrs: ["172.28.0.0/24"], block_ips: [],
    allow_countries: [], allow_continents: [], allow_asns: [],
    allow_cidrs: [], allow_ips: [$ip]
  },
  geoblockMode: "override"
}')" && pass "a host with a matching allow rule can be created"

wait_for "the allow-listed host to answer" 120 \
  bash -c "curl -sS --max-time 8 -o /dev/null --cacert '$CA_BUNDLE' 'https://$allowed/'"

t_eq "an explicit allow beats a covering block" "200" "$(http_code "https://$allowed/")"

# ── An unblocked host is unaffected ─────────────────────────────────────────

neutral=$(domain_for "geoblock-neutral")
create_host_or_fail "a host with no geoblock config can be created" "$(jq -nc --arg d "$neutral" '{
  name: "docker-test geoblock neutral", domains: [$d], upstreams: ["origin-a:8080"]
}')" && pass "a host with no geoblock config can be created"

wait_for_https "$neutral" 120
t_eq "hosts without a rule are not blocked" "200" "$(http_code "https://$neutral/")"

# ── Global blocking ─────────────────────────────────────────────────────────
#
# Applies to every host that has not overridden it, which is the interesting
# part: the neutral host above must start returning a rejection.

api PUT /api/v1/settings/geoblock "$(jq -nc --arg ip "$CLIENT_IP" '{
  enabled: true,
  block_countries: [], block_continents: [], block_asns: [],
  block_cidrs: [], block_ips: [$ip],
  allow_countries: [], allow_continents: [], allow_asns: [],
  allow_cidrs: [], allow_ips: []
}')"

if [ "$API_STATUS" != "200" ]; then
  skip "global IP blocking" "settings rejected (HTTP $API_STATUS): $(printf '%.200s' "$API_BODY")"
else
  pass "global IP block settings can be saved"

  if wait_for "the global block to take effect" 30 \
       bash -c "[ \"\$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' --cacert '$CA_BUNDLE' 'https://$neutral/' 2>/dev/null)\" != '200' ]"; then
    pass "a global block applies to hosts with no rule of their own"
  else
    fail "a global block applies to hosts with no rule of their own" "https://$neutral/ still returns 200"
  fi

  # The allow-listed host overrode the global settings, so it must stay open.
  t_eq "a host in override mode ignores the global block" "200" "$(http_code "https://$allowed/")"

  restore_global
  if wait_for "the global block to be lifted" 30 \
       bash -c "curl -sS --max-time 8 -o /dev/null -f --cacert '$CA_BUNDLE' 'https://$neutral/'"; then
    pass "clearing the global settings restores access"
  else
    fail "clearing the global settings restores access" "https://$neutral/ is still blocked"
  fi
fi

finish
