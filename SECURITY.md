# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by:

1. **DO NOT** open a public issue
2. Email the maintainers or use GitHub's private vulnerability reporting
3. Include detailed information about the vulnerability:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and provide regular updates on the fix progress.

## Security Measures

### Build Pipeline Security

Our CI/CD pipeline implements multiple security layers:

1. **Nothing published from a pull request**: images are built and pushed by one workflow
   (`docker-build-trusted.yml`), which runs only on a `v*` tag or a manual dispatch. A pull request —
   from a fork or otherwise — runs the test and end-to-end suites and never touches the registry, so
   there is no build-and-push path for untrusted code to reach.
2. **The version bump is the gate**: `release.yml` tags a release only when `package.json`'s version
   changes on `main`, and only that tag triggers an image build.
3. **SBOM Generation**: Software Bill of Materials is generated for all builds
4. **Provenance Attestation**: Build provenance is recorded for supply chain security
5. **Limited Permissions**: Workflows use minimal required permissions. The test workflow declares
   `permissions: {}`, so its `GITHUB_TOKEN` carries no scopes, and it references no repository secrets

### Container Security

- Multi-architecture builds (linux/amd64 and linux/arm64)
- Regular base image updates
- Minimal attack surface
- Non-root user execution where possible

### Caddy Module Builds

**Settings → Caddy Build** lets an admin choose which plugins Caddy is compiled
with, and add their own. Two consequences are worth stating plainly:

- **Custom modules are arbitrary code in the proxy.** A module added there is
  fetched from its Go module path, compiled into the Caddy binary, and runs with
  the proxy's privileges on every request. Treat adding one exactly as you would
  treat merging code into this repository. Module paths are validated against a
  strict allowlist before they reach the build (see `validateCustomModule`), so
  a path cannot inject shell into the Dockerfile — but a *valid* path to a
  malicious repository is still malicious.

- **Rebuilding widens the Docker API surface.** The `docker-socket-proxy`
  service ships with `BUILD: 1` so the agent can run `docker compose build
  caddy`. The socket proxy still denies `EXEC`, `SWARM`, `AUTH`, and `SECRETS`,
  and only the agent is attached to that isolated network — but image builds
  are a meaningful capability. Set `BUILD: 0` to opt out; the rest of the
  application is unaffected and images can be built by hand instead.

Only admins can reach either surface.

### First-run Setup

An installation with no accounts serves nothing but the setup flow, and that flow is necessarily
public — there is no account to authenticate against yet. **Whoever reaches a fresh deployment
first becomes its administrator.** Complete setup before the instance is reachable from anywhere
you do not control, or set `ADMIN_USERNAME`/`ADMIN_PASSWORD`, which seeds an admin at startup and
skips the flow entirely.

Once setup completes the flag is stored, and the setup screens redirect away for good.

### Controller and Agent

The controller reaches its agents over a REST API, and the seam is signed rather than
bearer-authenticated. Every request carries an HMAC-SHA256 over the method, path, timestamp and a
hash of the body:

- **The secret never travels with a request**, so it cannot be lifted from a proxy log or a
  `curl -v` pasted into an issue.
- **The path is bound into the signature**, so a captured read cannot be replayed as a write.
- **The body is bound too**, so a valid request cannot be edited in flight.
- A ±60 second window bounds replay.

**Pairing.** An agent on another host prints a six-letter code valid for five minutes, burned on
first use and refused after ten wrong guesses. The two exchange a secret, which is encrypted with
`encryptSecret` before it reaches a row and is never returned to the browser, logged, or included
in any view type. Unpairing forgets the controller's side only — restart the agent as well if you
are removing one you no longer trust.

**The agent's Caddy admin proxy is an allowlist**, not a sanitiser: `/load`, `/config/`, `/adapt`
and `/reverse_proxy/upstreams` are the four paths the controller needs. Caddy's admin API can stop
the server outright, so a request for anything else is treated as not having come from this
application, whatever signed it.

**Agent-to-controller** runs on exactly one route, the GeoLite2 download, signed with the same
pairing secret. Every refusal on it answers `404` — unsigned, unknown agent id, stale timestamp,
disabled agent, unknown database edition are all identical from outside, so nothing can learn the
route exists or which agent ids are real without already holding a secret.

**ClickHouse credentials travel to every agent.** Each host parses its own Caddy logs and inserts
the events itself, using credentials the controller pushes. Two things follow: enabling analytics
puts that password on every agent host, and it is currently the same account the controller reads
with, not an insert-only one. On a fleet spread across hosts you do not equally trust, weigh that
before turning analytics on.

**`SESSION_SECRET` is the root of all of it.** It derives the key that encrypts DNS provider
credentials, imported private keys, agent secrets and the secret settings. Rotating it makes every
one of them unreadable.

### Dependency Management

- Automated dependency updates via Dependabot
- Security alerts enabled
- Regular security audits

## Security Best Practices for Contributors

When contributing:

1. Never commit secrets, tokens, or credentials
2. Use environment variables for sensitive configuration
3. Keep dependencies up to date
4. Follow principle of least privilege
5. Validate and sanitize all user inputs
6. Use parameterized queries for database operations

## Automated Security Checks

Our repository includes:

- **Dependabot** for dependency updates
- **GitHub Security Advisories** monitoring

## Reviewing a fork pull request

No workflow publishes anything from a pull request, so review is about what merging would let in
rather than what the run itself can do:

1. Review the PR code thoroughly for malicious content
2. Check for suspicious file modifications — workflow files and `docker/` especially, since those
   decide what a later release builds and pushes
3. Verify no secrets or credentials are exposed

## Security Updates

Security updates are prioritized and released as soon as possible. Subscribe to repository releases to stay informed.
