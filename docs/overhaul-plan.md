# Configuration overhaul

Moving most settings out of `.env` and into the database, so upgrades and configuration stop
requiring a file edit and a restart, and so a first-run setup flow becomes possible at all.

Restored from the working tree's `OVERHAUL.md`, with the decisions taken on 2026-09-02 folded in.

## Goals

- Reorganize the repo into a monorepo, with separate packages for the controller, the agent, the
  project's website, and anything else currently in the tree.
- In-app user setup: the first-run flow creates a local user or configures OAuth.
- IPv6 support in both the controller and the agent.
- Move settings from `.env` into the database, leaving only what is needed to reach the database or
  to start the process before the database is readable.
- `sidecar` becomes `agent`, and becomes genuinely separate. The agent handles all interaction with
  the Caddy servers; the controller talks to it over a REST API with a shared secret negotiated at
  setup.
- Separate the application into its core parts for maintainability.
  - SQLite support is removed from the controller. PostgreSQL and PostgreSQL-compatible only.
  - Agents keep SQLite for their own internal database.

## Agent overhaul

The agent is a separate service responsible for managing the Caddy servers and communicating with
the controller. The controller reaches it over a REST API authenticated with a shared secret.

Where controller and agent share a machine, the controller uses a Unix socket — first to negotiate
the secret, then to communicate using it. Where they are on different machines:

1. The user clicks **Connect new agent** in controller settings.
2. A modal shows the controller's public IP, a random OTP of 6 capital letters, and a 5-minute
   timer showing how long the code is valid.
3. The user puts the IP and the code into the agent's `.env`, or into the agent's setup page.
4. The agent uses them to connect and negotiate a shared secret. Both sides store the secret in
   their own database for future communication.

`AGENT_MODE` selects between the two: `standalone` uses the socket, `managed` uses the IP and OTP.

## First-run setup flow

Triggered when the app finds no existing database setup, or a `.env` present with the database not
yet configured.

1. Ask whether this is a controller or an agent. For an agent, stop: explain that agent setup is
   separate, is done after the controller is up, and point at the agent setup page on the wiki.
2. Present a user-creation page with a toggle above it for OAuth setup instead.
   - Local user: prompt for username and password, enforcing the password policy.
   - OAuth: prompt for the provider settings (client id, client secret, issuer, and so on).
3. Route to a login page to prove the login actually works before going any further. A mistake in
   the OAuth settings or a forgotten admin password then costs only a database reset.
4. After a successful login, route to a settings page covering everything else that used to live in
   `.env` — ClickHouse, geoipupdate, and the rest. **Save** writes them to the database and routes
   to the app. Nothing is saved before Save is clicked.

## Migration flow

Triggered when an existing SQLite database is detected, or a `.env` carries settings not yet in the
database.

1. Sanity-check the old database. On failure, tell the user migration cannot proceed and that they
   must migrate settings by hand. On success, copy its settings into PostgreSQL.
   - Existing databases are auto-detected and verified against the expected schema. If more than
     one candidate is found, the user picks which to migrate.
2. Copy the `.env` settings into the database's settings, **excluding** everything in the
   "Stays in `.env`" table below.
3. Route to the same settings page as first-run setup, with migrated values pre-filled and
   highlighted as having come from `.env`. Save writes them and routes to the app.
4. After Save, confirm the migration, offer a backup download of the old database, warn that the
   old database will be deleted, and provide a copyable `.env` with the migrated entries removed.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | `INSTANCE_MODE=controller\|agent` already means replica sync — a naming collision | Keep the controller/agent vocabulary and **replace** the old roles with the new system. The existing instance-sync feature is deleted, not renamed: the agent removes the reason it existed. |
| 2 | How does an existing SQLite deployment upgrade? | Auto-detect existing databases and verify they match the expected schema; on multiple matches the user chooses. Add a `postgres` service to the Compose stack and a password field to `.env.example`. |
| 3 | Do ClickHouse and geoipupdate move to the agent? | No. Both stay with the controller. The controller hands agents ClickHouse credentials so they insert their own events directly, rather than shipping events through the controller. The shared credential is scoped to an insert-only ClickHouse user, since it now travels to every agent host. |
| 4 | Branch strategy | Phases land sequentially on `main`. |
| 5 | Where does the test suite's database come from once SQLite is gone? | A throwaway PostgreSQL container started by a global setup, so `bun test` keeps working on a fresh clone with no manual setup. |

## Stays in `.env`

Everything not listed here moves to the database.

| Variable | Why it cannot move |
| --- | --- |
| `DATABASE_URL` | Needed to reach the database. |
| `DATABASE_POOL_MAX` | Sizes the pool that reads the database, so it cannot be read from it. |
| `SESSION_SECRET` | HKDF root for `encryptSecret`, so it encrypts the database's own secrets. It cannot live inside what it encrypts, and rotating it makes every stored secret unreadable. |
| `NODE_ENV` | Read at module load, before any query. |
| `PORT`, `HOST` | The socket binds before the app can read anything. |
| `CPM_APP_ROOT`, `CPM_HEALTHCHECK_URL` | Standalone-binary bootstrap paths, used before the app starts. |
| `COMPOSE_PROFILES`, `HOSTNAME`, `PUID`, `PGID`, `POSTGRES_PASSWORD` | Read by Compose on the host. Compose cannot read the database. |
| `LEGACY_KEY_CUTOFF_DATE` | Break-glass knob governing whether stored secrets can be decrypted at all. Low confidence — this one could reasonably move. |
| Agent-side: `AGENT_MODE`, `CONTROLLER_ADDR`, `AGENT_PAIRING_CODE`, `AGENT_DB_PATH`, `DATA_DIR`, `COMPOSE_DIR` | Pre-database bootstrap for the agent process. |

`BASE_URL` moves, despite being needed for the OAuth callback URL during setup: it is derived from
the request origin at setup time and stored.

## Phases

Each phase ends green — tests, typecheck, lint, build — and lands on `main` on its own.

| # | Phase | Status |
| --- | --- | --- |
| 0 | Monorepo restructure | Done — `4463b947` |
| 1 | PostgreSQL only | Done |
| 2 | Settings service: typed registry, DB-backed config with an env-override layer | Done |
| 3 | First-run setup and login-verify flow | Done |
| 4 | Migration flow | |
| 5 | Agent extraction, pairing, and the ClickHouse/GeoIP handoff | |
| 6 | IPv6 | |

### Consumers still reading the environment directly

Phase 2 built the service and moved the Caddy admin URL and the login throttle onto it. The rest
are deliberately still on `process.env`, for reasons that are worth keeping straight:

| Setting | Why it has not moved |
| --- | --- |
| `AVATAR_GRAVATAR`, `AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH` | Both already have a stored value too — a JSON blob the Settings page writes — and the environment variable only pins it. Reading the registry alone would silently discard whatever the operator chose in the UI. They move in phase 4, where the migration can carry the blob's value across. |
| `CLICKHOUSE_*` | Read into module-scope constants that are interpolated into the table DDL, so making them async means restructuring how the schema is built. Worth doing on its own, not as a rider. |
| `APP_NAME` | Reached from `app/layout.tsx`'s static `metadata` export, which has to become `generateMetadata()` first. |
| `AUTH_*`, `BASE_URL` | Phase 3 rewrites the paths that read them, so converting now would be work done twice. |

### Owed to phase 4

Three test files were deleted in phase 1 because they tested a path that no longer exists — running
the application *on* a legacy SQLite database. What they covered is still worth covering, but as
migration tests, reading an old database rather than booting on one:

- `auth-adapter-compat.test.ts` — Better Auth reading rows written by the old Kysely/SQLite path.
- `db-compat-accounts.test.ts` — repairing a legacy `accounts.id` schema, and the issuer backfill's
  refusal to merge colliding identities.
- `db-backend.test.ts` — serial ids, boolean round trips, upserts and transactions. Now covered
  incidentally by the whole suite running on PostgreSQL, so this one needs no successor.

`src/lib/db/legacy-sqlite.ts` is unreferenced for the same reason and kept for the same one: it
encodes which release wrote which column names, which is not recoverable from the current schema.

Phases 1 and 5 carry the risk. Phase 1 rebuilds the test suite's database layer across 132 test
files; Phase 5 moves the eight places the controller touches the Caddy host's filesystem behind an
API, and adds GeoLite2 distribution to agents.
