# Caddy Proxy Manager

Web interface for managing [Caddy Server](https://caddyserver.com/) reverse proxies and certificates. This fork is for redoing the original UI in a way that I like and trying to make the application as lightweight as possible. **THE CONFIG SETTINGS ON THIS PAGE HAVEN'T BEEN UPDATED, AND THEY WON'T BE UNTIL I'M SATISFIED WITH THE NEW CONFIG SETUP. IN THE MEANTIME, USE AT YOUR OWN RISK.** (As long as this message is here, I'm still not satisfied)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://mit-license.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Report Bug](https://github.com/silentspud/caddy-proxy-manager/issues) • [Request Feature](https://github.com/silentspud/caddy-proxy-manager/issues)

<img width="100%" alt="Dashboard" src="site/assets/screenshots/dashboard-main.png" />

## Overview

This project provides a web UI for Caddy Server, eliminating the need to manually edit JSON configurations or Caddyfiles. It handles reverse proxies, access lists, and certificate management through a Astryx interface. Built with Vinext version whatever, React 19, Astryx, Tailwind CSS, Drizzle ORM, and TypeScript. Analytics data (traffic events, WAF events) is stored in ClickHouse for fast aggregation queries, with automatic retention via TTL (30 days by default, configurable).

---

## Installation

```bash
git clone https://github.com/silentspud/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

Access at `http://localhost:3000/login`

Data persists in Docker volumes (caddy-manager-data, caddy-data, caddy-config, caddy-logs).

### Runtime

[Bun](https://bun.sh) is the only supported runtime. The app uses `bun:sqlite`, a Bun
built-in with no Node.js equivalent, so it refuses to start under Node.js and tells you
what to run instead.

For local work:

```bash
bun install
bun run dev
```

The web image does not need Bun installed, and does not contain the Bun CLI. What it
runs is `cpm-server`, a single executable produced by `bun build --compile`, holding
the Bun runtime and the production server. The application bundle itself stays on disk
beside the binary, in `dist/` — vinext loads it with a runtime `import()`, which Bun's
embedded-asset filesystem cannot serve, so it cannot be compiled in.

There is one runtime image, and the end-to-end suite runs that same image rather than a
variant with extra tooling, so what the tests exercise is what ships. Since the image
has no interpreter to execute a script with, the suite seeds its fixtures through the
`db-seed` container in `tests/docker-compose.test.yml` — a throwaway `oven/bun:1-slim`
that mounts the same data volume. See `tests/helpers/seed.ts`.

The container health check is `cpm-server --healthcheck`, which probes `/api/health`
from inside the image — the runtime has no shell HTTP client to call instead.

---

## Features

- **Proxy Hosts** - Reverse proxies with custom headers, multiple upstreams, load balancing (8 policies), active/passive health checks, retries, and enable/disable toggle
- **L4 Proxy Hosts** - TCP/UDP stream proxying with TLS SNI matching, proxy protocol (v1/v2), load balancing, health checks, and per-host geo blocking. Automatic Docker Compose port management via sidecar
- **Location Rules** - Path-based routing to different upstreams per proxy host (e.g. `/api/*` to one backend, `/ws/*` to another)
- **Redirect & Rewrite** - Per-host redirect rules (301/302/307/308) and path prefix rewriting
- **Forward Auth Portal** - Built-in identity provider for protecting proxy hosts without an external IdP. Credential and OAuth login portal, user groups with membership management, per-host access control by user or group, and excluded paths that bypass authentication
- **WAF** - Web Application Firewall powered by Coraza with optional OWASP Core Rule Set (SQLi, XSS, LFI, RCE). Per-host enable/disable, global and per-host rule suppression, custom SecLang directives, and a searchable event log with severity and blocked/detected classification
- **Analytics** - Live traffic charts, protocol breakdown, country map, top user agents, and blocked request log with configurable time ranges
- **Geo Blocking** - Block or allow traffic by country, continent, ASN, CIDR range, or exact IP per proxy host. Allow rules override block rules. Fail-closed mode, custom response codes/bodies, and trusted proxy support
- **Access Lists** - Multi-account HTTP basic auth protection (bcrypt-hashed) assignable per proxy host
- **Certificates** - Automatic HTTPS for every proxy host via Caddy ACME (Let's Encrypt / ZeroSSL), manual SSL/TLS import with expiry monitoring, and a built-in CA for issuing and revoking internal client certificates (mTLS)
- **mTLS** - Mutual TLS per proxy host using built-in CA certificates. Issue, track, and revoke client certificates. Fail-closed revocation (all certs revoked = all connections rejected)
- **mTLS RBAC** - Role-based access control for mTLS client certificates. Define roles, assign certs to roles, and create path-based access rules per proxy host (e.g. `/admin/*` requires the "ops" role)
- **User Roles** - Three-tier role system (Viewer, User, Admin) controlling dashboard access, API permissions, and feature visibility
- **User Management** - Admin page for managing users: edit roles, status, profiles; disable or delete accounts; search and filter
- **Groups** - Organize users into groups for forward auth access control. Assign groups to proxy hosts to grant access to all members at once
- **Authentik Integration** - Forward-auth SSO per proxy host with configurable header forwarding and protected paths
- **DNS Controls** - Custom DNS resolvers per host, upstream DNS pinning with IPv4/IPv6/both address family selection
- **REST API** - Full REST API under `/api/v1/` with Bearer token authentication, covering all resources. Interactive OpenAPI 3.1.0 docs at `/api-docs`
- **API Tokens** - Create and manage API tokens with optional expiration for programmatic access
- **Instance Sync** - Master/slave configuration sync for multi-instance deployments. The master pushes proxy hosts, certificates, access lists, and settings to slaves on every change
- **OAuth / SSO** - OAuth2/OIDC authentication with any compliant provider (Authentik, Keycloak, Auth0, etc.). Account linking from the Profile page. Optional group-based role mapping (e.g. members of `CPM_Admin` become admins) and OIDC-only mode, which disables local accounts entirely
- **DNS Providers** - Multi-provider DNS-01 challenge support for ACME certificates: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, Spaceship, deSEC, Dynu, and acme-dns. Credentials encrypted at rest. Per-certificate provider override supported
- **Caddy Build** - Choose which Caddy plugins the image is compiled with. Toggle any supported module (Layer 4, Request Blocker, Coraza WAF, and each DNS provider), add your own Go modules, and rebuild from the UI. Settings that depend on a disabled module are greyed out and say which module to turn back on
- **Settings** - ACME email, DNS provider configuration, upstream DNS pinning defaults, Authentik outpost, Prometheus metrics, logging format
- **Audit Log** - Searchable configuration change history with user attribution and pagination
- **Search & Pagination** - Server-side search and pagination on all data tables
- **Dark Mode** - Full dark/light theme support with system preference detection
- **Mobile UI** - Fully responsive interface optimised for iPhone and other narrow viewports

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
| -------- | ----------- | ------- | -------- |
| `SESSION_SECRET` | Session encryption key (32+ chars) | None | **Yes** |
| `ADMIN_USERNAME` | Admin login username | `admin` | **Yes** (unless `AUTH_DISABLE_LOCAL_USERS=true`) |
| `ADMIN_PASSWORD` | Admin password (see requirements below) | `admin` (dev only) | **Yes** (unless `AUTH_DISABLE_LOCAL_USERS=true`) |
| `BASE_URL` | Public URL where users access the dashboard.<br/>**Required for OAuth** - must match redirect URI | `http://localhost:3000` | **Yes** (if using OAuth) |
| `APP_NAME` | Display name in the sidebar, on the login card, and as the suffix on every page title | `Caddy Proxy Manager` | No |
| `AVATAR_GRAVATAR` | Allow user icons to fall back to Gravatar. Set `false` to keep all avatar lookups off the network. When unset, the **Settings → User Avatars** toggle decides (and syncs from master to slaves) | Unset (toggle decides) | No |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` (prod)<br/>`http://localhost:2019` (dev) | No |
| `DATABASE_URL` | SQLite database URL | `file:/app/data/caddy-proxy-manager.db` | No |
| `CERTS_DIRECTORY` | Certificate storage directory | `./data/certs` | No |
| `LOGIN_MAX_ATTEMPTS` | Max login attempts before rate limit | `5` | No |
| `LOGIN_WINDOW_MS` | Rate limit window in milliseconds | `300000` (5 min) | No |
| `LOGIN_BLOCK_MS` | Rate limit block duration in milliseconds | `900000` (15 min) | No |
| `OAUTH_ENABLED` | Enable OAuth2/OIDC authentication | `false` | No |
| `OAUTH_PROVIDER_NAME` | Display name for OAuth provider | `OAuth2` | No |
| `OAUTH_CLIENT_ID` | OAuth2 client ID | None | No |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret | None | No |
| `OAUTH_ISSUER` | OAuth2 OIDC issuer URL | None | No |
| `OAUTH_AUTHORIZATION_URL` | Optional OAuth authorization endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_TOKEN_URL` | Optional OAuth token endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_USERINFO_URL` | Optional OAuth userinfo endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_ALLOW_AUTO_LINKING` | Allow auto-linking OAuth identities to existing users | `false` | No |
| `OAUTH_SCOPES` | Scopes requested from the provider. Group claims usually need an extra scope | `openid email profile` | No |
| `OAUTH_GROUPS_CLAIM` | Claim holding the user's groups. Dots address nested claims (`resource_access.cpm.roles`) | `groups` | No |
| `OAUTH_GROUP_PREFIX` | Prefix marking CPM-relevant groups, e.g. `CPM_` | None | No |
| `OAUTH_ROLE_MAPPING` | Assign CPM roles from the group claim | `false` | No |
| `OAUTH_ADMIN_GROUP` | Group(s) granting admin, comma-separated. Takes precedence over the prefix | `<prefix>Admin` | No |
| `OAUTH_USER_GROUP` | Group(s) granting user, comma-separated. Takes precedence over the prefix | `<prefix>User` | No |
| `OAUTH_VIEWER_GROUP` | Group(s) granting viewer, comma-separated. Takes precedence over the prefix | `<prefix>Viewer` | No |
| `OAUTH_DEFAULT_ROLE` | Role assigned when no role group matches | `user` | No |
| `OAUTH_SYNC_GROUPS` | Mirror the remaining prefixed IdP groups into CPM groups | `false` | No |
| `AUTH_TRUST_HOST` | Trust the Host header for URL construction (only behind proxies that rewrite Host) | `false` | No |
| `AUTH_ALLOW_SELF_REGISTRATION` | Allow public email/password account registration | `false` | No |
| `AUTH_ALLOW_OAUTH_REGISTRATION` | Allow first-time OAuth/OIDC identities to create user accounts | `false` (`true` when `AUTH_DISABLE_LOCAL_USERS=true`) | No |
| `AUTH_DISABLE_LOCAL_USERS` | OIDC-only mode: no local accounts, no credential sign-in, no bootstrap admin | `false` | No |
| `AUTH_RATE_LIMIT_ENABLED` | Enable Better Auth rate limiting | `true` | No |
| `AUTH_RATE_LIMIT_WINDOW` | Rate limit window in seconds | `60` | No |
| `AUTH_RATE_LIMIT_MAX` | Max requests per window | `5` | No |
| `INSTANCE_MODE` | Instance role: `standalone`, `master`, or `slave` | `standalone` | No |
| `INSTANCE_SYNC_TOKEN` | Bearer token slaves use to authenticate sync requests | None | No (required if `slave`) |
| `INSTANCE_SLAVES` | JSON array of slave instances for the master to push to | None | No |
| `INSTANCE_SYNC_INTERVAL` | Periodic sync interval in seconds (`0` = disabled) | `0` | No |
| `INSTANCE_SYNC_ALLOW_HTTP` | Allow sync over HTTP (for internal Docker networks) | `false` | No |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint for analytics | `http://clickhouse:8123` | No |
| `CLICKHOUSE_USER` | ClickHouse username | `cpm` | No |
| `CLICKHOUSE_PASSWORD` | ClickHouse password (`openssl rand -base64 32`). Required when the `clickhouse` profile is active. | None | No (required if analytics enabled) |
| `CLICKHOUSE_DB` | ClickHouse database name | `analytics` | No |

**Production Requirements:**

- `SESSION_SECRET`: 32+ characters (`openssl rand -base64 32`)
- `ADMIN_PASSWORD`: 12+ chars with uppercase, lowercase, numbers, and special characters — not required when `AUTH_DISABLE_LOCAL_USERS=true`

Development mode (`NODE_ENV=development`) allows default `admin`/`admin` credentials.

---

## Security

- Production enforces strong passwords (12+ chars, mixed case, numbers, special characters)
- 32+ character session secrets required
- Login rate limiting: 5 attempts per 60 seconds
- Audit trail for all configuration changes
- Supports OAuth2/OIDC for SSO, including group-based roles and an OIDC-only mode with no local accounts

**Production Setup:**

```bash
export SESSION_SECRET=$(openssl rand -base64 32)
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="YourStr0ng-P@ssw0rd123!"
docker compose up -d
```

**Limitations:**

- Certificate private keys stored unencrypted in SQLite
- In-memory rate limiting (not suitable for multi-instance deployments)

---

## User Roles

CPM has three roles with increasing privileges:

| Capability | Viewer | User | Admin |
| ---------- | ------ | ---- | ----- |
| Log in to the dashboard | Yes | Yes | Yes |
| View own profile | Yes | Yes | Yes |
| Access forward-auth-protected apps (when granted) | Yes | Yes | Yes |
| Manage proxy hosts, certificates, access lists | No | No | Yes |
| Manage users, groups, and settings | No | No | Yes |
| View analytics, audit log, and API docs | No | No | Yes |
| Create and manage API tokens | No | No | Yes |
| Access the REST API (`/api/v1/`) | No | No | Yes |

New users default to the **user** role. The initial admin account is created from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables.

> **Forward Auth access** is separate from role — all roles must be explicitly granted access to each protected host via the forward auth access list.

---

## Certificate Management

Caddy automatically obtains Let's Encrypt certificates for all proxy hosts.

**DNS-01 Challenge** (optional): Configure a DNS provider in **Settings → DNS Providers** for wildcard certificates and environments where ports 80/443 are not public. Supported providers: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, Spaceship, deSEC, Dynu, and acme-dns. Credentials are encrypted at rest with AES-256-GCM. You can override the DNS provider per certificate.

**Custom Certificates** (optional): Import your own certificates via the Certificates page. Private keys are stored unencrypted in SQLite.

---

## Geo Blocking

Geo blocking is configured per proxy host. It requires MaxMind GeoLite2 databases (see [GeoIP Setup](#geoip-setup)).

### Rule types

| Type | Example | Description |
| ---- | ------- | ----------- |
| Country | `DE` | ISO 3166-1 alpha-2 country code |
| Continent | `EU` | `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA` |
| ASN | `24940` | Autonomous System Number |
| CIDR | `91.98.150.0/24` | IP range in CIDR notation |
| IP | `91.98.150.103` | Exact IP address |

Rules can be **block** or **allow**. Allow rules take precedence over block rules — you can block an entire continent and then allow specific IPs or ASNs through.

### GeoIP Setup

Geo blocking requires MaxMind GeoLite2 Country and/or ASN databases. Use the bundled `geoipupdate` service:

1. Register for a free MaxMind account at [maxmind.com](https://www.maxmind.com/)
2. Generate a license key with `GeoLite2-Country` and `GeoLite2-ASN` permissions
3. Add to your `.env`:

   ```env
   GEOIPUPDATE_ACCOUNT_ID=your-account-id
   GEOIPUPDATE_LICENSE_KEY=your-license-key
   ```

4. Start with the `geoipupdate` profile:

   ```bash
   docker compose --profile geoipupdate up -d
   ```

The databases are stored in the `geoip-data` Docker volume and shared between the web and Caddy containers.

---

## Analytics

Analytics uses a bundled ClickHouse instance for storing and querying traffic events and WAF events. Data is retained for **30 days** by default via ClickHouse's TTL. Change the window with the `CLICKHOUSE_RETENTION_DAYS` environment variable — on the next startup the existing tables' TTL is migrated to the new value and expired data is purged.

### Enabling analytics (recommended)

Analytics is enabled via the `clickhouse` Docker Compose profile. The default `.env.example` has it on:

```env
COMPOSE_PROFILES=clickhouse
CLICKHOUSE_PASSWORD=your-clickhouse-password   # openssl rand -base64 32
```

Then start (or restart) the stack:

```bash
docker compose up -d
```

### Disabling analytics

Remove `clickhouse` from `COMPOSE_PROFILES` (or leave the variable empty) and omit `CLICKHOUSE_PASSWORD`:

```env
COMPOSE_PROFILES=
```

The web container starts normally without ClickHouse. The Analytics page shows a notice explaining that ClickHouse is not enabled, and no data is collected.

### Combining profiles

To run both analytics and GeoIP updates simultaneously, list both profiles:

```env
COMPOSE_PROFILES=clickhouse,geoipupdate
CLICKHOUSE_PASSWORD=…
GEOIPUPDATE_ACCOUNT_ID=…
GEOIPUPDATE_LICENSE_KEY=…
```

---

## WAF (Web Application Firewall)

The WAF is powered by [Coraza](https://coraza.io/) and integrates the OWASP Core Rule Set.

Enable globally in **WAF → Settings**, then optionally override per proxy host. Two modes:

- **Block** — requests matching rules are rejected with 403
- **Detect** — requests are logged but not blocked

**OWASP CRS** covers SQLi, XSS, LFI, RCE, and more (enabled by default when WAF is on).

**Rule suppression** — suppress noisy rules globally or per host from the event detail drawer or the Suppressed Rules tab.

**Custom directives** — any ModSecurity SecLang syntax is accepted, e.g.:

```text
SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,ctl:ruleEngine=Off,nolog"
```

---

## Caddy Build

Caddy is a single static binary: a plugin either was compiled in with
[xcaddy](https://github.com/caddyserver/xcaddy) or it does not exist at runtime.
**Settings → Caddy Build** makes that list editable.

The default image ships with every supported module, so an existing install
behaves exactly as it did before this page existed.

### Choosing modules

Each supported plugin has a toggle. Turning one off has two effects:

- The app stops generating config that uses it, immediately. This is safe — the
  handler simply stops being emitted — and it is what lets you remove a plugin
  without Caddy rejecting the stored config on the way out.
- Every setting that depends on it is disabled in the UI, with a tooltip naming
  the module. Global geoblocking and per-host geoblock rules follow the Request
  Blocker module; the WAF page and per-host WAF settings follow Coraza; the L4
  Proxy Hosts page follows caddy-l4; and each DNS provider follows its own
  `caddy-dns` module, so disabling Cloudflare leaves Route 53 alone.

A module still in use cannot be switched off — the save is refused and names
what is using it (for example "3 enabled L4 proxy hosts need the Layer 4 Proxy
module"). That check covers global WAF and geoblocking, per-host WAF and
geoblock rules, enabled L4 hosts, and every DNS provider with credentials on
file. Turn the feature off first.

Per-host **Custom Caddyfile** snippets cannot be checked the same way — they are
free-form text, and only Caddy's adapter knows what a directive resolves to, for
the binary running *now* rather than the one a rebuild would produce. Saving a
module change while any host has a snippet therefore adds an advisory note
listing those hosts, so you can review them before rebuilding.

### Custom modules

Any Caddy plugin published as a Go module can be added by path, with an optional
tag, branch, or commit. It is compiled from source at build time, so a module
that does not build fails the rebuild — the running container is left untouched
when that happens.

Custom modules are compiled into the proxy binary and run with its privileges.
Add only modules you trust, from sources you would trust with the proxy itself.

### Rebuilding

Saving records the selection; it does not change the running container. **Rebuild
Caddy** writes a Compose override onto the shared data volume and signals the
sidecar, which runs `docker compose build caddy` and then recreates the
container. Compiling Caddy takes several minutes; the proxy keeps serving on the
current binary until the new one is ready, then restarts.

Because *enabling* a module only takes effect once it is actually in the binary,
config generation uses the intersection of what you selected and what the running
image was built with. The panel shows a "Rebuild required" banner in between.

That distinction is tracked with two separate files on the data volume, and the
split is what makes a failed build harmless:

| File | Written by | Holds |
| --- | --- | --- |
| `docker-compose.caddy-build.yml` | web, when you click Rebuild | the *desired* module list — the build's input |
| `caddy-build.applied.json` | sidecar, only after the build succeeds and Caddy is healthy | what the running binary *actually* contains |

If a build fails, the applied record is left alone, so the app keeps generating
config the current binary can load. Nothing needs cleaning up by hand — fix the
selection and click Rebuild again. If the sidecar is restarted mid-build (a host
reboot, say), it clears the stale "building" state on startup and the button
becomes available again.

Rebuilding needs `BUILD: 1` on the `docker-socket-proxy` service (the default in
`docker-compose.yml`). Set it to `0` to opt out: everything else keeps working,
and you can run `docker compose build caddy` yourself — the generated module list
is written to the data volume as `docker-compose.caddy-build.yml` either way.
Note that a hand-run build does not write the applied record, so the app will
keep assuming the shipped module set until a sidecar rebuild happens.

Every image records what it was compiled with, so you can check a container
directly rather than inferring it:

```bash
docker exec caddy-proxy-manager-caddy cat /etc/caddy/caddy-modules.txt
```

### Managing modules over the REST API

The same selection is available under `/api/v1/caddy/modules`:

- `GET` returns the module catalog, the stored selection, and how it differs
  from the running image.
- `PUT` replaces the selection. It applies the same refusal as the UI, returning
  `409` and naming what is still using a module you tried to disable.

Saving over the API does not rebuild — same as the UI. The rebuild trigger and
its progress live at `POST` / `GET /api/caddy-build`, which take the same admin
Bearer token but sit outside the versioned `/api/v1` contract: they back the
Settings panel and may change without a version bump. Prefer the button.

### Per-host Caddyfile

Each proxy host also has a **Custom Caddyfile** field for raw Caddyfile
directives. They are adapted to JSON by the running Caddy — the same binary, with
the same plugin set, that will execute them — and inserted before that host's
reverse proxy, as a `subroute` so each directive keeps its own matcher.

A snippet Caddy cannot parse is rejected when you save, with Caddy's own error
naming the line. A snippet that stops adapting later — because it referenced a
plugin you have since removed — is skipped with a warning in the web container's
logs rather than failing the whole config, so one stale snippet cannot take the
other hosts down with it.

---

## Instance Sync

Run a master instance that pushes configuration to one or more slaves on every change.

```bash
# Master
INSTANCE_MODE=master
INSTANCE_SLAVES='[{"name":"replica","url":"https://replica.example.com","token":"<32-char-token>"}]'

# Slave
INSTANCE_MODE=slave
INSTANCE_SYNC_TOKEN=<32-char-token>
```

Synced data: proxy hosts, certificates, access lists, and settings. User accounts are **not** synced.

Use HTTPS slave URLs in production. Set `INSTANCE_SYNC_ALLOW_HTTP=true` only for internal Docker networks.

See the [Environment Variables Reference](https://github.com/fuomag9/caddy-proxy-manager/wiki/Environment-Variables-Reference) for all `INSTANCE_*` options.

---

## Upstream DNS Pinning

You can enable upstream DNS pinning globally (**Settings → Upstream DNS Pinning**) and override per host (**Proxy Host → Upstream DNS Pinning**).

When enabled, hostname upstreams are resolved during config save/reload and written to Caddy as concrete IP dials. Address family selection supports:

- `both` (preferred, resolves AAAA then A with IPv6 preference)
- `ipv6`
- `ipv4`

### Important HTTPS Limitation

If one reverse proxy handler contains multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those HTTPS upstreams to avoid TLS SNI mismatch. In that case, hostname dials are kept for those HTTPS upstreams.

HTTP upstreams in the same handler are still eligible for pinning.

---

## OAuth Authentication

Supports any OIDC-compliant provider (Authentik, Keycloak, Auth0, etc.). Providers can be configured via environment variables or the **Settings → OAuth Providers** UI.

### Option A: Configure via UI (Recommended)

1. Log in as admin and navigate to **Settings → OAuth Providers**
2. Click **Add Provider** and fill in the details
3. Copy the displayed **Callback URL** and add it to your OAuth provider's allowed redirect URIs

### Option B: Configure via Environment Variables

```bash
# Set your public URL (REQUIRED for OAuth to work)
BASE_URL=https://caddy-manager.example.com

OAUTH_ENABLED=true
OAUTH_PROVIDER_NAME="Authentik"  # Display name
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_ISSUER=https://auth.example.com/application/o/app/
```

**Redirect URI Configuration:**

The callback URL format is:

```text
{BASE_URL}/api/auth/callback/{provider-id}
```

For environment-configured providers, the provider ID is derived from `OAUTH_PROVIDER_NAME` (lowercased, non-alphanumeric replaced with `-`). The exact callback URL is shown in **Settings → OAuth Providers** after the provider is synced.

Examples:

- `https://caddy-manager.example.com/api/auth/callback/authentik-QXV0aG` (production)
- `http://localhost:3000/api/auth/callback/authentik-QXV0aG` (development)

The `BASE_URL` environment variable must match exactly where users access your dashboard.

> **Upgrading from < 1.0-RC:** The old callback URL (`/api/auth/callback/oauth2`) no longer works. Update your OAuth provider's redirect URI to the new format shown in **Settings → OAuth Providers**.

> **Upgrading to better-auth 1.7:** The callback URL changed again, from
> `/api/auth/oauth2/callback/{provider-id}` to `/api/auth/callback/{provider-id}`.
> Generic OAuth providers are now registered as first-class social providers and
> are served by the core callback endpoint, so the old plugin-specific path no
> longer exists. Update the redirect URI at your identity provider, or OAuth
> sign-in will fail with a redirect-URI mismatch. The current value is always
> shown in **Settings → OAuth Providers**.

OAuth login appears on the login page alongside credentials. Users can link OAuth to existing accounts from the Profile page.

### Group-Based Roles

CPM can take a user's role from their identity provider's group claim instead of
managing it by hand. Configure it per provider in **Settings → OAuth Providers →
Group mapping**, or with the `OAUTH_*` variables for the env-configured provider.

There are two equivalent ways to say which groups grant which role. Use whichever
matches how your directory is already organised.

**Name the groups directly.** Each role takes any number of groups, comma-separated,
written exactly as your provider reports them:

```bash
OAUTH_SCOPES="openid email profile groups"   # ask the IdP for the claim
OAUTH_GROUPS_CLAIM=groups                    # dots address nested claims
OAUTH_ROLE_MAPPING=true
OAUTH_ADMIN_GROUP="platform-owners, sre-oncall"
OAUTH_USER_GROUP="staff"
OAUTH_VIEWER_GROUP="auditors, contractors"
OAUTH_DEFAULT_ROLE=user
```

Membership of *any one* of a role's groups grants it, so several unrelated groups can
map to the same role.

**Or use a prefix**, if your groups already share one. CPM then derives all three
names for you:

| Group (prefix `CPM_`) | CPM role |
| --------------------- | -------- |
| `CPM_Admin` | admin |
| `CPM_User` | user |
| `CPM_Viewer` | viewer |

```bash
OAUTH_GROUP_PREFIX=CPM_
OAUTH_ROLE_MAPPING=true
```

The two mix freely: a role with its own group names ignores the prefix, and a role
left unset falls back to it. So `OAUTH_GROUP_PREFIX=CPM_` together with
`OAUTH_ADMIN_GROUP=platform-owners` means admins come from `platform-owners` while
users and viewers still come from `CPM_User` and `CPM_Viewer`.

`OAUTH_DEFAULT_ROLE` decides the role for users in none of the role groups.

Notes:

- **The IdP becomes authoritative.** With role mapping on, a user who loses
  `CPM_Admin` is demoted at their next sign-in. The last remaining active admin is
  never demoted, so a mistake in the IdP cannot lock you out.
- **Roles are applied at sign-in**, not continuously. A group change in the IdP
  takes effect when the user signs in again.
- **Matching is case-insensitive** and tolerates Keycloak-style group paths
  (`/Parent/CPM_Admin` matches `CPM_Admin`).
- **The most privileged match wins.** A user in both the admin and viewer groups is
  an admin.
- The claim may be an array of strings, an array of objects, a comma-separated
  string, or a JSON-encoded array. Nested claims use a dotted path, e.g.
  `resource_access.cpm.roles`.
- Groups are read from the ID token, falling back to the userinfo endpoint when the
  claim is not in the token. Remember to request the scope that carries it.

### Mirroring Groups

With `OAUTH_SYNC_GROUPS=true` (or the **Mirror groups into CPM groups** switch), the
remaining prefixed groups become CPM groups with the prefix stripped —
`CPM_Devs` → `Devs` — so IdP groups can drive [forward auth](#forward-auth-portal)
access control. Membership of these groups is reconciled on every sign-in. Groups
you created yourself keep `source=ui` and are never modified by the sync; if a
mirrored name matches one of them, the user is added to it but never removed.

### OIDC-Only Mode

Set `AUTH_DISABLE_LOCAL_USERS=true` to hand identity entirely to your IdP:

- No bootstrap admin is created, and `ADMIN_USERNAME` / `ADMIN_PASSWORD` are no
  longer required at startup — even in production.
- Credential sign-in is turned off in Better Auth, and the username/password form
  disappears from both the login page and the forward auth portal.
- Creating local users and setting or changing passwords is rejected in the UI and
  the REST API.
- OAuth self-provisioning defaults to enabled, since the IdP is the only way an
  account can come into existence. Set `AUTH_ALLOW_OAUTH_REGISTRATION=false` to
  restrict sign-in to accounts that already exist.

```bash
AUTH_DISABLE_LOCAL_USERS=true
OAUTH_ENABLED=true
OAUTH_ISSUER=https://auth.example.com/application/o/cpm/
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_SCOPES="openid email profile groups"
OAUTH_GROUP_PREFIX=CPM_
OAUTH_ROLE_MAPPING=true
```

> Configure and verify the provider **before** enabling this. With no enabled OAuth
> provider there is no way to sign in; CPM logs a warning at startup, and the only
> recovery is to fix the provider through the `OAUTH_*` environment variables.

---

## Forward Auth Portal

CPM includes a built-in forward auth identity provider — no external IdP (Authentik, Authelia, etc.) required.

### How it works

1. Enable **Forward Auth** on a proxy host and choose which users or groups may access it.
2. Unauthenticated visitors are redirected to the CPM login portal.
3. After login, CPM issues a session cookie and redirects back to the protected app.
4. Caddy's `forward_auth` directive validates every subsequent request against CPM.

### Groups

Create groups on the **Groups** page to organise users. When you grant a group access to a proxy host, all current and future members of that group gain access automatically.

### Per-host access control

Each forward-auth-protected host has its own access list of allowed users and/or groups. Access is separate from the user's role — even admins must be explicitly granted access.

---

## Roadmap

[Open an issue](https://github.com/silentspud/caddy-proxy-manager/issues) for feature requests.

---

## Contributing

Contributions welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/name`)
5. Open a Pull Request

- Follow the existing code style (TypeScript, Prettier formatting)
- Add tests for new features when applicable
- Update documentation for user-facing changes
- Keep commits focused and write clear commit messages

---

## Support

- **Issues:** [GitHub Issues](https://github.com/silentspud/caddy-proxy-manager/issues) for bugs and feature requests
- **Discussions:** [GitHub Discussions](https://github.com/silentspud/caddy-proxy-manager/discussions) for questions and ideas

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **[Caddy Server](https://caddyserver.com/)** - The amazing web server that powers this project
- **[Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager)** - The original project
- **[Next.js](https://nextjs.org/)** - React framework for production
- **[Astryx](https://ui.shadcn.com/)** - Beautifully designed components built on Radix UI and Tailwind CSS
- **[Drizzle ORM](https://orm.drizzle.team/)** - Lightweight SQL migrations and type-safe queries

---

<div align="center">

[⬆ back to top](#caddy-proxy-manager)

</div>
