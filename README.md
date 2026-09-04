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

[Bun](https://bun.sh) is the only supported runtime. The app reaches PostgreSQL through
`Bun.SQL`, a Bun built-in with no Node.js equivalent, so it refuses to start under Node.js
and tells you what to run instead.

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
- **L4 Proxy Hosts** - TCP/UDP stream proxying with TLS SNI matching, proxy protocol (v1/v2), load balancing, health checks, and per-host geo blocking. Automatic Docker Compose port management via agent
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
- **Default Response** - Replace Caddy's native behavior for unknown hosts or direct-IP requests with a custom status/body/headers, redirect, or connection abort
- **OAuth / SSO** - OAuth2/OIDC authentication with any compliant provider (Authentik, Keycloak, Auth0, etc.). Account linking from the Profile page. Optional group-based role mapping (e.g. members of `CPM_Admin` become admins) and OIDC-only mode, which disables local accounts entirely
- **DNS Providers** - Multi-provider DNS-01 challenge support for ACME certificates: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, Spaceship, deSEC, Dynu, and acme-dns. Credentials encrypted at rest. Per-certificate provider override supported
- **Caddy Build** - Choose which Caddy plugins the image is compiled with. Toggle any supported module (Layer 4, Request Blocker, Coraza WAF, and each DNS provider), add your own Go modules, and rebuild from the UI. Settings that depend on a disabled module are greyed out and say which module to turn back on
- **Settings** - ACME email, default response, DNS provider configuration, upstream DNS pinning defaults, Authentik outpost, Prometheus metrics, logging format
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
| `AVATAR_GRAVATAR` | Allow user icons to fall back to Gravatar. Set `false` to keep all avatar lookups off the network. When unset, the **Settings → User Avatars** toggle decides | Unset (toggle decides) | No |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` (prod)<br/>`http://localhost:2019` (dev) | No |
| `DATABASE_URL` | PostgreSQL connection string. Built from the `POSTGRES_*` values below when unset, so it only needs setting to reach a server other than the bundled one. See [The Database](#the-database) | `postgres://cpm:$POSTGRES_PASSWORD@postgres:5432/cpm` | No |
| `DATABASE_POOL_MAX` | Connections the database pool may open. Requests beyond it queue. Keep the server's own `max_connections` above the total across every instance pointing at it | `10` | No |
| `POSTGRES_PASSWORD` | Password for the bundled `postgres` service. Interpolated by Compose on the host, not read by the app | None | **Yes** |
| `POSTGRES_USER` / `POSTGRES_DB` | Role and database the bundled `postgres` service creates. Compose-only, as above | `cpm` / `cpm` | No |
| `CERTS_DIRECTORY` | Certificate storage directory | `./data/certs` | No |
| `LOGIN_MAX_ATTEMPTS` | Max login attempts before rate limit | `5` | No |
| `LOGIN_WINDOW_MS` | Rate limit window in milliseconds | `300000` (5 min) | No |
| `LOGIN_BLOCK_MS` | Rate limit block duration in milliseconds | `900000` (15 min) | No |
| `PUID` / `PGID` | Build args setting the UID/GID the containers run as. Match your host user to avoid volume permission issues (`id -u` / `id -g`) | `10001`/`10001` (web)<br/>`10000`/`10000` (caddy) | No |
| `CADDY_GID` | Caddy's GID, added to the web container's supplementary groups so it can write the shared `/logs` volume. Must match Caddy's `PGID` | `10000` | No |
| `PRIMARY_DOMAIN` | Domain the bundled Caddyfile serves the dashboard on, alongside `http://localhost` | `caddyproxymanager.com` | No |
| `CADDY_BUILD_TIMEOUT` | Seconds the agent waits for an xcaddy rebuild triggered from **Settings → Caddy Build** before giving up | `1800` | No |
| `AGENT_MODE` | How the agent listens: `standalone` (Unix socket on the shared volume) or `managed` (TCP, pairs with a controller by one-time code) | `standalone` | No |
| `AGENT_PORT` | Port the agent listens on in `managed` mode | `3100` | No |
| `HOSTNAME` | Suffix for the geoipupdate container name (`geoipupdate-<HOSTNAME>`). Interpolated by Compose on the host, not read by the app. Bash on Linux defines it without exporting, so Compose sees nothing and the name degrades to `geoipupdate-`; set it in `.env` to pin it | Shell's `HOSTNAME`, if exported | No |
| `COMPOSE_PROFILES` | Comma-separated Compose profiles to activate: `clickhouse`, `geoipupdate` | `clickhouse` | No |
| `GEOIPUPDATE_ACCOUNT_ID` | MaxMind account ID for GeoLite2 updates. Needed for geo blocking | None | No (required if `geoipupdate`) |
| `GEOIPUPDATE_LICENSE_KEY` | MaxMind license key for GeoLite2 updates | None | No (required if `geoipupdate`) |
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
| `AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS` | Trust the IdP's profile claims to set a new user's role and status. When `false`, OAuth-created accounts are forced to `user`/`active` regardless of claims. Enable only if you control the IdP | `false` | No |
| `AUTH_DISABLE_LOCAL_USERS` | OIDC-only mode: no local accounts, no credential sign-in, no bootstrap admin | `false` | No |
| `AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH` | Force a password reset for users still on a pre-argon2id bcrypt hash. Setting it pins the policy and locks the **Settings → Security** toggle; when unset, that toggle decides | Unset (toggle decides) | No |
| `AUTH_RATE_LIMIT_ENABLED` | Enable Better Auth rate limiting | `true` | No |
| `AUTH_RATE_LIMIT_WINDOW` | Rate limit window in seconds | `60` | No |
| `AUTH_RATE_LIMIT_MAX` | Max requests per window | `5` | No |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint for analytics | `http://clickhouse:8123` | No |
| `CLICKHOUSE_USER` | ClickHouse username | `cpm` | No |
| `CLICKHOUSE_PASSWORD` | ClickHouse password (`openssl rand -base64 32`). Required when the `clickhouse` profile is active. | None | No (required if analytics enabled) |
| `CLICKHOUSE_DB` | ClickHouse database name | `analytics` | No |
| `CLICKHOUSE_RETENTION_DAYS` | Days of analytics kept before ClickHouse's TTL deletes them. Changing it migrates the existing tables' TTL on the next startup | `30` | No |
| `FORWARD_AUTH_INTERNAL_URL` | Dial address Caddy uses to reach this app for `forward_auth`. Override only if the derived container address does not work | Derived from the container network | No |
| `LEGACY_KEY_CUTOFF_DATE` | Cutoff after which secrets still encrypted with the legacy key are refused, forcing re-encryption. ISO 8601 date, or `never` to disable | Built-in cutoff date | No |
| `ACME_CA_ROOT_DIR` | Directory holding the custom ACME CA root. For non-Docker deployments | `/acme-ca` | No |
| `L4_PORTS_DIR` | Shared directory where the local agent leaves its socket and secret. For non-Docker deployments | `/app/data` | No |
| `AGENT_URL` | Address of an agent to use instead of the local one, e.g. `http://agent.example.com:3100`. An agent paired under **Settings → Agent** takes precedence | Unset (use the local socket) | No |
| `AGENT_SECRET` | Shared secret for `AGENT_URL`. Pairing through the UI stores this in the database instead | None | No (required with `AGENT_URL`) |
| `PORT` / `HOST` | Listen address for the `cpm-server` binary when run directly instead of in the container | `3000` / `0.0.0.0` | No |
| `CPM_APP_ROOT` | Application root for the `cpm-server` binary | Directory of the executable | No |
| `CPM_HEALTHCHECK_URL` | Target for `cpm-server --healthcheck` | `http://127.0.0.1:${PORT}/api/health` | No |

**Production Requirements:**

- `SESSION_SECRET`: 32+ characters (`openssl rand -base64 32`)
- `ADMIN_PASSWORD`: 12+ chars with uppercase, lowercase, numbers, and special characters — not required when `AUTH_DISABLE_LOCAL_USERS=true`

Development mode (`NODE_ENV=development`) allows default `admin`/`admin` credentials.

---

## The Database

PostgreSQL only. `docker compose up -d` starts a `postgres` service alongside the app and points
`DATABASE_URL` at it, so a default install needs nothing but a password:

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 32)
```

To use a server you already run, set `DATABASE_URL` yourself and the bundled service is ignored:

```bash
DATABASE_URL=postgres://cpm:secret@db.internal:5432/cpm docker compose up -d
```

The database must already exist; the app creates its own tables but not the database itself.
Migrations run on boot.

MySQL, MariaDB and the rest are rejected by name at startup rather than half-working: Bun can talk
to some of them, but Drizzle's Bun driver only builds PostgreSQL, and several write paths here
depend on `RETURNING`.

### Upgrading from 3.0, which used SQLite

Leave the old `.env` alone and stand up PostgreSQL first, then point `DATABASE_URL` at it. On the
next start the app finds the old SQLite file, checks it against the schema it expects, and offers
to migrate it — proxy hosts, certificates, users and settings included. If several candidate files
are found, it asks which one.

Starting with a SQLite `DATABASE_URL` still set fails immediately, with a message saying so. That
is deliberate: silently starting against an empty database would look like total data loss.

### Working on the schema

`apps/controller/src/lib/db/schema.pg.ts` is the source of truth — hand-edited, since the SQLite
schema it used to be generated from is gone. After changing it:

```bash
DATABASE_URL=postgres://... bun run db:generate         # emits drizzle/postgres/
```

`apps/controller/drizzle/legacy-sqlite/` holds the migrations every pre-3.1 deployment ran. Nothing
generates into it; it stays so the migration flow's tests can build a realistic old database.

### Running the tests

`bun run test` starts a throwaway PostgreSQL container, runs the suite against it, and removes it.
Docker is the only prerequisite. Each test gets its own schema, so nothing leaks between them.

To use a server of your own instead, set `TEST_POSTGRES_URL` — the suite will use it and start no
container. Anything in it may be dropped, so do not point it at something you care about.

```bash
TEST_POSTGRES_URL=postgres://cpm:pw@127.0.0.1:5432/cpm_test bun run test
```

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
| Create and manage own API tokens | Yes | Yes | Yes |
| Access role-appropriate REST API endpoints (`/api/v1/`) | Yes | Yes | Yes |

New users default to the **user** role. The initial admin account is created from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables.

API tokens can only be created from an authenticated dashboard session; an
existing bearer token cannot mint replacement credentials. Viewer and user
tokens are restricted to the same user-scoped API capabilities as their owner.

> **Forward Auth access** is separate from role — all roles must be explicitly granted access to each protected host via the forward auth access list.

---

## Certificate Management

Caddy automatically obtains Let's Encrypt certificates for all proxy hosts.

**DNS-01 Challenge** (optional): Configure a DNS provider in **Settings → DNS Providers** for wildcard certificates and environments where ports 80/443 are not public. Supported providers: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, Spaceship, deSEC, Dynu, and acme-dns. Credentials are encrypted at rest with AES-256-GCM. You can override the DNS provider per certificate.

**Custom Certificates** (optional): Import your own certificates via the Certificates page. Private keys are encrypted at rest with AES-256-GCM, migrated from legacy plaintext storage on startup, and treated as write-only by ordinary API responses and browser payloads.

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

## The Agent

Publishing a layer-4 port and changing Caddy's compiled-in plugins both need the Caddy *container*
recreated, not just its config reloaded. The controller has no Docker access — deliberately — so a
second container does that work and the two talk over a small REST API.

Every request is signed with a shared secret using HMAC-SHA256 over the method, path, timestamp and
body. The secret never travels with a request, and the signature covers the path, so a captured
read cannot be replayed as a write.

### Same host — nothing to configure

The default. The agent listens on a Unix socket on the shared data volume and writes its secret
beside it, rotating that secret on every start. A controller that mounts the same volume finds both.
This is what `docker-compose.yml` sets up, and there is nothing to enter anywhere.

### A different host — pairing

Run the agent with `AGENT_MODE=managed` and publish its port (3100 by default). It prints a
six-letter code to its logs:

```bash
docker logs caddy-proxy-manager-agent
```

The code is valid for five minutes, works once, and is refused after ten wrong guesses. Enter it
with the agent's address under **Settings → Agent**; the two exchange a secret, which is stored
encrypted and is the only thing used from then on. The code is never needed again.

Unpairing forgets this side only. The agent keeps the secret until it is restarted or paired again,
so restart it too if you are removing an agent you no longer trust.

`AGENT_URL` and `AGENT_SECRET` do the same thing without the UI, for a deployment that configures
everything through the environment. An agent paired through Settings takes precedence over them.

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

### Version pinning

Which modules get compiled is your choice; *which version* of each is pinned in
`docker/caddy/go.mod`, and `docker/caddy/build.sh` turns the two into
`xcaddy build --with <path>@<version>` flags. So a rebuild next month produces
the same binary as one today, and `go.sum` authenticates every module it pulls.

Dependabot proposes updates to those pins weekly. Caddy's own version is pinned
there too, as a release tag: `docker/caddy/update-compatibility-pins.sh` derives
the `cel-go` replacement from that release, which is what keeps the build off a
floating master commit. A scheduled workflow reruns it and opens a PR when the
replacement moves.

You can see exactly what an image was built with, without rebuilding it:

```bash
docker run --rm ghcr.io/silentspud/caddy-proxy-manager/caddy:latest cat /etc/caddy/caddy-modules.resolved.txt
```

### Custom modules

Any Caddy plugin published as a Go module can be added by path, with an optional
tag, branch, or commit. It is compiled from source at build time, so a module
that does not build fails the rebuild — the running container is left untouched
when that happens.

Custom modules are compiled into the proxy binary and run with its privileges.
Add only modules you trust, from sources you would trust with the proxy itself.

### Rebuilding

Saving records the selection; it does not change the running container. **Rebuild
Caddy** sends the selection to the agent, which runs `docker compose build caddy`
and then recreates the container. Compiling Caddy takes several minutes; the proxy
keeps serving on the current binary until the new one is ready, then restarts.

Because *enabling* a module only takes effect once it is actually in the binary,
config generation uses the intersection of what you selected and what the running
image was built with. The panel shows a "Rebuild required" banner in between.

Those are two different things, and keeping them apart is what makes a failed
build harmless:

| | Owned by | Holds |
| --- | --- | --- |
| the selection | the controller's database | the *desired* module list — the build's input |
| the applied set | the agent, recorded only after the build succeeds and Caddy is healthy | what the running binary *actually* contains |

If a build fails, the applied set is left alone, so the app keeps generating
config the current binary can load. Nothing needs cleaning up by hand — fix the
selection and click Rebuild again. If the agent is restarted mid-build (a host
reboot, say), it clears the stale "building" state on startup and the button
becomes available again.

Rebuilding needs `BUILD: 1` on the `docker-socket-proxy` service (the default in
`docker-compose.yml`). Set it to `0` to opt out: everything else keeps working,
and you can run `docker compose build caddy` yourself. Note that a hand-run build
does not tell the agent anything, so the app keeps assuming the shipped module set
until a rebuild goes through the agent.

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

## Default Response

Configure **Settings → Default Response** to preserve Caddy's native behavior for unmatched HTTP requests (such as an automatic HTTPS redirect or empty response, depending on the generated server config), or replace it with:

- a custom HTTP status, body, and response headers (including custom HTML);
- a redirect; or
- an aborted connection with no HTTP response (the Caddy equivalent of an nginx `444`).

Configured proxy hosts always take precedence over this catch-all. For HTTPS, Caddy can only send the response after TLS succeeds; an unknown hostname or direct-IP request may fail the certificate handshake first.

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

OAuth login appears on the login page alongside credentials.

**Account linking:**

Attaching an OAuth identity to an existing CPM user requires **Auto-link accounts** to be enabled for that provider (**Settings → OAuth Providers**, or `OAUTH_ALLOW_AUTO_LINKING=true` for environment-configured providers). The switch marks the provider as trusted to prove that its identity owns the CPM account carrying the same email address, so leave it off for any IdP where users can register an arbitrary email themselves.

With it enabled:

- Signing in through the provider links the identity to the existing user with the matching email.
- **Profile → OAuth Connections** can link the provider to the signed-in account. The provider's email must match the signed-in user's email.

With it disabled, both paths are refused and the provider redirects to `/api/auth/error?error=account_not_linked`.

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
