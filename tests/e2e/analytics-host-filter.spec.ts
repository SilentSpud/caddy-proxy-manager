/**
 * Issue #171: the analytics host dropdown hides traffic-only hosts by default, behind an "Include
 * unconfigured hosts" toggle. Seeds one configured and one traffic-only host, then checks the
 * toggle reveals the latter.
 */
import { test, expect } from '@playwright/test';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

const ORIGIN = 'http://localhost:3000';
const API_PROXY_HOSTS = `${ORIGIN}/api/v1/proxy-hosts`;

// ClickHouse HTTP port is exposed to the host by tests/docker-compose.test.yml.
function makeClient(): ClickHouseClient {
  return createClient({
    url: 'http://localhost:8123',
    username: 'cpm',
    password: 'test-clickhouse-password-2026',
    database: 'analytics',
  });
}

function chDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

test.describe('Analytics host filter (#171)', () => {
  test('"Include unconfigured hosts" toggle reveals traffic-only hosts', async ({ page }) => {
    const stamp = Date.now();
    const tag = `hostfilter-${stamp}`;
    const configuredHost = `${tag}-configured.example.com`;
    const unconfiguredHost = `${tag}-unconfigured.example.com`;

    const ch = makeClient();
    let proxyHostId: number | undefined;

    try {
      // A configured proxy host (SQLite) — always present in the dropdown.
      const createRes = await page.request.post(API_PROXY_HOSTS, {
        headers: { Origin: ORIGIN },
        data: {
          name: `Host Filter ${stamp}`,
          domains: [configuredHost],
          upstreams: ['localhost:9999'],
        },
      });
      expect(createRes.ok(), `create proxy host failed: ${createRes.status()}`).toBeTruthy();
      proxyHostId = (await createRes.json()).id;

      // A traffic-only host (ClickHouse) — present in the dropdown but not a proxy host.
      await ch.insert({
        table: 'traffic_events',
        format: 'JSONEachRow',
        values: [
          {
            ts: chDateTime(Math.floor(Date.now() / 1000)),
            client_ip: '203.0.113.7',
            host: unconfiguredHost,
            method: 'GET',
            uri: '/',
            status: 200,
            proto: 'HTTP/1.1',
            bytes_sent: 1,
            user_agent: 'host-filter-test',
            is_blocked: 0,
          },
        ],
      });

      // Start with the toggle off regardless of any persisted preference.
      await page.addInitScript(() => {
        try {
          localStorage.removeItem('analytics:includeUnconfiguredHosts');
        } catch {
          /* ignore */
        }
      });
      await page.goto('/analytics');
      await expect(page.getByText('Total Requests', { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const configuredOption = page.getByRole('option', { name: configuredHost });
      const unconfiguredOption = page.getByRole('option', { name: unconfiguredHost });

      // Open the hosts selector. In `hasSearch` mode the MultiSelector trigger is deliberately NOT
      // a combobox — the popup's search input owns that role — so it is a plain listbox-opening
      // button, the only one on the page.
      const openHostList = async () => {
        await page.locator('button[aria-haspopup="listbox"]').click();
        await page.getByPlaceholder('Search hosts...').fill(tag);
      };

      // By default only configured proxy hosts are listed.
      await openHostList();
      await expect(configuredOption).toBeVisible({ timeout: 10_000 });
      await expect(unconfiguredOption).not.toBeVisible();

      // The toggle lives outside the popover, so activating it light-dismisses
      // the listbox — reopen and re-search before checking the widened list.
      await page.keyboard.press('Escape');
      await page.getByRole('checkbox', { name: /include unconfigured hosts/i }).click();

      await openHostList();
      await expect(configuredOption).toBeVisible({ timeout: 10_000 });
      await expect(unconfiguredOption).toBeVisible();
    } finally {
      if (proxyHostId != null) {
        await page.request
          .delete(`${API_PROXY_HOSTS}/${proxyHostId}`, { headers: { Origin: ORIGIN } })
          .catch(() => {
            /* best-effort cleanup */
          });
      }
      await ch
        .command({
          query: `ALTER TABLE traffic_events DELETE WHERE host = {h:String} SETTINGS mutations_sync = 2`,
          query_params: { h: unconfiguredHost },
        })
        .catch(() => {
          /* best-effort cleanup */
        });
      await ch.close();
    }
  });
});
