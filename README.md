# Caddy Proxy Manager

Web interface for managing [Caddy Server](https://caddyserver.com/) reverse proxies and certificates. This fork is for redoing the original UI in a way that I like and trying to make the application as lightweight as possible.

> **3.0 changes how this is configured.** Most settings now live in the database and are entered
> through a first-run setup flow in the browser, not in `.env`. PostgreSQL replaces SQLite, and an
> existing pre-3.0 installation is migrated in-app rather than by hand. See [First Run](#first-run)
> and [The Database](#the-database). It is a substantial change and the 3.0 line is still in beta —
> take a backup before upgrading.

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://mit-license.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Report Bug](https://github.com/silentspud/caddy-proxy-manager/issues) • [Request Feature](https://github.com/silentspud/caddy-proxy-manager/issues)

<img width="100%" alt="Dashboard" src="apps/site/assets/screenshots/dashboard-main.png" />

## Overview

This project provides a web UI for Caddy Server, eliminating the need to manually edit JSON configurations or Caddyfiles. It handles reverse proxies, access lists, and certificate management through an Astryx interface. Built with Vinext version whatever, React 19, Astryx, Tailwind CSS, Drizzle ORM, and TypeScript. Analytics data (traffic events, WAF events) is stored in ClickHouse for fast aggregation queries, with automatic retention via TTL (30 days by default, configurable).

---

## Installation

```bash
git clone https://github.com/silentspud/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env

# The only two values a fresh install has to have
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env

docker compose up -d
```

Then open `http://localhost:3000` and follow [First Run](#first-run) — every URL redirects there
until setup is finished. There is no administrator to sign in as until you create one.

Data persists in Docker volumes: `postgres-data` (the database), `caddy-manager-data`, `caddy-data`,
`caddy-config`, `caddy-logs`, `geoip-data`, `acme-ca`, and `clickhouse-data` when analytics are on.

---

## First Run

A fresh install has no accounts and nothing configured. The first request lands on `/setup`, and
the app serves nothing else until the flow finishes.

1. **Controller or agent.** Agents are set up from their own host and paired later — choosing it
   here just says so. See [The Agent](#the-agent).
2. **Create the first administrator**, or configure an OAuth provider instead of a local account.
3. **Sign in.** Deliberately before anything else is entered: a mistyped password or a wrong OAuth
   client secret is otherwise only discovered after the whole configuration has been filled in, and
   the only way out is deleting the database.
4. **Settings.** Everything that used to live in `.env` — public URL, analytics, GeoIP credentials,
   authentication policy — pre-filled with whatever the environment already provides, each field
   showing where its value came from. **Save** writes them to the database and opens the dashboard.
   Nothing is stored before Save.

The stage is derived from what exists, not tracked as a counter, so a half-finished setup resumes
where it left off and the back button cannot desynchronise it. Setup is one-way: once complete,
`/setup` redirects away.

Two things skip the flow entirely:

- **An existing pre-3.0 installation.** A SQLite database found on the host is offered for
  migration *before* account creation — you want its accounts, not a new one alongside them. You
  choose which parts to bring; leaving the users out continues to account creation rather than the
  login page. See [Upgrading from a pre-3.0 install](#upgrading-from-a-pre-30-install-which-used-sqlite).
- **A deployment that predates the flow.** If `ADMIN_USERNAME`/`ADMIN_PASSWORD` or `OAUTH_ENABLED`
  configure a way in and someone can already sign in, setup is marked complete at startup and never
  shown. Upgrading an existing install changes nothing about how it starts.

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
`db-seed` container in `apps/controller/tests/docker-compose.test.yml` — a throwaway `oven/bun:1-slim`
that mounts the same data volume. See `apps/controller/tests/helpers/seed.ts`.

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
- **Tailscale** - Serve a proxy host privately on your tailnet, gate it on the caller's Tailscale identity, or reach a backend that only exists on the tailnet. A Tailscale node runs inside the Caddy container — no `tailscaled` on the host, no TUN device, no published ports — and `*.ts.net` certificates come from Tailscale rather than ACME
- **DNS Controls** - Custom DNS resolvers per host, upstream DNS pinning with IPv4/IPv6/both address family selection
- **REST API** - Full REST API under `/api/v1/` with Bearer token authentication, covering all resources. Interactive OpenAPI 3.1.0 docs at `/api-docs`
- **API Tokens** - Create and manage API tokens with optional expiration for programmatic access
- **Default Response** - Replace Caddy's native behavior for unknown hosts or direct-IP requests with a custom status/body/headers, redirect, or connection abort
- **OAuth / SSO** - OAuth2/OIDC authentication with any compliant provider (Authentik, Keycloak, Auth0, etc.). Account linking from the Profile page. Optional group-based role mapping (e.g. members of `CPM_Admin` become admins) and OIDC-only mode, which disables local accounts entirely
- **DNS Providers** - Multi-provider DNS-01 challenge support for ACME certificates: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, netcup, Spaceship, deSEC, Dynu, acme-dns, Infomaniak, and ClouDNS. Credentials encrypted at rest. Per-certificate provider override supported. Configurable DNS propagation delay/timeout per provider (netcup ships with slow-propagation defaults)
- **Caddy Build** - Choose which Caddy plugins the image is compiled with. Toggle any supported module (Layer 4, Tailscale, Request Blocker, Coraza WAF, and each DNS provider), add your own Go modules, and rebuild from the UI. Settings that depend on a disabled module are greyed out and say which module to turn back on
- **Settings** - ACME email, default response, DNS provider configuration, upstream DNS pinning defaults, Authentik outpost, Prometheus metrics, logging format — plus everything that used to be in `.env`, stored in the database and editable without a restart
- **First-run Setup** - Browser flow that creates the first administrator (or configures OAuth), proves the credentials work, and collects the rest of the configuration. No admin password in `.env`
- **In-app Migration** - A pre-3.0 SQLite installation is detected, verified against the expected schema, and imported — accounts, hosts, certificates and settings. Secrets encrypted with the old installation's `SESSION_SECRET` are re-encrypted under this deployment's own, so the old key is entered once and never needed again. Ends with a backup of the old file and a paste-ready command to clear the migrated variables out of `.env`
- **Agent Fleet** - Any number of Caddy hosts, paired by one-time code, all serving one configuration. Every apply lands on all of them or none, and names the host that refused
- **Update Check** - Settings reports when a newer release has been published to the registry this deployment pulls from. The only request the app makes to the internet on its own, and it can be switched off
- **Audit Log** - Searchable configuration change history with user attribution and pagination
- **Search & Pagination** - Server-side search and pagination on all data tables
- **Dark Mode** - Full dark/light theme support with system preference detection
- **Mobile UI** - Fully responsive interface optimised for iPhone and other narrow viewports

---

## Configuration

Most configuration lives in the database and is edited on the **Settings** page. `.env` holds what
has to be read before the database can be, plus what Docker Compose itself needs.

### How a setting is resolved

**Stored value → environment variable → default.** Three layers, in that order.

The environment layer is what makes upgrading safe: until a deployment has been through setup or
migration nothing is stored, every setting resolves from the variable it always did, and behaviour
is unchanged. Once a value is stored it wins, and the variable can be deleted from your `.env`.
Each field on the Settings page shows which layer its current value came from.

A stored value that no longer validates — because a range was tightened, say — is ignored with a
warning and falls through to the environment and the default, rather than taking the app down.

### Stored in the database

Each of these is a field on **Settings** (and on the setup flow's final step). The variable named
is still honoured as an override until a value is stored.

| Setting | Variable | Default |
| ------- | -------- | ------- |
| Application name — sidebar, login card, page-title suffix | `APP_NAME` | `Caddy Proxy Manager` |
| Public URL. OAuth redirect URIs are built from it, so it must match what the provider has registered | `BASE_URL` | `http://localhost:3000` |
| Caddy admin API, for a deployment running Caddy with **no** agent. With an agent, every admin call is proxied through it and this is unused | `CADDY_API_URL` | `http://caddy:2019` |
| Gravatar fallback for user icons. Off keeps every avatar lookup off the network | `AVATAR_GRAVATAR` | `true` |
| Internal forward-auth address Caddy dials. Derived from the container network when empty | `FORWARD_AUTH_INTERNAL_URL` | Derived |
| Seconds before an xcaddy rebuild is abandoned | `CADDY_BUILD_TIMEOUT` | `1800` |
| Allow email/password self-registration | `AUTH_ALLOW_SELF_REGISTRATION` | `false` |
| Let a first-time OAuth identity create an account | `AUTH_ALLOW_OAUTH_REGISTRATION` | `false` |
| Trust the IdP's claims to set a new user's role and status. Off forces `user`/`active` | `AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS` | `false` |
| OIDC-only mode: no local accounts, no credential sign-in, no bootstrap admin | `AUTH_DISABLE_LOCAL_USERS` | `false` |
| Build URLs from the request's Host header. Only behind a proxy that rewrites it | `AUTH_TRUST_HOST` | `false` |
| Force a reset for pre-argon2id bcrypt hashes. Leave unset to let the toggle decide | `AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH` | Unset |
| Rate-limit the auth endpoints | `AUTH_RATE_LIMIT_ENABLED` | `true` |
| Auth rate-limit window, in seconds | `AUTH_RATE_LIMIT_WINDOW` | `60` |
| Auth requests allowed per window | `AUTH_RATE_LIMIT_MAX` | `5` |
| Failed sign-ins before lockout | `LOGIN_MAX_ATTEMPTS` | `5` |
| Window over which failed sign-ins are counted, in ms | `LOGIN_WINDOW_MS` | `300000` |
| How long a blocked client stays blocked, in ms | `LOGIN_BLOCK_MS` | `900000` |
| Check the registry for a newer release. The only outbound request this app makes on its own | `UPDATE_CHECK_ENABLED` | `true` |
| Image namespace the update check reads tags from, without the image name. Change it for a fork | `UPDATE_IMAGE_REPOSITORY` | `ghcr.io/silentspud/caddy-proxy-manager` |
| Collect traffic and WAF events. Leave unset to decide from whether a password is set | `ANALYTICS_ENABLED` | Unset |
| ClickHouse endpoint | `CLICKHOUSE_URL` | `http://clickhouse:8123` |
| ClickHouse user | `CLICKHOUSE_USER` | `cpm` |
| ClickHouse password. Required for analytics — the container will not start without one. Encrypted at rest | `CLICKHOUSE_PASSWORD` | None |
| ClickHouse database | `CLICKHOUSE_DB` | `analytics` |
| Days of analytics kept. Lowering it migrates the tables' TTL on the next start | `CLICKHOUSE_RETENTION_DAYS` | `30` |
| Use GeoIP for country lookups and geo blocking. Leave unset to decide from whether the databases are present | `GEOIP_ENABLED` | Unset |
| MaxMind account ID, for GeoLite2 downloads | `GEOIPUPDATE_ACCOUNT_ID` | None |
| MaxMind license key. Encrypted at rest | `GEOIPUPDATE_LICENSE_KEY` | None |

> Compose reads `CLICKHOUSE_PASSWORD`, `GEOIPUPDATE_ACCOUNT_ID` and `GEOIPUPDATE_LICENSE_KEY` too,
> to provision the `clickhouse` and `geoipupdate` containers. **With an agent running the stack you
> do not need to keep them in `.env`**: the agent starts those containers itself and passes the
> saved values to Compose. Without an agent, Docker is the only thing that can start them and it
> cannot read the database — so there they must stay in `.env`.

### Stays in `.env`

| Variable | Description | Default | Required |
| -------- | ----------- | ------- | -------- |
| `SESSION_SECRET` | Session key, and the HKDF root every stored secret is encrypted with. 32+ chars (`openssl rand -base64 32`). It cannot live inside what it encrypts, and rotating it makes every stored secret unreadable | None | **Yes** |
| `POSTGRES_PASSWORD` | Password for the database. Provisions the bundled `postgres` service and is what the app authenticates with. Any characters; it is never put through a URL | None | **Yes** |
| `POSTGRES_USER` / `POSTGRES_DB` | Role and database the bundled `postgres` service creates, and what the app connects as | `cpm` / `cpm` | No |
| `POSTGRES_HOST` / `POSTGRES_PORT` | Where the app looks for PostgreSQL. Set these to use a server other than the bundled one | `postgres` / `5432` | No |
| `POSTGRES_SSL` | Whether the app connects with TLS. On/off only — anything finer wants `DATABASE_URL` | `false` | No |
| `DATABASE_URL` | A full connection string, which overrides every `POSTGRES_*` above. Only needed for what the fields cannot express. A password in it must be percent-encoded. See [The Database](#the-database) | Unset | No |
| `DATABASE_POOL_MAX` | Connections the pool may open — it sizes what reads the database, so it cannot be read from it. Requests beyond it queue. Keep the server's own `max_connections` above the total across every instance | `10` | No |
| `NODE_ENV` | Read at module load, before any query. `production` enforces the password policy | `production` in the image | No |
| `HOST` / `PORT` | The socket binds before anything can be read. `::` is dual-stack and accepts IPv4 too; `0.0.0.0` binds IPv4 only | `::` / `3000` | No |
| `CPM_APP_ROOT` / `CPM_HEALTHCHECK_URL` | Bootstrap paths for the `cpm-server` binary, used before the app starts | Executable's directory / `http://127.0.0.1:${PORT}/api/health` | No |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seeds an administrator at startup, as releases before 3.0 did. **Not required** — [First Run](#first-run) creates the first account instead. Setting both skips the setup flow entirely | None | No |
| `OAUTH_*` | An OAuth provider configured by environment. Synced into the `oauth_providers` table at startup rather than into the settings registry, so there is one source of truth per provider. See [OAuth Authentication](#oauth-authentication) | None | No |
| `CERTS_DIRECTORY` | Where generated certificates are written | `./data/certs` | No |
| `ACME_CA_ROOT_DIR` | Directory holding a custom ACME CA root. For non-Docker deployments | `/acme-ca` | No |
| `L4_PORTS_DIR` | Shared directory where the local agent leaves its socket and secret. For non-Docker deployments | `/app/data` | No |
| `LEGACY_KEY_CUTOFF_DATE` | Cutoff after which secrets still encrypted with the legacy key are refused, forcing re-encryption. ISO 8601 date, or `never` | Built-in date | No |
| `LEGACY_SQLITE_PATH` | Pins which pre-3.0 database the migration flow offers, instead of scanning the usual locations | Unset (scan) | No |
| `AGENT_URL` | Address of an agent to use instead of the local one, e.g. `http://agent.example.com:3100`. An agent paired under **Settings → Agent** takes precedence | Unset (local socket) | No |
| `AGENT_SECRET` | Shared secret for `AGENT_URL`. Pairing through the UI stores this encrypted in the database instead | None | With `AGENT_URL` |
| `AGENT_SOCKET` / `AGENT_CONTROLLER_ID` | Override the local agent's socket path, and the identity the controller signs as | `$L4_PORTS_DIR/agent.sock` / built-in | No |
| `COMPOSE_PROFILES` | Compose profiles to activate: `clickhouse`, `geoipupdate`. Only needed without an agent — with one, **Settings → Analytics** and **Settings → GeoIP** start and stop those containers regardless of this. `.env.example` ships it empty, since the bundled compose file runs an agent | Empty | No |
| `PUID` / `PGID` | Build args setting the UID/GID containers run as. Match your host user to avoid volume permission issues (`id -u` / `id -g`) | `10001`/`10001` (web)<br/>`10000`/`10000` (caddy) | No |
| `CADDY_GID` | Caddy's GID, added to the web container's supplementary groups so it can write the shared `/logs` volume. Must match Caddy's `PGID` | `10000` | No |
| `PRIMARY_DOMAIN` | Domain the bundled Caddyfile serves the dashboard on, alongside `http://localhost` | `caddyproxymanager.com` | No |
| `HOSTNAME` | Suffix for the geoipupdate container name (`geoipupdate-<HOSTNAME>`). Compose-only. Bash on Linux defines it without exporting, so Compose sees nothing and the name degrades to `geoipupdate-`; set it in `.env` to pin it | Shell's `HOSTNAME`, if exported | No |

### The agent's environment

The agent has no database to read configuration from until it has one, and none of this is
changeable at runtime — it describes the host the agent is bolted to. So it stays environment-only.

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `AGENT_MODE` | `standalone` binds a Unix socket on the shared volume; `managed` binds TCP and prints a pairing code. Startup fails on any other value rather than guessing | `standalone` |
| `AGENT_HOST` / `AGENT_PORT` | Listen address in `managed` mode | `::` / `3100` |
| `AGENT_SOCKET` | Socket path in `standalone` mode | `$DATA_DIR/agent.sock` |
| `DATA_DIR` | Where the agent's SQLite state, socket and secret live. Must be writable | `/data` |
| `COMPOSE_DIR` | Where the compose project files are mounted, read-only | `/compose` |
| `CADDY_API_URL` | Where this host's Caddy admin API listens. The controller reaches it only through here | `http://caddy:2019` |
| `CADDY_CONTAINER_NAME` | The container the agent recreates | `caddy-proxy-manager-caddy` |
| `CADDY_BUILD_TIMEOUT` | Seconds before a Caddy rebuild is abandoned | `1800` |
| `CADDY_HEALTH_TIMEOUT` | Seconds to wait for Caddy to report healthy after a recreate | `60` |
| `SERVICE_START_TIMEOUT` | Seconds before starting an optional service (`clickhouse`, `geoipupdate`) is abandoned. Generous because the first start pulls the image | `900` |
| `DOCKER_HOST` | The Docker API. Points at `docker-socket-proxy`, never the raw socket | `tcp://docker-socket-proxy:2375` |
| `COMPOSE_PROJECT_NAME` / `COMPOSE_HOST_DIR` / `COMPOSE_EXTRA_FILE` / `COMPOSE_SKIP_OVERRIDE` | Compose overrides: an explicit project name, a `--project-directory` for a host path the agent cannot see, an extra `-f` file, and skipping `docker-compose.override.yml`. The last two exist for the test rigs | Auto-detected |
| `CADDY_ACCESS_LOG` / `WAF_AUDIT_LOG` / `WAF_RULES_LOG` / `GEOIP_DIR` / `GEOIP_DB` | Where the agent reads Caddy's logs and the GeoLite2 databases from | Container paths |

**Production requirements:**

- `SESSION_SECRET`: 32+ characters (`openssl rand -base64 32`)
- Any password you set, whether through setup or `ADMIN_PASSWORD`: 12+ chars with uppercase,
  lowercase, numbers, and special characters — not required when OIDC-only mode is on

There is no longer a development default: setting neither variable is not an error in any
environment, it means the deployment runs [First Run](#first-run) instead of seeding an account.
The password policy above — including the refusal of `admin` itself — is enforced only when
`NODE_ENV=production`, so a development instance may set whatever it likes.

---

## The Database

PostgreSQL only. `docker compose up -d` starts a `postgres` service alongside the app and hands it
the `POSTGRES_*` values, so a default install needs nothing but a password:

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 32)
```

Those reach the app as discrete fields rather than folded into a connection string, and that is
deliberate: a password only has to be escaped when it goes into a URL, and Compose interpolates
without escaping anything. `openssl rand -base64 32` emits a `/` about half the time, and a `/` in
a URL's password ends the authority early — `postgres://cpm:pa/ss@postgres:5432/cpm` names the host
`cpm:pa` — so the app would fail to reach a server nobody had configured. As fields there is no
delimiter to collide with, and any password works as typed.

To use a server you already run, point the same fields at it:

```bash
POSTGRES_HOST=db.internal POSTGRES_USER=cpm POSTGRES_PASSWORD=secret POSTGRES_DB=cpm   docker compose up -d
```

`POSTGRES_PORT` (5432) and `POSTGRES_SSL` (off) are there too. `DATABASE_URL` still overrides all
of them, for a server needing something the fields cannot express — an `sslmode` beyond on/off, a
`search_path`, a libpq connection option:

```bash
DATABASE_URL=postgres://cpm:secret@db.internal:5432/cpm?sslmode=verify-full docker compose up -d
```

A password inside that URL has to be percent-encoded (`/` is `%2F`, `@` is `%40`), which is the
problem the fields exist to avoid.

The database must already exist; the app creates its own tables but not the database itself.
Migrations run on boot.

MySQL, MariaDB and the rest are rejected by name at startup rather than half-working: Bun can talk
to some of them, but Drizzle's Bun driver only builds PostgreSQL, and several write paths here
depend on `RETURNING`.

### Upgrading from a pre-3.0 install, which used SQLite

Leave the old `.env` alone and stand up PostgreSQL first, then point `DATABASE_URL` at it. On the
next start the app finds the old SQLite file, checks it against the schema it expects, and offers
to migrate it. If several candidate files are found, it asks which one; `LEGACY_SQLITE_PATH` pins
one instead of scanning.

The offer comes **before** account creation — an operator with an old database wants its accounts,
not a new one alongside them. By default it copies everything: proxy hosts, certificates, access
lists, users and their credentials, groups, tokens, agents, the audit log, and the settings blobs.
You then sign in with an account it just imported, using the password you already had, which is
what proves the credential rows arrived intact.

Each of those is a checkbox, so an installation changing hands can take the configuration and leave
the people behind. Two rules keep a partial choice honest:

- A proxy host references a certificate and an access list, and both references are nullable — so
  importing hosts without them would succeed and quietly publish a host that used to sit behind a
  password. Those groups come along with proxy hosts, shown ticked and locked.
- Everything else is resolved from the foreign keys rather than a list. A reference into a group
  you left behind is emptied when the column allows it (`createdBy`, `ownerUserId` — provenance
  nothing authorises against) and the row is dropped when it does not (an API token cannot exist
  without its user).

Leaving the users out means nothing can sign in yet, so the flow continues to account creation
instead of the login page — the same screen a fresh install sees, offering a first administrator or
an identity provider, and saying that your data arrived without its accounts.

### If the old installation used a different SESSION_SECRET

Certificate private keys, DNS provider credentials, OAuth client secrets, agent secrets and the
Tailscale auth key are stored encrypted, with `SESSION_SECRET` as the root key. A new deployment
generates its own, so the old database's secrets are usually unreadable by it.

The migration screen notices and asks for the old value. Enter it, and every encrypted value is
decrypted with it and re-encrypted under the secret this deployment already uses, as the rows are
copied. The old secret is used for that one import and nothing stores it — you do not have to keep
it, and you do not have to change `SESSION_SECRET` to match the old installation.

The key is checked before anything is written, and the whole database is converted in memory before
the first row is inserted. A missing or mistyped key is a refusal with nothing written, not a
half-finished import. A value encrypted with the current secret already is copied across untouched,
so an upgrade that kept its `SESSION_SECRET` never sees this step.

Migrating without the key is not offered: the ciphertext would arrive intact and unreadable, and
every affected credential would have to be entered again by hand.

Your existing environment is read too — whatever your `.env` or your Compose file puts there.
Anything in it that is now a database setting is carried into the [settings step](#first-run)
pre-filled and marked as having come from the environment, so you can see what is being taken over
before agreeing to it.

Setup finishes on a summary rather than the dashboard, because a deployment that has just replaced
its database is owed three things first: a download of the old SQLite file, the path it was read
from, and the variables that have moved into the database. The old database file is read, never
moved or deleted — take the backup before you clean anything up.

Those variables come with a `sed` you can paste, which comments them out of the `.env` beside your
`docker-compose.yml` and leaves a `.env.bak` next to it. The command is generated rather than the
file rewritten, because the app cannot see that file: its environment arrives from Compose, and on
another deployment it might arrive from Swarm or Kubernetes secrets or a systemd unit instead.
Comments rather than deletes, so you keep the values — some of them are the only copy of a secret
you have. Cleaning up is optional either way: a variable that is still set is ignored once a value
is stored.

The variables Compose itself reads — `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`,
`GEOIPUPDATE_ACCOUNT_ID`, `GEOIPUPDATE_LICENSE_KEY` — are held back from that command and listed
separately, because removing them is a two-step change the command cannot make on its own. Without
an agent they stay: Docker is the only thing that can start those two containers, and it cannot read
the database. With an agent they can go too, as long as you drop `clickhouse` and `geoipupdate` from
`COMPOSE_PROFILES` in the same pass — see [Pick one owner](#enabling-and-disabling-analytics).

Starting with a SQLite `DATABASE_URL` still set fails immediately, with a message saying so. That
is deliberate: silently starting against an empty database would look like total data loss.

### Working on the schema

`apps/controller/src/lib/db/schema.pg.ts` is the source of truth — hand-edited, since the SQLite
schema it used to be generated from is gone. After changing it:

```bash
DATABASE_URL=postgres://... bun run db:generate         # emits drizzle/postgres/
```

`apps/controller/drizzle/legacy-sqlite/` holds the migrations every pre-3.0 deployment ran. Nothing
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
- Two independent throttles on the auth endpoints: Better Auth's request limit (5 per 60 seconds)
  and the login lockout (5 failed sign-ins per 5 minutes, then blocked for 15). Both are Settings
  fields
- Audit trail for all configuration changes
- Supports OAuth2/OIDC for SSO, including group-based roles and an OIDC-only mode with no local accounts

**Production Setup:**

```bash
export SESSION_SECRET=$(openssl rand -base64 32)
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
docker compose up -d
```

Then create the administrator through [First Run](#first-run). Nothing needs a password in `.env`.

**Limitations:**
- In-memory rate limiting (not suitable for multi-instance deployments)
- `SESSION_SECRET` encrypts every secret the database holds — DNS credentials, private keys, agent
  secrets. Rotating it makes all of them unreadable

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

New users default to the **user** role. The first administrator is created in [First Run](#first-run), or imported from a migrated 3.0 database. `ADMIN_USERNAME` / `ADMIN_PASSWORD` still seed one at startup for deployments that predate the setup flow.

API tokens can only be created from an authenticated dashboard session; an
existing bearer token cannot mint replacement credentials. Viewer and user
tokens are restricted to the same user-scoped API capabilities as their owner.

> **Forward Auth access** is separate from role — all roles must be explicitly granted access to each protected host via the forward auth access list.

---

## Certificate Management

Caddy automatically obtains Let's Encrypt certificates for all proxy hosts.

**DNS-01 Challenge** (optional): Configure a DNS provider in **Settings → DNS Providers** for wildcard certificates and environments where ports 80/443 are not public. Supported providers: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, netcup, Spaceship, deSEC, Dynu, acme-dns, Infomaniak, and ClouDNS. Credentials are encrypted at rest with AES-256-GCM. You can override the DNS provider per certificate.

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
3. Open **Settings → GeoIP Databases**, tick **Use GeoIP**, and enter the account ID and licence key

That is the whole setup on a stack with an agent — saving starts the `geoipupdate` container, no
Compose profile needed. Turning the toggle off stops it again and hides country matching from the
proxy-host forms.

Without an agent, put the credentials in `.env` and start the profile by hand instead:

```env
GEOIPUPDATE_ACCOUNT_ID=your-account-id
GEOIPUPDATE_LICENSE_KEY=your-license-key
```

```bash
docker compose --profile geoipupdate up -d
```

The databases are stored in the `geoip-data` Docker volume and shared between the web and Caddy containers.

---

## Analytics

Analytics uses a bundled ClickHouse instance for storing and querying traffic events and WAF events. Data is retained for **30 days** by default via ClickHouse's TTL. Change the window with the `CLICKHOUSE_RETENTION_DAYS` environment variable — on the next startup the existing tables' TTL is migrated to the new value and expired data is purged.

### Enabling and disabling analytics

Open **Settings → Analytics**, tick **Collect analytics**, and set a ClickHouse password. Saving
starts the `clickhouse` container; unticking stops it. Nothing needs to change in `.env`, and no
Compose profile has to be listed — the agent runs `docker compose --profile clickhouse up -d
clickhouse` on your behalf, passing the saved credentials through.

Three things to expect:

- **The first start pulls the ClickHouse image**, which takes a few minutes on a slow link. The
  save returns immediately; the agent reports progress under **Settings → Agent**.
- **Turning analytics off stops the container but keeps `clickhouse-data`.** Your event history
  survives, and turning it back on picks up where it left off.
- **Pick one owner.** Once the credentials live in Settings, drop `clickhouse` from
  `COMPOSE_PROFILES` and delete `CLICKHOUSE_PASSWORD` from `.env`. Leaving both in place means your
  own `docker compose up -d` also creates the container — from the `.env` values, which are now the
  stale copy. The controller repairs it on its next start, but the window is avoidable. A fresh
  install already starts this way: `.env.example` ships both commented out.

Without an agent — a standalone binary, or a stack you assemble yourself — Docker is the only thing
that can start ClickHouse, so it is the profile as before:

```env
COMPOSE_PROFILES=clickhouse
CLICKHOUSE_PASSWORD=your-clickhouse-password   # openssl rand -base64 32
```

```bash
docker compose up -d
```

Leaving `COMPOSE_PROFILES` empty and omitting `CLICKHOUSE_PASSWORD` disables analytics there. The
web container starts normally without ClickHouse, the Analytics page explains that it is not
enabled, and no data is collected.

### Combining profiles

To run both without an agent, list both:

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

## IPv6

Both families, everywhere, by default.

- The controller binds `::`, a dual-stack socket that accepts IPv4 too. `HOST=0.0.0.0` restricts it
  to IPv4 if you want that.
- Caddy's admin API listens on a bare port rather than `0.0.0.0`, so an agent reaching it over IPv6
  finds something there.
- `caddy-network` is created with `enable_ipv6`, without which a proxy host with an IPv6 upstream
  has no route to it however the containers themselves are configured.
- Layer-4 listen addresses and upstreams accept `[2001:db8::1]:5432`. **The brackets are
  required**: unbracketed, `2001:db8::1` ends in `:1`, which is indistinguishable from a port — so
  it is rejected rather than silently read as one.
- Trusted proxies, geo-blocking allow/block lists and access lists already took IPv6 addresses and
  CIDR ranges.

## The Agent

Publishing a layer-4 port and changing Caddy's compiled-in plugins both need the Caddy *container*
recreated, not just its config reloaded. The controller has no Docker access — deliberately — so a
second container does that work and the two talk over a small REST API.

Every request is signed with a shared secret using HMAC-SHA256 over the method, path, timestamp and
body. The secret never travels with a request, and the signature covers the path, so a captured
read cannot be replayed as a write.

### Analytics are written by the agent

Caddy's access and WAF logs are files on the agent's host — a controller elsewhere cannot read them
at all. So the agent parses them and inserts the events into ClickHouse itself, using credentials
the controller pushes to it. ClickHouse still lives with the controller; only the write path moved.

Nothing to configure: enabling analytics on the controller (`CLICKHOUSE_PASSWORD`) is what causes
the credentials to be pushed, and turning it off pushes `null` and stops the agent writing. The
push happens at startup and whenever those settings change.

Worth knowing before enabling analytics on a fleet: the credential pushed is the same ClickHouse
account the controller reads with, not an insert-only one, and it goes to every agent host.

### GeoIP databases come from the controller

The controller holds the MaxMind subscription and the `geoipupdate` container that refreshes the
databases. An agent on another host fetches them through the controller rather than needing a
licence key of its own, checking daily and downloading only when the copy it has is out of date.
It writes them where Caddy reads them, so geo-blocking works on every host in the fleet.

This is the only request that runs agent-to-controller, and it is signed with the same pairing
secret — no extra credential. It does mean a remote agent has to be able to reach `BASE_URL`. An
agent that cannot keeps using whatever database it already has.

### One controller, one configuration

Everything a proxy serves — hosts, certificates, access lists, published ports, compiled-in
plugins — belongs to this controller's database, not to any host. Every agent's Caddy is loaded
with the identical document. A change is applied to all of them or to none: if one agent rejects
the config or cannot be reached, the whole apply fails and names that agent, rather than leaving
one proxy serving the new configuration and another serving the old.

Two consequences worth knowing:

- **Plugins are the intersection.** A handler is only emitted if *every* agent's Caddy was built
  with the module behind it, because one document goes to all of them and Caddy rejects a document
  naming a module it lacks — wholesale, taking every host on that instance down with it. Rebuild
  the fleet before a newly enabled module takes effect.
- **Ports are published everywhere.** A layer-4 host's port is opened on every agent, since any of
  them may be the one a client reaches.

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
  Proxy Hosts page follows caddy-l4; the Tailscale settings and every per-host
  tailnet option follow caddy-tailscale; and each DNS provider follows its own
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

Every `replace` directive in that `go.mod` is passed through to the build, so a
plugin can be pointed at a fork carrying a fix its upstream has not merged. Each
one says why it exists in a comment beside itself, and the resolved list below
records them, so an image never hides which source a plugin actually came from.
`caddy-tailscale` is on one now — see [The plugin is on a
fork](#the-plugin-is-on-a-fork).

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

## Tailscale

A proxy host can be served on your [tailnet](https://tailscale.com/) instead of, or as well as, the
public internet — and it does not need anything else on the host. The
[caddy-tailscale](https://github.com/tailscale/caddy-tailscale) plugin runs a Tailscale node in
userspace inside the Caddy process: no `tailscaled`, no `/dev/net/tun`, no extra published ports,
and no change to `docker-compose.yml`.

Turn it on in **Settings → Tailscale**. The one thing it needs is a reusable auth key from the
Tailscale admin console. If you would rather not store the key in the database, put a Caddy
placeholder in the field instead — `{env.TS_AUTHKEY}` is passed through untouched, and Caddy
resolves it from the container's environment.

| Setting | What it does |
| --- | --- |
| **Auth key** | Registers each node. Encrypted at rest and never sent back to the browser. |
| **Default node name** | The tailnet machine name a host inherits when it names none. Several hosts can share one node. |
| **Tags** | ACL tags applied at registration. Most reusable auth keys require at least one, e.g. `tag:caddy`. |
| **Control server URL** | Point at Headscale or another coordination server. Empty uses Tailscale's own. |
| **State directory** | Where each node keeps its identity, one subdirectory per node. Defaults to `/data/tailscale`, which is on the `caddy-data` volume — keep it on a volume, or every restart registers a new machine. |
| **Ephemeral** | Nodes leave the tailnet when Caddy stops instead of lingering as offline machines. |
| **Check the auth key** | Verify the key against the Tailscale API before saving. Off by default; see [Checking the auth key](#checking-the-auth-key). |

### Per host

**Proxy Host → Tailscale** carries three things.

**Serve on tailnet.** The host's routes move to a listener on the chosen node. **Tailnet only** —
on by default — keeps them off the public `:80`/`:443` listener entirely, so the service exists
only for devices on your tailnet; turn it off to publish in both places.

Routing is still by `Host` header, so add the node's MagicDNS name (`<node>.<tailnet>.ts.net`) to
the host's **Domains**. Caddy gets the certificate for that name from Tailscale — no ACME, no DNS
provider, and nothing to configure. A `.ts.net` domain is never sent to a public CA, which could
not validate it anyway.

**Require a Tailscale identity.** Only devices signed in to your tailnet may reach the host, and the
caller is identified by their tailnet login. Supports the same protected/excluded path lists as the
other authentication integrations, and **Forward the identity upstream** sets these on the proxied
request:

| Header | Value |
| --- | --- |
| `X-Tailscale-User` | Full login, e.g. `alice@example.com` |
| `X-Tailscale-Login` | Login without the domain |
| `X-Tailscale-Name` | Display name |
| `X-Tailscale-Tailnet` | Tailnet name |
| `X-Tailscale-Profile-Picture` | Profile picture URL |

Any such header sent by the client is stripped before the request is proxied, on every route,
including ones that bypass the identity check — so an upstream can trust what it receives.

Tagged devices are refused: a tag has no user behind it, so there is no identity to forward.
Identity authentication needs the host to be served on the tailnet, and is dropped if it is not —
the authenticator finds its node through the listener the request arrived on.

**Reach upstreams over the tailnet.** Independent of the other two: a host published on the public
internet can still proxy to a machine that only exists on your tailnet. Name a node to dial through
and put a MagicDNS name or tailnet IP in **Upstreams**. Upstream DNS pinning and custom DNS
resolvers do not apply to these — names are resolved by MagicDNS on the far side, which this
container's resolver knows nothing about.

A node named only here is never listened on: it exists so Caddy has something to dial out through,
and it stays idle until a request goes through it.

### Checking the auth key

A node that cannot register is a listener that never comes up, and Caddy refuses a configuration it
cannot start — so a missing or rejected auth key fails the apply for **every** host on **every**
agent, with an error naming Tailscale rather than whatever was being edited. Two things guard
against that.

**A host that uses Tailscale will not save while no key is stored.** This is unconditional, and it
covers the REST API as well as the form. A Caddy placeholder counts as a key: whether the
environment actually defines `TS_AUTHKEY` is only knowable inside the Caddy container.

**Optionally, the key itself is checked before it is stored.** Turn on *Check the auth key against
the Tailscale API* in **Settings → Tailscale**. A revoked, expired or mistyped key is then refused
at the point you paste it, with the reason, instead of surfacing at the next config apply.

This needs a second credential. An auth key (`tskey-auth-…`) authenticates a device registration and
nothing else — only an API access token (`tskey-api-…`) can call the API — so the check asks for one,
and is off by default because it is the only thing in this app that reaches Tailscale on its own.
Read access to keys is enough. The tailnet field is `-` for the token's own tailnet, which is right
unless you administer several.

> **With the check off, nothing can tell a revoked key from a working one.** The first sign is a
> failed apply, and until the key is fixed no proxy host on any agent can be updated. That is the
> trade: an outbound request to Tailscale on save, against discovering a dead key at the worst
> moment.

Some keys cannot be checked even with it on — an older `tskey-<secret>` key, a Headscale key, or a
Caddy placeholder — because none of them carries an id the API can address. Those save with a note
in the log rather than being refused: the format is not a documented contract, and guessing wrong
would reject a key that works. If the API cannot be reached at all, the save **is** refused, since
letting it through would quietly defeat the point of turning the check on.

### The plugin is on a fork

`docker/caddy/go.mod` points `caddy-tailscale` at a fork of upstream's own `main` plus the one
commit proposed in [tailscale/caddy-tailscale#142](https://github.com/tailscale/caddy-tailscale/pull/142),
for a crash that is not merged yet.

A node is not started until something uses it, and a node named only by the reverse-proxy transport
is not used until the first request goes through it. Releasing one in that state crashed Caddy from
inside `tsnet`: `tailscaleNode.Destruct` calls `tsnet.(*Server).Close`, which is documented as unsafe
before `Start` and dereferences state that only `start()` creates. Caddy releases the previous
configuration's modules after every reload and again on shutdown, so a single host dialling over the
tailnet took the admin API down on the apply that stopped using it — reporting failure across the
fleet when the configuration had in fact been applied — and turned every container stop into a
crash. `CertDomains` had the same flaw, reached on every TLS handshake, so one idle node would break
certificates for all of them.

The commit records whether `Start` ever returned successfully and consults that in both places. With
it, four previously-crashing cases are clean: the reload that stops using a node, shutdown, `caddy
validate`, and a load that fails on a bad auth key — which now exits 1 with the Tailscale error
instead of 2 with a stack trace.

Nothing else guards against this, so keep the `replace` directive until the PR merges.
`docker/caddy/go.mod` says as much beside it.

### What happens if the module is missing

Tailscale is a Caddy plugin, so it has to be in the binary. It is in the default image, but if it is
switched off in **Settings → Caddy Build** — or switched back on and not rebuilt yet — a host set to
**tailnet only** is dropped from the configuration entirely rather than published on the public
listener. Serving something privately-intended to the internet is the one failure mode worth an
outage; the reason is logged, and everything else keeps serving.

L4 proxy hosts are not on the tailnet — only HTTP proxy hosts are.

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

### Back-channel logout

CPM implements [OIDC Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html), so an identity provider can end a user's CPM sessions when it ends their SSO session — an administrator revoking access, a sign-out at another application, or a disabled account.

Register this as the provider's **back-channel logout URL**:

```text
{BASE_URL}/api/auth/oidc/backchannel-logout
```

It is also shown in **Settings → OAuth Providers**, beside the callback URL. One URL serves every configured provider: the logout token names its own issuer, and that selects the provider whose client ID and signing keys it is checked against.

The endpoint is optional — nothing else changes if you do not configure it — and unauthenticated by design, because the caller is the provider's server rather than a browser. The signed token is the whole of the authentication, so it is rejected unless it verifies against the issuer's published JWKS, carries that provider's client ID as its audience, names a back-channel logout in its `events` claim, carries no `nonce`, was issued within the last five minutes, and has a `jti` that has not been seen before.

What gets ended:

- A token carrying a `sid` ends exactly the CPM session that came from that IdP session, leaving the user's other devices signed in. This needs a provider that puts `sid` in its ID tokens; most do.
- A token carrying only a `sub` ends every CPM session for that identity, because there is nothing finer to go on.
- Either way, the user's **forward-auth sessions** for proxied hosts are dropped too. Those are minted from a CPM session but outlive it, so a proxied host would otherwise keep letting the user in after their SSO session ended.

Failures answer `400` with an `error_description` naming the check that failed. A token for someone who was never signed in answers `200` — there is nothing to do, and reporting that as an error would have the provider retry indefinitely.

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

- Follow the existing code style — `bun run lint` and `bun run format` run Biome, which is the formatter here
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
- **[Astryx](https://www.npmjs.com/package/@astryxdesign/core)** - The component library the dashboard is built from
- **[Drizzle ORM](https://orm.drizzle.team/)** - Lightweight SQL migrations and type-safe queries

---

<div align="center">

[⬆ back to top](#caddy-proxy-manager)

</div>
