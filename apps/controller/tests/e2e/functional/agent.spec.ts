/**
 * Functional: the agent (#117). "Apply Ports" reaches "applied", and the agent republishes on
 * startup after a restart. The bug: NETWORKS: 0 in the socket proxy blocked the GET /networks/{id}
 * compose makes.
 *
 * This used to say "must run after l4-proxy-routing.spec.ts", which was true and enforced by
 * nothing but the alphabet — the file was called sidecar.spec.ts and sorted after it. Renaming it
 * to agent.spec.ts moved it in front, so the port under test had not been created yet, the apply
 * succeeded against an empty override, and only the TCP assertion noticed. It now creates the host
 * itself when it is missing.
 */
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { waitForTcpEcho, tcpSend } from '../../helpers/tcp';
import { COMPOSE_CWD } from '../../helpers/compose';
import { ensureL4ProxyHost } from '../../helpers/l4-proxy-api';

// Container name as defined in docker-compose.yml
const AGENT_CONTAINER = 'caddy-proxy-manager-agent';

// Shared with l4-proxy-routing.spec.ts, which creates the same host when it runs first.
const TCP_PORT = 15432;

const BASE_URL = 'http://localhost:3000';
const ENV = { ...process.env, CLICKHOUSE_PASSWORD: 'test-clickhouse-password-2026' };

// requireApiAdmin → requireApiUser performs a same-origin CSRF check for mutating
// requests authenticated via session cookie.  page.request.post() doesn't send an
// Origin header by default, so we must add it explicitly.
const SESSION_HEADERS = { Origin: BASE_URL };

type L4StatusResponse = {
  status: {
    state: string;
    appliedAt?: string;
    message?: string;
    error?: string;
  };
};

async function fetchL4Status(page: Page): Promise<L4StatusResponse> {
  const res = await page.request.get('/api/l4-ports');
  expect(res.ok()).toBe(true);
  return res.json();
}

/**
 * Poll /api/l4-ports until the state is "applied" or "failed". Pass `newerThan` (ISO timestamp) to
 * confirm a *new* apply completed — lexicographic comparison is correct for ISO-8601.
 */
async function waitForL4Terminal(
  page: Page,
  timeoutMs: number,
  newerThan?: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await fetchL4Status(page);
    const state = status?.state as string;
    const appliedAt = status?.appliedAt ?? '';

    const isTerminal = state === 'applied' || state === 'failed';
    const isFresh = !newerThan || appliedAt > newerThan;

    if (isTerminal && isFresh) return state;
    await page.waitForTimeout(2_000);
  }
  throw new Error(`agent did not reach a terminal state within ${timeoutMs}ms`);
}

test.describe
  .serial('Agent', () => {
    test('setup: an enabled L4 host is listening on the TCP port', async ({ page }) => {
      // Idempotent: whichever of this file and l4-proxy-routing.spec.ts runs first creates it.
      await ensureL4ProxyHost(page, {
        name: 'L4 TCP Echo Test',
        protocol: 'tcp',
        listenAddress: `:${TCP_PORT}`,
        upstream: 'tcp-echo:9000',
      });
    });

    test('apply ports reaches "applied" state', async ({ page }) => {
      // waitForL4Terminal polls for up to 90 s; the global 60 s timeout would
      // fire first without this override.
      test.setTimeout(180_000);

      // Trigger a fresh apply through the API. The agent republishes unconditionally, so this
      // completes even when the port set has not changed.
      const res = await page.request.post('/api/l4-ports', { headers: SESSION_HEADERS });
      expect(res.ok(), `POST /api/l4-ports failed: ${await res.text()}`).toBe(true);

      const state = await waitForL4Terminal(page, 90_000);
      expect(
        state,
        'Expected "applied" but got "failed". Run: docker logs caddy-proxy-manager-agent',
      ).toBe('applied');
    });

    test('TCP traffic works after explicit apply', async () => {
      await waitForTcpEcho('127.0.0.1', TCP_PORT, 'ready-probe', 30_000);
      const res = await tcpSend('127.0.0.1', TCP_PORT, 'agent-apply-check\n');
      expect(res.connected).toBe(true);
      expect(res.data).toContain('agent-apply-check');
    });

    test('auto-applies on agent container restart — regression #117', async ({ page }) => {
      // Container restart + republish + Caddy's health check can take ~60 s total;
      // waitForL4Terminal polls for up to 90 s. Override to avoid the 60 s global cap.
      test.setTimeout(180_000);

      // Record the current appliedAt so we can detect when a *new* apply finishes. Sleep first so
      // the new timestamp is strictly greater whatever precision the clock has.
      const { status: before } = await fetchL4Status(page);
      const prevAppliedAt = before?.appliedAt ?? '';
      await page.waitForTimeout(1_500);

      // On startup the agent compares what Caddy publishes against what it last applied and
      // republishes on a mismatch — which is what keeps L4 routing alive across a host reboot,
      // since the base compose files carry no port override. With NETWORKS: 0 that always failed,
      // since compose needs GET /networks/{id} to inspect caddy-network before reconnecting.
      execFileSync('docker', ['restart', AGENT_CONTAINER], {
        stdio: 'inherit',
        cwd: COMPOSE_CWD,
        env: ENV,
      });

      // Wait for the agent to restart, republish, and record a fresh status. Caddy's health check
      // has a 10 s start_period, so allow up to 90 s total.
      const state = await waitForL4Terminal(page, 90_000, prevAppliedAt);
      expect(
        state,
        'Agent returned "failed" after restart. ' +
          'Likely cause: docker-socket-proxy is missing NETWORKS: 1. ' +
          'Run: docker logs caddy-proxy-manager-agent',
      ).toBe('applied');
    });

    test('TCP traffic still works after agent restart and auto-apply', async () => {
      // Caddy was briefly recreated during the restart apply; waitForTcpEcho
      // retries until the route actually carries data again.
      await waitForTcpEcho('127.0.0.1', TCP_PORT, 'ready-probe', 30_000);
      const res = await tcpSend('127.0.0.1', TCP_PORT, 'after-restart-check\n');
      expect(res.connected).toBe(true);
      expect(res.data).toContain('after-restart-check');
    });
  });
