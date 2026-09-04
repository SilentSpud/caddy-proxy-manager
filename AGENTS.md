# AGENTS.md

Project-specific guidance for AI coding agents.

## Repository layout

A Bun workspace. Nothing but config, docs and the Compose stack lives at the root.

| Path | What it is |
| --- | --- |
| `apps/controller` | `@cpm/controller` — the web UI, REST API, schema, migrations and the whole test suite |
| `apps/agent` | `@cpm/agent` — manages the Caddy container on its host. Was `docker/sidecar` |
| `apps/site` | `@cpm/site` — the project website, static, no build step |
| `packages/shared` | `@cpm/shared` — contracts both the controller and the agent hard-code |
| `docker/` | Dockerfiles and image config. Build contexts are the repo root |

Root `package.json` scripts delegate with `bun run --filter`, so `bun run test`, `bun run build` and
`bun run typecheck` still work from the root and CI needed no new working directories. Anything
reading a path off `process.cwd()` inside the controller now resolves against `apps/controller` —
the e2e suite is the exception and pins `COMPOSE_CWD` to the repo root, because Compose anchors
every relative path in every `-f` file to the first one's directory.

`bunfig.toml` pins the **hoisted** installer. Bun 1.4 defaults workspaces to the isolated linker,
under which four direct imports (`jose`, `@better-auth/core/db`, `topojson-specification`,
`@maplibre/maplibre-gl-style-spec`) stop resolving because they arrive transitively. Declare those
before changing it.

## Comments

Terse. One line is the median here and three is already long — match that, in every language,
workflows and shell included. Explain *why*: a constraint, a gotcha, a decision that reads as a
mistake without it. Never restate what the line does, and leave code that holds no surprise
uncommented. Prefer tightening an existing comment to adding one beside it.

## Configuration

Most settings live in the database, defined once in `apps/controller/src/lib/settings/registry.ts`.
One definition carries the storage key, the environment variable it migrates from, validation, the
default, and where it renders — the setup flow, the Settings page and the migration carry-over all
read that list rather than repeating it. **A new user-facing setting is a registry entry, not a new
environment variable.** Resolution is stored value → environment → default (`resolve.ts`).

An environment variable is the right answer only for what has to be read before the database can
be: bootstrap paths, the connection string, the key that encrypts the database's own secrets. The
"Stays in `.env`" table in `docs/overhaul-plan.md` records which those are and why.

### When you do add, remove or rename one

Never a one-file change. Update `.env.example` and the README's environment tables in the same
commit as the code, and delete the entries when the variable goes away — a stale row is worse than
a missing one, because it reads as supported.

A variable the app reads must also be listed under `web.environment` in `docker-compose.yml` (or
`agent.environment` for an agent-side one). Compose forwards nothing implicitly and there is no
`env_file`, so an undeclared one is simply unset in the container: documented, honored in
development, silently ignored in production.

Give Compose the real default, not `${VAR:-}`, for anything parsed as `Number(process.env.X ?? d)`
— `??` does not catch the empty string that form produces, so the fallback lands as 0.

## Tests

`bun run test` from the root runs everything. It starts a throwaway PostgreSQL container, gives
each test its own schema, and removes it afterwards; `TEST_POSTGRES_URL` points at a server of your
own instead. Two constraints are not obvious from reading the suites:

- **`mock.module` is global and leaks across files sharing a process.** The agent's tests run with
  `--parallel` for that reason — a `node:fs` mock in one file was reaching every file that ran
  after it. A test that passes alone and fails in the suite is this, not flake.
- **Playwright specs run under Node, not Bun.** `bun:sqlite`, `Bun.password` and the rest are
  unavailable in `tests/e2e/**`. Anything needing them belongs in a script the spec spawns with
  `bun` — see `tests/helpers/build-legacy-db.ts`.

<!-- ASTRYX:START -->
Astryx v0.4.5 · 90+ components
CLI: run every command as `bunx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else Tailwind utilities backed by tokens (bg-surface, text-primary, rounded-lg) via tailwind-theme.css. No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any style={{…}}, raw <div>/<span> layout, imported .css/@apply, or hardcoded/arbitrary value (e.g. bg-[#fff], p-[13px]) with the component or a token-backed utility. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   90+ components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
