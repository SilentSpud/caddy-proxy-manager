/**
 * The dashboard host's proxy options: reading them from the host form, and copying them from a
 * stored host.
 *
 * Kept out of dashboard-host.ts, which caddy.ts imports: this module needs the proxy host model,
 * and the model imports caddy.ts, so putting it there would close a cycle.
 */
import {
  type DashboardHostOptions,
  type DashboardHostSettings,
  EMPTY_DASHBOARD_HOST_OPTIONS,
} from "./dashboard-host";
import { parseAccessListId, parseCertificateId } from "./form-parse";
import { agentIdsForHost, parseAgentIds } from "./models/host-agents";
import {
  assertProxyHostOptionsStorable,
  getProxyHost,
  getProxyHostMeta,
  listProxyHosts,
  mergeProxyHostMeta,
  type ProxyHost,
  type ProxyHostMetaView,
  proxyHostMetaView,
} from "./models/proxy-hosts";
import { parseProxyHostOptionUpdates, validateAndSanitizeCertificateId } from "./proxy-host-form";

/** What the dashboard host's option fields render from: the parts of a `ProxyHost` they read. */
export type DashboardHostFormView = ProxyHostMetaView & {
  certificateId: number | null;
  accessListId: number | null;
  hstsSubdomains: boolean;
  skipHttpsHostnameValidation: boolean;
  agentIds: number[];
};

export function dashboardHostFormView(options?: DashboardHostOptions): DashboardHostFormView {
  const current = options ?? EMPTY_DASHBOARD_HOST_OPTIONS;
  return {
    ...proxyHostMetaView(current.meta),
    certificateId: current.certificateId,
    accessListId: current.accessListId,
    hstsSubdomains: current.hstsSubdomains,
    skipHttpsHostnameValidation: current.skipHttpsHostnameValidation,
    agentIds: current.agentIds,
  };
}

/**
 * CPM forward auth is dropped from anything stored here. Its grants live in a table keyed by host
 * id, which the managed host does not have - and gating the dashboard behind the sign-in the
 * dashboard itself serves is a loop, not a protection.
 */
function withoutForwardAuth(meta: string | null): string | null {
  return mergeProxyHostMeta(meta, { cpmForwardAuth: null });
}

/**
 * Read the host form's option fields into the dashboard host's options.
 *
 * Reads the way `updateProxyHostAction` does: a section the form did not render is left as it was.
 * A form with no option fields at all - the setup step, or a client from before they existed -
 * keeps `existing` whole. Throws the model's domain errors for what a stored host would refuse.
 */
export async function readDashboardHostOptions(
  formData: FormData,
  existing: DashboardHostOptions | undefined,
  domain: string,
): Promise<DashboardHostOptions> {
  const base = existing ?? EMPTY_DASHBOARD_HOST_OPTIONS;
  if (!formData.has("dashboardOptionsPresent")) return base;

  const { certificateId, warning } = formData.has("certificateId")
    ? await validateAndSanitizeCertificateId(parseCertificateId(formData.get("certificateId")))
    : { certificateId: base.certificateId, warning: undefined };
  if (warning) console.warn(`[readDashboardHostOptions] ${warning}`);

  const accessListId = formData.has("accessListId")
    ? parseAccessListId(formData.get("accessListId"))
    : base.accessListId;
  const agentIds = formData.has("agentAssignmentPresent")
    ? parseAgentIds(formData.getAll("agentId"))
    : base.agentIds;

  const updates = parseProxyHostOptionUpdates(formData);
  const meta = withoutForwardAuth(mergeProxyHostMeta(base.meta, updates));

  await assertProxyHostOptionsStorable({
    domains: [domain],
    certificateId,
    agentIds,
    meta,
    customCaddyfileChanged:
      updates.customCaddyfile !== undefined &&
      proxyHostMetaView(meta).customCaddyfile !== proxyHostMetaView(base.meta).customCaddyfile,
    previousMeta: base.meta,
    target: { kind: "dashboard" },
  });

  return {
    certificateId,
    accessListId,
    hstsSubdomains: updates.hstsSubdomains ?? base.hstsSubdomains,
    skipHttpsHostnameValidation:
      updates.skipHttpsHostnameValidation ?? base.skipHttpsHostnameValidation,
    agentIds,
    meta,
  };
}

/** A stored host that claims exactly this domain, as the setup step lists it. */
export type DomainClaim = { id: number; name: string; domains: string[]; enabled: boolean };

/**
 * Every stored host, by the domains it claims - so the setup step can say, as the operator types,
 * which one the dashboard host would take a domain from.
 *
 * Exact names only. A wildcard host does not tie with the dashboard's exact domain - the route sort
 * already puts the exact one first - so there is nothing to take over from it.
 */
export async function listDomainClaims(): Promise<DomainClaim[]> {
  const hosts = await listProxyHosts();
  return hosts.map((host) => ({
    id: host.id,
    name: host.name,
    domains: host.domains.map((domain) => domain.toLowerCase()),
    enabled: host.enabled,
  }));
}

/**
 * The dashboard host a stored host would become: its certificate, access list, agents, HTTPS and
 * every `meta` option, on the dashboard's domain. Null when the host is gone or does not claim the
 * domain - the form was drawn before the save, and a host can change in between.
 *
 * HTTPS is carried over rather than reset to the setup default of HTTP. A host that was serving the
 * domain over HTTPS with HSTS has pinned every browser that visited it to HTTPS, and a dashboard
 * that came back on plain HTTP would be unreachable from exactly those browsers.
 */
export async function dashboardSettingsFromHost(
  hostId: number,
  domain: string,
): Promise<{ settings: DashboardHostSettings; host: ProxyHost } | null> {
  const name = domain.trim().toLowerCase();
  const host = await getProxyHost(hostId);
  if (!host?.domains.some((claimed) => claimed.toLowerCase() === name)) return null;

  const [meta, agentIds] = await Promise.all([
    getProxyHostMeta(hostId),
    agentIdsForHost("http", hostId),
  ]);

  return {
    host,
    settings: {
      enabled: true,
      domain: name,
      tls: host.sslForced,
      options: {
        certificateId: host.certificateId,
        accessListId: host.accessListId,
        hstsSubdomains: host.hstsSubdomains,
        skipHttpsHostnameValidation: host.skipHttpsHostnameValidation,
        agentIds,
        meta: withoutForwardAuth(meta),
      },
    },
  };
}
