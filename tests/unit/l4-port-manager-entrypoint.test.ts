/**
 * Invariants of the compose-manager sidecar's entrypoint script. It runs in its own container, so
 * these assertions read the shipped source directly — weaker than executing it, but the alternative
 * is Docker-in-Docker for a 400-line shell script.
 *
 * Ports: applies the override on startup, touches only caddy, auto-detects the compose project,
 * pre-loads LAST_TRIGGER, supports COMPOSE_HOST_DIR, never pulls images. Rebuilds: both overrides
 * always passed together, timeout-bounded, a failed build leaves the container alone, the
 * applied-module record is written only once healthy, a stale "building" status is cleared. Status
 * files are valid JSON with control characters stripped, and exit codes survive `set -e`.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

const SCRIPT_PATH = resolve(moduleDir, '../../docker/l4-port-manager/entrypoint.sh');
const script = readFileSync(SCRIPT_PATH, 'utf-8');
const lines = script.split('\n');

describe('L4 port manager entrypoint.sh', () => {
  it('applies override on startup (not only on trigger change)', () => {
    // The script must call do_apply before entering the while loop, so L4 ports are bound after any
    // restart — the main compose stack starts caddy without the L4 ports override file.
    const firstApply = lines.findIndex(
      (l) => l.trim().startsWith('do_apply') || l.includes('do_apply'),
    );
    const whileLoop = lines.findIndex((l) => l.includes('while true'));
    expect(firstApply).toBeGreaterThan(-1);
    expect(whileLoop).toBeGreaterThan(-1);
    expect(firstApply).toBeLessThan(whileLoop);
  });

  it('pre-loads LAST_TRIGGER after startup apply to avoid double-apply', () => {
    // After the startup apply, LAST_TRIGGER must be set from the current trigger
    // file content so the poll loop doesn't re-apply the same trigger again.
    const lastTriggerInit = lines.findIndex(
      (l) => l.includes('LAST_TRIGGER=') && l.includes('TRIGGER_FILE'),
    );
    const whileLoop = lines.findIndex((l) => l.includes('while true'));
    expect(lastTriggerInit).toBeGreaterThan(-1);
    expect(lastTriggerInit).toBeLessThan(whileLoop);
  });

  it('only recreates the caddy service', () => {
    // The docker compose command should target only "caddy" — never "web" or other services
    const composeUpLines = lines.filter(
      (line) => line.includes('docker compose') && line.includes('up'),
    );
    expect(composeUpLines.length).toBeGreaterThan(0);
    for (const line of composeUpLines) {
      expect(line).toContain('caddy');
      expect(line).not.toMatch(/\bweb\b/);
    }
  });

  it('uses --no-deps flag to prevent dependency cascades', () => {
    const composeUpLines = lines.filter(
      (line) => line.includes('docker compose') && line.includes('up'),
    );
    for (const line of composeUpLines) {
      expect(line).toContain('--no-deps');
    }
  });

  it('uses --force-recreate to ensure port changes take effect', () => {
    const composeUpLines = lines.filter(
      (line) => line.includes('docker compose') && line.includes('up'),
    );
    for (const line of composeUpLines) {
      expect(line).toContain('--force-recreate');
    }
  });

  it('specifies project name to target the correct compose stack', () => {
    // Without -p, compose would infer the project from the mount directory name ("/compose") rather
    // than the running stack, creating new containers instead of recreating the existing ones.
    expect(script).toMatch(/args="-p \$COMPOSE_PROJECT"/);
    // Every compose invocation must take its flags from the shared builder,
    // so the build path cannot drift away from the port-apply path.
    for (const line of lines.filter(
      (l) => l.includes('docker compose') && !l.trim().startsWith('#'),
    )) {
      expect(line).toContain('$COMPOSE_ARGS');
    }
  });

  it('auto-detects project name from caddy container labels', () => {
    expect(script).toContain('com.docker.compose.project');
    expect(script).toContain('docker inspect');
    expect(script).toContain('detect_project_name');
  });

  it('compares trigger content to avoid redundant restarts', () => {
    expect(script).toContain('LAST_TRIGGER');
    expect(script).toContain('CURRENT_TRIGGER');
    expect(script).toContain('"$CURRENT_TRIGGER" != "$LAST_TRIGGER"');
    expect(script).toContain('"$CURRENT_BUILD_TRIGGER" != "$LAST_BUILD_TRIGGER"');
  });

  it('uses --pull never on every compose up (recreate, never pull)', () => {
    const composeUpLines = lines.filter(
      (line) => line.includes('docker compose') && line.includes(' up '),
    );
    expect(composeUpLines.length).toBeGreaterThan(0);
    for (const line of composeUpLines) {
      expect(line).toContain('--pull never');
      // Building is a separate, explicitly triggered step — `up --build` would
      // turn every port change into a multi-minute Caddy recompile.
      expect(line).not.toContain('--build');
    }
  });

  it('waits for caddy health check after recreation', () => {
    expect(script).toContain('Health');
    expect(script).toContain('healthy');
    expect(script).toContain('HEALTH_TIMEOUT');
  });

  it('writes status for both success and failure cases', () => {
    const statusWrites = lines.filter((l) => l.trim().startsWith('write_status'));
    // At least: startup idle/applying, applying, applied/success, failed
    expect(statusWrites.length).toBeGreaterThanOrEqual(4);
  });

  it('does not include test override files in production', () => {
    // Including docker-compose.test.yml would override web env vars (triggering
    // web restart) and switch to test volume names.
    expect(script).not.toContain('docker-compose.test.yml');
  });

  it('does not restart the web service or itself', () => {
    const dangerousPatterns = [
      /up.*\bweb\b/,
      /restart.*\bweb\b/,
      /up.*\bl4-port-manager\b/,
      /restart.*\bl4-port-manager\b/,
    ];
    for (const pattern of dangerousPatterns) {
      expect(script).not.toMatch(pattern);
    }
  });

  // ── Caddy image rebuild (module selection) ─────────────────────────────────

  it('watches a separate build trigger and only builds the caddy service', () => {
    expect(script).toContain('caddy-build.trigger');
    const buildLines = lines.filter((l) => l.includes('docker compose') && l.includes(' build '));
    expect(buildLines.length).toBe(1);
    expect(buildLines[0]).toContain('caddy');
    expect(buildLines[0]).not.toMatch(/\bweb\b/);
  });

  it('includes the build override in compose args so ports and modules coexist', () => {
    // A rebuild that dropped the L4 port override would unbind every L4 listener; a port apply that
    // dropped the build override would rebuild with the default module set. Always pass both.
    expect(script).toContain('-f $BUILD_OVERRIDE_FILE');
    expect(script).toContain('-f $OVERRIDE_FILE');
  });

  it('bounds the build with a timeout so a hung compile cannot wedge the sidecar', () => {
    expect(script).toContain('CADDY_BUILD_TIMEOUT');
    expect(script).toMatch(/timeout "\$CADDY_BUILD_TIMEOUT" docker compose/);
  });

  it('leaves the running container alone when the build fails', () => {
    // xcaddy compiles from source against upstream module repos, so a build failure is routine (a
    // bad custom module path, an upstream tag pulled). Gate the recreate on the build succeeding.
    const buildIdx = lines.findIndex((l) => l.includes('docker compose') && l.includes(' build '));
    const returnIdx = lines.findIndex((l, i) => i > buildIdx && l.trim() === 'return');
    const upIdx = lines.findIndex(
      (l, i) => i > buildIdx && l.includes('docker compose') && l.includes(' up '),
    );
    expect(buildIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(buildIdx);
    expect(upIdx).toBeGreaterThan(returnIdx);
  });

  it('resolves the compose project in the caller, not inside the subshell', () => {
    // build_compose_args is invoked as $(...), so an assignment inside it is discarded on subshell
    // exit and the "Using compose project" log line would print an empty name.
    expect(script).not.toMatch(/build_compose_args\(\) \{[\s\S]{0,200}COMPOSE_PROJECT=/);
    const callers = lines.filter((l) => l.includes('COMPOSE_ARGS="$(build_compose_args)"'));
    expect(callers.length).toBeGreaterThanOrEqual(2);
    for (const [i, line] of lines.entries()) {
      if (!line.includes('COMPOSE_ARGS="$(build_compose_args)"')) continue;
      expect(lines[i - 1]).toContain('COMPOSE_PROJECT="$(detect_project_name)"');
    }
  });

  it('strips control characters before embedding output in status JSON', () => {
    // RFC 8259 forbids raw U+0000..U+001F inside a JSON string, and compose output carries CR/ESC
    // routinely. One of them makes the status file unparseable, which the UI shows as no progress.
    expect(script).toContain("tr -d '\\000-\\037'");
  });

  it('captures compose exit codes without tripping set -e', () => {
    // The script runs under `set -e`, where a plain `VAR=$(failing-cmd)` exits immediately — so
    // every failure branch that writes a "failed" status would be unreachable. Use an AND-OR list.
    const captures = lines.filter((l) => l.includes('docker compose') && l.includes('=$('));
    expect(captures.length).toBeGreaterThanOrEqual(3);
    for (const line of captures) {
      expect(line).toMatch(/&& [A-Z_]+=0 \|\| [A-Z_]+=\$\?/);
    }
  });

  it('records the applied module set only after the build is healthy', () => {
    // The web app treats this file as the authority on what the binary contains. Writing it any
    // earlier would claim a module is available while the old binary is still serving.
    const writeIdx = lines.findIndex((l) => l.trim() === 'write_applied_modules');
    const healthyIdx = lines.findIndex(
      (l) => l.includes('HEALTH" = "healthy"') && l.includes('if'),
    );
    expect(writeIdx).toBeGreaterThan(-1);
    expect(healthyIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(healthyIdx);
    // And nothing writes it on any failure path.
    expect(script.split('write_applied_modules').length - 1).toBe(2); // definition + one call
  });

  it('clears a stale in-progress build status on startup', () => {
    // A sidecar killed mid-build leaves state=building on disk, and the trigger is pre-loaded as
    // already-handled — so nothing would move it on, and the UI would sit on a disabled button.
    expect(script).toMatch(/grep -q .*building.*pending.*BUILD_STATUS_FILE/);
    expect(script).toContain('Startup: cleared a stale in-progress build status.');
  });

  it('writes build status separately from port status', () => {
    expect(script).toContain('caddy-build.status');
    const buildStatusWrites = lines.filter((l) => l.trim().startsWith('write_build_status'));
    // building, timeout/failure, up failure, healthy, unhealthy, startup idle
    expect(buildStatusWrites.length).toBeGreaterThanOrEqual(5);
  });

  it('escapes compose output before embedding it in status JSON', () => {
    // Compose output routinely contains quotes; writing it raw produced status
    // files the web app could not parse, which the operator saw as silence.
    expect(script).toContain('json_escape');
    expect(script).toMatch(/message="\$\(json_escape "\$3"\)"/);
  });

  // ── Deployment: COMPOSE_HOST_DIR (bind-mount / cloud override) ─────────────

  it('uses --project-directory $COMPOSE_HOST_DIR when COMPOSE_HOST_DIR is set', () => {
    // Bind-mount deployments (docker-compose.override.yml swaps named volumes for ./data binds).
    // Relative paths like ./geoip-data in the override must resolve against the HOST project
    // directory, not the sidecar's /compose mount — --project-directory tells the daemon where.
    expect(script).toContain('--project-directory $COMPOSE_HOST_DIR');
    // It must be conditional — only applied when COMPOSE_HOST_DIR is non-empty
    expect(script).toMatch(/if \[ -n "\$COMPOSE_HOST_DIR" \]/);
  });

  it('does NOT unconditionally add --project-directory (named-volume deployments work without it)', () => {
    // Standard deployments (no override file) use named volumes — no host path
    // is needed. --project-directory must NOT be hardcoded outside the conditional.
    const unconditional = lines.filter(
      (l) =>
        l.includes('--project-directory') &&
        !l.includes('COMPOSE_HOST_DIR') &&
        !l.trim().startsWith('#'),
    );
    expect(unconditional).toHaveLength(0);
  });

  it('uses --env-file from $COMPOSE_DIR (container-accessible path), not $COMPOSE_HOST_DIR', () => {
    // With --project-directory pointing at the host path, Compose looks for .env at
    // $COMPOSE_HOST_DIR/.env, which is NOT mounted inside the container — so pass
    // --env-file $COMPOSE_DIR/.env explicitly.
    expect(script).toContain('--env-file $COMPOSE_DIR/.env');
    // Must NOT reference the host dir for the env file
    expect(script).not.toContain('--env-file $COMPOSE_HOST_DIR');
  });

  it('always reads compose files from $COMPOSE_DIR regardless of COMPOSE_HOST_DIR', () => {
    // The sidecar mounts the project at /compose (COMPOSE_DIR). Set or not, all -f flags must
    // reference container-accessible paths under $COMPOSE_DIR, never the host path.
    const composeFileFlags = lines.filter((l) => l.includes('-f ') && l.includes('docker-compose'));
    expect(composeFileFlags.length).toBeGreaterThan(0);
    for (const line of composeFileFlags) {
      expect(line).toContain('$COMPOSE_DIR');
      expect(line).not.toContain('$COMPOSE_HOST_DIR');
    }
  });
});
