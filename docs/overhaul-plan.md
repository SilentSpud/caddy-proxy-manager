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
| 4 | Migration flow | Done |
| 5 | Agent extraction, pairing, and the ClickHouse/GeoIP handoff | Done |
| 6 | IPv6 | Done |

### Phase 5, step 1: instance sync deleted

The old feature is gone in one commit, ahead of the agent work, because everything the agent
replaces it with would otherwise have to keep it compiling.

What went: `instance-sync.ts` and its four leaf modules, the `instances` table and model, both
`/api/instances/sync` and `/api/v1/instances*`, the Settings → Instance Sync screen, and the
`INSTANCE_*` environment variables. Two collapses fell out of it and are the parts worth
remembering:

- **`getEffectiveSetting` is `getSetting` again.** The `synced:` key prefix existed so an agent
  could inherit a controller's settings and override them locally. With no controller pushing,
  every read is a plain read, and the eleven "Override controller settings" toggles in the
  Settings UI went with it.
- **`applyCaddyConfig` no longer pushes.** It ended by calling `syncInstances()` and could fail
  with `INSTANCE_SYNC_FAILED` after Caddy had already accepted the config — an apply that both
  succeeded and reported failure. That code is gone from `CaddyApplyErrorCode`.

The end-to-end stack lost the four services that only existed for this feature — `web-controller`,
`web-agent` and their two Caddy instances — along with three networks, four volumes and two of the
extra databases `postgres-init.sql` created. The `docker-tests` rig lost its `--sync` profile for
the same reason.

The `instances` table was dropped from `drizzle/postgres/0000_initial.sql` by regenerating it
rather than adding a migration: PostgreSQL support is unreleased, so no deployment has ever run
the version that created it. The legacy importer is schema-derived, so a pre-3.1 database's
`instances` rows are simply not copied — which is correct, since nothing would read them.

### Phase 5, step 2: the agent is a service

The agent was a 400-line POSIX shell script polling files on a shared volume. It is now a Bun HTTP
service with its own SQLite database, and the controller reaches it over a signed REST API.

**Why signing rather than a bearer token.** Every request carries an HMAC-SHA256 over
`METHOD
PATH
TIMESTAMP
SHA256(body)`; the secret never travels with a request, so it cannot be
lifted from a proxy log or a `curl -v` pasted into an issue. Binding the path into the signature is
what stops a captured `GET /v1/status` from being replayed as `POST /v1/caddy-build`, and binding
the body stops a valid request being edited in flight. A ±60s window bounds replay.

**Two listening modes, one code path.** `standalone` binds a Unix socket on the shared volume and
writes the secret beside it, rotating it on every start — a controller in the same stack is
configured by mounting the volume and nothing else. `managed` binds TCP and prints a six-capital
one-time code, valid five minutes, burned on use or after ten wrong guesses. Both modes verify the
same signature, which is what keeps them one program.

**What moved.** The controller no longer writes the compose overrides or the trigger files; it
sends `{ports}` or `{modules}` and reads a status back. Both writes answer 202 — a recreate takes
seconds and a rebuild takes minutes — and the agent records the applied set only once Caddy is
healthy again, which is the invariant the whole desired/applied split exists to protect.

**Validation moved with it.** The port and module specs are interpolated into generated YAML, so
the agent re-validates them against a strict pattern rather than trusting a caller that has already
authenticated. `docker compose` is spawned without a shell, so this is not a command-injection
route — but a quote or a newline still corrupts the compose file, which is a config-injection route
into the build.

The 28 tests that pinned the old script's behaviour by grepping its source are gone. What they
covered — `--no-deps`, `--force-recreate`, `--pull never`, only the caddy service, both overrides
on every invocation, a bounded build, a failed build leaving the container alone, the applied
record written only when healthy, a stale status cleared on restart — is pinned properly now,
against the argv the agent actually builds. The controller's side is tested against a real HTTP
server that verifies the real signature, so nothing about this seam is covered only by a mock.

**One behaviour that had to be carried across deliberately.** The old script re-applied the port
override on every startup, because the operator's `docker compose up` starts Caddy from the base
files, which carry no generated override — so a rebooted host comes up with every L4 port
unpublished. The first version of the service reconciled the *record* to Docker instead, which is
the opposite and would have silently broken layer-4 routing across a reboot. It now compares the
two and republishes on a mismatch, adopting Docker's list only when it has never applied anything.

**Not yet done, and owed to the next step:** the `agents` table and the pairing UI — done in step
3 below. The ClickHouse credential handoff and GeoLite2 distribution are still outstanding.

### Phase 5, step 3: pairing

Agents reached over the network now live in an `agents` table and are paired from
**Settings → Agent**, rather than being configured with `AGENT_URL` and `AGENT_SECRET`.

**The secret's path is the whole design.** It is generated by the agent, returned once over the
pairing response, encrypted with `encryptSecret` before it touches a row, and read back only by
`getActiveAgent` on the server. It is not in the server action's return value — that value is
serialized to the browser — not in a log line, and not in any view type. Three tests pin exactly
that, because none of it fails loudly if it breaks.

**The local agent is deliberately not a row.** It proves itself with a secret it rotates on every
start, so a stored copy would be wrong after the first restart. It stays discovered by its socket
on the shared volume, and the table is only for agents whose secret was agreed once and is the only
way back to them.

**Resolution order is paired → environment → local socket.** Pairing is an explicit act by an
operator, so a leftover `AGENT_URL` must not silently override it; that ordering is tested.

**What pairing refuses** matters more than what it accepts, since an operator gets one code and
five minutes: an address with a path or a non-HTTP scheme (a sign something else was pasted), a
code that is not six letters, a reply whose secret is too short to be an agent's, and a code the
agent has already burned. Each failure says which of those happened rather than "pairing failed".

**Also not done:** there is no `/api/v1/agents` REST surface. The old `/api/v1/instances*` routes
went with instance-sync and nothing has replaced them; pairing is UI-only for now.

### Phase 5, step 4: more than one agent

The open question from step 3 — do proxy hosts belong to a host or to the fleet? — is answered:
**to the fleet.** The controller's database is the single source of truth, and every agent's Caddy
is loaded with the identical document.

That is what instance-sync tried to do and got wrong. It replicated the *database* to a second CPM
instance, which gave every replica its own writable copy, its own drift, and a `synced:` override
layer to paper over the difference. Replicating only the *rendered configuration* has no divergence
surface at all: there is one writer, and the agents hold no state the controller does not.

**This also fixed a live bug rather than only adding a feature.** Until now the controller reached
Caddy at its own `CADDY_API_URL` while the agent recreated a container on its own host. With a
paired remote agent that is a split brain: ports and rebuilds landed on the remote host, config on
the local one. Every admin call now goes through an agent, because the agent is the only thing that
knows where its Caddy is. `CADDY_API_URL` is the agent's setting; the controller keeps it only for
a deployment running Caddy with no agent.

**Writes fan out, reads do not.** Config loads, port publishes and rebuilds go to every agent and
report per agent; a rejection or an unreachable host fails the whole apply and names the agent,
because half a fleet configured is a state to report, never one to succeed at. Reads go to the
first agent, since every Caddy carries the same document and a second answer would be the same
answer. With one agent nothing fans out at all — it goes through the ordinary transport seam, which
already routes to that agent, and which is what keeps the seam testable.

**Module availability is the intersection.** A handler is emitted only if every agent's binary has
the module behind it: one document goes to all of them, and Caddy rejects a document naming an
unknown module wholesale. An unreachable agent contributes nothing rather than emptying the set —
it cannot be configured either, and stripping every plugin-backed handler from the hosts that *are*
reachable would turn one unreachable agent into a fleet-wide outage.

**The agent's Caddy proxy is an allowlist, not a sanitiser.** `/load`, `/config/`, `/adapt` and
`/reverse_proxy/upstreams` are the four paths the controller needs. Caddy's admin API can also stop
the server outright, and a request for anything else is a sign it did not come from this
application, whatever signed it.

The compose file puts the agent on `caddy-network` for this. It already controls that container
through the Docker API, so reaching its admin port grants it nothing it did not have.

**One cost had to be paid back.** Reads that were file reads are now HTTP round trips, and a single
render asks for the agent's status several times — the port diff and the port status, the build
diff and the module gate. Fanning each of those out to every agent made the layer-4 page slow
enough that an e2e click landed before the page had settled. Concurrent callers now share one round
trip; only in-flight calls are shared, never a completed one, so nothing is ever served a status
from before an apply the operator just triggered.

### Phase 5, step 5: analytics move to the agent

The decision was "instead of shipping events to the controller, have the controller give the
ClickHouse credentials to the agents so they can add to it themselves". Doing that meant moving the
log parsers too, because the thing being parsed is a file on the agent's host: a controller
elsewhere cannot read it at all, and relaying every request through it would put the busiest write
path in the fleet through a machine with nothing to do with it.

`log-parser.ts`, `waf-log-parser.ts` and `log-read.ts` moved to `apps/agent` with two seams
changed: the parse offsets now live in the agent's SQLite instead of two PostgreSQL tables, and the
rows go to an insert-only ClickHouse client instead of the controller's. Their five test files came
with them and got *simpler* — the controller's copies mocked `db`, `maxmind`, `node:fs` and the
ClickHouse client to isolate pure functions; in the agent those are real dependencies of the
package, so most of the mocking was deleted. The truncation test now runs against a real
`AgentStore` on a temp file rather than a shape-mocked data layer.

**Credentials are pushed, never fetched.** An agent needs no credential for the controller, and the
direction of trust stays one-way. `POST /v1/fleet-config` validates the URL's scheme before storing
it — the agent dials that value, and a pushed `file://` would be a different kind of request
entirely — and persists it so a restarted agent keeps writing without waiting for the controller to
notice it came back.

**One thing had to be reported rather than checked.** The controller decided "logging is disabled"
by looking for `/logs/access.log` on its own filesystem. That is now the agent's to answer, and it
does, in its status: checking locally would have reported logging as off on every deployment whose
Caddy runs somewhere else.

### Phase 5, step 6: GeoLite2 distribution

The controller holds the subscription and the `geoipupdate` container; agents fetch the databases
through it, which is what "the agents will reach them through the controller" asked for.

**Pulled, not pushed** — the only route in the protocol that runs agent-to-controller. These files
are tens of megabytes, and chunking them over the JSON push API to preserve a direction would have
been ceremony rather than design.

**It needs no new credential.** The pairing secret is symmetric, so the agent signs with the same
`signatureBase` and the controller verifies against the row it stored. The local agent never uses
this at all: it shares the volume the files are on.

**Every refusal is 404, not 401.** An unsigned caller, an unknown agent id, a stale timestamp, a
disabled agent, an edition this controller does not have — all identical from outside, so nothing
can learn the route exists or which agent ids are real without already holding a secret. The
edition name is checked against a fixed list *before* authentication, because it becomes a path on
the controller's filesystem.

**Conditional, and atomic.** The controller answers `304` against a size+mtime ETag, so a daily
check moves nothing when nothing changed — including in the single-host case, where both sides are
looking at the same file. The agent downloads to a temporary name and renames into place, because
Caddy has that directory open and a partial file under the real name is one it would try to load.

The agent's `geoip-data` mount becomes writable for this. It is the only place that volume is not
read-only, and on a host with no `geoipupdate` of its own the agent is what puts the files there
for Caddy.

### Phase 6: IPv6

Mostly small, with one trap worth naming.

**The trap.** `2001:db8::1` ends in `:1`. Every place that split a listen address or an upstream on
the last colon read that as port 1 and carried on — a silently wrong listener, not an error. The
L4 listen address and upstream checks both did this, and so did the port computation that tells the
agent what to publish. They now go through `splitHostPort`, which refuses a bare IPv6 literal
outright: with a port, it must be bracketed, as it must everywhere else in this stack.

That function is built on the `parseHostPort` the HTTP upstream path already had rather than beside
it — the first draft duplicated the bracket handling, which is exactly the kind of second parser
that drifts. It adds the three things the upstream path does not need: a bare `:PORT` is valid,
the port must be numeric and in range, and brackets must actually contain an IPv6 address.

**The rest is binding.** The controller binds `::` rather than `0.0.0.0` — a dual-stack socket
accepts IPv4 too, while `0.0.0.0` leaves an IPv6-only client with nothing to connect to. Caddy's
admin API moves from `0.0.0.0:2019` to `:2019` for the same reason, with the bracketed loopback
added to its `origins` because Caddy matches the Host header literally. `caddy-network` gains
`enable_ipv6`, without which Docker gives it IPv4 only and an IPv6 upstream is unreachable however
the containers are configured.

**Already fine:** trusted proxies, geo-blocking lists and access lists validate through `isIP` and
took IPv6 addresses and CIDR ranges before this phase. The agent already bound `::`, from the day
it was written.

### Setup and migration, in a browser

The last open item, and it found a real bug on the first run.

**`/login` was public and returned before the setup check ran.** So a deployment that had never
been set up could not be set up through a browser: `/` redirected to `/login`, and `/login`
redirected nowhere. An operator saw a sign-in form for an account that did not exist, with no way
forward but guessing the URL. The integration tests could not have caught it — they call
`getSetupState` directly and never go through the proxy. The proxy now resolves the setup state
before the sign-in redirect, and `/login` is handled after it rather than as a public path.

**Two more web instances**, `web-setup` and `web-migrate`, each with an empty database and no
`ADMIN_USERNAME`. Setup is single-use by design, so an instance that has completed it cannot show
those screens again — resetting the main one was not an option. Both point at a dead Caddy admin
address: the setup screens never touch Caddy, and sharing the suite's would let an empty database's
startup apply wipe the routes the other tests had just created.

**The legacy database is real**, built from `drizzle/legacy-sqlite` and bind-mounted where the
application scans. Building it needs Bun, and Playwright runs specs under Node — which cannot load
`bun:sqlite` at all — so that half is a script the spec spawns rather than a function it imports.
That was the first thing the local run caught.

**One page per block, not one per test.** Playwright's default fresh context signed the operator
out between every step of a flow that is walked through in one session. Three of the four failures
in the local runs were that, or expectations about the flow that turned out to be wrong: creating
the first administrator sends you to `/login` on purpose (proving the password works before more
configuration is entered), and a migrated deployment finishes on `/setup/done` rather than the
dashboard, because it is owed its old database and a trimmed `.env` first.

### Consumers still reading the environment directly

Phase 2 built the service and moved the Caddy admin URL and the login throttle onto it. The rest
are deliberately still on `process.env`, for reasons that are worth keeping straight:

| Setting | Why it has not moved |
| --- | --- |
| `AVATAR_GRAVATAR`, `AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH` | Both already have a stored value too — a JSON blob the Settings page writes — and the environment variable only pins it. Reading the registry alone would silently discard whatever the operator chose in the UI. They move in phase 4, where the migration can carry the blob's value across. |
| `CLICKHOUSE_*` | Read into module-scope constants that are interpolated into the table DDL, so making them async means restructuring how the schema is built. Worth doing on its own, not as a rider. |
| `APP_NAME` | Reached from `app/layout.tsx`'s static `metadata` export, which has to become `generateMetadata()` first. |
| `AUTH_*`, `BASE_URL` | Phase 3 rewrites the paths that read them, so converting now would be work done twice. |

### Settled in phase 4

`AVATAR_GRAVATAR` and `AUTH_REQUIRE_PASSWORD_CHANGE_ON_LEGACY_HASH` now resolve through the
registry first and fall back to their old JSON blob only for deployments that have not migrated.
The migration lifts the blob's value into the registry key, which is what makes that fallback
safe to remove later.

### Owed to phase 4

Three test files were deleted in phase 1 because they tested a path that no longer exists — running
the application *on* a legacy SQLite database. What they covered is still worth covering, but as
migration tests, reading an old database rather than booting on one:

- `auth-adapter-compat.test.ts` — Better Auth reading rows written by the old Kysely/SQLite path.
  **Done:** `legacy-migration.test.ts` asserts the credential account row arrives intact, which is
  the only way one can reach a PostgreSQL deployment now.
- `db-compat-accounts.test.ts` — repairing a legacy `accounts.id` schema, and the issuer backfill's
  refusal to merge colliding identities. **Partly done:** the import is covered, but the issuer
  backfill's collision refusal is not yet exercised against a migrated database.
- `db-backend.test.ts` — serial ids, boolean round trips, upserts and transactions. Now covered
  incidentally by the whole suite running on PostgreSQL, so this one needs no successor.

`src/lib/db/legacy-sqlite.ts` is unreferenced for the same reason and kept for the same one: it
encodes which release wrote which column names, which is not recoverable from the current schema.

Phases 1 and 5 carry the risk. Phase 1 rebuilds the test suite's database layer across 132 test
files; Phase 5 moves the eight places the controller touches the Caddy host's filesystem behind an
API, and adds GeoLite2 distribution to agents.
