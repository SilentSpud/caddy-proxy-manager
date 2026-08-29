#!/bin/sh
#
# Caddy Compose Manager Sidecar (historically the "L4 port manager")
#
# The web container has no Docker API access, so anything needing the caddy *container* recreated —
# rather than its config reloaded over the admin API — is signalled through files on the shared data
# volume and done here. Two such things: L4 ports (published ports are fixed at create time) and
# Caddy builds (plugins are compiled in). Only ever touches the caddy container.
#
# On startup it applies the current L4 ports override, since the main stack starts caddy without it,
# and clears any stale "building" status from a sidecar killed mid-build.
#
# Files on $DATA_DIR, the only interface to the web container:
#   docker-compose.l4-ports.yml     read   port override, written by web
#   l4-ports.trigger                r/w    web signals; deleted once handled
#   l4-ports.status                 write  progress of the port apply
#   docker-compose.caddy-build.yml  read   DESIRED module list, written by web
#   caddy-build.trigger             r/w    web signals; deleted once handled
#   caddy-build.status              write  progress of the rebuild
#   caddy-build.applied.json        write  APPLIED module list — written ONLY after a build succeeds
#                                          and caddy is healthy; the web app treats it as the
#                                          authority on what the binary contains
#
# Environment variables:
#   DATA_DIR              - Path to shared data volume (default: /data)
#   COMPOSE_DIR           - Path to compose files (default: /compose)
#   CADDY_CONTAINER_NAME  - Caddy container name for project auto-detection (default: caddy-proxy-manager-caddy)
#   COMPOSE_PROJECT_NAME  - Override compose project name (auto-detected from caddy container labels if unset)
#   POLL_INTERVAL         - Seconds between trigger file checks (default: 2)
#   COMPOSE_SKIP_OVERRIDE - If non-empty, skip docker-compose.override.yml (useful in test environments)
#   COMPOSE_EXTRA_FILE    - If set, include this additional compose file (e.g. a test-specific override)
#   CADDY_BUILD_TIMEOUT   - Seconds to allow for an image rebuild (default: 1800)

set -e

DATA_DIR="${DATA_DIR:-/data}"
COMPOSE_DIR="${COMPOSE_DIR:-/compose}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
CADDY_CONTAINER_NAME="${CADDY_CONTAINER_NAME:-caddy-proxy-manager-caddy}"
CADDY_BUILD_TIMEOUT="${CADDY_BUILD_TIMEOUT:-1800}"

TRIGGER_FILE="$DATA_DIR/l4-ports.trigger"
STATUS_FILE="$DATA_DIR/l4-ports.status"
OVERRIDE_FILE="$DATA_DIR/docker-compose.l4-ports.yml"

BUILD_TRIGGER_FILE="$DATA_DIR/caddy-build.trigger"
BUILD_STATUS_FILE="$DATA_DIR/caddy-build.status"
BUILD_OVERRIDE_FILE="$DATA_DIR/docker-compose.caddy-build.yml"
# The record of what the running binary was actually built with. Distinct from BUILD_OVERRIDE_FILE,
# which carries the *desired* list into the build and is written before it starts.
BUILD_APPLIED_FILE="$DATA_DIR/caddy-build.applied.json"

log() {
  echo "[caddy-compose-manager] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

# Escape a message for embedding in a JSON string literal. Compose output contains quotes and
# backslashes often enough that writing it raw produces status files the web app cannot parse —
# and an unparseable status reads to the operator as "nothing happened".
json_escape() {
  # The `tr -d` pass removes every remaining C0 control byte: RFC 8259 forbids unescaped
  # U+0000..U+001F inside a JSON string, and compose output carries them routinely — CR from
  # BuildKit progress, ESC from ANSI colour, whatever a failing `go build` emits. Tab and newline
  # are folded to spaces first so they survive as separators rather than being deleted.
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | tr '\t\n' '  ' \
    | tr -d '\000-\037'
}

write_status_file() {
  path="$1"
  state="$2"
  message="$(json_escape "$3")"
  error="${4:-}"
  applied_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if [ -n "$error" ]; then
    error="$(json_escape "$error")"
    cat > "$path" <<STATUSEOF
{
  "state": "$state",
  "message": "$message",
  "appliedAt": "$applied_at",
  "error": "$error"
}
STATUSEOF
  else
    cat > "$path" <<STATUSEOF
{
  "state": "$state",
  "message": "$message",
  "appliedAt": "$applied_at"
}
STATUSEOF
  fi
}

write_status() {
  write_status_file "$STATUS_FILE" "$1" "$2" "${3:-}"
}

write_build_status() {
  write_status_file "$BUILD_STATUS_FILE" "$1" "$2" "${3:-}"
}

# Record the module list the running binary was just built with.
#
# Read back out of the override that fed the build, so the record can only ever describe a build
# that actually happened. The web app treats this file as the authority on which plugin-backed
# handlers it may emit; a handler for a module the binary lacks makes Caddy reject the whole config.
write_applied_modules() {
  modules="$(sed -n 's/^[[:space:]]*CADDY_MODULES:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$BUILD_OVERRIDE_FILE" 2>/dev/null || echo "")"
  cat > "$BUILD_APPLIED_FILE" <<APPLIEDEOF
{
  "modules": "$(json_escape "$modules")",
  "appliedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
APPLIEDEOF
  log "Recorded applied modules: ${modules:-none}"
}

# Auto-detect the Docker Compose project name from the running caddy container's labels, so we
# operate on the correct project regardless of where the compose files are mounted.
detect_project_name() {
  if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    echo "$COMPOSE_PROJECT_NAME"
    return
  fi
  detected=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$CADDY_CONTAINER_NAME" 2>/dev/null || echo "")
  if [ -n "$detected" ]; then
    echo "$detected"
  else
    echo "caddy-proxy-manager"
  fi
}

# Assemble the -f/-p/--env-file arguments every compose invocation shares, and echo them. Both
# overrides are included whenever they exist: a rebuild must not drop the L4 port bindings, and a
# port change must not rebuild caddy without the module selection.
#
# Callers set COMPOSE_PROJECT first; this reads it rather than assigning it. The function is always
# invoked as `$(build_compose_args)`, and an assignment made inside that command-substitution
# subshell is discarded when it exits — so assigning here would leave the caller's "Using compose
# project" log line empty, the one line you want when diagnosing a rebuild that hit the wrong stack.
build_compose_args() {
  args="-p $COMPOSE_PROJECT"
  # COMPOSE_HOST_DIR (when set) is passed as --project-directory so the Docker daemon resolves
  # relative bind-mount paths (e.g. ./geoip-data) against the real host project directory rather
  # than the sidecar's /compose mount.
  if [ -n "$COMPOSE_HOST_DIR" ]; then
    args="$args --project-directory $COMPOSE_HOST_DIR"
  fi
  # Explicitly supply the .env file so required variables are available even
  # when --project-directory points to a host path not mounted in the sidecar.
  if [ -f "$COMPOSE_DIR/.env" ]; then
    args="$args --env-file $COMPOSE_DIR/.env"
  fi
  args="$args -f $COMPOSE_DIR/docker-compose.yml"
  if [ -z "$COMPOSE_SKIP_OVERRIDE" ] && [ -f "$COMPOSE_DIR/docker-compose.override.yml" ]; then
    args="$args -f $COMPOSE_DIR/docker-compose.override.yml"
  fi
  if [ -n "$COMPOSE_EXTRA_FILE" ] && [ -f "$COMPOSE_EXTRA_FILE" ]; then
    args="$args -f $COMPOSE_EXTRA_FILE"
  fi
  if [ -f "$BUILD_OVERRIDE_FILE" ]; then
    args="$args -f $BUILD_OVERRIDE_FILE"
  fi
  if [ -f "$OVERRIDE_FILE" ]; then
    args="$args -f $OVERRIDE_FILE"
  fi
  echo "$args"
}

# Wait for the caddy healthcheck, echoing the final status. Shared by both the
# port apply and the rebuild, which have the same "did it come back up" question.
wait_for_caddy_health() {
  HEALTH_TIMEOUT="${1:-30}"
  HEALTH_WAITED=0
  health="unknown"
  while [ "$HEALTH_WAITED" -lt "$HEALTH_TIMEOUT" ]; do
    health=$(docker inspect --format='{{.State.Health.Status}}' "$CADDY_CONTAINER_NAME" 2>/dev/null || echo "unknown")
    if [ "$health" = "healthy" ]; then
      break
    fi
    sleep 1
    HEALTH_WAITED=$((HEALTH_WAITED + 1))
  done
  echo "$health"
}

APPLY_LOCK="$DATA_DIR/.l4-apply.lock"

# Apply the current port override — recreates only the caddy container.
do_apply() {
  # Record timestamp so startup can detect an in-progress apply.
  date +%s > "$APPLY_LOCK"

  COMPOSE_PROJECT="$(detect_project_name)"
  COMPOSE_ARGS="$(build_compose_args)"
  log "Using compose project: $COMPOSE_PROJECT"

  write_status "applying" "Recreating caddy container with updated ports..."

  # `&& ... || ...` rather than a bare assignment followed by `$?`: under
  # `set -e` a failing command substitution in a plain assignment exits the
  # script outright, so the failure branch below would never run and the status
  # file would never say what went wrong.
  # shellcheck disable=SC2086
  COMPOSE_OUTPUT=$(docker compose $COMPOSE_ARGS up -d --no-deps --pull never --force-recreate caddy 2>&1) && COMPOSE_EXIT=0 || COMPOSE_EXIT=$?
  log "$COMPOSE_OUTPUT"
  if [ $COMPOSE_EXIT -eq 0 ]; then
    log "Caddy container recreated successfully."

    HEALTH="$(wait_for_caddy_health 30)"
    if [ "$HEALTH" = "healthy" ]; then
      write_status "applied" "Caddy container recreated and healthy with updated ports."
      log "Caddy is healthy."
    else
      write_status "applied" "Caddy container recreated but health check status: $HEALTH (may still be starting)."
      log "Warning: Caddy health status is '$HEALTH' after 30s."
    fi
  else
    # Truncate output to avoid oversized status files
    SHORT_OUTPUT=$(echo "$COMPOSE_OUTPUT" | tail -5)
    ERROR_MSG="Failed to recreate caddy container: $SHORT_OUTPUT"
    write_status "failed" "$ERROR_MSG" "$ERROR_MSG"
    log "ERROR: $ERROR_MSG"
  fi

  # Delete the trigger file after processing so stale triggers don't cause
  # "Waiting for port manager sidecar..." on the next boot.
  rm -f "$TRIGGER_FILE"

  # Clear the apply lock — the apply completed (success or failure).
  rm -f "$APPLY_LOCK"
}

# Rebuild the caddy image with the selected modules, then recreate the container.
#
# The build is the slow half — xcaddy compiles Caddy from source and can take
# minutes — so the status file is written before it starts. Without that the UI
# would show "pending" for the whole build with no sign anything is happening.
do_build() {
  date +%s > "$APPLY_LOCK"

  COMPOSE_PROJECT="$(detect_project_name)"
  COMPOSE_ARGS="$(build_compose_args)"
  log "Using compose project: $COMPOSE_PROJECT"

  write_build_status "building" "Rebuilding the Caddy image with the selected modules. This can take several minutes..."
  log "Starting caddy image rebuild (timeout ${CADDY_BUILD_TIMEOUT}s)..."

  # See do_apply: the AND-OR list is what keeps `set -e` from killing the script
  # on a failed build, which is the one case whose status the operator needs.
  # shellcheck disable=SC2086
  BUILD_OUTPUT=$(timeout "$CADDY_BUILD_TIMEOUT" docker compose $COMPOSE_ARGS build caddy 2>&1) && BUILD_EXIT=0 || BUILD_EXIT=$?
  log "$BUILD_OUTPUT"

  if [ $BUILD_EXIT -ne 0 ]; then
    SHORT_OUTPUT=$(echo "$BUILD_OUTPUT" | tail -10)
    if [ $BUILD_EXIT -eq 124 ] || [ $BUILD_EXIT -eq 143 ]; then
      ERROR_MSG="Caddy image build timed out after ${CADDY_BUILD_TIMEOUT}s. The previous image is still running."
    else
      # A build failure leaves the old image in place, so caddy keeps serving.
      # Say so explicitly — the operator's first question is whether the proxy
      # just went down.
      ERROR_MSG="Caddy image build failed (the running container was left untouched): $SHORT_OUTPUT"
    fi
    write_build_status "failed" "$ERROR_MSG" "$ERROR_MSG"
    log "ERROR: $ERROR_MSG"
    rm -f "$BUILD_TRIGGER_FILE"
    rm -f "$APPLY_LOCK"
    return
  fi

  log "Build succeeded. Recreating caddy container..."

  # shellcheck disable=SC2086
  UP_OUTPUT=$(docker compose $COMPOSE_ARGS up -d --no-deps --pull never --force-recreate caddy 2>&1) && UP_EXIT=0 || UP_EXIT=$?
  log "$UP_OUTPUT"

  if [ $UP_EXIT -ne 0 ]; then
    SHORT_OUTPUT=$(echo "$UP_OUTPUT" | tail -5)
    ERROR_MSG="Caddy image built, but recreating the container failed: $SHORT_OUTPUT"
    write_build_status "failed" "$ERROR_MSG" "$ERROR_MSG"
    log "ERROR: $ERROR_MSG"
    rm -f "$BUILD_TRIGGER_FILE"
    rm -f "$APPLY_LOCK"
    return
  fi

  HEALTH="$(wait_for_caddy_health 60)"
  if [ "$HEALTH" = "healthy" ]; then
    # Record what the binary now actually contains. This is the web app's source
    # of truth for which plugin-backed handlers it may emit, so it is written
    # here and nowhere else: only at this point — build succeeded, container
    # recreated, healthy — is the new module set genuinely in the running binary.
    # Writing it any earlier (e.g. when the override is generated) would tell the
    # app a module is available while the old binary is still serving.
    write_applied_modules
    write_build_status "applied" "Caddy rebuilt with the selected modules and is healthy."
    log "Caddy is healthy."
  else
    # Unhealthy after a module change usually means the stored config references
    # a plugin that is no longer compiled in, which Caddy refuses wholesale.
    ERROR_MSG="Caddy rebuilt but the health check reports '$HEALTH'. Check the caddy container logs — a config referencing a removed module will fail to load."
    write_build_status "failed" "$ERROR_MSG" "$ERROR_MSG"
    log "Warning: $ERROR_MSG"
  fi

  rm -f "$BUILD_TRIGGER_FILE"
  rm -f "$APPLY_LOCK"
}

# ---------------------------------------------------------------------------
# Startup: always apply the override so caddy has the correct ports bound (the main compose stack
# starts caddy without the L4 ports override file), but only if the override file exists.
#
# If the apply lock was written less than 10 s ago, this container was just recreated as a side
# effect of a compose "up" targeting caddy — skip the re-apply, that operation is already running.
# ---------------------------------------------------------------------------
if [ -f "$OVERRIDE_FILE" ]; then
  SKIP_APPLY=0
  if [ -f "$APPLY_LOCK" ]; then
    LOCK_TS=$(cat "$APPLY_LOCK" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    if [ $((NOW - LOCK_TS)) -lt 10 ]; then
      SKIP_APPLY=1
      log "Startup: restore after compose-up restart — caddy recreation already in progress, skipping..."
    fi
  fi

  if [ "$SKIP_APPLY" -eq 0 ]; then
    log "Startup: applying existing L4 port override..."
    do_apply
  fi
else
  write_status "idle" "Port manager sidecar is running and ready."
  log "Started. No L4 port override file yet."
fi

# A build that was in flight when this container died cannot be in flight now.
# The status file would otherwise still say "building", and because the trigger
# is pre-loaded as already-handled just below, nothing would ever move it on —
# leaving the UI spinning on a build that is not running, with its Rebuild
# button disabled and no way back except deleting the file by hand.
if [ -f "$BUILD_STATUS_FILE" ] && grep -q '"state": *"\(building\|pending\)"' "$BUILD_STATUS_FILE" 2>/dev/null; then
  STALE_MSG="The sidecar restarted while a rebuild was in progress. The Caddy image was left unchanged; click Rebuild to try again."
  write_build_status "failed" "$STALE_MSG" "$STALE_MSG"
  log "Startup: cleared a stale in-progress build status."
elif [ ! -f "$BUILD_STATUS_FILE" ]; then
  write_build_status "idle" "Build manager is running and ready."
fi

# Capture the current trigger content so the poll loop doesn't re-apply
# a trigger that was already handled (either above or before this boot).
# Use explicit assignment — do NOT use ${VAR:-fallback} which treats empty as unset.
LAST_TRIGGER=$(cat "$TRIGGER_FILE" 2>/dev/null || echo "")
LAST_BUILD_TRIGGER=$(cat "$BUILD_TRIGGER_FILE" 2>/dev/null || echo "")

log "Watching $TRIGGER_FILE and $BUILD_TRIGGER_FILE for changes (poll every ${POLL_INTERVAL}s)"

while true; do
  sleep "$POLL_INTERVAL"

  CURRENT_TRIGGER=$(cat "$TRIGGER_FILE" 2>/dev/null || echo "")
  if [ "$CURRENT_TRIGGER" != "$LAST_TRIGGER" ]; then
    # Empty trigger means the file was just deleted — nothing to do.
    if [ -z "$CURRENT_TRIGGER" ]; then
      LAST_TRIGGER=""
    else
      LAST_TRIGGER="$CURRENT_TRIGGER"
      log "Port trigger changed. Applying port changes..."
      do_apply
    fi
  fi

  CURRENT_BUILD_TRIGGER=$(cat "$BUILD_TRIGGER_FILE" 2>/dev/null || echo "")
  if [ "$CURRENT_BUILD_TRIGGER" != "$LAST_BUILD_TRIGGER" ]; then
    if [ -z "$CURRENT_BUILD_TRIGGER" ]; then
      LAST_BUILD_TRIGGER=""
    else
      LAST_BUILD_TRIGGER="$CURRENT_BUILD_TRIGGER"
      log "Build trigger changed. Rebuilding caddy image..."
      do_build
    fi
  fi
done
