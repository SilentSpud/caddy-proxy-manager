/**
 * Browser-safe helpers for the dashboard host.
 *
 * dashboard-host.ts reads the server config and resolves DNS, so a client component can import only
 * types from it. Anything the settings page runs in the browser lives here instead, with nothing
 * but a type import back.
 */
import type { DashboardHostSettings } from "./dashboard-host";

/**
 * The controller address for an agent's pairing command, when the dashboard host gives it one.
 *
 * Only while the host is on: a stored domain with the route switched off is a name nothing answers
 * on. Over HTTPS the bare domain is enough - the agent reads a bare public name as https on 443.
 * Over HTTP it needs the scheme and :80 spelled out, because the agent reads `http://` without a
 * port as the controller's own 3000, which is not where Caddy serves the dashboard. `insecure`
 * flags that case, which an agent refuses for a public address unless told it may.
 */
export function pairingHostFor(
  settings: DashboardHostSettings | null,
): { host: string; insecure: boolean } | null {
  const domain = settings?.domain.trim().toLowerCase() ?? "";
  if (!settings?.enabled || !domain) return null;
  return settings.tls
    ? { host: domain, insecure: false }
    : { host: `http://${domain}:80`, insecure: true };
}
