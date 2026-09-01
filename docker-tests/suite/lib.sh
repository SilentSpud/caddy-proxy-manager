#!/usr/bin/env bash
# Shared helpers for the caddy-proxy-manager docker test suite.
#
# Sourced by every file under tests/. Assertions never abort the file: they
# record a result and return, so one broken feature does not hide the state of
# the rest. Each test file exits non-zero if any of its own assertions failed.

# shellcheck disable=SC2034  # several colour vars are used only by some files

set -o pipefail

STATE_DIR="${STATE_DIR:-/tmp/cpm-test}"
RESULT_FILE="${RESULT_FILE:-$STATE_DIR/results.tsv}"
# Every REST call the suite makes, for the API-surface coverage report that
# run-tests.sh prints at the end.
CALLS_FILE="${CALLS_FILE:-$STATE_DIR/api-calls.tsv}"
SPEC_FILE="$STATE_DIR/openapi.json"
TOKEN_FILE="$STATE_DIR/api-token"
CA_BUNDLE="$STATE_DIR/ca-bundle.pem"
CPM_API="${CPM_API:-http://web:3000}"
CPM_AGENT_API="${CPM_AGENT_API:-http://web-agent:3000}"
TEST_DOMAIN="${TEST_DOMAIN:-cpm.test}"
CADDY_IP="${CADDY_IP:-172.28.0.10}"
CLIENT_IP="${CLIENT_IP:-172.28.0.40}"

mkdir -p "$STATE_DIR"

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=; C_DIM=; C_BOLD=; C_OFF=
fi

SUITE_NAME="${SUITE_NAME:-$(basename "${BASH_SOURCE[1]:-suite}" .sh)}"
FAIL_COUNT=0

# ── Result recording ────────────────────────────────────────────────────────

_record() {
  # _record STATUS NAME DETAIL
  printf '%s\t%s\t%s\t%s\n' "$1" "$SUITE_NAME" "$2" "${3//$'\n'/ }" >>"$RESULT_FILE"
}

pass() {
  _record PASS "$1" ""
  printf '  %sok%s   %s\n' "$C_GREEN" "$C_OFF" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  _record FAIL "$1" "${2:-}"
  printf '  %sFAIL%s %s\n' "$C_RED" "$C_OFF" "$1"
  if [ -n "${2:-}" ]; then
    printf '       %s%s%s\n' "$C_DIM" "$2" "$C_OFF"
  fi
}

skip() {
  _record SKIP "$1" "${2:-}"
  printf '  %sskip%s %s %s(%s)%s\n' "$C_YELLOW" "$C_OFF" "$1" "$C_DIM" "${2:-}" "$C_OFF"
}

info() { printf '  %s->%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }

banner() {
  printf '\n%s== %s ==%s\n' "$C_BOLD" "$*" "$C_OFF"
}

# ── Assertions ──────────────────────────────────────────────────────────────

t_eq() {  # t_eq NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi
}

t_ne() {  # t_ne NAME NOT_EXPECTED ACTUAL
  if [ "$2" != "$3" ]; then pass "$1"; else fail "$1" "expected anything but '$2'"; fi
}

t_contains() {  # t_contains NAME NEEDLE HAYSTACK
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1" "'$2' not found in: $(printf '%.400s' "$3")" ;;
  esac
}

t_not_contains() {  # t_not_contains NAME NEEDLE HAYSTACK
  case "$3" in
    *"$2"*) fail "$1" "'$2' unexpectedly present in: $(printf '%.400s' "$3")" ;;
    *) pass "$1" ;;
  esac
}

t_matches() {  # t_matches NAME REGEX VALUE
  if printf '%s' "$3" | grep -Eq "$2"; then pass "$1"; else fail "$1" "'$3' does not match /$2/"; fi
}

t_ok() {  # t_ok NAME CMD...
  local name="$1"; shift
  local out
  if out=$("$@" 2>&1); then pass "$name"; else fail "$name" "command failed: $* :: $(printf '%.300s' "$out")"; fi
}

t_fails() {  # t_fails NAME CMD... — passes when the command exits non-zero
  local name="$1"; shift
  local out
  if out=$("$@" 2>&1); then fail "$name" "command unexpectedly succeeded: $*"; else pass "$name"; fi
}

# ── CPM REST API ────────────────────────────────────────────────────────────
#
# api METHOD PATH [BODY] -> sets API_STATUS and API_BODY.
# Uses the bearer token minted by bootstrap.sh unless API_TOKEN is overridden.

API_STATUS=
API_BODY=

# Records a call for the coverage report. The raw path is kept as-is; matching
# it back to a documented path template is the reporter's job, so nothing here
# has to know which segments are ids.
_record_api_call() {
  printf '%s\t%s\n' "$1" "${2%%\?*}" >>"$CALLS_FILE" 2>/dev/null || true
}

api() {
  local method="$1" path="$2" body="${3:-}"
  _record_api_call "$method" "$path"
  local token="${API_TOKEN-$(cat "$TOKEN_FILE" 2>/dev/null)}"
  local base="${API_BASE:-$CPM_API}"
  local out="$STATE_DIR/api-out.$$"
  local args=(-sS -X "$method" --max-time 60 -o "$out" -w '%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$body")
  fi
  API_STATUS=$(curl "${args[@]}" "$base$path" 2>"$out.err") || API_STATUS="000"
  API_BODY=$(cat "$out" 2>/dev/null)
  [ "$API_STATUS" = "000" ] && API_BODY="$(cat "$out.err" 2>/dev/null)"
  rm -f "$out" "$out.err"
}

# jqr FILTER [extra jq args...] — jq over the last API response. Extra args go
# before the filter, so `jqr '.x' --argjson y "$json"` works.
jqr() {
  local filter="$1"; shift
  printf '%s' "$API_BODY" | jq -r "$@" "$filter" 2>/dev/null
}

# with_token TOKEN CMD... — runs CMD with a different (or empty) bearer token.
# `local` gives dynamic scope in bash, so `api` several frames down sees it, and
# the override disappears when this returns.
with_token() {
  local API_TOKEN="$1"; shift
  "$@"
}

# cpm_sign_in BASE_URL COOKIE_JAR USERNAME PASSWORD -> prints the HTTP status
#
# The seeded admin has both an email (<username>@localhost) and a username, and which better-auth
# accepts depends on how the account was created. Try email, then the username plugin, and report
# whichever got furthest.
cpm_sign_in() {
  local base="$1" jar="$2" user="$3" password="$4"
  local out="$STATE_DIR/signin-$$.json" status

  status=$(curl -sS --max-time 15 -o "$out" -w '%{http_code}' -c "$jar" \
    -H 'Content-Type: application/json' -H "Origin: $base" \
    --data-binary "$(jq -nc --arg e "${user}@localhost" --arg p "$password" \
      '{email:$e, password:$p, rememberMe:true}')" \
    "$base/api/auth/sign-in/email" 2>/dev/null)

  if [ "$status" != "200" ]; then
    status=$(curl -sS --max-time 15 -o "$out" -w '%{http_code}' -c "$jar" \
      -H 'Content-Type: application/json' -H "Origin: $base" \
      --data-binary "$(jq -nc --arg u "$user" --arg p "$password" \
        '{username:$u, password:$p, rememberMe:true}')" \
      "$base/api/auth/sign-in/username" 2>/dev/null)
  fi

  SIGN_IN_BODY=$(cat "$out" 2>/dev/null)
  rm -f "$out"
  printf '%s' "$status"
}

# cpm_mint_token BASE_URL COOKIE_JAR NAME -> prints the raw token, empty on failure
cpm_mint_token() {
  curl -sS --max-time 15 -b "$2" \
    -H 'Content-Type: application/json' -H "Origin: $1" \
    --data-binary "$(jq -nc --arg n "$3" '{name:$n}')" \
    "$1/api/v1/tokens" 2>/dev/null | jq -r '.raw_token // empty'
}

# Some endpoints outside /api/v1 (waf-events, geoip-status, l4-ports) sit behind
# the session middleware, which redirects anything without a session cookie to
# the login page — a bearer token is not enough. Those are called with the
# admin's browser session instead, which is what the UI uses.
api_session() {  # api_session METHOD PATH [BODY] -> API_STATUS, API_BODY
  local method="$1" path="$2" body="${3:-}"
  _record_api_call "$method" "$path"
  local out="$STATE_DIR/api-session-out.$$"
  local args=(-sS -X "$method" --max-time 60 -o "$out" -w '%{http_code}'
              -b "$STATE_DIR/cookies.txt" -H "Origin: $CPM_API")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$body")
  fi
  API_STATUS=$(curl "${args[@]}" "$CPM_API$path" 2>/dev/null) || API_STATUS="000"
  API_BODY=$(cat "$out" 2>/dev/null)
  rm -f "$out"
}

api_expect() {  # api_expect NAME EXPECTED_STATUS METHOD PATH [BODY]
  local name="$1" want="$2"; shift 2
  api "$@"
  if [ "$API_STATUS" = "$want" ]; then
    pass "$name"
  else
    fail "$name" "HTTP $API_STATUS (wanted $want): $(printf '%.300s' "$API_BODY")"
  fi
}

# ── Resource lifecycle ──────────────────────────────────────────────────────
#
# Everything created by a test file is registered here and torn down by the
# EXIT trap, so a failure part-way through does not leak proxy hosts into the
# next file's Caddy config.

CLEANUP_STACK=()

track() { CLEANUP_STACK+=("$1"); }   # track "proxy-hosts/12"

cleanup_tracked() {
  local i
  for (( i=${#CLEANUP_STACK[@]}-1; i>=0; i-- )); do
    api DELETE "/api/v1/${CLEANUP_STACK[$i]}" >/dev/null 2>&1
  done
  CLEANUP_STACK=()
}

trap cleanup_tracked EXIT

# create_resource COLLECTION JSON
#
# Sets NEW_ID on success and registers the resource for teardown; non-zero on failure, with the
# reply in API_STATUS / API_BODY. Deliberately not written to echo the id — it must run in the
# caller's shell so `track` mutates the caller's cleanup stack, which a $(...) subshell would lose.
NEW_ID=

create_resource() {
  local collection="$1" body="$2"
  NEW_ID=
  api POST "/api/v1/$collection" "$body"
  case "$API_STATUS" in
    200|201) ;;
    *)
      # CPM writes the row first and pushes the Caddy config second, so a
      # rejected config still leaves a live resource behind — and every later
      # config push would keep failing on it. Adopt any orphan so the EXIT trap
      # removes it and the next test file starts from a clean config.
      local name status_backup="$API_STATUS" body_backup="$API_BODY"
      name=$(printf '%s' "$body" | jq -r '.name // empty' 2>/dev/null)
      if [ -n "$name" ]; then
        api GET "/api/v1/$collection"
        local orphan
        while read -r orphan; do
          [ -n "$orphan" ] && track "$collection/$orphan"
        done < <(printf '%s' "$API_BODY" | jq -r --arg n "$name" '.[]? | select(.name == $n) | .id' 2>/dev/null)
      fi
      API_STATUS="$status_backup"; API_BODY="$body_backup"
      return 1 ;;
  esac
  local id; id=$(jqr '.id')
  [ -n "$id" ] && [ "$id" != "null" ] || return 1
  NEW_ID="$id"
  track "$collection/$id"
  return 0
}

create_host() { create_resource proxy-hosts "$1"; }
create_l4_host() { create_resource l4-proxy-hosts "$1"; }

# create_host_or_fail NAME JSON — creates a host, recording a failed assertion
# and returning non-zero if the API rejected it. On success NEW_ID holds the id.
create_host_or_fail() {
  local name="$1" body="$2"
  if create_host "$body"; then
    return 0
  fi
  fail "$name" "could not create proxy host: HTTP $API_STATUS $(printf '%.300s' "$API_BODY")"
  return 1
}

# ── HTTP client against Caddy ───────────────────────────────────────────────
#
# fetch URL [curl args...] -> FETCH_CODE, FETCH_BODY, FETCH_HEADERS, FETCH_RC
# Names resolve through dnsmasq, so URLs use the real test domain and Caddy
# sees a genuine SNI + Host pair, exactly as a browser would send them.

FETCH_CODE=; FETCH_BODY=; FETCH_HEADERS=; FETCH_RC=0

fetch() {
  local url="$1"; shift
  local body="$STATE_DIR/fetch-body.$$" hdr="$STATE_DIR/fetch-hdr.$$"
  FETCH_CODE=$(curl -sS --max-time 20 --cacert "$CA_BUNDLE" \
    -o "$body" -D "$hdr" -w '%{http_code}' "$@" "$url" 2>"$hdr.err")
  FETCH_RC=$?
  FETCH_BODY=$(cat "$body" 2>/dev/null)
  FETCH_HEADERS=$(cat "$hdr" 2>/dev/null)
  [ "$FETCH_RC" -ne 0 ] && FETCH_HEADERS="$FETCH_HEADERS$(cat "$hdr.err" 2>/dev/null)"
  rm -f "$body" "$hdr" "$hdr.err"
  return $FETCH_RC
}

# The last response's value for a header, lower-cased name, last occurrence wins.
header_value() {
  printf '%s' "$FETCH_HEADERS" \
    | tr -d '\r' \
    | grep -i "^$1:" \
    | tail -n1 \
    | sed "s/^[^:]*: *//"
}

fetch_json() { printf '%s' "$FETCH_BODY" | jq -r "$1" 2>/dev/null; }

# Just the status code, and "000" when the request never produced one — which
# is how a refused TLS handshake (mTLS with no client certificate, say) shows
# up as distinct from an HTTP-level rejection.
http_code() {
  local url="$1"; shift
  local code
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    --cacert "$CA_BUNDLE" "$@" "$url" 2>/dev/null)
  printf '%s' "${code:-000}"
}

http_body() {
  local url="$1"; shift
  curl -sS --max-time 20 --cacert "$CA_BUNDLE" "$@" "$url" 2>/dev/null
}

# ── TLS inspection ──────────────────────────────────────────────────────────

# tls_cert DOMAIN [openssl s_client args...] -> leaf certificate PEM on stdout
tls_cert() {
  local domain="$1"; shift
  printf '' | openssl s_client -connect "$domain:443" -servername "$domain" \
    "$@" 2>/dev/null | openssl x509 -outform pem 2>/dev/null
}

tls_field() {  # tls_field DOMAIN -subject|-issuer|-text
  local domain="$1" field="$2"; shift 2
  tls_cert "$domain" "$@" | openssl x509 -noout "$field" 2>/dev/null
}

# Succeeds only when a full TLS handshake completes and a certificate is served.
tls_handshake_ok() {
  local domain="$1"; shift
  printf '' | openssl s_client -connect "$domain:443" -servername "$domain" \
    -CAfile "$CA_BUNDLE" -verify_return_error "$@" 2>&1 | grep -q "Verify return code: 0 (ok)"
}

# ── Local PKI ───────────────────────────────────────────────────────────────
#
# Tests that need certificates CPM did not issue — imported server certs, mTLS
# client certs — mint them here. Everything lands in $STATE_DIR, is idempotent
# across test files, and never leaves the container.

# make_ca NAME — creates $STATE_DIR/NAME-ca.{crt,key}.pem and, for server CAs,
# adds the root to the bundle `fetch` verifies against.
make_ca() {
  local name="$1"
  local crt="$STATE_DIR/$name-ca.crt.pem"
  [ -s "$crt" ] && return 0
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$STATE_DIR/$name-ca.key.pem" -out "$crt" \
    -days 3650 -sha256 -subj "/CN=CPM Docker Test $name CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1 || return 1
  return 0
}

trust_ca() {  # trust_ca NAME — append a local CA to the client's trust store
  local name="$1" marker="$STATE_DIR/.trusted-$1"
  [ -e "$marker" ] && return 0
  cat "$STATE_DIR/$name-ca.crt.pem" >>"$CA_BUNDLE" && : >"$marker"
}

# issue_cert CA_NAME LEAF_NAME SUBJECT SAN PURPOSE
#   SAN     e.g. "DNS:a.cpm.test,DNS:*.b.cpm.test" — empty for client certs
#   PURPOSE serverAuth | clientAuth
issue_cert() {
  local ca="$1" leaf="$2" subject="$3" san="$4" purpose="${5:-serverAuth}"
  local base="$STATE_DIR/$leaf"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$base.key.pem" -out "$base.csr" -subj "$subject" >/dev/null 2>&1 || return 1
  {
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=critical,digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=$purpose"
    [ -n "$san" ] && echo "subjectAltName=$san"
  } >"$base.ext"
  openssl x509 -req -in "$base.csr" \
    -CA "$STATE_DIR/$ca-ca.crt.pem" -CAkey "$STATE_DIR/$ca-ca.key.pem" -CAcreateserial \
    -out "$base.crt.pem" -days 825 -sha256 -extfile "$base.ext" >/dev/null 2>&1 || return 1
  rm -f "$base.csr" "$base.ext"
  return 0
}

cert_fingerprint() {  # lower-case hex, colon-free — the form Caddy compares against
  openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null \
    | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z'
}

cert_serial() { openssl x509 -in "$1" -noout -serial 2>/dev/null | sed 's/.*=//'; }
cert_not_before() { openssl x509 -in "$1" -noout -startdate 2>/dev/null | sed 's/.*=//'; }
cert_not_after() { openssl x509 -in "$1" -noout -enddate 2>/dev/null | sed 's/.*=//'; }

# ISO-8601 form of a certificate validity bound, which is what the API stores.
cert_date_iso() {  # cert_date_iso FILE -startdate|-enddate
  local raw; raw=$(openssl x509 -in "$1" -noout "$2" 2>/dev/null | sed 's/.*=//')
  date -u -d "$raw" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null
}

# ── Waiting ─────────────────────────────────────────────────────────────────

# wait_for DESCRIPTION TIMEOUT_SECONDS CMD...
wait_for() {
  local desc="$1" timeout="$2"; shift 2
  local deadline=$(( $(date +%s) + timeout ))
  while :; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      printf '  %s..%s timed out after %ss waiting for %s\n' "$C_DIM" "$C_OFF" "$timeout" "$desc"
      return 1
    fi
    sleep 1
  done
}

# Caddy obtains certificates asynchronously after a config load, so anything
# that talks HTTPS to a freshly-created host has to wait for issuance.
wait_for_https() {
  local domain="$1" timeout="${2:-90}"
  wait_for "a certificate for $domain" "$timeout" tls_handshake_ok "$domain"
}

wait_for_http() {  # wait until an HTTP request to the domain returns a status
  local url="$1" timeout="${2:-30}"
  wait_for "$url to respond" "$timeout" curl -sS --max-time 5 -o /dev/null --cacert "$CA_BUNDLE" "$url"
}

# ── Misc ────────────────────────────────────────────────────────────────────

# A domain unique to the calling test file, so parallel edits and leftover
# state from an aborted run cannot collide.
domain_for() { printf '%s.%s' "$1" "$TEST_DOMAIN"; }

json_escape() { printf '%s' "$1" | jq -Rs .; }

# Read a PEM file into a JSON string literal.
pem_json() { jq -Rs . <"$1"; }

finish() {
  if [ "$FAIL_COUNT" -gt 0 ]; then
    printf '  %s%d assertion(s) failed in %s%s\n' "$C_RED" "$FAIL_COUNT" "$SUITE_NAME" "$C_OFF"
    exit 1
  fi
  exit 0
}
