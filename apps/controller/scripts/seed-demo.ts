/**
 * Fill a DEMO_MODE database with something to look at.
 *
 *   DEMO_MODE=true DATABASE_URL=... bun scripts/seed-demo.ts [--reset]
 *
 * A demo whose every page is an empty state teaches nobody what this does, and screenshots of it
 * are worse. So this writes a plausible small deployment - proxy hosts with the options a real one
 * uses, the people who run it, and two weeks of traffic behind them.
 *
 * Everything goes through the models rather than into the tables, so what lands is what the UI
 * would have written: audit entries, `meta` blobs, normalised domains. Each host creation ends in
 * an apply, which is why demo mode is not optional here - `installDemoCaddy` puts that apply in
 * memory, and without it this would try to configure whatever Caddy the environment points at.
 *
 * Analytics are ClickHouse's, so the metrics half is skipped unless CLICKHOUSE_PASSWORD is set.
 * Point it at any ClickHouse; the demo one is:
 *
 *   docker run -d --name cpm-demo-clickhouse -p 18123:8123 \
 *     -e CLICKHOUSE_DB=analytics -e CLICKHOUSE_USER=cpm -e CLICKHOUSE_PASSWORD=cpmdemo \
 *     -v cpm-demo-clickhouse:/var/lib/clickhouse clickhouse/clickhouse-server:26.8.3.105-alpine
 */
import { eq, ne } from "drizzle-orm";

if (process.env.DEMO_MODE?.trim().toLowerCase() !== "true") {
  console.error("Refusing to seed: DEMO_MODE is not true. This writes invented data.");
  process.exit(1);
}

const RESET = process.argv.includes("--reset");

const db = (await import("../src/lib/db")).default;
const { installDemoCaddy } = await import("../src/lib/demo/start");
const schema = await import("../src/lib/db/schema");
const { createProxyHost } = await import("../src/lib/models/proxy-hosts");
const { createL4ProxyHost } = await import("../src/lib/models/l4-proxy-hosts");
const { createAccessList } = await import("../src/lib/models/access-lists");
const { createCertificate } = await import("../src/lib/models/certificates");
const { createGroup, addGroupMember } = await import("../src/lib/models/groups");
const { createUser } = await import("../src/lib/models/user");

installDemoCaddy();

/** Whoever owns this deployment. Everything seeded is attributed to them, as the UI would. */
async function actorId(): Promise<number> {
  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, "admin"))
    .limit(1);
  if (!admin) {
    console.error("No administrator in this database. Start the app once and finish setup first.");
    process.exit(1);
  }
  return admin.id;
}

/**
 * Clear what a previous run wrote, in foreign-key order, so re-seeding is not a game of guessing
 * which rows are new. The administrator survives: it is the account you sign in with.
 */
async function reset(actor: number): Promise<void> {
  await db.delete(schema.proxyHosts);
  await db.delete(schema.l4ProxyHosts);
  await db.delete(schema.accessLists);
  await db.delete(schema.certificates);
  await db.delete(schema.groups);
  await db.delete(schema.users).where(ne(schema.users.id, actor));
  await db.delete(schema.auditEvents);
  console.log("Cleared the previous demo data");
}

// ── People ──────────────────────────────────────────────────────────────────

const PEOPLE = [
  { name: "Priya Raman", email: "priya@example.com", role: "admin", group: "Platform" },
  { name: "Tomas Berg", email: "tomas@example.com", role: "operator", group: "Platform" },
  { name: "Dana Okafor", email: "dana@example.com", role: "operator", group: "Support" },
  { name: "Kit Marlowe", email: "kit@example.com", role: "user", group: "Support" },
  { name: "Sam Ellery", email: "sam@example.com", role: "viewer", group: null },
] as const;

async function seedPeople(actor: number): Promise<void> {
  const groups = new Map<string, number>();
  for (const [name, description] of [
    ["Platform", "Runs the proxy and the hosts behind it"],
    ["Support", "Reads the logs and answers for the services"],
  ] as const) {
    groups.set(name, (await createGroup({ name, description }, actor)).id);
  }

  for (const person of PEOPLE) {
    // No password: these accounts exist to populate the lists and to own things, not to sign in.
    const user = await createUser({
      email: person.email,
      name: person.name,
      role: person.role,
      provider: "credentials",
      subject: person.email,
    });
    const group = person.group ? groups.get(person.group) : undefined;
    if (group) await addGroupMember(group, user.id, actor);
  }
  console.log(`Seeded ${PEOPLE.length} people in ${groups.size} groups`);
}

// ── What the deployment serves ──────────────────────────────────────────────

type HostSpec = {
  name: string;
  domain: string;
  upstream: string;
  /** Its share of the traffic. A real deployment is lopsided, and a flat chart says nothing. */
  share?: number;
  /** Behind the shared certificate, which covers *.example.com. */
  wildcard?: boolean;
  accessList?: string;
  enabled?: boolean;
  websocket?: boolean;
};

const HOSTS: HostSpec[] = [
  {
    name: "Jellyfin",
    domain: "jellyfin.example.com",
    upstream: "http://10.0.3.12:8096",
    share: 30,
  },
  { name: "Immich", domain: "photos.example.com", upstream: "http://10.0.3.13:2283", share: 18 },
  { name: "Nextcloud", domain: "cloud.example.com", upstream: "http://10.0.3.14:8080", share: 15 },
  { name: "Grafana", domain: "grafana.example.com", upstream: "http://10.0.3.11:3000", share: 10 },
  {
    name: "Home Assistant",
    domain: "home.example.com",
    upstream: "http://10.0.3.16:8123",
    wildcard: true,
    share: 9,
  },
  {
    name: "Gitea",
    domain: "git.example.com",
    upstream: "http://10.0.3.15:3000",
    wildcard: true,
    share: 7,
  },
  {
    name: "Vaultwarden",
    domain: "vault.example.com",
    upstream: "http://10.0.3.17:80",
    accessList: "Staff only",
    share: 5,
  },
  {
    name: "Uptime Kuma",
    domain: "status.example.com",
    upstream: "http://10.0.3.19:3001",
    share: 4,
  },
  {
    name: "Paperless",
    domain: "paperless.example.com",
    upstream: "http://10.0.3.18:8000",
    accessList: "Staff only",
    share: 2,
  },
  {
    name: "n8n (staging)",
    domain: "n8n.example.com",
    upstream: "http://10.0.3.20:5678",
    enabled: false,
  },
];

type TrafficShare = { domain: string; share: number };

async function seedHosts(actor: number): Promise<TrafficShare[]> {
  const staffOnly = await createAccessList(
    {
      name: "Staff only",
      description: "Basic auth in front of the things that hold secrets",
      users: [
        { username: "priya", password: "demo-password-1" },
        { username: "tomas", password: "demo-password-2" },
      ],
    },
    actor,
  );

  const wildcard = await createCertificate(
    {
      name: "example.com wildcard",
      type: "managed",
      domainNames: ["*.example.com", "example.com"],
      autoRenew: true,
    },
    actor,
  );

  for (const host of HOSTS) {
    await createProxyHost(
      {
        name: host.name,
        domains: [host.domain],
        upstreams: [host.upstream],
        certificateId: host.wildcard ? wildcard.id : null,
        accessListId: host.accessList ? staffOnly.id : null,
        sslForced: true,
        hstsEnabled: true,
        allowWebsocket: host.websocket ?? true,
        preserveHostHeader: true,
        enabled: host.enabled ?? true,
      },
      actor,
    );
  }

  await createL4ProxyHost(
    {
      name: "PostgreSQL (read replica)",
      protocol: "tcp",
      listenAddress: ":5432",
      upstreams: ["10.0.3.30:5432"],
    },
    actor,
  );
  await createL4ProxyHost(
    {
      name: "Minecraft",
      protocol: "tcp",
      listenAddress: ":25565",
      upstreams: ["10.0.3.31:25565"],
    },
    actor,
  );

  console.log(`Seeded ${HOSTS.length} proxy hosts, 2 L4 hosts, 1 access list, 1 certificate`);
  // A disabled host answers nothing, so it has no traffic to invent.
  return HOSTS.filter((host) => host.enabled !== false).map((host) => ({
    domain: host.domain,
    share: host.share ?? 1,
  }));
}

// ── Two weeks of traffic ────────────────────────────────────────────────────

const DAYS = 14;
/** Requests a day at the busiest hour's rate; the shape below scales everything off it. */
const PEAK_PER_HOUR = 420;

const COUNTRIES = [
  ["GB", 26],
  ["US", 22],
  ["DE", 13],
  ["NL", 8],
  ["FR", 7],
  ["SE", 5],
  ["PL", 4],
  ["ES", 4],
  ["CA", 3],
  ["BR", 3],
  ["IN", 3],
  ["AU", 2],
] as const;

const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1",
  "curl/8.11.1",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];

const PATHS = ["/", "/login", "/api/status", "/assets/app.js", "/media/library", "/health"];

const WAF_RULES = [
  [942100, "SQL Injection Attack Detected via libinjection", "CRITICAL"],
  [941100, "XSS Attack Detected via libinjection", "CRITICAL"],
  [930110, "Path Traversal Attack (/../)", "ERROR"],
  [913100, "Found User-Agent associated with security scanner", "WARNING"],
  [920350, "Host header is a numeric IP address", "WARNING"],
] as const;

function pick<T>(list: readonly T[], random: number): T {
  return list[Math.floor(random * list.length)] as T;
}

/** Weighted so the country chart has a shape rather than twelve equal bars. */
function pickCountry(random: number): string {
  const total = COUNTRIES.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random * total;
  for (const [code, weight] of COUNTRIES) {
    cursor -= weight;
    if (cursor <= 0) return code;
  }
  return "GB";
}

function pickHost(hosts: TrafficShare[], random: number): string {
  const total = hosts.reduce((sum, host) => sum + host.share, 0);
  let cursor = random * total;
  for (const host of hosts) {
    cursor -= host.share;
    if (cursor <= 0) return host.domain;
  }
  return hosts[0]!.domain;
}

/** Busy in the evening, quiet at 04:00, and quieter at the weekend. */
function busyness(date: Date): number {
  const hour = date.getUTCHours();
  const daily = 0.15 + 0.85 * Math.max(0, Math.sin(((hour - 5) / 24) * Math.PI * 2) * 0.5 + 0.5);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.65 : 1;
  return daily * weekend;
}

function randomIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `${Math.floor(Math.random() * 180) + 20}.${octet()}.${octet()}.${octet()}`;
}

/**
 * A fixed set of visitors, drawn from rather than invented per request.
 *
 * Both extremes look wrong on the dashboard: one address per request makes "unique visitors" equal
 * the request count, and a handful of addresses makes every chart look like one person. A pool the
 * size of a small service's audience, with a few machines that never sleep taking a fifth of it,
 * is the shape of the real thing.
 */
const VISITOR_IPS = Array.from({ length: 2200 }, randomIp);
const REGULARS = 15;

/** The ones the WAF keeps catching: a scanner comes back, it does not arrive once and leave. */
const ATTACKER_IPS = Array.from({ length: 40 }, randomIp);

function clientIp(): string {
  const pool = Math.random() < 0.2 ? REGULARS : VISITOR_IPS.length;
  return VISITOR_IPS[Math.floor(Math.random() * pool)] as string;
}

async function seedTraffic(hosts: TrafficShare[]): Promise<void> {
  const { insertTrafficEvents, insertWafEvents, initClickHouse, isAnalyticsEnabled, getClient } =
    await import("../src/lib/clickhouse/client");
  if (!(await isAnalyticsEnabled())) {
    console.log("Analytics are off, so no metrics were written. Set the CLICKHOUSE_* settings.");
    return;
  }
  await initClickHouse();

  // Nothing here is incremental, so a second run without this would show twice the traffic.
  if (RESET) {
    const ch = await getClient();
    for (const table of ["traffic_events", "waf_events"]) {
      await ch.command({ query: `TRUNCATE TABLE IF EXISTS ${table}` });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  let written = 0;
  let wafWritten = 0;

  // An hour at a time: a batch small enough to hold, large enough that the insert is not the cost.
  for (let hoursAgo = DAYS * 24; hoursAgo > 0; hoursAgo--) {
    const start = now - hoursAgo * 3600;
    const rows = [];
    const waf = [];
    const count = Math.round(PEAK_PER_HOUR * busyness(new Date(start * 1000)));

    for (let i = 0; i < count; i++) {
      const r = Math.random();
      const host = pickHost(hosts, Math.random());
      // A handful of 4xx and the occasional 5xx, so the error line is not flat zero.
      const status = r > 0.97 ? 500 : r > 0.93 ? 404 : r > 0.91 ? 302 : 200;
      const blocked = r > 0.995;
      rows.push({
        ts: start + Math.floor(Math.random() * 3600),
        client_ip: clientIp(),
        country_code: pickCountry(Math.random()),
        host,
        method: r > 0.88 ? "POST" : "GET",
        uri: pick(PATHS, Math.random()),
        status: blocked ? 403 : status,
        proto: r > 0.3 ? "HTTP/2.0" : "HTTP/1.1",
        bytes_sent: Math.floor(Math.random() * 180_000) + 400,
        user_agent: pick(AGENTS, Math.random()),
        is_blocked: blocked,
      });

      if (blocked) {
        const [ruleId, message, severity] = pick(WAF_RULES, Math.random());
        waf.push({
          ts: start + Math.floor(Math.random() * 3600),
          host,
          client_ip: pick(ATTACKER_IPS, Math.random()),
          country_code: pickCountry(Math.random()),
          rule_id: ruleId,
          rule_message: message,
          severity,
          raw_data: null,
          blocked: true,
          method: "GET",
          uri: pick(PATHS, Math.random()),
        });
      }
    }

    await insertTrafficEvents(rows);
    if (waf.length > 0) await insertWafEvents(waf);
    written += rows.length;
    wafWritten += waf.length;
  }

  console.log(`Seeded ${written} traffic events and ${wafWritten} WAF events over ${DAYS} days`);
}

/** Store the ClickHouse connection so the app reads analytics the way a configured one does. */
async function enableAnalytics(): Promise<boolean> {
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();
  if (!password) return false;

  const registry = await import("../src/lib/settings/registry");
  const { saveSettings } = await import("../src/lib/settings/resolve");
  await saveSettings({
    [registry.analyticsEnabled.key]: true,
    [registry.clickhouseUrl.key]: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:18123",
    [registry.clickhouseUser.key]: process.env.CLICKHOUSE_USER ?? "cpm",
    [registry.clickhousePassword.key]: password,
    [registry.clickhouseDb.key]: process.env.CLICKHOUSE_DB ?? "analytics",
  });
  return true;
}

const actor = await actorId();
if (RESET) await reset(actor);

await seedPeople(actor);
const hosts = await seedHosts(actor);

if (await enableAnalytics()) {
  await seedTraffic(hosts);
} else {
  console.log("CLICKHOUSE_PASSWORD is unset, so analytics were left off and no metrics written.");
}

console.log("Demo data ready.");
process.exit(0);
